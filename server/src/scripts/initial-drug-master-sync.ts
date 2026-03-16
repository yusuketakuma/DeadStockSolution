/**
 * 初回マスターデータ一括同期スクリプト
 *
 * 1. MHLW 薬価基準4カテゴリ → drug_master テーブル
 * 2. MEDIS medhot 包装単位CSV → drug_master_packages テーブル
 *
 * 実行: cd server && npx tsx src/scripts/initial-drug-master-sync.ts
 */
import 'dotenv/config';
import iconv from 'iconv-lite';
import AdmZip from 'adm-zip';
import { db } from '../config/database';
import { drugMaster, drugMasterPackages, drugMasterSyncLogs } from '../db/schema';
import { eq, isNull, sql } from 'drizzle-orm';
import { discoverMhlwExcelUrls } from '../services/mhlw-index-scraper';
import { parseMhlwDrugFile } from '../services/drug-master-parser-mhlw';
import { parsePackageCsvData } from '../services/drug-master-parser-package';
import { decodeCsvBuffer } from '../services/drug-master-parser-service';
import { syncDrugMaster, syncPackageData, completeSyncLog } from '../services/drug-master-sync-service';
import { createPinnedDnsAgent, validateExternalHttpsUrl } from '../utils/network-utils';
import { fetchWithTimeout, type FetchDispatcher } from '../utils/http-utils';

async function download(url: string): Promise<{ buffer: Buffer; contentType: string | null }> {
  const validated = await validateExternalHttpsUrl(url);
  if (!validated.ok) throw new Error(`URL検証失敗: ${validated.reason} (${url})`);
  const agent = createPinnedDnsAgent(
    validated.hostname ?? new URL(url).hostname,
    validated.resolvedAddresses,
  ) as unknown as FetchDispatcher;
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { 'User-Agent': 'DeadStockSolution-InitialSync/1.0' },
    redirect: 'follow',
    dispatcher: agent,
    timeoutMs: 120_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') };
}

async function main() {
  console.log('=== 初回マスターデータ一括同期 ===');
  console.log('');

  // ===== Phase 1: MHLW 薬価基準データ =====
  console.log('--- Phase 1: MHLW 薬価基準データ同期 ---');
  const indexResult = await discoverMhlwExcelUrls();
  console.log(`発見ファイル: ${indexResult.files.length} カテゴリ`);

  const allDrugRows: Awaited<ReturnType<typeof parseMhlwDrugFile>> = [];
  for (const file of indexResult.files) {
    process.stdout.write(`  [${file.category}] ダウンロード+パース中... `);
    const { buffer, contentType } = await download(file.url);
    const rows = await parseMhlwDrugFile(file.url, contentType, buffer);
    allDrugRows.push(...rows);
    console.log(`${rows.length} 件`);
  }
  console.log(`  合計: ${allDrugRows.length} 品目`);

  // 同期ログ作成
  const [drugSyncLog] = await db.insert(drugMasterSyncLogs).values({
    syncType: 'auto_mhlw',
    sourceDescription: `初回一括同期: MHLW薬価基準4カテゴリ (${indexResult.indexUrl})`,
    status: 'running',
    startedAt: new Date().toISOString(),
  }).returning();
  console.log(`  同期ログ #${drugSyncLog.id} 作成`);

  const today = new Date().toISOString().slice(0, 10);
  try {
    console.log('  DB書込中...');
    const drugResult = await syncDrugMaster(allDrugRows, drugSyncLog.id, today);
    await completeSyncLog(drugSyncLog.id, 'success', drugResult);
    console.log(`  完了: processed=${drugResult.itemsProcessed} added=${drugResult.itemsAdded} updated=${drugResult.itemsUpdated} deleted=${drugResult.itemsDeleted}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await completeSyncLog(drugSyncLog.id, 'failed', { itemsProcessed: 0, itemsAdded: 0, itemsUpdated: 0, itemsDeleted: 0 }, msg);
    console.error(`  FAILED: ${msg}`);
    throw err;
  }

  // ===== Phase 2: MEDIS medhot 包装単位データ =====
  console.log('');
  console.log('--- Phase 2: MEDIS medhot 包装単位データ同期 ---');
  const packageUrl2 = process.env.DRUG_PACKAGE_SOURCE_URL || 'https://medhot.medd.jp/csv/A_20260228_2.txt';
  const packageUrl1 = packageUrl2.replace(/_2\.txt$/, '_1.txt');

  // ファイル2（調剤+販売+元梱包装単位コード）— メインデータ
  process.stdout.write(`  ファイル2 ダウンロード中... `);
  const { buffer: pkgBuffer2 } = await download(packageUrl2);
  console.log(`${(pkgBuffer2.length / 1024 / 1024).toFixed(1)} MB`);
  process.stdout.write('  パース中... ');
  const pkgRows2 = parsePackageCsvData(decodeCsvBuffer(pkgBuffer2));
  console.log(`${pkgRows2.length} 件`);

  // ファイル1（販売名+調剤包装単位コード）— 補完データ
  let pkgRows1: typeof pkgRows2 = [];
  try {
    process.stdout.write(`  ファイル1 ダウンロード中... `);
    const { buffer: pkgBuffer1 } = await download(packageUrl1);
    console.log(`${(pkgBuffer1.length / 1024 / 1024).toFixed(1)} MB`);
    process.stdout.write('  パース中... ');
    pkgRows1 = parsePackageCsvData(decodeCsvBuffer(pkgBuffer1));
    console.log(`${pkgRows1.length} 件`);
  } catch (err) {
    console.log(`  ファイル1 取得スキップ: ${err instanceof Error ? err.message : err}`);
  }

  // 結合（ファイル2 優先、ファイル1 で補完）
  const seen = new Set(pkgRows2.map(r => r.yjCode + '|' + (r.gs1Code || '')));
  const supplementRows = pkgRows1.filter(r => !seen.has(r.yjCode + '|' + (r.gs1Code || '')));
  const pkgRows = [...pkgRows2, ...supplementRows];
  console.log(`  結合: ${pkgRows.length} 件 (ファイル1補完: +${supplementRows.length})`);

  const [pkgSyncLog] = await db.insert(drugMasterSyncLogs).values({
    syncType: 'package_auto',
    sourceDescription: `初回一括同期: MEDIS medhot包装単位 (${packageUrl2.split('/').pop()})`,
    status: 'running',
    startedAt: new Date().toISOString(),
  }).returning();
  console.log(`  同期ログ #${pkgSyncLog.id} 作成`);

  try {
    console.log('  DB書込中...');
    const pkgResult = await syncPackageData(pkgRows);
    await completeSyncLog(pkgSyncLog.id, 'success', {
      itemsProcessed: pkgRows.length,
      itemsAdded: pkgResult.added,
      itemsUpdated: pkgResult.updated,
      itemsDeleted: 0,
    });
    console.log(`  完了: processed=${pkgRows.length} added=${pkgResult.added} updated=${pkgResult.updated}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await completeSyncLog(pkgSyncLog.id, 'failed', { itemsProcessed: 0, itemsAdded: 0, itemsUpdated: 0, itemsDeleted: 0 }, msg);
    console.error(`  FAILED: ${msg}`);
    throw err;
  }

  // ===== Phase 3: MEDIS HOTコードマスターから HOT 補完 =====
  console.log('');
  console.log('--- Phase 3: MEDIS HOTコードマスターから HOT 補完 ---');
  const hotMasterUrl = 'https://www2.medis.or.jp/hcode/moto_data/h20260228.zip';
  try {
    process.stdout.write('  ダウンロード中... ');
    const { buffer: hotZipBuf } = await download(hotMasterUrl);
    console.log(`${(hotZipBuf.length / 1024 / 1024).toFixed(1)} MB`);

    const zip = new AdmZip(hotZipBuf);
    const mainEntry = zip.getEntries().find(e => e.entryName.endsWith('.TXT') && !e.entryName.includes('HOT9') && !e.entryName.includes('_OP'));
    if (!mainEntry) throw new Error('HOTマスター TXT ファイルが見つかりません');

    const hotContent = iconv.decode(mainEntry.getData(), 'Shift_JIS');
    const hotLines = hotContent.split(/\r?\n/).filter(l => l.trim());
    console.log(`  HOTマスター: ${hotLines.length - 1} レコード`);

    // YJ→HOT13 マッピング構築
    const yjToHot = new Map<string, string>();
    for (let i = 1; i < hotLines.length; i++) {
      const vals: string[] = [];
      let cur = '', inQ = false;
      for (const ch of hotLines[i]) {
        if (ch === '"') { inQ = !inQ; continue; }
        if (ch === ',' && !inQ) { vals.push(cur); cur = ''; continue; }
        cur += ch;
      }
      vals.push(cur);
      const hot13 = (vals[0] || '').trim();
      const yj = (vals[6] || '').trim();
      if (hot13 && yj && !yjToHot.has(yj)) {
        yjToHot.set(yj, hot13);
      }
    }
    console.log(`  YJ→HOT マッピング: ${yjToHot.size} 件`);

    // drug_master_packages に HOT がない行を補完
    const packagesWithoutHot = await db.select({
      id: drugMasterPackages.id,
      drugMasterId: drugMasterPackages.drugMasterId,
    })
      .from(drugMasterPackages)
      .where(isNull(drugMasterPackages.hotCode));

    // drug_master_id → yj_code のマップ
    const dmRows = await db.select({ id: drugMaster.id, yjCode: drugMaster.yjCode }).from(drugMaster);
    const idToYj = new Map(dmRows.map(r => [r.id, r.yjCode]));

    let hotUpdated = 0;
    const BATCH = 500;
    for (let i = 0; i < packagesWithoutHot.length; i += BATCH) {
      const batch = packagesWithoutHot.slice(i, i + BATCH);
      for (const pkg of batch) {
        const yj = idToYj.get(pkg.drugMasterId);
        if (!yj) continue;
        const hot = yjToHot.get(yj);
        if (!hot) continue;
        await db.update(drugMasterPackages)
          .set({ hotCode: hot })
          .where(eq(drugMasterPackages.id, pkg.id));
        hotUpdated++;
      }
    }
    console.log(`  HOT補完: ${hotUpdated} 件更新`);
  } catch (err) {
    console.log(`  HOT補完スキップ: ${err instanceof Error ? err.message : err}`);
  }

  console.log('');
  console.log('=== 初回同期完了 ===');
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('致命的エラー:', err instanceof Error ? err.message : err);
  process.exit(1);
});
