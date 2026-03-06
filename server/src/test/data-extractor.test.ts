import { describe, expect, it } from 'vitest';
import {
  extractDeadStockRowsWithIssues,
  extractDeadStockRows,
  extractUsedMedicationRowsWithIssues,
  extractUsedMedicationRows,
} from '../services/data-extractor';
import type { ColumnMapping } from '../types';

/** テスト用の最小カラムマッピング（列インデックスをそのまま指定）
 *  col: 0=drugCode, 1=drugName, 2=quantity, 3=unit, 4=yakkaUnitPrice, 5=expirationDate, 6=lotNumber
 */
const DEAD_STOCK_MAPPING: ColumnMapping = {
  drug_code: '0',
  drug_name: '1',
  quantity: '2',
  unit: '3',
  yakka_unit_price: '4',
  expiration_date: '5',
  lot_number: '6',
  monthly_usage: null,
};

/** col: 0=drugCode, 1=drugName, 2=monthlyUsage, 3=unit, 4=yakkaUnitPrice */
const USED_MED_MAPPING: ColumnMapping = {
  drug_code: '0',
  drug_name: '1',
  monthly_usage: '2',
  unit: '3',
  yakka_unit_price: '4',
  quantity: null,
  expiration_date: null,
  lot_number: null,
};

// ---- extractDeadStockRowsWithIssues ----------------------------------------

describe('extractDeadStockRowsWithIssues', () => {
  describe('正常系', () => {
    it('有効な行を正しく抽出する', () => {
      const rows = [
        ['YJ001', '薬A', '10', '錠', '100.5', '2027-03-31', 'LOT001'],
      ];
      const result = extractDeadStockRowsWithIssues(rows, DEAD_STOCK_MAPPING);

      expect(result.rows).toHaveLength(1);
      expect(result.issues).toHaveLength(0);
      expect(result.inspectedRowCount).toBe(1);
      expect(result.rows[0]).toMatchObject({
        drugCode: 'YJ001',
        drugName: '薬A',
        quantity: 10,
        unit: '錠',
        yakkaUnitPrice: 100.5,
        yakkaTotal: 1005,
        expirationDate: '2027-03-31',
        lotNumber: 'LOT001',
      });
    });

    it('薬価が未入力の場合 yakkaTotal が null になる', () => {
      const rows = [['', '薬B', '5', '包', '', '', '']];
      const result = extractDeadStockRowsWithIssues(rows, DEAD_STOCK_MAPPING);

      expect(result.rows[0].yakkaUnitPrice).toBeNull();
      expect(result.rows[0].yakkaTotal).toBeNull();
    });

    it('drugCode が未入力の場合 null になる', () => {
      const rows = [['', '薬C', '3', null, null, null, null]];
      const result = extractDeadStockRowsWithIssues(rows, DEAD_STOCK_MAPPING);

      expect(result.rows[0].drugCode).toBeNull();
    });

    it('startIndex でヘッダー行をスキップできる', () => {
      const rows = [
        ['drugCode', 'drugName', 'quantity', 'unit', 'yakka', 'exp', 'lot'], // ヘッダー
        ['YJ002', '薬D', '20', '錠', '50', '2028-01-01', 'LOT002'],
      ];
      const result = extractDeadStockRowsWithIssues(rows, DEAD_STOCK_MAPPING, 1);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].drugName).toBe('薬D');
      expect(result.inspectedRowCount).toBe(1);
    });
  });

  describe('境界値', () => {
    it('空の dataRows に対して空の結果を返す', () => {
      const result = extractDeadStockRowsWithIssues([], DEAD_STOCK_MAPPING);

      expect(result.rows).toHaveLength(0);
      expect(result.issues).toHaveLength(0);
      expect(result.inspectedRowCount).toBe(0);
    });

    it('全セルが空白の行はスキップされる', () => {
      const rows = [
        ['', '', '', '', '', '', ''],
        ['YJ003', '薬E', '1', '錠', '10', '', ''],
      ];
      const result = extractDeadStockRowsWithIssues(rows, DEAD_STOCK_MAPPING);

      expect(result.rows).toHaveLength(1);
      expect(result.inspectedRowCount).toBe(1);
    });

    it('大量の行（1000行）でも正しく処理される', () => {
      const rows = Array.from({ length: 1000 }, (_, i) => [
        `YJ${i.toString().padStart(4, '0')}`,
        `薬${i}`,
        '1',
        '錠',
        '10',
        '',
        '',
      ]);
      const result = extractDeadStockRowsWithIssues(rows, DEAD_STOCK_MAPPING);

      expect(result.rows).toHaveLength(1000);
      expect(result.issues).toHaveLength(0);
      expect(result.inspectedRowCount).toBe(1000);
    });
  });

  describe('異常系', () => {
    it('薬剤名が空の行はスキップされ issue が記録される', () => {
      const rows = [['YJ001', '', '10', '錠', '', '', '']];
      const result = extractDeadStockRowsWithIssues(rows, DEAD_STOCK_MAPPING);

      expect(result.rows).toHaveLength(0);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].issueCode).toBe('MISSING_DRUG_NAME');
      expect(result.issues[0].rowNumber).toBe(1);
    });

    it('数量が数値でない場合 issue が記録される', () => {
      const rows = [['YJ001', '薬A', 'abc', '錠', '', '', '']];
      const result = extractDeadStockRowsWithIssues(rows, DEAD_STOCK_MAPPING);

      expect(result.rows).toHaveLength(0);
      expect(result.issues[0].issueCode).toBe('INVALID_QUANTITY');
    });

    it('数量が 0 以下の場合 issue が記録される', () => {
      const rows = [
        ['YJ001', '薬A', '0', '錠', '', '', ''],
        ['YJ002', '薬B', '-5', '錠', '', '', ''],
      ];
      const result = extractDeadStockRowsWithIssues(rows, DEAD_STOCK_MAPPING);

      expect(result.rows).toHaveLength(0);
      expect(result.issues).toHaveLength(2);
      expect(result.issues[0].issueCode).toBe('NON_POSITIVE_QUANTITY');
      expect(result.issues[1].issueCode).toBe('NON_POSITIVE_QUANTITY');
    });

    it('有効行と無効行が混在する場合にそれぞれ正しく分類される', () => {
      const rows = [
        ['YJ001', '薬A', '5', '錠', '', '', ''],    // 有効
        ['YJ002', '', '10', '錠', '', '', ''],       // 薬名なし → issue
        ['YJ003', '薬C', 'N/A', '錠', '', '', ''],  // 数量不正 → issue
        ['YJ004', '薬D', '3', '包', '20', '', ''],  // 有効
      ];
      const result = extractDeadStockRowsWithIssues(rows, DEAD_STOCK_MAPPING);

      expect(result.rows).toHaveLength(2);
      expect(result.issues).toHaveLength(2);
      expect(result.inspectedRowCount).toBe(4);
    });

    it('issue の rowData に元データが含まれる', () => {
      const rows = [['YJ001', '', '10', '錠', '', '', '']];
      const result = extractDeadStockRowsWithIssues(rows, DEAD_STOCK_MAPPING);

      expect(result.issues[0].rowData).not.toBeNull();
      expect(Array.isArray(result.issues[0].rowData)).toBe(true);
    });
  });
});

// ---- extractDeadStockRows（wrapper） ----------------------------------------

describe('extractDeadStockRows', () => {
  it('rows のみを返す', () => {
    const rows = [['YJ001', '薬A', '2', '錠', '10', '', '']];
    const result = extractDeadStockRows(rows, DEAD_STOCK_MAPPING);

    expect(Array.isArray(result)).toBe(true);
    expect(result[0].drugName).toBe('薬A');
  });
});

// ---- extractUsedMedicationRowsWithIssues ------------------------------------

describe('extractUsedMedicationRowsWithIssues', () => {
  describe('正常系', () => {
    it('有効な行を正しく抽出する', () => {
      const rows = [['YJ001', '薬A', '30', 'mL', '200']];
      const result = extractUsedMedicationRowsWithIssues(rows, USED_MED_MAPPING);

      expect(result.rows).toHaveLength(1);
      expect(result.issues).toHaveLength(0);
      expect(result.rows[0]).toMatchObject({
        drugCode: 'YJ001',
        drugName: '薬A',
        monthlyUsage: 30,
        unit: 'mL',
        yakkaUnitPrice: 200,
      });
    });

    it('monthlyUsage が未入力の場合 null になる', () => {
      const rows = [['', '薬B', '', '錠', '']];
      const result = extractUsedMedicationRowsWithIssues(rows, USED_MED_MAPPING);

      expect(result.rows[0].monthlyUsage).toBeNull();
    });

    it('空の dataRows に対して空の結果を返す', () => {
      const result = extractUsedMedicationRowsWithIssues([], USED_MED_MAPPING);

      expect(result.rows).toHaveLength(0);
      expect(result.issues).toHaveLength(0);
      expect(result.inspectedRowCount).toBe(0);
    });
  });

  describe('異常系', () => {
    it('薬剤名が空の行は issue になる', () => {
      const rows = [['YJ001', '', '10', '錠', '100']];
      const result = extractUsedMedicationRowsWithIssues(rows, USED_MED_MAPPING);

      expect(result.rows).toHaveLength(0);
      expect(result.issues[0].issueCode).toBe('MISSING_DRUG_NAME');
    });
  });
});

// ---- extractUsedMedicationRows（wrapper） -----------------------------------

describe('extractUsedMedicationRows', () => {
  it('rows のみを返す', () => {
    const rows = [['', '薬C', '15', '包', '50']];
    const result = extractUsedMedicationRows(rows, USED_MED_MAPPING);

    expect(result[0].drugName).toBe('薬C');
  });
});
