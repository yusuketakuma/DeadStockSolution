import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// =============================================
// デッドストックリストテストファイル
// =============================================
async function generateDeadStock() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('デッドストックリスト');

  // ヘッダー行
  ws.addRow(['YJコード', 'GS1コード', '薬剤名', '数量', '包装単位', '薬価（円）', '使用期限', 'ロット番号']);

  // 正常データ（一般的な医薬品）
  ws.addRow(['2119002F1025', '04987123456789', 'アムロジピン錠5mg「サワイ」', 100, '錠', 10.1, '2027-03-31', 'LOT-A001']);
  ws.addRow(['6119003F1020', '04987234567890', 'ロキソプロフェンNa錠60mg「EMEC」', 50, '錠', 9.8, '2026-12-31', 'LOT-B002']);
  ws.addRow(['2171014F1025', '04987345678901', 'カルベジロール錠10mg「サワイ」', 200, '錠', 15.5, '2027-06-30', 'LOT-C003']);
  ws.addRow(['2329025F1024', '04987456789012', 'ランソプラゾールOD錠15mg「トーワ」', 30, '錠', 28.3, '2026-08-31', 'LOT-D004']);

  // 液剤・外用薬
  ws.addRow(['2646725M1039', '04987567890123', 'カロナール細粒20%', 500, 'g', 8.9, '2028-01-31', 'LOT-E005']);
  ws.addRow(['2649707Q3028', '04987678901234', 'モーラステープ20mg', 70, '枚', 25.7, '2027-09-30', 'LOT-F006']);
  ws.addRow(['1319726G1028', '04987789012345', 'アレジオン点眼液0.05%', 5, '本', 498.0, '2026-06-30', 'LOT-G007']);

  // エッジケース: 期限切れ間近
  ws.addRow(['2190023F1028', '', 'メトホルミン塩酸塩錠250mg「トーワ」', 80, '錠', 10.1, '2026-03-15', 'LOT-H008']);

  // エッジケース: 数量が小数
  ws.addRow(['', '04987890123456', 'ワーファリン錠1mg', 0.5, '錠', 9.8, '2027-12-31', 'LOT-I009']);

  // エッジケース: 薬価が空
  ws.addRow(['3999999X9999', '', 'テスト薬品（薬価不明）', 10, '錠', null, '2027-05-31', 'LOT-J010']);

  // エッジケース: ロット番号が空
  ws.addRow(['2119002F1025', '04987123456789', 'アムロジピン錠5mg「サワイ」（別ロット）', 25, '錠', 10.1, '2026-09-30', '']);

  // エッジケース: 数量が大きい
  ws.addRow(['6119003F1020', '04987234567890', 'ロキソプロフェンNa錠60mg「EMEC」（大量）', 9999, '錠', 9.8, '2028-06-30', 'LOT-K011']);

  // エッジケース: 薬剤名に特殊文字
  ws.addRow(['1124017F1048', '', 'ＰＬ配合顆粒（全角）', 300, 'g', 6.5, '2027-11-30', 'LOT-L012']);

  // エッジケース: 薬剤名が空（スキップされるべき行）
  ws.addRow(['9999999F9999', '', '', 100, '錠', 10.0, '2027-01-01', 'LOT-SKIP']);

  // エッジケース: 数量が0（スキップされるべき行）
  ws.addRow(['8888888F8888', '', 'ゼロ数量テスト薬', 0, '錠', 5.0, '2027-01-01', 'LOT-ZERO']);

  const filePath = path.join(__dirname, 'dead-stock-test.xlsx');
  await wb.xlsx.writeFile(filePath);
  console.log(`[created] ${filePath} (${ws.rowCount - 1} data rows)`);
}

// =============================================
// 医薬品使用量リストテストファイル
// =============================================
async function generateUsedMedication() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('医薬品使用量リスト');

  // ヘッダー行
  ws.addRow(['YJコード', 'GS1コード', '薬剤名', '数量', '包装単位', '使用期限', '薬価（円）', '調剤回数', '調剤数量']);

  // 正常データ（高頻度使用薬）
  ws.addRow(['2119002F1025', '04987123456789', 'アムロジピン錠5mg「サワイ」', 500, '錠', '2027-03-31', 10.1, 120, 500]);
  ws.addRow(['6119003F1020', '04987234567890', 'ロキソプロフェンNa錠60mg「EMEC」', 300, '錠', '2027-06-30', 9.8, 85, 300]);
  ws.addRow(['2171014F1025', '04987345678901', 'カルベジロール錠10mg「サワイ」', 150, '錠', '2027-12-31', 15.5, 45, 150]);
  ws.addRow(['2329025F1024', '04987456789012', 'ランソプラゾールOD錠15mg「トーワ」', 200, '錠', '2027-09-30', 28.3, 60, 200]);

  // 低頻度使用薬
  ws.addRow(['2646725M1039', '04987567890123', 'カロナール細粒20%', 50, 'g', '2028-01-31', 8.9, 5, 50]);
  ws.addRow(['2649707Q3028', '04987678901234', 'モーラステープ20mg', 30, '枚', '2027-09-30', 25.7, 10, 30]);

  // エッジケース: 調剤回数が0（使用なしだが在庫あり）
  ws.addRow(['1319726G1028', '04987789012345', 'アレジオン点眼液0.05%', 10, '本', '2027-06-30', 498.0, 0, 0]);

  // エッジケース: 数量が小数
  ws.addRow(['2190023F1028', '', 'メトホルミン塩酸塩錠250mg「トーワ」', 2.5, 'g', '2027-08-31', 10.1, 3, 2.5]);

  // エッジケース: YJコードのみ（GS1なし）
  ws.addRow(['3999999X9999', '', 'テスト薬品（GS1なし）', 100, '錠', '2027-05-31', 12.0, 20, 100]);

  // エッジケース: GS1コードのみ（YJなし）
  ws.addRow(['', '04987999888777', 'テスト薬品（YJなし）', 80, '錠', '2027-10-31', 8.5, 15, 80]);

  // エッジケース: 大量使用
  ws.addRow(['6119003F1020', '04987234567890', 'ロキソプロフェンNa錠60mg「EMEC」（大量）', 50000, '錠', '2028-06-30', 9.8, 5000, 50000]);

  // エッジケース: 全角文字を含む薬剤名
  ws.addRow(['1124017F1048', '', 'ＰＬ配合顆粒（全角テスト）', 200, 'g', '2027-11-30', 6.5, 30, 200]);

  // エッジケース: 薬剤名が空（スキップされるべき行）
  ws.addRow(['9999999F9999', '', '', 100, '錠', '2027-01-01', 10.0, 10, 100]);

  const filePath = path.join(__dirname, 'used-medication-test.xlsx');
  await wb.xlsx.writeFile(filePath);
  console.log(`[created] ${filePath} (${ws.rowCount - 1} data rows)`);
}

// =============================================
// 見出し行が2行目にあるケース（デッドストックリスト）
// =============================================
async function generateDeadStockWithMultiHeader() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('デッドストックリスト');

  // 1行目: タイトル行（ヘッダーではない）
  ws.addRow(['デッドストックリスト', '', '', '', '', '', `出力日: ${new Date().toLocaleDateString('ja-JP')}`]);
  // 2行目: 実際のヘッダー
  ws.addRow(['YJコード', 'GS1コード', '薬剤名', '数量', '包装単位', '薬価（円）', '使用期限', 'ロット番号']);
  // データ行
  ws.addRow(['2119002F1025', '04987123456789', 'アムロジピン錠5mg「サワイ」', 100, '錠', 10.1, '2027-03-31', 'LOT-A001']);
  ws.addRow(['6119003F1020', '04987234567890', 'ロキソプロフェンNa錠60mg「EMEC」', 50, '錠', 9.8, '2026-12-31', 'LOT-B002']);

  const filePath = path.join(__dirname, 'dead-stock-multi-header.xlsx');
  await wb.xlsx.writeFile(filePath);
  console.log(`[created] ${filePath} (multi-header test)`);
}

// =============================================
// 空のファイル
// =============================================
async function generateEmptyFile() {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Sheet1');

  const filePath = path.join(__dirname, 'empty-test.xlsx');
  await wb.xlsx.writeFile(filePath);
  console.log(`[created] ${filePath} (empty file)`);
}

// =============================================
// ヘッダーのみ（データ行なし）
// =============================================
async function generateHeaderOnly() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');

  ws.addRow(['YJコード', 'GS1コード', '薬剤名', '数量', '包装単位', '薬価（円）', '使用期限', 'ロット番号']);

  const filePath = path.join(__dirname, 'header-only-test.xlsx');
  await wb.xlsx.writeFile(filePath);
  console.log(`[created] ${filePath} (header only)`);
}

// =============================================
// 列名が異なるケース（英語ヘッダー）
// =============================================
async function generateEnglishHeaders() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DeadStock');

  ws.addRow(['Drug Code', 'Drug Name', 'Quantity', 'Unit', 'Unit Price', 'Expiry', 'Lot']);
  ws.addRow(['2119002F1025', 'Amlodipine 5mg', 100, 'Tab', 10.1, '2027-03-31', 'LOT-EN01']);
  ws.addRow(['6119003F1020', 'Loxoprofen 60mg', 50, 'Tab', 9.8, '2026-12-31', 'LOT-EN02']);

  const filePath = path.join(__dirname, 'english-header-test.xlsx');
  await wb.xlsx.writeFile(filePath);
  console.log(`[created] ${filePath} (english headers)`);
}

// Run all generators
async function main() {
  console.log('Generating test xlsx files...\n');
  await generateDeadStock();
  await generateUsedMedication();
  await generateDeadStockWithMultiHeader();
  await generateEmptyFile();
  await generateHeaderOnly();
  await generateEnglishHeaders();
  console.log('\nDone!');
}

main().catch(console.error);
