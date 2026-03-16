import { Request } from 'express';

export interface JwtPayload {
  id: number;
  email: string;
  isAdmin: boolean;
  sessionVersion?: string;
  workosUserId?: string;
}

export interface AuthUser {
  id: number;
  email: string;
  isAdmin: boolean;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export type AuthMeRow = {
  id: number;
  email: string;
  name: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  licenseNumber: string;
  prefecture: string;
  isAdmin: boolean | null;
  isTestAccount: boolean;
};

export type LegacyAuthMeRow = Omit<AuthMeRow, 'isTestAccount'>;

export type TestPharmacyPreviewRow = {
  id: number;
  name: string;
  email: string;
  prefecture: string;
  password: string | null;
};

export interface ColumnMapping {
  [fieldName: string]: string | null;
}

export interface BusinessHoursStatus {
  isOpen: boolean;
  closingSoon: boolean;
  is24Hours: boolean;
  todayHours: { openTime: string; closeTime: string } | null;
  isConfigured?: boolean;
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
  matchRate?: number;
  priorityBreakdown?: MatchPriorityBreakdown;
  businessImpact?: MatchBusinessImpact;
  priorityReasons?: MatchPriorityReason[];
  businessStatus?: BusinessHoursStatus;
  isFavorite?: boolean;
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

export const DEAD_STOCK_FIELDS = [
  'drug_code',
  'drug_name',
  'quantity',
  'unit',
  'yakka_unit_price',
  'expiration_date',
  'lot_number',
] as const;

export const USED_MEDICATION_FIELDS = [
  'drug_code',
  'drug_name',
  'monthly_usage',
  'unit',
  'yakka_unit_price',
] as const;

// Re-export types from separate modules
export * from './group';
export * from './push';
export * from './alert';

export type EquivalenceType = 'brand_generic' | 'generic_generic';

export interface DrugEquivalence {
  id: number;
  drugNameA: string;
  drugNameB: string;
  equivalenceType: EquivalenceType;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
export * from './admin';
export * from './notification';
