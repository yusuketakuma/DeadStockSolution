/**
 * MEDIS HOT コードマスター取得・補完サービス
 *
 * パッケージ同期後に実行し、drug_master_packages に HOT コードを補完する。
 * ETag / contentHash で変更検出し、更新があった場合のみ補完を実行。
 */
import iconv from 'iconv-lite';
import AdmZip from 'adm-zip';
import { eq, isNull, inArray } from 'drizzle-orm';
import { db } from '../config/database';
import { drugMaster, drugMasterPackages } from '../db/schema';
import { createPinnedDnsAgent, validateExternalHttpsUrl } from '../utils/network-utils';
import { type FetchDispatcher } from '../utils/http-utils';
import { sha256 } from '../utils/crypto-utils';
import { checkForUpdates, downloadFile } from './mhlw-source-fetch';
import { persistSourceHeaders, SOURCE_KEY_HOT_MASTER } from './drug-master-source-state-service';
import { logger } from './logger';
import { getErrorMessage } from '../middleware/error-handler';

const HOT_MASTER_URL = 'https://www2.medis.or.jp/hcode/moto_data/h20260228.zip';
const BATCH_SIZE = 200;

interface HotMasterEntry {
  hot13: string;
  yjCode: string;
}

function parseHotMasterZip(buffer: Buffer): HotMasterEntry[] {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntries().find(
    (e) => e.entryName.endsWith('.TXT') && !e.entryName.includes('HOT9') && !e.entryName.includes('_OP'),
  );
  if (!entry) return [];

  const content = iconv.decode(entry.getData(), 'Shift_JIS');
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  const results: HotMasterEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    const vals: string[] = [];
    let cur = '';
    let inQ = false;
    for (const ch of lines[i]) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { vals.push(cur); cur = ''; continue; }
      cur += ch;
    }
    vals.push(cur);
    const hot13 = (vals[0] || '').trim();
    const yjCode = (vals[6] || '').trim();
    if (hot13 && yjCode) {
      results.push({ hot13, yjCode });
    }
  }
  return results;
}

export async function syncHotMasterCodes(): Promise<{ checked: boolean; updated: number; created: number }> {
  const sourceUrl = HOT_MASTER_URL;
  const result = { checked: false, updated: 0, created: 0 };

  const validated = await validateExternalHttpsUrl(sourceUrl);
  if (!validated.ok) {
    logger.warn('HOT master sync: URL validation failed', { reason: validated.reason });
    return result;
  }

  const pinnedAgent = createPinnedDnsAgent(
    validated.hostname ?? new URL(sourceUrl).hostname,
    validated.resolvedAddresses,
  );
  const dispatcher = pinnedAgent as unknown as FetchDispatcher;

  try {
    // ETag / Last-Modified チェック
    const updateCheck = await checkForUpdates(sourceUrl, dispatcher, {
      sourceKey: SOURCE_KEY_HOT_MASTER,
      retries: 1,
      headers: { 'User-Agent': 'DeadStockSolution-HotMasterSync/1.0' },
    });
    result.checked = true;

    if (!updateCheck.hasUpdate) {
      logger.info('HOT master sync: no updates detected');
      await persistSourceHeaders(SOURCE_KEY_HOT_MASTER, sourceUrl, updateCheck, false);
      return result;
    }

    // ダウンロード
    logger.info('HOT master sync: update detected, downloading');
    const { buffer } = await downloadFile(sourceUrl, dispatcher, {
      retries: 1,
      headers: { 'User-Agent': 'DeadStockSolution-HotMasterSync/1.0' },
    });
    const contentHash = sha256(buffer);

    if (updateCheck.compareByContentHash && updateCheck.previousContentHash === contentHash) {
      logger.info('HOT master sync: no change by content hash');
      await persistSourceHeaders(SOURCE_KEY_HOT_MASTER, sourceUrl, { ...updateCheck, contentHash }, false);
      return result;
    }

    // パース
    const entries = parseHotMasterZip(buffer);
    logger.info('HOT master sync: parsed entries', { count: entries.length });

    // YJ→HOT マッピング（1つ目のHOTのみ）
    const yjToHot = new Map<string, string>();
    for (const e of entries) {
      if (!yjToHot.has(e.yjCode)) {
        yjToHot.set(e.yjCode, e.hot13);
      }
    }

    // HOT なしパッケージを補完
    const noHotPkgs = await db.select({
      id: drugMasterPackages.id,
      drugMasterId: drugMasterPackages.drugMasterId,
    }).from(drugMasterPackages).where(isNull(drugMasterPackages.hotCode));

    if (noHotPkgs.length > 0) {
      const dmIds = [...new Set(noHotPkgs.map((p) => p.drugMasterId))];
      const dmIdBatches: number[][] = [];
      for (let i = 0; i < dmIds.length; i += BATCH_SIZE) {
        dmIdBatches.push(dmIds.slice(i, i + BATCH_SIZE));
      }
      const idToYj = new Map<number, string>();
      for (const batch of dmIdBatches) {
        const rows = await db.select({ id: drugMaster.id, yjCode: drugMaster.yjCode })
          .from(drugMaster).where(inArray(drugMaster.id, batch));
        for (const r of rows) idToYj.set(r.id, r.yjCode);
      }

      // バッチ UPDATE（SQL で一括）
      const updates: Array<{ pkgId: number; hot: string }> = [];
      for (const pkg of noHotPkgs) {
        const yj = idToYj.get(pkg.drugMasterId);
        if (!yj) continue;
        const hot = yjToHot.get(yj);
        if (!hot) continue;
        updates.push({ pkgId: pkg.id, hot });
      }

      for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batch = updates.slice(i, i + BATCH_SIZE);
        await db.transaction(async (tx) => {
          for (const u of batch) {
            await tx.update(drugMasterPackages)
              .set({ hotCode: u.hot })
              .where(eq(drugMasterPackages.id, u.pkgId));
          }
        });
        result.updated += batch.length;
      }
    }

    // 麻薬等: パッケージレコードが無い品目に HOT のみの行を作成
    const allDmRows = await db.select({ id: drugMaster.id, yjCode: drugMaster.yjCode }).from(drugMaster);
    const dmWithPkg = new Set(
      (await db.select({ drugMasterId: drugMasterPackages.drugMasterId }).from(drugMasterPackages))
        .map((r) => r.drugMasterId),
    );
    const yjToHots = new Map<string, string[]>();
    for (const e of entries) {
      const arr = yjToHots.get(e.yjCode) || [];
      arr.push(e.hot13);
      yjToHots.set(e.yjCode, arr);
    }

    for (const dm of allDmRows) {
      if (dmWithPkg.has(dm.id)) continue;
      const hots = yjToHots.get(dm.yjCode);
      if (!hots || hots.length === 0) continue;
      const uniqueHots = [...new Set(hots)];
      for (const hot of uniqueHots) {
        await db.insert(drugMasterPackages).values({
          drugMasterId: dm.id,
          hotCode: hot,
          gs1Code: null,
          janCode: null,
          packageDescription: null,
          normalizedPackageLabel: null,
        });
        result.created++;
      }
    }

    await persistSourceHeaders(SOURCE_KEY_HOT_MASTER, sourceUrl, { ...updateCheck, contentHash }, true);
    logger.info('HOT master sync: completed', { updated: result.updated, created: result.created });
  } catch (err) {
    logger.error('HOT master sync: failed', { error: getErrorMessage(err) });
  } finally {
    if (typeof (pinnedAgent as { close?: () => Promise<void> }).close === 'function') {
      await (pinnedAgent as { close: () => Promise<void> }).close().catch(() => undefined);
    }
  }

  return result;
}
