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

interface CompiledMapping {
  drugCodeIdx: number;
  drugNameIdx: number;
  quantityIdx: number;
  unitIdx: number;
  yakkaUnitPriceIdx: number;
  expirationDateIdx: number;
  lotNumberIdx: number;
  monthlyUsageIdx: number;
}

function parseColumnIndex(index: string | null | undefined): number {
  if (index === null || index === undefined) return -1;
  const parsed = Number(index);
  if (!Number.isInteger(parsed) || parsed < 0) return -1;
  return parsed;
}

function compileMapping(mapping: ColumnMapping): CompiledMapping {
  return {
    drugCodeIdx: parseColumnIndex(mapping.drug_code),
    drugNameIdx: parseColumnIndex(mapping.drug_name),
    quantityIdx: parseColumnIndex(mapping.quantity),
    unitIdx: parseColumnIndex(mapping.unit),
    yakkaUnitPriceIdx: parseColumnIndex(mapping.yakka_unit_price),
    expirationDateIdx: parseColumnIndex(mapping.expiration_date),
    lotNumberIdx: parseColumnIndex(mapping.lot_number),
    monthlyUsageIdx: parseColumnIndex(mapping.monthly_usage),
  };
}

function getCellValue(row: unknown[], colIndex: number): unknown {
  if (colIndex < 0 || colIndex >= row.length) return null;
  return row[colIndex];
}

function getStringValue(row: unknown[], colIndex: number): string | null {
  const val = getCellValue(row, colIndex);
  if (val === null || val === undefined || String(val).trim() === '') return null;
  return String(val).trim();
}

function getNumberValue(row: unknown[], colIndex: number): number | null {
  const val = getCellValue(row, colIndex);
  return parseNumber(val);
}

export function extractDeadStockRows(
  dataRows: unknown[][],
  mapping: ColumnMapping,
  startIndex: number = 0
): ExtractedDeadStock[] {
  const m = compileMapping(mapping);
  const results: ExtractedDeadStock[] = [];

  for (let i = startIndex; i < dataRows.length; i++) {
    const row = dataRows[i];
    const drugName = getStringValue(row, m.drugNameIdx);
    const quantity = getNumberValue(row, m.quantityIdx);

    // Skip rows without drug name or quantity
    if (!drugName || quantity === null || quantity <= 0) continue;

    const yakkaUnitPrice = getNumberValue(row, m.yakkaUnitPriceIdx);
    const yakkaTotal = yakkaUnitPrice !== null ? yakkaUnitPrice * quantity : null;

    results.push({
      drugCode: getStringValue(row, m.drugCodeIdx),
      drugName,
      quantity,
      unit: getStringValue(row, m.unitIdx),
      yakkaUnitPrice,
      yakkaTotal,
      expirationDate: getStringValue(row, m.expirationDateIdx),
      lotNumber: getStringValue(row, m.lotNumberIdx),
    });
  }

  return results;
}

export function extractUsedMedicationRows(
  dataRows: unknown[][],
  mapping: ColumnMapping,
  startIndex: number = 0
): ExtractedUsedMedication[] {
  const m = compileMapping(mapping);
  const results: ExtractedUsedMedication[] = [];

  for (let i = startIndex; i < dataRows.length; i++) {
    const row = dataRows[i];
    const drugName = getStringValue(row, m.drugNameIdx);
    if (!drugName) continue;

    results.push({
      drugCode: getStringValue(row, m.drugCodeIdx),
      drugName,
      monthlyUsage: getNumberValue(row, m.monthlyUsageIdx),
      unit: getStringValue(row, m.unitIdx),
      yakkaUnitPrice: getNumberValue(row, m.yakkaUnitPriceIdx),
    });
  }

  return results;
}
