import * as crypto from 'crypto';
import { ColumnMapping, DEAD_STOCK_FIELDS, USED_MEDICATION_FIELDS } from '../types';

type FieldName = typeof DEAD_STOCK_FIELDS[number] | typeof USED_MEDICATION_FIELDS[number];

const KEYWORD_MAP: Record<FieldName, string[]> = {
  drug_code: ['薬品コード', '医薬品コード', 'JANコード', 'YJコード', '統一商品コード', 'コード', 'code'],
  drug_name: ['薬品名', '医薬品名', '薬剤名', '品名', '品目名', '商品名', '名称', 'drug_name', 'name'],
  quantity: ['数量', '在庫数', '在庫数量', '残数', '個数', 'quantity', 'qty'],
  unit: ['単位', 'unit'],
  yakka_unit_price: ['薬価', '単価', '薬価単価', 'unit_price', 'price'],
  expiration_date: ['使用期限', '有効期限', '期限', 'expiry', 'expiration'],
  lot_number: ['ロット', 'ロット番号', 'lot', 'LOT'],
  monthly_usage: ['月間使用量', '使用量', '月間', '処方量', '使用数量', 'usage'],
};

export function detectHeaderRow(rows: unknown[][]): number {
  let bestRow = 0;
  let bestScore = 0;

  const scanLimit = Math.min(rows.length, 10);
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i];
    if (!row) continue;

    // Count non-empty string cells
    const nonEmptyStrings = row.filter(
      (cell) => cell !== null && cell !== undefined && String(cell).trim().length > 0
    ).length;

    // Bonus for cells that contain known keywords
    let keywordScore = 0;
    for (const cell of row) {
      const cellStr = String(cell || '').normalize('NFKC');
      for (const keywords of Object.values(KEYWORD_MAP)) {
        if (keywords.some((kw) => cellStr.includes(kw))) {
          keywordScore += 5;
        }
      }
    }

    const totalScore = nonEmptyStrings + keywordScore;
    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestRow = i;
    }
  }

  return bestRow;
}

export function suggestMapping(
  headerRow: unknown[],
  uploadType: 'dead_stock' | 'used_medication'
): ColumnMapping {
  const fields = uploadType === 'dead_stock' ? DEAD_STOCK_FIELDS : USED_MEDICATION_FIELDS;
  const mapping: ColumnMapping = {};

  for (const field of fields) {
    mapping[field] = null;
  }

  const headers = headerRow.map((h) => String(h || '').normalize('NFKC'));

  for (const field of fields) {
    const keywords = KEYWORD_MAP[field as FieldName];
    if (!keywords) continue;

    let bestCol: string | null = null;
    let bestScore = 0;

    for (let colIdx = 0; colIdx < headers.length; colIdx++) {
      const header = headers[colIdx];
      if (!header) continue;

      let score = 0;
      for (const keyword of keywords) {
        if (header === keyword) {
          score = 10; // exact match
          break;
        } else if (header.includes(keyword)) {
          score = Math.max(score, 5); // partial match
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestCol = String(colIdx);
      }
    }

    if (bestCol !== null) {
      mapping[field] = bestCol;
    }
  }

  return mapping;
}

export function computeHeaderHash(headerRow: unknown[]): string {
  const headerStr = headerRow.map((h) => String(h || '')).join('|');
  return crypto.createHash('md5').update(headerStr).digest('hex');
}
