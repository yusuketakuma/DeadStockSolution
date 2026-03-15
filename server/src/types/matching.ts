/**
 * matching 系サービス共通の純粋型定義。
 * ReturnType/Parameters 派生の型（BusinessHoursRows, SpecialHoursRows 等）は含まない。
 */

import type { MatchItem } from './index';

// ---------------------------------------------------------------------------
// スコアリングルール
// ---------------------------------------------------------------------------

export interface MatchingScoringRules {
  nameMatchThreshold: number;
  valueScoreMax: number;
  valueScoreDivisor: number;
  balanceScoreMax: number;
  balanceScoreDiffFactor: number;
  distanceScoreMax: number;
  distanceScoreDivisor: number;
  distanceScoreFallback: number;
  nearExpiryScoreMax: number;
  nearExpiryItemFactor: number;
  nearExpiryDays: number;
  diversityScoreMax: number;
  diversityItemFactor: number;
  favoriteBonus: number;
  groupBonus: number;
  nearExpiryDecayCurve: number;
  successRateBonus: number;
  maxCandidates: number;
}

// ---------------------------------------------------------------------------
// マッチングルールプロファイル
// ---------------------------------------------------------------------------

export interface MatchingRuleProfile extends MatchingScoringRules {
  id: number;
  profileName: string;
  isActive: boolean;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
  source: 'database' | 'default_fallback';
}

export interface MatchingRuleProfileUpdateInput extends Partial<MatchingScoringRules> {
  expectedVersion?: number;
}

// ---------------------------------------------------------------------------
// 薬品名マッチング
// ---------------------------------------------------------------------------

export interface UsedMedRow {
  pharmacyId: number;
  drugName: string;
}

export interface UsedMedName {
  normalizedName: string;
  tokenSet: Set<string>;
  length: number;
}

export interface UsedMedIndex {
  exactNames: Set<string>;
  names: UsedMedName[];
  tokenIndex: Map<string, number[]>;
  lengthBuckets: Map<number, number[]>;
}

export interface DrugMatchResult {
  score: number;
}

export interface PreparedDrugName {
  normalizedDrugName: string;
  tokenSet: Set<string>;
}

// ---------------------------------------------------------------------------
// データフェッチ行
// ---------------------------------------------------------------------------

export interface DeadStockRow {
  id: number;
  pharmacyId: number;
  drugName: string;
  quantity: number;
  unit: string | null;
  yakkaUnitPrice: number | string | null;
  expirationDate: string | null;
  expirationDateIso: string | null;
  lotNumber: string | null;
  createdAt: string | null;
}

export interface ViablePharmacyRow {
  id: number;
  name: string;
  phone: string | null;
  fax: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface PharmacyWithDistance extends ViablePharmacyRow {
  distance: number;
}

// ---------------------------------------------------------------------------
// データ準備
// ---------------------------------------------------------------------------

export interface PreparedStockRow {
  stock: DeadStockRow;
  preparedDrugName: PreparedDrugName;
}

// ---------------------------------------------------------------------------
// フィルタリング
// ---------------------------------------------------------------------------

export interface BalancedValueResult {
  balancedA: MatchItem[];
  balancedB: MatchItem[];
  totalA: number;
  totalB: number;
}
