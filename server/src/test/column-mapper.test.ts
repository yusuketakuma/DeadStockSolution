import { describe, expect, it } from 'vitest';
import {
  computeHeaderHash,
  detectHeaderRow,
  detectUploadType,
  getCell,
  parseColumnIndex,
  suggestMapping,
} from '../services/column-mapper';

describe('parseColumnIndex', () => {
  it('null を渡すと -1 を返す', () => {
    expect(parseColumnIndex(null)).toBe(-1);
  });

  it('undefined を渡すと -1 を返す', () => {
    expect(parseColumnIndex(undefined)).toBe(-1);
  });

  it('有効な非負整数文字列を返す', () => {
    expect(parseColumnIndex('0')).toBe(0);
    expect(parseColumnIndex('1')).toBe(1);
    expect(parseColumnIndex('99')).toBe(99);
  });

  it('負数文字列は -1 を返す', () => {
    expect(parseColumnIndex('-1')).toBe(-1);
  });

  it('非数値文字列は -1 を返す', () => {
    expect(parseColumnIndex('abc')).toBe(-1);
  });

  it('空文字列は 0 を返す（Number("") === 0 のため）', () => {
    // Number('') は 0 に変換され、0 は有効な非負整数として扱われる
    expect(parseColumnIndex('')).toBe(0);
  });

  it('小数点を含む文字列は -1 を返す（整数でない）', () => {
    expect(parseColumnIndex('1.5')).toBe(-1);
  });
});

describe('getCell', () => {
  const row = ['a', 'b', 'c'];

  it('有効なインデックスで値を返す', () => {
    expect(getCell(row, 0)).toBe('a');
    expect(getCell(row, 2)).toBe('c');
  });

  it('負数インデックスは null を返す', () => {
    expect(getCell(row, -1)).toBeNull();
  });

  it('配列長以上のインデックスは null を返す', () => {
    expect(getCell(row, 3)).toBeNull();
    expect(getCell(row, 100)).toBeNull();
  });

  it('空配列で -1 以外のインデックスでも null を返す', () => {
    expect(getCell([], 0)).toBeNull();
  });
});

describe('detectHeaderRow', () => {
  it('キーワードを含む行を検出する', () => {
    const rows = [
      ['メモ', '作成日', '担当者'],
      ['薬品名', '数量', '使用期限', '単位'],
      ['アスピリン', '10', '2025-12-31', '錠'],
    ];
    expect(detectHeaderRow(rows)).toBe(1);
  });

  it('キーワードが最初の行にある場合は 0 を返す', () => {
    const rows = [
      ['薬品名', '在庫数量', '有効期限'],
      ['薬品A', '5', '2025-01-01'],
    ];
    expect(detectHeaderRow(rows)).toBe(0);
  });

  it('空の行列では 0 を返す', () => {
    expect(detectHeaderRow([[]])).toBe(0);
  });

  it('最大 10 行まで走査する（11行目以降は無視）', () => {
    // 最初の 10 行はすべてデータ行、11行目にキーワードあり
    const rows: unknown[][] = Array.from({ length: 10 }, (_, i) => [`データ${i}`, i]);
    rows.push(['薬品名', '数量', '使用期限', '単位']); // インデックス 10
    // 走査範囲外なので、スコアが低い行 0 が返される
    const result = detectHeaderRow(rows);
    expect(result).toBeLessThan(10);
  });
});

describe('suggestMapping', () => {
  describe('dead_stock モード', () => {
    it('標準的な日本語ヘッダをマッピングする', () => {
      const headers = ['薬品コード', '薬品名', '数量', '単位', '薬価', '使用期限', 'ロット番号'];
      const mapping = suggestMapping(headers, 'dead_stock');
      expect(mapping.drug_code).toBe('0');
      expect(mapping.drug_name).toBe('1');
      expect(mapping.quantity).toBe('2');
      expect(mapping.unit).toBe('3');
      expect(mapping.yakka_unit_price).toBe('4');
      expect(mapping.expiration_date).toBe('5');
      expect(mapping.lot_number).toBe('6');
    });

    it('部分一致でもマッピングされる', () => {
      const headers = ['医薬品コード（内部用）', '在庫数量', '使用期限日'];
      const mapping = suggestMapping(headers, 'dead_stock');
      expect(mapping.drug_code).toBe('0');
      expect(mapping.quantity).toBe('1');
      expect(mapping.expiration_date).toBe('2');
    });

    it('対応するヘッダがない場合は null になる', () => {
      const headers = ['列A', '列B', '列C'];
      const mapping = suggestMapping(headers, 'dead_stock');
      expect(mapping.drug_name).toBeNull();
      expect(mapping.quantity).toBeNull();
    });

    it('空のヘッダ行では全フィールドが null', () => {
      const mapping = suggestMapping([], 'dead_stock');
      expect(mapping.drug_name).toBeNull();
      expect(mapping.quantity).toBeNull();
      expect(mapping.expiration_date).toBeNull();
    });
  });

  describe('used_medication モード', () => {
    it('used_medication の標準ヘッダをマッピングする', () => {
      const headers = ['薬品名', '月間使用量', '単位', '薬価'];
      const mapping = suggestMapping(headers, 'used_medication');
      expect(mapping.drug_name).toBe('0');
      expect(mapping.monthly_usage).toBe('1');
      expect(mapping.unit).toBe('2');
      expect(mapping.yakka_unit_price).toBe('3');
    });

    it('dead_stock 専用フィールドは含まれない', () => {
      const headers = ['薬品名', '月間使用量'];
      const mapping = suggestMapping(headers, 'used_medication');
      expect(mapping.expiration_date).toBeUndefined();
      expect(mapping.lot_number).toBeUndefined();
    });
  });

  describe('重複列名のエッジケース', () => {
    it('同じキーワードが複数列にある場合、スコアが最も高い列（最初に一致した列）を使う', () => {
      // 両方同じキーワードなら最初の列が選ばれる（スコア同点で後から上書きされない）
      const headers = ['数量', '数量'];
      const mapping = suggestMapping(headers, 'dead_stock');
      // 最初の列（インデックス0）が選ばれる
      expect(mapping.quantity).toBe('0');
    });
  });
});

describe('detectUploadType', () => {
  it('在庫ヘッダで dead_stock を検出する', () => {
    const rows = [
      ['薬品名', '在庫数量', '使用期限', 'ロット番号'],
      ['アスピリン', '100', '2025-12-31', 'LOT001'],
      ['ロキソプロフェン', '50', '2025-06-30', 'LOT002'],
    ];
    const result = detectUploadType(rows, 0);
    expect(result.detectedType).toBe('dead_stock');
    expect(result.scores.dead_stock).toBeGreaterThan(result.scores.used_medication);
  });

  it('使用量ヘッダで used_medication を検出する', () => {
    const rows = [
      ['薬品名', '月間使用量', '単位'],
      ['アスピリン', '200', '錠'],
      ['ロキソプロフェン', '150', '錠'],
    ];
    const result = detectUploadType(rows, 0);
    expect(result.detectedType).toBe('used_medication');
    expect(result.scores.used_medication).toBeGreaterThan(result.scores.dead_stock);
  });

  it('スコア差が 12 以上なら confidence が high', () => {
    const rows = [
      ['薬品名', '月間使用量', '使用量', '処方量', '単位'],
      ['アスピリン', '200', '200', '200', '錠'],
    ];
    const result = detectUploadType(rows, 0);
    if (Math.abs(result.scores.dead_stock - result.scores.used_medication) >= 12) {
      expect(result.confidence).toBe('high');
    }
  });

  it('スコア差が 5 未満なら confidence が low', () => {
    // 曖昧なヘッダ：スコアが拮抗する
    const rows = [['薬品名', '数量']];
    const result = detectUploadType(rows, 0);
    // スコア差が小さいときに low になる
    const diff = Math.abs(result.scores.dead_stock - result.scores.used_medication);
    if (diff < 5) {
      expect(result.confidence).toBe('low');
    }
  });

  it('空のデータ行でもエラーなく実行できる', () => {
    const rows = [['薬品名', '数量', '使用期限']];
    expect(() => detectUploadType(rows, 0)).not.toThrow();
  });

  it('headerRowIndex が範囲外でも安全に動作する', () => {
    const rows: unknown[][] = [];
    expect(() => detectUploadType(rows, 0)).not.toThrow();
  });
});

describe('computeHeaderHash', () => {
  it('同じヘッダ行は同じハッシュを返す', () => {
    const headers = ['薬品名', '数量', '使用期限'];
    expect(computeHeaderHash(headers)).toBe(computeHeaderHash(headers));
  });

  it('異なるヘッダ行は異なるハッシュを返す', () => {
    const a = computeHeaderHash(['薬品名', '数量']);
    const b = computeHeaderHash(['薬品名', '月間使用量']);
    expect(a).not.toBe(b);
  });

  it('空のヘッダ行でもハッシュを返す', () => {
    const hash = computeHeaderHash([]);
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });

  it('ハッシュは 32 文字の MD5 文字列', () => {
    const hash = computeHeaderHash(['薬品名', '数量']);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('null や undefined の要素は空文字として扱われる', () => {
    const hash1 = computeHeaderHash([null, undefined, '数量']);
    const hash2 = computeHeaderHash(['', '', '数量']);
    expect(hash1).toBe(hash2);
  });
});
