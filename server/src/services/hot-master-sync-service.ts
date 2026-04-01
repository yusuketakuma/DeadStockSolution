/**
 * MEDIS HOT コードマスター取得・補完サービス
 *
 * パッケージ同期後に実行し、drug_master_packages に HOT コードを補完する。
 * ETag / contentHash で変更検出し、更新があった場合のみ補完を実行。
 */
import iconv from 'iconv-lite';
import AdmZip from 'adm-zip';
import { eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../config/database';
import { drugMaster, drugMasterPackages } from '../db/schema';
import { getErrorMessage } from '../middleware/error-handler';
import { sha256 } from '../utils/crypto-utils';
import { type FetchDispatcher } from '../utils/http-utils';
import { createPinnedDnsAgent, validateExternalHttpsUrl } from '../utils/network-utils';
import { persistSourceHeaders, SOURCE_KEY_HOT_MASTER } from './drug-master/source-state-service';
import { logger } from './logger';
import { checkForUpdates, downloadFile } from './mhlw-source-fetch';

const HOT_MASTER_URL = 'https://www2.medis.or.jp/hcode/moto_data/h20260228.zip';
const BATCH_SIZE = 200;
const REQUEST_OPTIONS = {
  retries: 1,
  headers: { 'User-Agent': 'DeadStockSolution-HotMasterSync/1.0' },
};

interface HotMasterEntry {
  hot13: string;
  yjCode: string;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuote = false;

  for (const ch of line) {
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (ch === ',' && !inQuote) {
      values.push(current);
      current = '';
      continue;
    }
    current += ch;
  }

  values.push(current);
  return values;
}

function parseHotMasterZip(buffer: Buffer): HotMasterEntry[] {
  const zip = new AdmZip(buffer);
  const entry = zip
    .getEntries()
    .find((e) => e.entryName.endsWith('.TXT') && !e.entryName.includes('HOT9') && !e.entryName.includes('_OP'));
  if (!entry) return [];

  const lines = iconv
    .decode(entry.getData(), 'Shift_JIS')
    .split(/\r?\n/)
    .filter((line) => line.trim());

  const parsed: HotMasterEntry[] = [];
  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const hot13 = (values[0] ?? '').trim();
    const yjCode = (values[6] ?? '').trim();
    if (!hot13 || !yjCode) {
      continue;
    }
    parsed.push({ hot13, yjCode });
  }

  return parsed;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function buildHotMaps(entries: HotMasterEntry[]): {
  yjToFirstHot: Map<string, string>;
  yjToUniqueHots: Map<string, string[]>;
} {
  const yjToFirstHot = new Map<string, string>();
  const yjToHotSet = new Map<string, Set<string>>();

  for (const entry of entries) {
    if (!yjToFirstHot.has(entry.yjCode)) {
      yjToFirstHot.set(entry.yjCode, entry.hot13);
    }
    if (!yjToHotSet.has(entry.yjCode)) {
      yjToHotSet.set(entry.yjCode, new Set<string>());
    }
    yjToHotSet.get(entry.yjCode)?.add(entry.hot13);
  }

  const yjToUniqueHots = new Map<string, string[]>();
  for (const [yjCode, hots] of yjToHotSet.entries()) {
    yjToUniqueHots.set(yjCode, [...hots]);
  }

  return { yjToFirstHot, yjToUniqueHots };
}

export async function syncHotMasterCodes(): Promise<{ checked: boolean; updated: number; created: number }> {
  const sourceUrl = HOT_MASTER_URL;
  const result = { checked: false, updated: 0, created: 0 };

  const validated = await validateExternalHttpsUrl(sourceUrl);
  if (!validated.ok) {
    logger.warn('HOT master sync: URL validation failed', { reason: validated.reason });
    return result;
  }

  const pinnedAgent = createPinnedDnsAgent(validated.hostname ?? new URL(sourceUrl).hostname, validated.resolvedAddresses);
  const dispatcher = pinnedAgent as unknown as FetchDispatcher;

  try {
    const updateCheck = await checkForUpdates(sourceUrl, dispatcher, {
      sourceKey: SOURCE_KEY_HOT_MASTER,
      ...REQUEST_OPTIONS,
    });
    result.checked = true;

    if (!updateCheck.hasUpdate) {
      logger.info('HOT master sync: no updates detected');
      await persistSourceHeaders(SOURCE_KEY_HOT_MASTER, sourceUrl, updateCheck, false);
      return result;
    }

    logger.info('HOT master sync: update detected, downloading');
    const { buffer } = await downloadFile(sourceUrl, dispatcher, REQUEST_OPTIONS);
    const contentHash = sha256(buffer);

    if (updateCheck.compareByContentHash && updateCheck.previousContentHash === contentHash) {
      logger.info('HOT master sync: no change by content hash');
      await persistSourceHeaders(SOURCE_KEY_HOT_MASTER, sourceUrl, { ...updateCheck, contentHash }, false);
      return result;
    }

    const entries = parseHotMasterZip(buffer);
    logger.info('HOT master sync: parsed entries', { count: entries.length });
    if (entries.length === 0) {
      await persistSourceHeaders(SOURCE_KEY_HOT_MASTER, sourceUrl, { ...updateCheck, contentHash }, true);
      logger.info('HOT master sync: completed', { updated: result.updated, created: result.created });
      return result;
    }

    const { yjToFirstHot, yjToUniqueHots } = buildHotMaps(entries);

    const noHotPkgs = await db
      .select({ id: drugMasterPackages.id, drugMasterId: drugMasterPackages.drugMasterId })
      .from(drugMasterPackages)
      .where(isNull(drugMasterPackages.hotCode));

    if (noHotPkgs.length > 0) {
      const dmIds = [...new Set(noHotPkgs.map((pkg) => pkg.drugMasterId))];
      const dmBatches = chunkArray(dmIds, BATCH_SIZE);
      const batchRows = await Promise.all(
        dmBatches.map((batch) =>
          db
            .select({ id: drugMaster.id, yjCode: drugMaster.yjCode })
            .from(drugMaster)
            .where(inArray(drugMaster.id, batch)),
        ),
      );

      const idToYj = new Map<number, string>();
      for (const rows of batchRows) {
        for (const row of rows) {
          idToYj.set(row.id, row.yjCode);
        }
      }

      const updates: Array<{ pkgId: number; hot: string }> = [];
      for (const pkg of noHotPkgs) {
        const yj = idToYj.get(pkg.drugMasterId);
        if (!yj) {
          continue;
        }
        const hot = yjToFirstHot.get(yj);
        if (!hot) {
          continue;
        }
        updates.push({ pkgId: pkg.id, hot });
      }

      for (const batch of chunkArray(updates, BATCH_SIZE)) {
        await db.transaction(async (tx): Promise<void> => {
          await Promise.all(
            batch.map((update) =>
              tx.update(drugMasterPackages).set({ hotCode: update.hot }).where(eq(drugMasterPackages.id, update.pkgId)),
            ),
          );
        });
        result.updated += batch.length;
      }
    }

    const allDmRows = await db.select({ id: drugMaster.id, yjCode: drugMaster.yjCode }).from(drugMaster);
    const dmWithPkg = new Set(
      (await db.select({ drugMasterId: drugMasterPackages.drugMasterId }).from(drugMasterPackages)).map(
        (row) => row.drugMasterId,
      ),
    );

    for (const dm of allDmRows) {
      if (dmWithPkg.has(dm.id)) {
        continue;
      }
      const hots = yjToUniqueHots.get(dm.yjCode);
      if (!hots || hots.length === 0) {
        continue;
      }

      await Promise.all(
        hots.map((hot) =>
          db.insert(drugMasterPackages).values({
            drugMasterId: dm.id,
            hotCode: hot,
            gs1Code: null,
            janCode: null,
            packageDescription: null,
            normalizedPackageLabel: null,
          }),
        ),
      );
      result.created += hots.length;
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
