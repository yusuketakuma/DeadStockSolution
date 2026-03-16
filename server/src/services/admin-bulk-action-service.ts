export interface CsvParseResult {
  pharmacyIds: number[];
  errors: string[];
}

export function parseBulkActionCsv(csvContent: string): CsvParseResult {
  const lines = csvContent.trim().split(/\r?\n/);
  const pharmacyIds: number[] = [];
  const errors: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || i === 0 && /^(id|pharmacy_id|薬局ID)/i.test(line)) continue;
    const firstCol = line.split(',')[0].trim();
    const id = Number(firstCol);
    if (!Number.isInteger(id) || id < 1) {
      errors.push(`行${i + 1}: 不正なID「${firstCol}」`);
      continue;
    }
    pharmacyIds.push(id);
  }

  return { pharmacyIds: [...new Set(pharmacyIds)], errors };
}
