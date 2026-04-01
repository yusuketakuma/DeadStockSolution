import { parseExcelBuffer } from '../upload-service';
import { detectHeaderRow, getCell, parseYjCode, decodeCsvBuffer, assertCsvLimits, parseCsvLine, type ParsedDrugRow } from './parser-service';
import { parseNumber } from '../../utils/string-utils';

/**
 * 規格単位文字列（例: "10mg1錠", "500mL1袋", "1g"）から薬価単位を抽出する。
 * MHLW Excel は「単位」列がないため specification から補完する。
 */
function extractUnitFromSpecification(specification: string | null): string | null {
  if (!specification) return null;
  const normalized = specification.normalize('NFKC').replace(/\s+/g, '');

  // 括弧付き補足を除去して末尾単位を取る: "500mg1瓶(溶解液付)" → "500mg1瓶"
  const withoutParens = normalized.replace(/[（(][^）)]*[）)]$/g, '');

  // 末尾の日本語単位
  const jpMatch = withoutParens.match(/(錠|カプセル|包|袋|瓶|本|枚|個|管|キット|筒|丸|シリンジ|缶|カセット|シート|セット|吸入)$/);
  if (jpMatch) return jpMatch[1];

  // "バイアル" が含まれていれば瓶扱い
  if (/バイアル/.test(withoutParens)) return '瓶';

  // 末尾の英語/計量単位: "1g" → "g", "10mL" → "mL"
  const enMatch = withoutParens.match(/(g|mg|μg|mL|L)$/i);
  if (enMatch) {
    const u = enMatch[1];
    if (/^ml$/i.test(u)) return 'mL';
    if (/^l$/i.test(u)) return 'L';
    return u;
  }

  return null;
}

const MHLW_HEADER_KEYWORDS: Record<string, string[]> = {
  yjCode: ['薬価基準収載医薬品コード', 'YJコード', '医薬品コード', '収載コード', 'コード'],
  drugName: ['品名', '品目名称', '医薬品名', '名称', '商品名'],
  genericName: ['成分名', '一般名', '一般的名称'],
  specification: ['規格', '規格単位'],
  unit: ['単位', '薬価単位'],
  yakkaPrice: ['薬価', '薬価（円）', '薬価円', '告示価格'],
  manufacturer: ['メーカー', '製造販売業者', '業者名', '会社名', '販売名'],
  category: ['区分', '薬効分類', '投与経路'],
  therapeuticCategory: ['薬効分類番号', '分類番号'],
  listedDate: ['収載日', '収載年月日'],
  transitionDeadline: ['経過措置期限', '経過措置', '経過措置年月日'],
};

function detectMhlwHeaderRow(rows: unknown[][]): { rowIndex: number; mapping: Record<string, number> } {
  return detectHeaderRow(rows, MHLW_HEADER_KEYWORDS, {
    isMatch: (field, header, keyword) => {
      if (field === 'yakkaPrice' && header.includes(keyword) && header.includes('コード')) {
        return false;
      }
      return header === keyword || header.includes(keyword);
    },
  });
}

export function parseMhlwExcelData(rows: unknown[][]): ParsedDrugRow[] {
  const { rowIndex, mapping } = detectMhlwHeaderRow(rows);

  if (mapping.yjCode === undefined && mapping.drugName === undefined) {
    throw new Error('薬価基準収載品目リストのフォーマットを検出できません。YJコードまたは品名の列が必要です。');
  }

  const results: ParsedDrugRow[] = [];

  for (let i = rowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const yjCode = parseYjCode(getCell(row, mapping.yjCode));
    const drugName = getCell(row, mapping.drugName);
    const priceStr = getCell(row, mapping.yakkaPrice);
    const yakkaPrice = parseNumber(priceStr);

    if (!yjCode || !drugName || yakkaPrice === null || yakkaPrice < 0) continue;

    const specification = getCell(row, mapping.specification);
    const rawUnit = getCell(row, mapping.unit);
    const unit = rawUnit || extractUnitFromSpecification(specification);

    results.push({
      yjCode,
      drugName,
      genericName: getCell(row, mapping.genericName),
      specification,
      unit,
      yakkaPrice,
      manufacturer: getCell(row, mapping.manufacturer),
      category: getCell(row, mapping.category),
      therapeuticCategory: getCell(row, mapping.therapeuticCategory),
      listedDate: getCell(row, mapping.listedDate),
      transitionDeadline: getCell(row, mapping.transitionDeadline),
    });
  }

  return results;
}

export function parseMhlwCsvData(csvContent: string): ParsedDrugRow[] {
  const lines = assertCsvLimits(csvContent);
  if (lines.length < 2) return [];

  return parseMhlwExcelData(lines.map((line) => parseCsvLine(line)));
}

/**
 * MHLW 薬価基準ファイル（Excel/CSV）をパースする共通エントリーポイント。
 */
export async function parseMhlwDrugFile(
  url: string,
  contentType: string | null,
  buffer: Buffer,
): Promise<ParsedDrugRow[]> {
  const looksLikeCsv = contentType?.includes('csv')
    || contentType?.includes('text/plain')
    || url.endsWith('.csv');
  if (looksLikeCsv) {
    const csvContent = decodeCsvBuffer(buffer);
    return parseMhlwCsvData(csvContent);
  }
  const excelRows = await parseExcelBuffer(buffer);
  return parseMhlwExcelData(excelRows);
}
