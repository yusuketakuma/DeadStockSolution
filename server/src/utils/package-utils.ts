import { parseNumber } from './string-utils';

export type PackageForm = 'loose' | 'ptp' | 'bottle' | 'sachet' | 'vial' | 'ampoule' | 'other' | null;

export interface NormalizedPackageInfo {
  normalizedPackageLabel: string | null;
  packageForm: PackageForm;
  isLoosePackage: boolean;
  quantity: number | null;
  unit: string | null;
}

function formatQuantity(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

function normalizePackageText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '');
}

function normalizeUnit(raw: string | null): string | null {
  if (!raw) return null;
  const normalized = normalizePackageText(raw);
  if (!normalized) return null;

  if (/^(cap|capsule|cp|カプセル)$/i.test(normalized)) return 'カプセル';
  if (/^(ml)$/i.test(normalized)) return 'mL';
  if (/^(μg|ug)$/i.test(normalized)) return 'μg';
  if (/^(mg|g|mL|L|錠|包|袋|本|枚|個|管|キット|カプセル)$/i.test(normalized)) return normalized;

  const match = normalized.match(/(錠|カプセル|包|袋|本|枚|個|管|キット|mL|ml|L|g|mg|μg|ug)/i);
  if (!match) return null;
  return normalizeUnit(match[0]);
}

function detectPackageForm(description: string, isLoose: boolean): PackageForm {
  if (isLoose) return 'loose';
  if (/ptp/i.test(description)) return 'ptp';
  if (/瓶|ボトル|bottle/i.test(description)) return 'bottle';
  if (/分包|sachet|stick|スティック/i.test(description)) return 'sachet';
  if (/バイアル|vial/i.test(description)) return 'vial';
  if (/アンプル|ampoule|ampule/i.test(description)) return 'ampoule';
  if (description) return 'other';
  return null;
}

function parseQuantityAndUnitFromDescription(description: string): { quantity: number | null; unit: string | null } {
  const normalized = description.normalize('NFKC');

  const direct = normalized.match(/(\d+(?:\.\d+)?)\s*(錠|カプセル|包|袋|本|枚|個|管|キット|mL|ml|L|g|mg|μg|ug)/i);
  if (direct) {
    const quantity = parseNumber(direct[1]);
    const unit = normalizeUnit(direct[2]);
    return { quantity, unit };
  }

  const multiplied = normalized.match(/(\d+(?:\.\d+)?)\s*(錠|カプセル|包|袋|本|枚|個)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (multiplied) {
    const left = parseNumber(multiplied[1]);
    const right = parseNumber(multiplied[3]);
    const unit = normalizeUnit(multiplied[2]);
    if (left !== null && right !== null) {
      return { quantity: left * right, unit };
    }
  }

  return { quantity: null, unit: null };
}

export function normalizePackageInfo(input: {
  packageDescription?: string | null;
  packageQuantity?: number | null;
  packageUnit?: string | null;
}): NormalizedPackageInfo {
  const rawDescription = (input.packageDescription ?? '').normalize('NFKC').trim();
  const isLoosePackage = /バラ/.test(rawDescription);
  const packageForm = detectPackageForm(rawDescription, isLoosePackage);

  let quantity = input.packageQuantity ?? null;
  let unit = normalizeUnit(input.packageUnit ?? null);

  if (quantity === null || unit === null) {
    const parsed = parseQuantityAndUnitFromDescription(rawDescription);
    if (quantity === null) quantity = parsed.quantity;
    if (unit === null) unit = parsed.unit;
  }

  const normalizedPackageLabel = quantity !== null && unit
    ? `${formatQuantity(quantity)}${unit}${isLoosePackage ? 'バラ' : ''}`
    : null;

  return {
    normalizedPackageLabel,
    packageForm,
    isLoosePackage,
    quantity,
    unit,
  };
}

/**
 * unit フィールド（CSVアップロード由来）から包装形態を推定する。
 * "10PTP", "100錠バラ", "SP", "1000T" 等を分類。
 */
export function classifyPackageFormFromUnit(unit: string | null): PackageForm {
  if (!unit) return null;
  const normalized = normalizePackageText(unit).toLowerCase();
  if (!normalized) return null;

  // バラ判定（最優先: PTPをバラした品はバラ扱い）
  if (/バラ|ばら/i.test(normalized)) return 'loose';
  if (/散$|散剤|顆粒|細粒|ドライシロップ|ds$/i.test(normalized)) return 'loose';

  // PTP/SP/ヒート/シート
  if (/ptp|sp$|ヒート|シート|プレス/i.test(normalized)) return 'ptp';

  // 瓶・ボトル
  if (/瓶|ボトル|bottle/i.test(normalized)) return 'bottle';

  // 分包・スティック
  if (/分包|sachet|stick|スティック/i.test(normalized)) return 'sachet';

  // バイアル
  if (/バイアル|vial/i.test(normalized)) return 'vial';

  // アンプル・管・シリンジ
  if (/アンプル|ampoule|ampule|管|シリンジ|syringe/i.test(normalized)) return 'ampoule';

  // 貼付剤
  if (/貼付|テープ|パッチ|patch|tape/i.test(normalized)) return 'other';

  // 数字+T のみ（例: "100T", "1000T"）→ 包装数量のみで形態不明
  if (/^\d+t$/i.test(normalized)) return null;

  return null;
}

/**
 * 2つの包装形態がマッチング互換かどうかを判定する。
 *
 * ルール:
 * - 両方 null → 互換（判定不能のため許容）
 * - 片方 null → 互換（判定不能のため許容）
 * - 両方同じ形態 → 互換
 * - 異なる形態 → 非互換
 *
 * 重要: PTP ↔ loose は非互換（PTPをバラした品はバラのみマッチ）
 */
export function arePackageFormsCompatible(formA: PackageForm, formB: PackageForm): boolean {
  if (formA === null || formB === null) return true;
  return formA === formB;
}

function normalizeLooseHint(value: string): boolean {
  const normalized = value.normalize('NFKC');
  return /バラ/.test(normalized);
}

export function scorePackageMatch(options: {
  rowUnit: string | null;
  normalizedPackageLabel: string | null;
  packageDescription: string | null;
  isLoosePackage: boolean;
}): number {
  const rowUnit = options.rowUnit?.normalize('NFKC').replace(/\s+/g, '').toLowerCase() ?? '';
  if (!rowUnit) return 0;

  let score = 0;
  const normalizedLabel = options.normalizedPackageLabel?.normalize('NFKC').replace(/\s+/g, '').toLowerCase() ?? '';
  const description = options.packageDescription?.normalize('NFKC').replace(/\s+/g, '').toLowerCase() ?? '';

  if (normalizedLabel && rowUnit === normalizedLabel) score += 120;
  if (normalizedLabel && rowUnit.includes(normalizedLabel)) score += 80;
  if (normalizedLabel && normalizedLabel.includes(rowUnit)) score += 60;
  if (description && rowUnit === description) score += 80;
  if (description && rowUnit.includes(description)) score += 50;
  if (description && description.includes(rowUnit)) score += 30;

  const rowLoose = normalizeLooseHint(rowUnit);
  if (rowLoose && options.isLoosePackage) score += 20;
  if (rowLoose !== options.isLoosePackage) score -= 10;

  return score;
}
