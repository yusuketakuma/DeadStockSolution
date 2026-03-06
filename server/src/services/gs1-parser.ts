import { parseYjCode } from './drug-master-parser-service';

const GS_SEPARATOR = '\u001D';
const FNC1_PLACEHOLDER = '[FNC1]';

export type CameraCodeType = 'gs1' | 'yj' | 'unknown';

export interface ParsedCameraCode {
  codeType: CameraCodeType;
  normalizedCode: string;
  gtin: string | null;
  yjCode: string | null;
  expirationDate: string | null;
  lotNumber: string | null;
  warnings: string[];
}

interface PartialGs1Fields {
  gtin?: string;
  expirationDate?: string;
  lotNumber?: string;
}

function stripSymbologyPrefix(value: string): string {
  if (value.startsWith(']') && value.length >= 3) {
    return value.slice(3);
  }
  return value;
}

function normalizeRawCode(value: string): string {
  return stripSymbologyPrefix(value)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1C\x1E-\x1F\x7F]/g, '')
    .replaceAll(FNC1_PLACEHOLDER, GS_SEPARATOR)
    .replace(/\s+/g, '')
    .normalize('NFKC')
    .trim();
}

function toIsoDateFromYymmdd(raw: string): string | null {
  if (!/^\d{6}$/.test(raw)) return null;
  const yy = Number(raw.slice(0, 2));
  const mm = Number(raw.slice(2, 4));
  const dd = Number(raw.slice(4, 6));
  const fullYear = 2000 + yy;
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;

  const date = new Date(Date.UTC(fullYear, mm - 1, dd));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCFullYear() !== fullYear || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) {
    return null;
  }

  const month = String(mm).padStart(2, '0');
  const day = String(dd).padStart(2, '0');
  return `${fullYear}-${month}-${day}`;
}

function parseBracketedGs1(value: string): PartialGs1Fields | null {
  const tokenRegex = /\((\d{2,4})\)/g;
  const tokens: Array<{ ai: string; aiStart: number; valueStart: number; valueEnd: number }> = [];

  let match: RegExpExecArray | null = tokenRegex.exec(value);
  while (match) {
    tokens.push({
      ai: match[1],
      aiStart: match.index,
      valueStart: tokenRegex.lastIndex,
      valueEnd: -1,
    });
    match = tokenRegex.exec(value);
  }

  if (tokens.length === 0) return null;

  for (let i = 0; i < tokens.length; i += 1) {
    tokens[i].valueEnd = i + 1 < tokens.length ? tokens[i + 1].aiStart : value.length;
  }

  const parsed: PartialGs1Fields = {};
  for (const token of tokens) {
    const rawField = value.slice(token.valueStart, token.valueEnd).replaceAll(GS_SEPARATOR, '').trim();
    if (token.ai === '01') {
      const gtin = rawField.slice(0, 14);
      if (/^\d{14}$/.test(gtin)) parsed.gtin = gtin;
    } else if (token.ai === '17') {
      const exp = rawField.slice(0, 6);
      const iso = toIsoDateFromYymmdd(exp);
      if (iso) parsed.expirationDate = iso;
    } else if (token.ai === '10') {
      const lot = rawField.slice(0, 20);
      if (lot) parsed.lotNumber = lot;
    }
  }

  return parsed.gtin || parsed.expirationDate || parsed.lotNumber ? parsed : null;
}

function parseUnbracketedGs1(value: string): PartialGs1Fields | null {
  const parsed: PartialGs1Fields = {};
  let index = 0;

  const consumeSeparator = () => {
    while (index < value.length && value[index] === GS_SEPARATOR) {
      index += 1;
    }
  };

  consumeSeparator();
  while (index + 2 <= value.length) {
    const ai = value.slice(index, index + 2);
    if (ai !== '01' && ai !== '17' && ai !== '10') break;
    index += 2;

    if (ai === '01') {
      const gtin = value.slice(index, index + 14);
      if (!/^\d{14}$/.test(gtin)) return null;
      parsed.gtin = gtin;
      index += 14;
      consumeSeparator();
      continue;
    }

    if (ai === '17') {
      const exp = value.slice(index, index + 6);
      const iso = toIsoDateFromYymmdd(exp);
      if (!iso) return null;
      parsed.expirationDate = iso;
      index += 6;
      consumeSeparator();
      continue;
    }

    const lotStart = index;
    while (index < value.length && value[index] !== GS_SEPARATOR) {
      index += 1;
    }
    const lot = value.slice(lotStart, index).slice(0, 20);
    if (!lot) return null;
    parsed.lotNumber = lot;
    consumeSeparator();
  }

  if (parsed.gtin || parsed.expirationDate || parsed.lotNumber) {
    return parsed;
  }

  if (/^\d{13}$/.test(value)) {
    return { gtin: `0${value}` };
  }
  if (/^\d{14}$/.test(value)) {
    return { gtin: value };
  }

  return null;
}

export function parseCameraCode(rawCode: string): ParsedCameraCode {
  const normalizedCode = normalizeRawCode(rawCode);
  const warnings: string[] = [];

  const bracketed = parseBracketedGs1(normalizedCode);
  const unbracketed = bracketed ? null : parseUnbracketedGs1(normalizedCode);
  const gs1 = bracketed ?? unbracketed;

  if (gs1) {
    if (gs1.expirationDate === undefined) {
      warnings.push('使用期限(AI17)はバーコードから取得できませんでした。');
    }
    if (gs1.lotNumber === undefined) {
      warnings.push('ロット番号(AI10)はバーコードから取得できませんでした。');
    }

    return {
      codeType: 'gs1',
      normalizedCode,
      gtin: gs1.gtin ?? null,
      yjCode: null,
      expirationDate: gs1.expirationDate ?? null,
      lotNumber: gs1.lotNumber ?? null,
      warnings,
    };
  }

  const yjCode = parseYjCode(normalizedCode);
  if (yjCode) {
    return {
      codeType: 'yj',
      normalizedCode,
      gtin: null,
      yjCode,
      expirationDate: null,
      lotNumber: null,
      warnings,
    };
  }

  return {
    codeType: 'unknown',
    normalizedCode,
    gtin: null,
    yjCode: null,
    expirationDate: null,
    lotNumber: null,
    warnings: ['GS1またはYJコードとして認識できませんでした。'],
  };
}
