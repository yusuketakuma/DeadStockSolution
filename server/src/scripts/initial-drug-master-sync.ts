/**
 * 初回マスターデータ一括同期スクリプト
 *
 * 1. MHLW 薬価基準4カテゴリ → drug_master テーブル
 * 2. MEDIS medhot 包装単位CSV → drug_master_packages テーブル
 *
 * 実行: cd server && npx tsx src/scripts/initial-drug-master-sync.ts
 */
import 'dotenv/config';
import { db } from '../config/database';
import { drugMasterSyncLogs } from '../db/schema';
import { discoverMhlwExcelUrls } from '../services/mhlw-index-scraper';
import { parseMhlwDrugFile } from '../services/drug-master-parser-mhlw';
import { parsePackageCsvData } from '../services/drug-master-parser-package';
import { decodeCsvBuffer } from '../services/drug-master-parser-service';
import { syncDrugMaster, syncPackageData, completeSyncLog } from '../services/drug-master-sync-service';
import { createPinnedDnsAgent, validateExternalHttpsUrl } from '../utils/network-utils';
import { fetchWithTimeout, type FetchDispatcher } from '../utils/http-utils';
import dns from 'dns/promises';

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
  const packageUrl = process.env.DRUG_PACKAGE_SOURCE_URL || 'https://medhot.medd.jp/csv/A_20260228_2.txt';
  console.log(`  ソースURL: ${packageUrl}`);

  process.stdout.write('  ダウンロード中... ');
  const { buffer: pkgBuffer } = await download(packageUrl);
  console.log(`${(pkgBuffer.length / 1024 / 1024).toFixed(1)} MB`);

  process.stdout.write('  パース中... ');
  const csvContent = decodeCsvBuffer(pkgBuffer);
  const pkgRows = parsePackageCsvData(csvContent);
  console.log(`${pkgRows.length} 件`);

  const [pkgSyncLog] = await db.insert(drugMasterSyncLogs).values({
    syncType: 'package_auto',
    sourceDescription: `初回一括同期: MEDIS medhot包装単位 (${packageUrl.split('/').pop()})`,
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

  console.log('');
  console.log('=== 初回同期完了 ===');
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('致命的エラー:', err instanceof Error ? err.message : err);
  process.exit(1);
});
