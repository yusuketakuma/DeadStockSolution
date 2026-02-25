import { XMLParser } from 'fast-xml-parser';
import AdmZip from 'adm-zip';
import { parseNumber } from '../utils/string-utils';
import iconv from 'iconv-lite';
import { parseExcelBuffer } from './upload-service';

// ── 型定義 ──────────────────────────────────────────

export interface ParsedDrugRow {
  yjCode: string;
  drugName: string;
  genericName: string | null;
  specification: string | null;
  unit: string | null;
  yakkaPrice: number;
  manufacturer: string | null;
  category: string | null;
  therapeuticCategory: string | null;
  listedDate: string | null;
  transitionDeadline: string | null;
}

export interface ParsedPackageRow {
  yjCode: string;
  gs1Code: string | null;
  janCode: string | null;
  hotCode: string | null;
  packageDescription: string | null;
  packageQuantity: number | null;
  packageUnit: string | null;
}

// ── MHLW Excel パース ─────────────────────────────────

// 厚生労働省の薬価基準収載品目リストの標準的なヘッダーキーワード
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
  let bestRow = 0;
  let bestScore = 0;
  let bestMapping: Record<string, number> = {};

  const scanLimit = Math.min(rows.length, 15);
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i];
    if (!row) continue;

    const headers = row.map((h) => String(h || '').normalize('NFKC').trim());
    const mapping: Record<string, number> = {};
    let score = 0;

    for (const [field, keywords] of Object.entries(MHLW_HEADER_KEYWORDS)) {
      for (let colIdx = 0; colIdx < headers.length; colIdx++) {
        const header = headers[colIdx];
        if (!header) continue;
        for (const keyword of keywords) {
          let matched = header === keyword || header.includes(keyword);
          // 「薬価基準収載医薬品コード」を薬価列と誤認しない
          if (field === 'yakkaPrice' && matched && header.includes('コード')) {
            matched = false;
          }
          if (matched) {
            if (mapping[field] === undefined) {
              mapping[field] = colIdx;
              score += header === keyword ? 10 : 5;
            }
            break;
          }
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
      bestMapping = mapping;
    }
  }

  return { rowIndex: bestRow, mapping: bestMapping };
}

function getCell(row: unknown[], idx: number | undefined): string | null {
  if (idx === undefined || idx < 0 || idx >= row.length) return null;
  const val = row[idx];
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  return str || null;
}

export function parseYjCode(raw: string | null): string | null {
  if (!raw) return null;
  // YJコードは数字12桁（先頭のスペースやハイフン除去）
  const cleaned = raw.replace(/[\s\-]/g, '').normalize('NFKC');
  // 12桁の数字パターンにマッチするか
  if (/^\d{12}$/.test(cleaned)) return cleaned;
  // 先頭にアルファベットが入るパターン（一部旧形式）
  if (/^[A-Z0-9]{12}$/i.test(cleaned)) return cleaned;
  return null;
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

    // YJコードと品名と薬価は必須
    if (!yjCode || !drugName || yakkaPrice === null || yakkaPrice < 0) continue;

    results.push({
      yjCode,
      drugName,
      genericName: getCell(row, mapping.genericName),
      specification: getCell(row, mapping.specification),
      unit: getCell(row, mapping.unit),
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

// ── CSV エンコーディング検出 ──────────────────────────────

/**
 * バッファから文字列に変換する（UTF-8 / Shift_JIS 自動判別）
 * MHLWのCSVはShift_JIS（CP932）の場合が多い
 */
export function decodeCsvBuffer(buffer: Buffer): string {
  // UTF-8 BOM check
  if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return buffer.toString('utf-8').slice(1); // BOM除去
  }

  // UTF-8 として妥当かチェック（不正バイトシーケンスが含まれるならShift_JISの可能性）
  const utf8Text = buffer.toString('utf-8');
  // 置換文字（U+FFFD）が含まれる場合、UTF-8として不正
  if (!utf8Text.includes('\uFFFD')) {
    return utf8Text;
  }

  // Shift_JIS（CP932）でデコードを試みる
  if (iconv.encodingExists('CP932')) {
    return iconv.decode(buffer, 'CP932');
  }

  return utf8Text;
}

// ── CSV パース ──────────────────────────────────────

export function parseMhlwCsvData(csvContent: string): ParsedDrugRow[] {
  const lines = csvContent.split(/\r?\n/);
  if (lines.length < 2) return [];

  // ヘッダー行を検出（CSVなのでカンマ区切り）
  const allRows = lines.map((line) => parseCsvLine(line));
  return parseMhlwExcelData(allRows);
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// ── 包装単位データパース ────────────────────────────────

const PACKAGE_HEADER_KEYWORDS: Record<string, string[]> = {
  yjCode: ['薬価基準収載医薬品コード', 'YJコード', '医薬品コード'],
  gs1Code: ['GS1コード', 'GS1', 'GTIN', '販売包装単位コード'],
  janCode: ['JANコード', 'JAN'],
  hotCode: ['HOTコード', 'HOT', 'HOT番号'],
  packageDescription: ['包装', '包装規格', '包装単位', '包装形態'],
  packageQuantity: ['包装数量', '入数', '数量'],
  packageUnit: ['単位', '包装単位名'],
};

const PACKAGE_XML_KEYWORDS: Record<string, string[]> = {
  yjCode: ['yjcode', 'yjコード', '薬価基準収載医薬品コード', '医薬品コード'],
  gs1Code: ['gs1', '販売包装単位コード', 'gtin'],
  janCode: ['jan'],
  hotCode: ['hot'],
  packageDescription: ['包装単位', '包装規格', '包装形態'],
  packageQuantity: ['包装数量', '入数', '数量'],
  packageUnit: ['包装単位名', '単位'],
};

export function parsePackageCsvData(csvContent: string): ParsedPackageRow[] {
  const lines = csvContent.split(/\r?\n/);
  const allRows = lines.map((line) => parseCsvLine(line));
  return parsePackageExcelData(allRows);
}

function normalizeXmlKey(key: string): string {
  return key
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_\-（）()【】\[\]\/]/g, '');
}

function toXmlStringValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    return text || null;
  }
  if (typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  for (const key of ['#text', '_text', 'text']) {
    const val = record[key];
    if (typeof val === 'string') {
      const text = val.trim();
      if (text) return text;
    }
  }

  return null;
}

function pickXmlField(
  obj: Record<string, unknown>,
  keywords: string[],
  options?: { excludeIfKeyIncludes?: string[] },
): string | null {
  let bestValue: string | null = null;
  let bestScore = -1;

  for (const [rawKey, rawValue] of Object.entries(obj)) {
    const key = normalizeXmlKey(rawKey);
    if (options?.excludeIfKeyIncludes?.some((kw) => key.includes(normalizeXmlKey(kw)))) {
      continue;
    }

    for (const keyword of keywords) {
      const normalizedKeyword = normalizeXmlKey(keyword);
      let score = -1;
      if (key === normalizedKeyword) {
        score = 100;
      } else if (key.endsWith(normalizedKeyword)) {
        score = 80;
      } else if (key.includes(normalizedKeyword)) {
        score = 60;
      }

      if (score > bestScore) {
        const value = toXmlStringValue(rawValue);
        if (value) {
          bestScore = score;
          bestValue = value;
        }
      }
    }
  }
  return bestValue;
}

function extractPackageRowFromXmlObject(obj: Record<string, unknown>): ParsedPackageRow | null {
  const yjRaw = pickXmlField(obj, PACKAGE_XML_KEYWORDS.yjCode);
  const yjCode = parseYjCode(yjRaw);
  if (!yjCode) return null;

  const gs1Code = pickXmlField(obj, PACKAGE_XML_KEYWORDS.gs1Code);
  const janCode = pickXmlField(obj, PACKAGE_XML_KEYWORDS.janCode);
  const hotCode = pickXmlField(obj, PACKAGE_XML_KEYWORDS.hotCode);
  if (!gs1Code && !janCode && !hotCode) return null;

  return {
    yjCode,
    gs1Code,
    janCode,
    hotCode,
    packageDescription: pickXmlField(obj, PACKAGE_XML_KEYWORDS.packageDescription, { excludeIfKeyIncludes: ['コード'] }),
    packageQuantity: parseNumber(pickXmlField(obj, PACKAGE_XML_KEYWORDS.packageQuantity)),
    packageUnit: pickXmlField(obj, PACKAGE_XML_KEYWORDS.packageUnit, { excludeIfKeyIncludes: ['コード'] }),
  };
}

export function parsePackageXmlData(xmlContent: string): ParsedPackageRow[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseTagValue: true,
    parseAttributeValue: false,
    trimValues: true,
  });

  const parsed = parser.parse(xmlContent);
  const rows: ParsedPackageRow[] = [];

  const walk = (node: unknown): void => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (typeof node !== 'object') return;

    const obj = node as Record<string, unknown>;
    const row = extractPackageRowFromXmlObject(obj);
    if (row) rows.push(row);

    for (const value of Object.values(obj)) {
      walk(value);
    }
  };

  walk(parsed);

  const deduped = new Map<string, ParsedPackageRow>();
  for (const row of rows) {
    const key = [row.yjCode, row.gs1Code ?? '', row.janCode ?? '', row.hotCode ?? '', row.packageDescription ?? ''].join('|');
    if (!deduped.has(key)) {
      deduped.set(key, row);
    }
  }
  return [...deduped.values()];
}

const MAX_ZIP_ENTRY_SIZE = 200 * 1024 * 1024; // 200MB per entry
const MAX_ZIP_TOTAL_SIZE = 500 * 1024 * 1024; // 500MB total

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export async function parsePackageZipData(buffer: Buffer): Promise<ParsedPackageRow[]> {
  const zip = new AdmZip(buffer);
  const rows: ParsedPackageRow[] = [];
  let totalSize = 0;

  const entries = zip.getEntries();
  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    if (entry.isDirectory) continue;

    // パストラバーサル対策
    if (entry.entryName.includes('..')) continue;

    // サイズ制限チェック
    if (entry.header.size > MAX_ZIP_ENTRY_SIZE) {
      console.warn(`Skipping oversized ZIP entry: ${entry.entryName} (${entry.header.size} bytes)`);
      continue;
    }
    totalSize += entry.header.size;
    if (totalSize > MAX_ZIP_TOTAL_SIZE) {
      console.warn(`ZIP total extracted size exceeds limit (${MAX_ZIP_TOTAL_SIZE} bytes), stopping`);
      break;
    }

    const lowerName = entry.entryName.toLowerCase();
    const entryBuffer = entry.getData();

    try {
      if (lowerName.endsWith('.xml')) {
        rows.push(...parsePackageXmlData(entryBuffer.toString('utf-8')));
      } else if (lowerName.endsWith('.csv')) {
        rows.push(...parsePackageCsvData(decodeCsvBuffer(entryBuffer)));
      } else if (lowerName.endsWith('.xlsx')) {
        const excelRows = await parseExcelBuffer(entryBuffer);
        rows.push(...parsePackageExcelData(excelRows));
      }
    } catch (err) {
      console.warn(`Failed to parse ZIP entry: ${entry.entryName}`, err instanceof Error ? err.message : err);
    }

    // エントリ処理間にイベントループを解放
    if (idx % 5 === 4) {
      await yieldToEventLoop();
    }
  }

  const deduped = new Map<string, ParsedPackageRow>();
  for (const row of rows) {
    const key = [row.yjCode, row.gs1Code ?? '', row.janCode ?? '', row.hotCode ?? '', row.packageDescription ?? ''].join('|');
    if (!deduped.has(key)) {
      deduped.set(key, row);
    }
  }
  return [...deduped.values()];
}

export function parsePackageExcelData(rows: unknown[][]): ParsedPackageRow[] {
  const { rowIndex, mapping } = detectPackageHeader(rows);
  if (mapping.yjCode === undefined) {
    throw new Error('包装単位データのフォーマットを検出できません。YJコードの列が必要です。');
  }

  const results: ParsedPackageRow[] = [];
  for (let i = rowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const yjCode = parseYjCode(getCell(row, mapping.yjCode));
    if (!yjCode) continue;

    const gs1Code = getCell(row, mapping.gs1Code);
    const janCode = getCell(row, mapping.janCode);
    const hotCode = getCell(row, mapping.hotCode);

    // 少なくとも1つのコードが必要
    if (!gs1Code && !janCode && !hotCode) continue;

    results.push({
      yjCode,
      gs1Code,
      janCode,
      hotCode,
      packageDescription: getCell(row, mapping.packageDescription),
      packageQuantity: parseNumber(getCell(row, mapping.packageQuantity)),
      packageUnit: getCell(row, mapping.packageUnit),
    });
  }
  return results;
}

function detectPackageHeader(rows: unknown[][]): { rowIndex: number; mapping: Record<string, number> } {
  let bestRow = 0;
  let bestScore = 0;
  let bestMapping: Record<string, number> = {};

  const scanLimit = Math.min(rows.length, 15);
  for (let i = 0; i < scanLimit; i++) {
    const row = rows[i];
    if (!row) continue;

    const headers = row.map((h) => String(h || '').normalize('NFKC').trim());
    const mapping: Record<string, number> = {};
    let score = 0;

    for (const [field, keywords] of Object.entries(PACKAGE_HEADER_KEYWORDS)) {
      for (let colIdx = 0; colIdx < headers.length; colIdx++) {
        const header = headers[colIdx];
        if (!header) continue;
        for (const keyword of keywords) {
          if (header === keyword || header.includes(keyword)) {
            if (mapping[field] === undefined) {
              mapping[field] = colIdx;
              score += header === keyword ? 10 : 5;
            }
            break;
          }
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
      bestMapping = mapping;
    }
  }

  return { rowIndex: bestRow, mapping: bestMapping };
}
