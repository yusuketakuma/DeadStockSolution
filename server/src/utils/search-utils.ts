import { type SQL, type AnyColumn, ilike, or, and } from 'drizzle-orm';
import {
  normalizeKana,
  katakanaToHiragana,
  hiraganaToKatakana,
  fullWidthAlphanumToHalfWidth,
  halfWidthAlphanumToFullWidth,
} from './kana-utils';
import { escapeLikeWildcards } from './request-utils';

const MAX_TOKENS = 5;
const SPACE_PATTERN = /[ \u3000]+/;

/**
 * クエリ文字列をトークンに分割する。
 * - 半角スペース (U+0020) と全角スペース (U+3000) で分割
 * - 空文字トークンを除去
 * - 1文字トークンは除外（ただし数字1文字は許可: /^\d+$/）
 * - 重複トークン除去
 * - 最大 MAX_TOKENS 個に制限
 */
export function tokenizeQuery(query: string): string[] {
  const raw = query.split(SPACE_PATTERN).filter((t) => t.length > 0);

  const seen = new Set<string>();
  const result: string[] = [];

  for (const token of raw) {
    // 1文字かつ非数字は除外
    if (token.length === 1 && !/^\d+$/.test(token)) {
      continue;
    }

    if (seen.has(token)) {
      continue;
    }

    seen.add(token);
    result.push(token);

    if (result.length >= MAX_TOKENS) {
      break;
    }
  }

  return result;
}

/**
 * トークンの表記ゆれバリアントを生成する。
 * カタカナ/ひらがな変換、全角/半角英数字変換を行い、重複を排除する。
 */
export function buildKanaVariants(token: string): string[] {
  const candidates = [
    token,
    normalizeKana(token),
    katakanaToHiragana(token),
    hiraganaToKatakana(token),
    fullWidthAlphanumToHalfWidth(token),
    halfWidthAlphanumToFullWidth(token),
  ];

  return [...new Set(candidates)];
}

/**
 * トークン化 AND 検索用の SQL 条件を構築する。
 * - 各トークンに buildKanaVariants を適用
 * - 各バリアント × 各カラムで ilike 条件を生成
 * - 1トークン内のカラム×バリアント条件を OR で結合
 * - トークン間を AND で結合
 * - tokens が空または columns が空なら undefined を返す
 */
export function buildTokenizedSearchConditions(
  query: string,
  columns: AnyColumn[]
): SQL | undefined {
  if (columns.length === 0) return undefined;

  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return undefined;

  const tokenConditions = tokens.map((token) => {
    const variants = buildKanaVariants(token);

    const variantConditions: SQL[] = [];
    for (const variant of variants) {
      const escaped = escapeLikeWildcards(variant);
      const pattern = `%${escaped}%`;
      for (const col of columns) {
        variantConditions.push(ilike(col, pattern));
      }
    }

    // 1トークン内のバリアント×カラム条件を OR で結合
    return or(...variantConditions) as SQL;
  });

  if (tokenConditions.length === 1) {
    return tokenConditions[0];
  }

  return and(...tokenConditions) as SQL;
}

/**
 * 医薬品マスター用の検索条件を構築する。
 * 名前カラムのトークン化AND検索 + YJコード前方一致検索を OR で結合。
 */
export function buildDrugMasterSearchCondition(
  query: string,
  nameColumns: AnyColumn[],
  yjCodeColumn: AnyColumn,
): SQL | undefined {
  const nameCondition = buildTokenizedSearchConditions(query, nameColumns);
  const trimmed = query.trim();
  const isCodeSearch = /^[A-Z0-9]+$/i.test(trimmed);
  const yjCondition = isCodeSearch
    ? ilike(yjCodeColumn, `%${escapeLikeWildcards(trimmed)}%`)
    : undefined;

  if (nameCondition && yjCondition) return or(nameCondition, yjCondition) as SQL;
  return nameCondition ?? yjCondition;
}
