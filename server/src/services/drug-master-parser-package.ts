import { XMLParser } from 'fast-xml-parser';
import AdmZip from 'adm-zip';
import { parseNumber } from '../utils/string-utils';
import { parseExcelBuffer } from './upload-service';
import { logger } from './logger';
import { detectHeaderRow, getCell, parseYjCode, decodeCsvBuffer, parseCsvContent, type ParsedPackageRow } from './drug-master-parser-service';

const PACKAGE_HEADER_KEYWORDS: Record<string, string[]> = {
  yjCode: ['薬価基準収載医薬品コード', 'YJコード', '医薬品コード', '薬価コード'],
  gs1Code: ['GS1コード', 'GS1', 'GTIN', '販売包装単位コード'],
  janCode: ['JANコード', 'JAN', '物流用JANコード'],
  hotCode: ['HOTコード', 'HOT', 'HOT番号', '基準番号'],
  packageDescription: ['包装', '包装規格', '包装単位', '包装形態', '調剤包装単位名称'],
  packageQuantity: ['包装数量', '入数', '数量', '包装単位数'],
  packageUnit: ['包装単位数単位', '包装単位名', '包装単位単位', '単位'],
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

type XmlFieldOptions = { excludeIfKeyIncludes?: string[] };

function normalizeXmlKey(key: string): string {
  return key.normalize('NFKC').toLowerCase().replace(/[\s_\-（）()【】\[\]\/]/g, '');
}

function toXmlStringValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    return text || null;
  }
  if (typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const textKeys = ['#text', '_text', 'text'];
  for (const key of textKeys) {
    const val = record[key];
    if (typeof val !== 'string') continue;
    const text = val.trim();
    if (text) return text;
  }
  return null;
}

function getXmlKeyScore(key: string, normalizedKeyword: string): number {
  if (key === normalizedKeyword) return 100;
  if (key.endsWith(normalizedKeyword)) return 80;
  if (key.includes(normalizedKeyword)) return 60;
  return -1;
}

function shouldExcludeXmlKey(key: string, options?: XmlFieldOptions): boolean {
  if (!options?.excludeIfKeyIncludes?.length) return false;
  return options.excludeIfKeyIncludes.some((kw) => key.includes(normalizeXmlKey(kw)));
}

function pickXmlField(
  obj: Record<string, unknown>,
  keywords: string[],
  options?: XmlFieldOptions,
): string | null {
  let bestValue: string | null = null;
  let bestScore = -1;
  const normalizedKeywords = keywords.map((keyword) => normalizeXmlKey(keyword));

  for (const [rawKey, rawValue] of Object.entries(obj)) {
    const key = normalizeXmlKey(rawKey);
    if (shouldExcludeXmlKey(key, options)) continue;

    for (const normalizedKeyword of normalizedKeywords) {
      const score = getXmlKeyScore(key, normalizedKeyword);
      if (score <= bestScore) continue;

      const value = toXmlStringValue(rawValue);
      if (!value) continue;
      bestScore = score;
      bestValue = value;
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

function buildPackageRowKey(row: ParsedPackageRow): string {
  return [row.yjCode, row.gs1Code ?? '', row.janCode ?? '', row.hotCode ?? '', row.packageDescription ?? ''].join('|');
}

function dedupePackageRows(rows: ParsedPackageRow[]): ParsedPackageRow[] {
  const deduped = new Map<string, ParsedPackageRow>();
  for (const row of rows) {
    const key = buildPackageRowKey(row);
    if (!deduped.has(key)) {
      deduped.set(key, row);
    }
  }
  return [...deduped.values()];
}

export function parsePackageCsvData(csvContent: string): ParsedPackageRow[] {
  return parsePackageExcelData(parseCsvContent(csvContent));
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
  return dedupePackageRows(rows);
}

const MAX_ZIP_ENTRY_SIZE = 200 * 1024 * 1024;
const MAX_ZIP_TOTAL_SIZE = 500 * 1024 * 1024;

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function parsePackageZipEntry(entryName: string, entryBuffer: Buffer): Promise<ParsedPackageRow[]> | ParsedPackageRow[] {
  const lowerName = entryName.toLowerCase();
  if (lowerName.endsWith('.xml')) {
    return parsePackageXmlData(entryBuffer.toString('utf-8'));
  }
  if (lowerName.endsWith('.csv')) {
    return parsePackageCsvData(decodeCsvBuffer(entryBuffer));
  }
  if (lowerName.endsWith('.xlsx')) {
    return parseExcelBuffer(entryBuffer).then((excelRows) => parsePackageExcelData(excelRows));
  }
  return [];
}

function buildPackageRowFromExcelRow(
  row: unknown[],
  mapping: Record<string, number | undefined>,
  yjCode: string,
): ParsedPackageRow {
  return {
    yjCode,
    gs1Code: getCell(row, mapping.gs1Code),
    janCode: getCell(row, mapping.janCode),
    hotCode: getCell(row, mapping.hotCode),
    packageDescription: getCell(row, mapping.packageDescription),
    packageQuantity: parseNumber(getCell(row, mapping.packageQuantity)),
    packageUnit: getCell(row, mapping.packageUnit),
  };
}

function pushIfHasAnyPackageCode(results: ParsedPackageRow[], row: ParsedPackageRow): void {
  if (!row.gs1Code && !row.janCode && !row.hotCode) return;
  results.push(row);
}

function pushGs1VariantRow(
  results: ParsedPackageRow[],
  baseRow: ParsedPackageRow,
  gs1Code: string,
): void {
  results.push({ ...baseRow, gs1Code, janCode: null });
}

export async function parsePackageZipData(buffer: Buffer): Promise<ParsedPackageRow[]> {
  const zip = new AdmZip(buffer);
  const rows: ParsedPackageRow[] = [];
  let totalSize = 0;

  const entries = zip.getEntries();
  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx];
    if (entry.isDirectory || entry.entryName.includes('..')) continue;

    if (entry.header.size > MAX_ZIP_ENTRY_SIZE) {
      logger.warn(`Skipping oversized ZIP entry: ${entry.entryName} (${entry.header.size} bytes)`);
      continue;
    }
    totalSize += entry.header.size;
    if (totalSize > MAX_ZIP_TOTAL_SIZE) {
      logger.warn(`ZIP total extracted size exceeds limit (${MAX_ZIP_TOTAL_SIZE} bytes), stopping`);
      break;
    }

    const entryBuffer = entry.getData();
    try {
      rows.push(...await parsePackageZipEntry(entry.entryName, entryBuffer));
    } catch (err) {
      logger.warn(`Failed to parse ZIP entry: ${entry.entryName}`, { error: err instanceof Error ? err.message : err });
    }

    if (idx % 5 === 4) {
      await yieldToEventLoop();
    }
  }

  return dedupePackageRows(rows);
}

// medhot 形式で複数GS1列を展開するための追加キーワード
const MEDHOT_EXTRA_GS1_KEYWORDS: Record<string, string[]> = {
  dispensingUnitCode: ['調剤包装単位コード'],
  outerPackageCode: ['元梱包装単位コード'],
};

export function parsePackageExcelData(rows: unknown[][]): ParsedPackageRow[] {
  const { rowIndex, mapping } = detectHeaderRow(rows, PACKAGE_HEADER_KEYWORDS);
  if (mapping.yjCode === undefined) {
    throw new Error('包装単位データのフォーマットを検出できません。YJコードの列が必要です。');
  }

  // medhot 形式の追加GS1列を検出
  const { mapping: extraMapping } = detectHeaderRow(rows, MEDHOT_EXTRA_GS1_KEYWORDS);

  const results: ParsedPackageRow[] = [];
  for (let i = rowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const yjCode = parseYjCode(getCell(row, mapping.yjCode));
    if (!yjCode) continue;

    const baseRow = buildPackageRowFromExcelRow(row, mapping, yjCode);

    // メインの販売包装単位コード
    pushIfHasAnyPackageCode(results, baseRow);

    // medhot: 調剤包装単位コード（販売包装単位コードと異なる場合のみ追加）
    const dispensingCode = getCell(row, extraMapping.dispensingUnitCode);
    if (dispensingCode && dispensingCode !== baseRow.gs1Code) {
      pushGs1VariantRow(results, baseRow, dispensingCode);
    }

    // medhot: 元梱包装単位コード（販売包装単位コードと異なる場合のみ追加）
    const outerCode = getCell(row, extraMapping.outerPackageCode);
    if (!outerCode || outerCode === baseRow.gs1Code || outerCode === dispensingCode) continue;
    pushGs1VariantRow(results, baseRow, outerCode);
  }
  return results;
}
