import { ColumnMapping } from '../types';
import { parseNumber } from '../utils/string-utils';
import { parseColumnIndex, getCell as getCellValue } from './column-mapper';

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

export interface UploadExtractionIssue {
  rowNumber: number;
  issueCode: string;
  issueMessage: string;
  rowData: unknown[] | null;
}

export interface UploadExtractionResult<T> {
  rows: T[];
  issues: UploadExtractionIssue[];
  inspectedRowCount: number;
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

function getStringValue(row: unknown[], colIndex: number): string | null {
  const val = getCellValue(row, colIndex);
  if (val === null || val === undefined || String(val).trim() === '') return null;
  return String(val).trim();
}

function getNumberValue(row: unknown[], colIndex: number): number | null {
  const val = getCellValue(row, colIndex);
  return parseNumber(val);
}

function isBlankCell(cell: unknown): boolean {
  if (cell === null || cell === undefined) return true;
  if (typeof cell === 'string') return cell.trim() === '';
  return false;
}

function isBlankRow(row: unknown[]): boolean {
  return row.every((cell) => isBlankCell(cell));
}

function normalizeRowForIssue(row: unknown[]): unknown[] {
  return row.map((cell) => {
    if (cell === null || cell === undefined) return '';
    if (typeof cell === 'string') return cell;
    if (typeof cell === 'number' || typeof cell === 'boolean') return cell;
    return String(cell);
  });
}

function createIssue(
  rowIndex: number,
  issueCode: string,
  issueMessage: string,
  row: unknown[],
): UploadExtractionIssue {
  return {
    rowNumber: rowIndex + 1,
    issueCode,
    issueMessage,
    rowData: normalizeRowForIssue(row),
  };
}

export function extractDeadStockRowsWithIssues(
  dataRows: unknown[][],
  mapping: ColumnMapping,
  startIndex: number = 0,
): UploadExtractionResult<ExtractedDeadStock> {
  const m = compileMapping(mapping);
  const rows: ExtractedDeadStock[] = [];
  const issues: UploadExtractionIssue[] = [];
  let inspectedRowCount = 0;

  for (let i = startIndex; i < dataRows.length; i += 1) {
    const row = dataRows[i] ?? [];
    if (isBlankRow(row)) {
      continue;
    }
    inspectedRowCount += 1;

    const drugName = getStringValue(row, m.drugNameIdx);
    const quantity = getNumberValue(row, m.quantityIdx);

    if (!drugName) {
      issues.push(createIssue(i, 'MISSING_DRUG_NAME', '薬剤名が入力されていません', row));
      continue;
    }

    if (quantity === null) {
      issues.push(createIssue(i, 'INVALID_QUANTITY', '数量が数値として解釈できません', row));
      continue;
    }

    if (quantity <= 0) {
      issues.push(createIssue(i, 'NON_POSITIVE_QUANTITY', '数量は0より大きい値を指定してください', row));
      continue;
    }

    const yakkaUnitPrice = getNumberValue(row, m.yakkaUnitPriceIdx);
    const yakkaTotal = yakkaUnitPrice !== null ? yakkaUnitPrice * quantity : null;

    rows.push({
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

  return {
    rows,
    issues,
    inspectedRowCount,
  };
}

export function extractDeadStockRows(
  dataRows: unknown[][],
  mapping: ColumnMapping,
  startIndex: number = 0,
): ExtractedDeadStock[] {
  return extractDeadStockRowsWithIssues(dataRows, mapping, startIndex).rows;
}

export function extractUsedMedicationRowsWithIssues(
  dataRows: unknown[][],
  mapping: ColumnMapping,
  startIndex: number = 0,
): UploadExtractionResult<ExtractedUsedMedication> {
  const m = compileMapping(mapping);
  const rows: ExtractedUsedMedication[] = [];
  const issues: UploadExtractionIssue[] = [];
  let inspectedRowCount = 0;

  for (let i = startIndex; i < dataRows.length; i += 1) {
    const row = dataRows[i] ?? [];
    if (isBlankRow(row)) {
      continue;
    }
    inspectedRowCount += 1;

    const drugName = getStringValue(row, m.drugNameIdx);
    if (!drugName) {
      issues.push(createIssue(i, 'MISSING_DRUG_NAME', '薬剤名が入力されていません', row));
      continue;
    }

    rows.push({
      drugCode: getStringValue(row, m.drugCodeIdx),
      drugName,
      monthlyUsage: getNumberValue(row, m.monthlyUsageIdx),
      unit: getStringValue(row, m.unitIdx),
      yakkaUnitPrice: getNumberValue(row, m.yakkaUnitPriceIdx),
    });
  }

  return {
    rows,
    issues,
    inspectedRowCount,
  };
}

export function extractUsedMedicationRows(
  dataRows: unknown[][],
  mapping: ColumnMapping,
  startIndex: number = 0,
): ExtractedUsedMedication[] {
  return extractUsedMedicationRowsWithIssues(dataRows, mapping, startIndex).rows;
}
