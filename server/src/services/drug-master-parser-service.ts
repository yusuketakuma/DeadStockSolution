import iconv from 'iconv-lite';

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

// ── 共通ユーティリティ ──────────────────────────────────

export interface HeaderDetectionOptions {
  isMatch?: (field: string, header: string, keyword: string) => boolean;
}

export function detectHeaderRow(
  rows: unknown[][],
  keywordMap: Record<string, string[]>,
  options?: HeaderDetectionOptions,
): { rowIndex: number; mapping: Record<string, number> } {
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

    for (const [field, keywords] of Object.entries(keywordMap)) {
      for (let colIdx = 0; colIdx < headers.length; colIdx++) {
        const header = headers[colIdx];
        if (!header) continue;
        for (const keyword of keywords) {
          const matched = options?.isMatch
            ? options.isMatch(field, header, keyword)
            : (header === keyword || header.includes(keyword));
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

export function getCell(row: unknown[], idx: number | undefined): string | null {
  if (idx === undefined || idx < 0 || idx >= row.length) return null;
  const val = row[idx];
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  return str || null;
}

export function parseYjCode(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s\-]/g, '').normalize('NFKC');
  if (/^\d{12}$/.test(cleaned)) return cleaned;
  if (/^[A-Z0-9]{12}$/i.test(cleaned)) return cleaned;
  return null;
}

// ── CSV ユーティリティ ──────────────────────────────────

const MAX_CSV_FILE_SIZE = 50 * 1024 * 1024;
const MAX_CSV_ROWS = 100000;
const MAX_CSV_LINE_LENGTH = 10000;

export function decodeCsvBuffer(buffer: Buffer): string {
  if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return buffer.toString('utf-8').slice(1);
  }

  const utf8Text = buffer.toString('utf-8');
  if (!utf8Text.includes('\uFFFD')) {
    return utf8Text;
  }

  if (iconv.encodingExists('CP932')) {
    return iconv.decode(buffer, 'CP932');
  }

  return utf8Text;
}

export function assertCsvLimits(csvContent: string): string[] {
  if (csvContent.length > MAX_CSV_FILE_SIZE) {
    throw new Error(`CSVファイルが大きすぎます（最大${MAX_CSV_FILE_SIZE / 1024 / 1024}MB）`);
  }

  const lines = csvContent.split(/\r?\n/);
  if (lines.length > MAX_CSV_ROWS) {
    throw new Error(`CSV行数が上限を超えています（最大${MAX_CSV_ROWS}行）`);
  }

  return lines;
}

export function parseCsvLine(line: string): string[] {
  if (line.length > MAX_CSV_LINE_LENGTH) {
    throw new Error(`CSV行が長すぎます（最大${MAX_CSV_LINE_LENGTH}文字）`);
  }

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

export function parseCsvContent(csvContent: string): string[][] {
  return assertCsvLimits(csvContent).map((line) => parseCsvLine(line));
}
