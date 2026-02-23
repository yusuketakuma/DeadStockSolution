import * as XLSX from 'xlsx';

export function parseExcelBuffer(buffer: Buffer): unknown[][] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];

  // Convert to array of arrays (raw data)
  const data: unknown[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: false,
  });

  return data;
}

export function getPreviewRows(allRows: unknown[][], headerRowIndex: number, count: number = 5): unknown[][] {
  const start = headerRowIndex + 1;
  return allRows.slice(start, start + count);
}
