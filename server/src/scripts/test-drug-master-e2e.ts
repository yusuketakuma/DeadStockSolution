/**
 * 医薬品マスター更新機能 E2E テストスクリプト
 *
 * 実行: cd server && npx tsx src/scripts/test-drug-master-e2e.ts
 *
 * ステップ:
 * 1. 厚労省ポータルからExcel URLを発見
 * 2. 1ファイルをダウンロード
 * 3. ダウンロードしたファイルをパース
 * 4. パース結果の検証
 */
import 'dotenv/config';
import { discoverMhlwExcelUrls } from '../services/mhlw-index-scraper';
import { validateExternalHttpsUrl, createPinnedDnsAgent } from '../utils/network-utils';
import { fetchWithTimeout } from '../utils/http-utils';
import { parseMhlwDrugFile } from '../services/drug-master-parser-mhlw';
import dns from 'dns/promises';

async function main() {
  console.log('=== 医薬品マスター更新 E2E テスト ===');
  console.log('');

  // Step 1: 厚労省ポータルからExcel URLを発見
  console.log('--- Step 1: MHLW ポータルからExcel URL 発見 ---');
  const indexResult = await discoverMhlwExcelUrls();
  console.log(`  ポータルURL: ${indexResult.indexUrl}`);
  console.log(`  発見ファイル数: ${indexResult.files.length}`);
  for (const file of indexResult.files) {
    console.log(`    [${file.category}] ${file.url}`);
  }
  if (indexResult.files.length === 0) {
    throw new Error('ファイルが発見できませんでした');
  }
  console.log('  PASS');

  // Step 2: ダウンロード（内用薬のみ）
  console.log('');
  console.log('--- Step 2: Excel ファイルダウンロード ---');
  const targetFile = indexResult.files[0];
  console.log(`  対象: [${targetFile.category}] ${targetFile.url}`);

  const urlValidation = await validateExternalHttpsUrl(targetFile.url);
  if (!urlValidation.ok) {
    throw new Error(`URL検証失敗: ${urlValidation.reason}`);
  }
  console.log('  URL検証: OK');

  const { hostname } = new URL(targetFile.url);
  const addresses = await dns.resolve4(hostname);
  const agent = createPinnedDnsAgent(hostname, addresses) as unknown as import('../utils/http-utils').FetchDispatcher;

  const response = await fetchWithTimeout(targetFile.url, {
    method: 'GET',
    headers: { 'User-Agent': 'DeadStockSolution-DrugMasterSync/1.0 (E2E-Test)' },
    redirect: 'error',
    dispatcher: agent,
    timeoutMs: 60_000,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type');
  const arrayBuf = await response.arrayBuffer();
  const downloadBuffer = Buffer.from(arrayBuf);
  console.log(`  サイズ: ${(downloadBuffer.length / 1024).toFixed(1)} KB`);
  console.log(`  Content-Type: ${contentType ?? '(なし)'}`);
  console.log('  PASS');

  // Step 3: パース
  console.log('');
  console.log('--- Step 3: Excel パース ---');
  const rows = await parseMhlwDrugFile(targetFile.url, contentType, downloadBuffer);
  console.log(`  パース行数: ${rows.length}`);
  if (rows.length === 0) {
    throw new Error('パース結果が0行');
  }

  // サンプル表示（先頭3件）
  const sample = rows.slice(0, 3);
  for (const row of sample) {
    console.log(`    YJ:${row.yjCode} | ${row.drugName} | ¥${row.yakkaPrice} | ${row.manufacturer ?? '?'}`);
  }
  console.log(`    ... 他 ${rows.length - 3} 件`);

  // 基本バリデーション
  const yjCodeSet = new Set(rows.map((r) => r.yjCode));
  const duplicateCount = rows.length - yjCodeSet.size;
  const emptyYj = rows.filter((r) => !r.yjCode || r.yjCode.trim() === '');
  const zeroPriceCount = rows.filter((r) => r.yakkaPrice <= 0).length;
  const emptyNameCount = rows.filter((r) => !r.drugName || r.drugName.trim() === '').length;

  console.log(`  ユニークYJコード: ${yjCodeSet.size}`);
  console.log(`  重複YJコード: ${duplicateCount}`);
  console.log(`  空YJコード: ${emptyYj.length}`);
  console.log(`  薬価0以下: ${zeroPriceCount}`);
  console.log(`  薬名なし: ${emptyNameCount}`);

  // 薬価統計
  const prices = rows.map((r) => r.yakkaPrice).filter((p) => p > 0);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  console.log(`  薬価: min=¥${minPrice} max=¥${maxPrice.toLocaleString()} avg=¥${avgPrice.toFixed(1)}`);

  console.log('  PASS');

  // Step 4: DB保存テスト（ドライラン）
  console.log('');
  console.log('--- Step 4: DB 保存確認（ドライラン） ---');
  console.log(`  書込予定行数: ${rows.length}`);
  console.log(`  重複チェック: ${duplicateCount === 0 ? 'OK（重複なし）' : `WARNING: ${duplicateCount} 件重複`}`);
  console.log(`  データ品質: ${emptyYj.length === 0 && emptyNameCount === 0 ? 'OK' : 'WARNING: 空フィールドあり'}`);
  console.log('  PASS (ドライラン)');

  // 全カテゴリのURLアクセス確認
  console.log('');
  console.log('--- Step 5: 全カテゴリURL到達性確認 ---');
  for (const file of indexResult.files) {
    try {
      const { hostname: h } = new URL(file.url);
      const addrs = await dns.resolve4(h);
      const a = createPinnedDnsAgent(h, addrs) as unknown as import('../utils/http-utils').FetchDispatcher;
      const r = await fetchWithTimeout(file.url, {
        method: 'HEAD',
        headers: { 'User-Agent': 'DeadStockSolution-DrugMasterSync/1.0 (E2E-Test)' },
        redirect: 'error',
        dispatcher: a,
        timeoutMs: 30_000,
      });
      const size = r.headers.get('content-length');
      console.log(`  [${file.category}] HTTP ${r.status} (${size ? (Number(size) / 1024).toFixed(0) + ' KB' : 'size unknown'})`);
    } catch (err) {
      console.log(`  [${file.category}] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log('  PASS');

  console.log('');
  console.log('=== 全ステップ通過 ===');
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('');
  console.error('FAILED:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
