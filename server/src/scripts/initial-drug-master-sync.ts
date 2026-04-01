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
import { eq, isNull } from 'drizzle-orm';
import { discoverMhlwExcelUrls } from '../services/mhlw-index-scraper';
import { parseMhlwDrugFile } from '../services/drug-master/parser-mhlw';
import { parsePackageCsvData } from '../services/drug-master/parser-package';
import { decodeCsvBuffer } from '../services/drug-master/parser-service';
import { syncDrugMaster, syncPackageData, completeSyncLog } from '../services/drug-master/sync-service';
import { createPinnedDnsAgent, validateExternalHttpsUrl } from '../utils/network-utils';
import { fetchWithTimeout, type FetchDispatcher } from '../utils/http-utils';

type SyncCounts = {
  itemsProcessed: number;
  itemsAdded: number;
  itemsUpdated: number;
  itemsDeleted: number;
};

type SyncType = 'auto_mhlw' | 'package_auto';

type MhlwFileParseResult = {
  category: string;
  rows: Awaited<ReturnType<typeof parseMhlwDrugFile>>;
};

const ZERO_SYNC_COUNTS: SyncCounts = {
  itemsProcessed: 0,
  itemsAdded: 0,
  itemsUpdated: 0,
  itemsDeleted: 0,
};

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

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseHotMasterLine(line: string): string[] {
  if (!line) {
    return [''];
  }
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  values.push(current);
  return values;
}

async function createSyncLog(syncType: SyncType, sourceDescription: string): Promise<number> {
  const [syncLog] = await db
    .insert(drugMasterSyncLogs)
    .values({
      syncType,
      sourceDescription,
      status: 'running',
      startedAt: new Date().toISOString(),
    })
    .returning({ id: drugMasterSyncLogs.id });
  return syncLog.id;
}

async function completeSyncLogWithHandling(
  syncLogId: number,
  counts: SyncCounts,
): Promise<void> {
  await completeSyncLog(syncLogId, 'success', counts);
}

async function failSyncLogWithHandling(syncLogId: number, err: unknown): Promise<never> {
  const message = getErrorMessage(err);
  await completeSyncLog(syncLogId, 'failed', ZERO_SYNC_COUNTS, message);
  console.error(`  FAILED: ${message}`);
  throw err;
}

async function parseMhlwFiles(
  files: Awaited<ReturnType<typeof discoverMhlwExcelUrls>>['files'],
): Promise<MhlwFileParseResult[]> {
  return Promise.all(
    files.map(async (file): Promise<MhlwFileParseResult> => {
      process.stdout.write(`  [${file.category}] ダウンロード+パース中... `);
      const { buffer, contentType } = await download(file.url);
      const rows = await parseMhlwDrugFile(file.url, contentType, buffer);
      console.log(`${rows.length} 件`);
      return { category: file.category, rows };
    }),
  );
}

async function main(): Promise<void> {
  console.log('=== 初回マスターデータ一括同期 ===');
  console.log('');

  // ===== Phase 1: MHLW 薬価基準データ =====
  console.log('--- Phase 1: MHLW 薬価基準データ同期 ---');
  const indexResult = await discoverMhlwExcelUrls();
  console.log(`発見ファイル: ${indexResult.files.length} カテゴリ`);

  const mhlwRowsByFile = await parseMhlwFiles(indexResult.files);
  const allDrugRows = mhlwRowsByFile.flatMap((result) => result.rows);
  console.log(`  合計: ${allDrugRows.length} 品目`);

  const drugSyncLogId = await createSyncLog(
    'auto_mhlw',
    `初回一括同期: MHLW薬価基準4カテゴリ (${indexResult.indexUrl})`,
  );
  console.log(`  同期ログ #${drugSyncLogId} 作成`);

  const today = new Date().toISOString().slice(0, 10);
  try {
    console.log('  DB書込中...');
    const drugResult = await syncDrugMaster(allDrugRows, drugSyncLogId, today);
    await completeSyncLogWithHandling(drugSyncLogId, drugResult);
    console.log(`  完了: processed=${drugResult.itemsProcessed} added=${drugResult.itemsAdded} updated=${drugResult.itemsUpdated} deleted=${drugResult.itemsDeleted}`);
  } catch (err) {
    await failSyncLogWithHandling(drugSyncLogId, err);
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

  const pkgSyncLogId = await createSyncLog(
    'package_auto',
    `初回一括同期: MEDIS medhot包装単位 (${packageUrl2.split('/').pop()})`,
  );
  console.log(`  同期ログ #${pkgSyncLogId} 作成`);

  try {
    console.log('  DB書込中...');
    const pkgResult = await syncPackageData(pkgRows);
    await completeSyncLogWithHandling(pkgSyncLogId, {
      itemsProcessed: pkgRows.length,
      itemsAdded: pkgResult.added,
      itemsUpdated: pkgResult.updated,
      itemsDeleted: 0,
    });
    console.log(`  完了: processed=${pkgRows.length} added=${pkgResult.added} updated=${pkgResult.updated}`);
  } catch (err) {
    await failSyncLogWithHandling(pkgSyncLogId, err);
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
      const vals = parseHotMasterLine(hotLines[i]);
      const hot13 = (vals[0] || '').trim();
      const yj = (vals[6] || '').trim();
      if (!hot13 || !yj || yjToHot.has(yj)) {
        continue;
      }
      yjToHot.set(yj, hot13);
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
      const updates: Array<Promise<unknown>> = [];
      for (const pkg of batch) {
        const yj = idToYj.get(pkg.drugMasterId);
        if (!yj) {
          continue;
        }
        const hot = yjToHot.get(yj);
        if (!hot) {
          continue;
        }
        updates.push(
          db
            .update(drugMasterPackages)
            .set({ hotCode: hot })
            .where(eq(drugMasterPackages.id, pkg.id)),
        );
      }
      if (updates.length === 0) {
        continue;
      }
      await Promise.all(updates);
      hotUpdated += updates.length;
    }
    console.log(`  HOT補完: ${hotUpdated} 件更新`);
  } catch (err) {
    console.log(`  HOT補完スキップ: ${getErrorMessage(err)}`);
  }

  console.log('');
  console.log('=== 初回同期完了 ===');
}

main().then((): void => {
  process.exit(0);
}).catch((err: unknown): void => {
  console.error('致命的エラー:', getErrorMessage(err));
  process.exit(1);
});
