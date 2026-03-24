import { type SQL, type AnyColumn, ilike, or, and, sql } from 'drizzle-orm';
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

interface RelevanceColumn {
  column: AnyColumn;
  weight?: number;
}

interface TextRelevanceField {
  value: string | null | undefined;
  weight?: number;
}

function uniqueNormalizedVariants(value: string): string[] {
  return [...new Set(buildKanaVariants(value).map((variant) => variant.trim()).filter(Boolean))];
}

function scoreTextMatch(
  text: string,
  variants: string[],
  scores: { exact: number; prefix: number; contains: number },
): number {
  if (!text || variants.length === 0) return 0;

  const normalized = text.trim().toLowerCase();
  let total = 0;

  for (const variant of variants) {
    const normalizedVariant = variant.toLowerCase();
    if (!normalizedVariant) continue;

    if (normalized === normalizedVariant) {
      total += scores.exact;
    } else if (normalized.startsWith(normalizedVariant)) {
      total += scores.prefix;
    } else if (normalized.includes(normalizedVariant)) {
      total += scores.contains;
    }
  }

  return total;
}

function buildColumnRelevanceScore(
  column: AnyColumn,
  variants: string[],
  scores: { exact: number; prefix: number; contains: number },
): SQL<number> {
  if (variants.length === 0) {
    return sql<number>`0`;
  }

  const cases: SQL[] = [];
  for (const variant of variants) {
    const normalizedVariant = variant.toLowerCase();
    const escaped = escapeLikeWildcards(normalizedVariant);
    const prefixPattern = `${escaped}%`;
    const containsPattern = `%${escaped}%`;

    cases.push(sql<number>`
      CASE
        WHEN LOWER(COALESCE(${column}, '')) = ${normalizedVariant} THEN ${scores.exact}
        WHEN LOWER(COALESCE(${column}, '')) LIKE ${prefixPattern} THEN ${scores.prefix}
        WHEN LOWER(COALESCE(${column}, '')) LIKE ${containsPattern} THEN ${scores.contains}
        ELSE 0
      END
    `);
  }

  return sql<number>`(${sql.join(cases, sql` + `)})`;
}

/**
 * 一覧検索用の一致度スコアを構築する。
 * 全文一致を強く、トークン一致を補助的に加点する。
 */
export function buildSearchRelevanceScore(
  query: string,
  columns: RelevanceColumn[],
): SQL<number> {
  const trimmed = query.trim();
  if (!trimmed || columns.length === 0) {
    return sql<number>`0`;
  }

  const fullVariants = uniqueNormalizedVariants(trimmed);
  const tokenVariants = [...new Set(
    tokenizeQuery(trimmed).flatMap((token) => uniqueNormalizedVariants(token)),
  )];

  const columnScores = columns.map(({ column, weight = 1 }) => {
    const fullScore = buildColumnRelevanceScore(column, fullVariants, {
      exact: 1000 * weight,
      prefix: 700 * weight,
      contains: 250 * weight,
    });
    const tokenScore = buildColumnRelevanceScore(column, tokenVariants, {
      exact: 120 * weight,
      prefix: 80 * weight,
      contains: 30 * weight,
    });

    return sql<number>`(${fullScore} + ${tokenScore})`;
  });

  return sql<number>`(${sql.join(columnScores, sql` + `)})`;
}

/**
 * JS 側で整列する一覧向けの一致度スコア。
 * SQL と同じ重みを使って並び順を揃える。
 */
export function computeTextRelevanceScore(
  query: string,
  fields: TextRelevanceField[],
): number {
  const trimmed = query.trim();
  if (!trimmed || fields.length === 0) {
    return 0;
  }

  const fullVariants = uniqueNormalizedVariants(trimmed);
  const tokenVariants = [...new Set(
    tokenizeQuery(trimmed).flatMap((token) => uniqueNormalizedVariants(token)),
  )];

  return fields.reduce((total, { value, weight = 1 }) => {
    const text = value?.trim() ?? '';
    if (!text) return total;

    return total
      + scoreTextMatch(text, fullVariants, {
        exact: 1000 * weight,
        prefix: 700 * weight,
        contains: 250 * weight,
      })
      + scoreTextMatch(text, tokenVariants, {
        exact: 120 * weight,
        prefix: 80 * weight,
        contains: 30 * weight,
      });
  }, 0);
}
