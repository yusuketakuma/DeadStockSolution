import { describe, expect, it } from 'vitest';
import { tokenizeQuery, buildKanaVariants, buildTokenizedSearchConditions } from '../../utils/search-utils';
import { sql } from 'drizzle-orm';

// ダミーカラム作成ヘルパー（AnyColumn の代わりに SQL 式を使用）
// 実際のテストでは drizzle の column オブジェクトが必要だが、
// buildTokenizedSearchConditions の動作確認には簡易的に対応する

describe('tokenizeQuery', () => {
  it('半角スペースで分割する', () => {
    expect(tokenizeQuery('アムロジピン サワイ')).toEqual(['アムロジピン', 'サワイ']);
  });

  it('全角スペース(U+3000)で分割する', () => {
    expect(tokenizeQuery('アムロジピン\u3000サワイ')).toEqual(['アムロジピン', 'サワイ']);
  });

  it('空文字列は [] を返す', () => {
    expect(tokenizeQuery('')).toEqual([]);
  });

  it('空白のみは [] を返す', () => {
    expect(tokenizeQuery('   \u3000  ')).toEqual([]);
  });

  it('6個以上のトークンは5個に切り詰める', () => {
    const result = tokenizeQuery('アア イイ ウウ エエ オオ カカ キキ');
    expect(result).toHaveLength(5);
  });

  it('6トークン: 先頭5個が返る', () => {
    const result = tokenizeQuery('AA BB CC DD EE FF');
    expect(result).toEqual(['AA', 'BB', 'CC', 'DD', 'EE']);
  });

  it('1文字非数字トークンは除外する', () => {
    expect(tokenizeQuery('ア サワイ')).toEqual(['サワイ']);
  });

  it('1文字数字トークンは許可する', () => {
    expect(tokenizeQuery('5 サワイ')).toEqual(['5', 'サワイ']);
  });

  it('重複トークンを除去する', () => {
    expect(tokenizeQuery('サワイ サワイ アムロジピン')).toEqual(['サワイ', 'アムロジピン']);
  });

  it('混在スペースで分割する', () => {
    expect(tokenizeQuery('アムロジピン\u3000サワイ 錠')).toEqual(['アムロジピン', 'サワイ']);
  });
});

describe('buildKanaVariants', () => {
  it('カタカナ入力はひらがなを含む', () => {
    const variants = buildKanaVariants('アムロジピン');
    expect(variants).toContain('アムロジピン'); // 元の入力
    expect(variants).toContain('あむろじぴん'); // カタカナ→ひらがな
  });

  it('ひらがな入力はカタカナを含む', () => {
    const variants = buildKanaVariants('あむろじぴん');
    expect(variants).toContain('あむろじぴん');
    expect(variants).toContain('アムロジピン');
  });

  it('半角英数字入力は全角版を含む', () => {
    const variants = buildKanaVariants('5mg');
    expect(variants).toContain('5mg');
    expect(variants).toContain('５ｍｇ');
  });

  it('全角英数字入力は半角版を含む', () => {
    const variants = buildKanaVariants('５ｍｇ');
    expect(variants).toContain('５ｍｇ');
    expect(variants).toContain('5mg');
  });

  it('漢字入力は重複なし', () => {
    const variants = buildKanaVariants('沢井');
    const unique = new Set(variants);
    expect(unique.size).toBe(variants.length);
  });

  it('重複を排除する', () => {
    // 変換しても変わらない文字列の場合（例: ASCII のみ）重複が除去されることを確認
    const variants = buildKanaVariants('abc');
    const unique = new Set(variants);
    expect(unique.size).toBe(variants.length);
  });
});

describe('buildTokenizedSearchConditions', () => {
  // drizzle の AnyColumn を直接テストするのは難しいため、
  // 実際には sql テンプレートタグで生成した擬似カラムを使う
  // ここでは型互換性のために any キャストを使用
   
  const mockColumn = sql`"name"` as any;

  it('空クエリは undefined を返す', () => {
    expect(buildTokenizedSearchConditions('', [mockColumn])).toBeUndefined();
  });

  it('空白のみのクエリは undefined を返す', () => {
    expect(buildTokenizedSearchConditions('   ', [mockColumn])).toBeUndefined();
  });

  it('空カラム配列は undefined を返す', () => {
    expect(buildTokenizedSearchConditions('サワイ', [])).toBeUndefined();
  });

  it('有効なクエリは SQL を返す (undefined でない)', () => {
    const result = buildTokenizedSearchConditions('アムロジピン', [mockColumn]);
    expect(result).toBeDefined();
  });

  it('複数トークンでも SQL を返す', () => {
    const result = buildTokenizedSearchConditions('アムロジピン サワイ', [mockColumn]);
    expect(result).toBeDefined();
  });
});
