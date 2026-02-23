import { ColumnMapping } from '../types';
import { parseNumber } from '../utils/string-utils';

interface ExtractedDeadStock {
  drugCode: string | null;
  drugName: string;
  quantity: number;
  unit: string | null;
  yakkaUnitPrice: number | null;
  yakkaTotal: number | null;
  expirationDate: string | null;
  lotNumber: string | null;
}

interface ExtractedUsedMedication {
  drugCode: string | null;
  drugName: string;
  monthlyUsage: number | null;
  unit: string | null;
  yakkaUnitPrice: number | null;
}

function getCellValue(row: unknown[], colIndex: string | null): unknown {
  if (colIndex === null) return null;
  const idx = parseInt(colIndex);
  if (isNaN(idx) || idx < 0 || idx >= row.length) return null;
  return row[idx];
}

function getStringValue(row: unknown[], colIndex: string | null): string | null {
  const val = getCellValue(row, colIndex);
  if (val === null || val === undefined || String(val).trim() === '') return null;
  return String(val).trim();
}

function getNumberValue(row: unknown[], colIndex: string | null): number | null {
  const val = getCellValue(row, colIndex);
  return parseNumber(val);
}

export function extractDeadStockRows(
  dataRows: unknown[][],
  mapping: ColumnMapping
): ExtractedDeadStock[] {
  const results: ExtractedDeadStock[] = [];

  for (const row of dataRows) {
    const drugName = getStringValue(row, mapping.drug_name ?? null);
    const quantity = getNumberValue(row, mapping.quantity ?? null);

    // Skip rows without drug name or quantity
    if (!drugName || quantity === null || quantity <= 0) continue;

    const yakkaUnitPrice = getNumberValue(row, mapping.yakka_unit_price ?? null);
    const yakkaTotal = yakkaUnitPrice !== null ? yakkaUnitPrice * quantity : null;

    results.push({
      drugCode: getStringValue(row, mapping.drug_code ?? null),
      drugName,
      quantity,
      unit: getStringValue(row, mapping.unit ?? null),
      yakkaUnitPrice,
      yakkaTotal,
      expirationDate: getStringValue(row, mapping.expiration_date ?? null),
      lotNumber: getStringValue(row, mapping.lot_number ?? null),
    });
  }

  return results;
}

export function extractUsedMedicationRows(
  dataRows: unknown[][],
  mapping: ColumnMapping
): ExtractedUsedMedication[] {
  const results: ExtractedUsedMedication[] = [];

  for (const row of dataRows) {
    const drugName = getStringValue(row, mapping.drug_name ?? null);
    if (!drugName) continue;

    results.push({
      drugCode: getStringValue(row, mapping.drug_code ?? null),
      drugName,
      monthlyUsage: getNumberValue(row, mapping.monthly_usage ?? null),
      unit: getStringValue(row, mapping.unit ?? null),
      yakkaUnitPrice: getNumberValue(row, mapping.yakka_unit_price ?? null),
    });
  }

  return results;
}
