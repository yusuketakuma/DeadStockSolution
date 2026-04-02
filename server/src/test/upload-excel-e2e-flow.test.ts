import { describe, expect, it } from 'vitest';
import {
  detectHeaderRow,
  detectUploadType,
  suggestMapping,
} from '../services/column-mapper';
import { extractDeadStockRowsWithIssues } from '../services/data-extractor';

/**
 * 仮想Excelデータを使ったアップロードロジック統合テスト
 * ヘッダー検出 → アップロード種別判定 → 自動マッピング → データ抽出 の一連を検証
 */
describe('仮想Excelファイル: デッドストックアップロード統合フロー', () => {
  // ---- パターン1: 典型的な薬局の在庫Excel ----
  describe('パターン1: 標準的なデッドストック在庫表', () => {
    const rows: unknown[][] = [
      ['在庫一覧表', '', '', '', '', '', ''],                        // 行0: タイトル行
      ['出力日: 2026-03-01', '', '', '', '', '', ''],                // 行1: メタ情報
      ['薬品コード', '薬品名', '数量', '単位', '薬価', '使用期限', 'ロット番号'],  // 行2: ヘッダー
      ['1234567', 'アムロジピン錠5mg', '100', '錠', '10.1', '2027-06-30', 'LOT001'],
      ['2345678', 'メトホルミン錠250mg', '50', '錠', '15.5', '2027-03-15', 'LOT002'],
      ['3456789', 'ロキソプロフェン錠60mg', '200', '錠', '7.8', '2026-12-31', 'LOT003'],
      ['', '', '', '', '', '', ''],  // 空行
      ['4567890', 'カルベジロール錠10mg', '30', '錠', '22.3', '2027-09-30', 'LOT004'],
    ];

    it('ヘッダー行を正しく検出する', () => {
      const headerRowIndex = detectHeaderRow(rows);
      expect(headerRowIndex).toBe(2);
    });

    it('デッドストックとして種別判定される', () => {
      const headerRowIndex = detectHeaderRow(rows);
      const result = detectUploadType(rows, headerRowIndex);
      expect(result.detectedType).toBe('dead_stock');
      expect(['high', 'medium']).toContain(result.confidence);
    });

    it('自動マッピングで全フィールドが正しく割り当てられる', () => {
      const headerRowIndex = detectHeaderRow(rows);
      const headerRow = rows[headerRowIndex] as string[];
      const mapping = suggestMapping(headerRow, 'dead_stock');

      expect(mapping.drug_code).toBe('0');
      expect(mapping.drug_name).toBe('1');
      expect(mapping.quantity).toBe('2');
      expect(mapping.unit).toBe('3');
      expect(mapping.yakka_unit_price).toBe('4');
      expect(mapping.expiration_date).toBe('5');
      expect(mapping.lot_number).toBe('6');
    });

    it('データ抽出で正しい件数・値が取れる', () => {
      const headerRowIndex = detectHeaderRow(rows);
      const headerRow = rows[headerRowIndex] as string[];
      const mapping = suggestMapping(headerRow, 'dead_stock');
      const dataRows = rows.slice(headerRowIndex + 1);

      const result = extractDeadStockRowsWithIssues(dataRows, mapping);

      // 空行を除いた4件が抽出される
      expect(result.rows).toHaveLength(4);
      expect(result.issues).toHaveLength(0);

      // 1件目の値を検証
      expect(result.rows[0]).toMatchObject({
        drugCode: '1234567',
        drugName: 'アムロジピン錠5mg',
        quantity: 100,
        unit: '錠',
        yakkaUnitPrice: 10.1,
        expirationDate: '2027-06-30',
        lotNumber: 'LOT001',
      });

      // 薬価合計が計算されている
      expect(result.rows[0].yakkaTotal).toBeCloseTo(10.1 * 100);
    });
  });

  // ---- パターン2: 列順がバラバラなExcel ----
  describe('パターン2: 列順が標準と異なる在庫表', () => {
    const rows: unknown[][] = [
      ['品名', 'ロット', '有効期限', '在庫数量', '単価', 'コード', '単位'],
      ['アスピリン錠100mg', 'L-100', '2027-01-31', '500', '5.6', '9876543', '錠'],
      ['プレドニゾロン錠5mg', 'L-200', '2026-11-30', '80', '9.9', '8765432', '錠'],
    ];

    it('ヘッダー行0を検出し、自動マッピングが正しく動作する', () => {
      const headerRowIndex = detectHeaderRow(rows);
      expect(headerRowIndex).toBe(0);

      const headerRow = rows[headerRowIndex] as string[];
      const mapping = suggestMapping(headerRow, 'dead_stock');

      // 列順がバラバラでも正しくマッピングされる
      expect(mapping.drug_name).toBe('0');    // 品名
      expect(mapping.lot_number).toBe('1');   // ロット
      expect(mapping.expiration_date).toBe('2'); // 有効期限
      expect(mapping.quantity).toBe('3');     // 在庫数量
      expect(mapping.yakka_unit_price).toBe('4'); // 単価
      expect(mapping.drug_code).toBe('5');   // コード
      expect(mapping.unit).toBe('6');        // 単位
    });

    it('データ抽出が正しく行われる', () => {
      const headerRowIndex = detectHeaderRow(rows);
      const headerRow = rows[headerRowIndex] as string[];
      const mapping = suggestMapping(headerRow, 'dead_stock');
      const dataRows = rows.slice(headerRowIndex + 1);

      const result = extractDeadStockRowsWithIssues(dataRows, mapping);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].drugName).toBe('アスピリン錠100mg');
      expect(result.rows[0].drugCode).toBe('9876543');
      expect(result.rows[0].quantity).toBe(500);
      expect(result.rows[0].yakkaUnitPrice).toBe(5.6);
    });
  });

  // ---- パターン3: 手動マッピングを想定（自動検出できない見出し） ----
  describe('パターン3: 独自見出しで手動マッピングが必要なケース', () => {
    const rows: unknown[][] = [
      ['商品ID', '商品', '個数', 'タイプ', '価格', '期日', 'LOT'],
      ['1111111', 'テスト薬A', '10', '錠', '100', '2027-12-31', 'L1'],
      ['2222222', 'テスト薬B', '20', 'カプセル', '200', '2027-06-30', 'L2'],
    ];

    it('自動マッピングで一部フィールドが検出されない可能性がある', () => {
      const headerRowIndex = detectHeaderRow(rows);
      const headerRow = rows[headerRowIndex] as string[];
      const autoMapping = suggestMapping(headerRow, 'dead_stock');

      // 「商品ID」「商品」「個数」「価格」は自動検出されない可能性
      // 手動マッピングで補完するシナリオ
      const manualMapping = {
        ...autoMapping,
        drug_code: '0',   // 商品ID → 薬品コード
        drug_name: '1',   // 商品 → 薬品名
        quantity: '2',    // 個数 → 数量
        unit: '3',        // タイプ → 単位
        yakka_unit_price: '4', // 価格 → 薬価
        expiration_date: '5',  // 期日 → 使用期限
        lot_number: '6',       // LOT → ロット番号
      };

      const dataRows = rows.slice(headerRowIndex + 1);
      const result = extractDeadStockRowsWithIssues(dataRows, manualMapping);

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toMatchObject({
        drugCode: '1111111',
        drugName: 'テスト薬A',
        quantity: 10,
        unit: '錠',
        yakkaUnitPrice: 100,
        lotNumber: 'L1',
      });
      expect(result.rows[1]).toMatchObject({
        drugCode: '2222222',
        drugName: 'テスト薬B',
        quantity: 20,
        unit: 'カプセル',
        yakkaUnitPrice: 200,
        lotNumber: 'L2',
      });
    });
  });

  // ---- パターン4: 問題のあるデータ行 ----
  describe('パターン4: データ品質の問題があるExcel', () => {
    const rows: unknown[][] = [
      ['薬品コード', '薬品名', '数量', '単位', '薬価', '使用期限', 'ロット番号'],
      ['1234567', '', '100', '錠', '10', '2027-06-30', 'LOT001'],       // 薬品名なし
      ['2345678', 'テスト薬', 'abc', '錠', '15', '2027-03-15', 'LOT002'],  // 数量が非数値
      ['', 'テスト薬2', '50', '錠', '20', '2027-12-31', 'LOT003'],       // コードなし
      ['3456789', 'テスト薬3', '0', '錠', '10', '2027-12-31', 'LOT004'], // 数量0
      ['4567890', 'テスト薬4', '30', '錠', '', '2027-12-31', 'LOT005'],  // 薬価なし
      ['5678901', '正常な薬', '10', '錠', '25.5', '2027-12-31', 'LOT006'], // 正常
    ];

    it('問題のある行はissueとして報告され、正常行のみ抽出される', () => {
      const headerRow = rows[0] as string[];
      const mapping = suggestMapping(headerRow, 'dead_stock');
      const dataRows = rows.slice(1);

      const result = extractDeadStockRowsWithIssues(dataRows, mapping);

      // 正常な行は1件のみ
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].drugName).toBe('正常な薬');

      // 5件のissue
      expect(result.issues).toHaveLength(5);
      const issueCodes = result.issues.map((i) => i.issueCode);
      expect(issueCodes).toContain('MISSING_DRUG_NAME');
      expect(issueCodes).toContain('INVALID_QUANTITY');
      expect(issueCodes).toContain('MISSING_DRUG_CODE');
      expect(issueCodes).toContain('NON_POSITIVE_QUANTITY');
      expect(issueCodes).toContain('MISSING_YAKKA_PRICE');
    });
  });
});
