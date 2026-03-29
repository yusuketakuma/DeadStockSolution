export interface MatchScoreBreakdown {
  valueScore: number;
  balanceScore: number;
  distanceScore: number;
  expiryScore: number;
  diversityScore: number;
  favoriteBonus: number;
  groupBonus: number;
  successRateBonus: number;
  total: number;
}

export interface MatchPriorityBreakdown {
  mutualStagnantItems: number;
  mutualNearExpiryItems: number;
  mutualExchangeValue: number;
  mutualItemCount: number;
  mutualTraceableItems: number;
}

export interface MatchBusinessImpact {
  estimatedWasteAvoidanceYen: number;
  estimatedWorkingCapitalReleaseYen: number;
  estimatedMutualLiquidationItems: number;
  estimatedMutualNearExpiryItems: number;
  estimatedTraceableExchangeItems: number;
}

export interface MatchPriorityReason {
  code: 'mutual_stagnant' | 'mutual_near_expiry' | 'mutual_exchange_value' | 'mutual_item_count' | 'mutual_traceability';
  label: string;
  value: number;
}

export interface MatchItem {
  deadStockItemId: number;
  drugCode?: string | null;
  drugName: string;
  quantity: number;
  unit: string | null;
  yakkaUnitPrice: number;
  yakkaValue: number;
  expirationDate?: string | null;
  expirationDateIso?: string | null;
  lotNumber?: string | null;
  stockCreatedAt?: string | null;
  matchScore?: number;
}

export interface MatchCandidate {
  pharmacyId: number;
  pharmacyName: string;
  distance: number;
  pharmacyPhone?: string | null;
  pharmacyFax?: string | null;
  itemsFromA: MatchItem[];
  itemsFromB: MatchItem[];
  totalValueA: number;
  totalValueB: number;
  valueDifference: number;
  score?: number;
  scoreBreakdown?: MatchScoreBreakdown;
  matchRate?: number;
  priorityBreakdown?: MatchPriorityBreakdown;
  businessImpact?: MatchBusinessImpact;
  priorityReasons?: MatchPriorityReason[];
  businessStatus?: import('../components/BusinessStatusBadge').BusinessHoursStatus;
  isFavorite?: boolean;
  matchType?: 'exact' | 'equivalent';
}
