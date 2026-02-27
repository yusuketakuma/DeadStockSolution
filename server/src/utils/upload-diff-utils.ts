export function normalizeString(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function normalizeNullableNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.round(Number(value) * 1000) / 1000;
}

export function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\//g, '-').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  return normalized;
}

export function deadStockKey(item: {
  drugCode: string | null;
  drugName: string;
  unit: string | null;
  expirationDate: string | null;
  lotNumber: string | null;
}): string {
  return [
    normalizeString(item.drugCode),
    normalizeString(item.drugName),
    normalizeString(item.unit),
    normalizeString(item.expirationDate),
    normalizeString(item.lotNumber),
  ].join('|');
}

export function usedMedicationKey(item: {
  drugCode: string | null;
  drugName: string;
  unit: string | null;
}): string {
  return [
    normalizeString(item.drugCode),
    normalizeString(item.drugName),
    normalizeString(item.unit),
  ].join('|');
}

export function equalNullableNumber(a: number | string | null, b: number | null): boolean {
  const left = a === null ? null : Number(a);
  const right = b === null ? null : Number(b);
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) < 0.0001;
}

export function dedupeIncomingByKey<T>(incoming: T[], keyFn: (item: T) => string): T[] {
  const deduped = new Map<string, T>();
  for (const item of incoming) {
    deduped.set(keyFn(item), item);
  }
  return [...deduped.values()];
}

export function buildExistingByKey<T>(existing: T[], keyFn: (item: T) => string): Map<string, T> {
  const existingByKey = new Map<string, T>();
  for (const row of existing) {
    const key = keyFn(row);
    if (!existingByKey.has(key)) existingByKey.set(key, row);
  }
  return existingByKey;
}
