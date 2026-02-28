import { Request } from 'express';

export interface JwtPayload {
  id: number;
  email: string;
  isAdmin: boolean;
  sessionVersion?: string;
}

export interface AuthUser {
  id: number;
  email: string;
  isAdmin: boolean;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export interface ColumnMapping {
  [fieldName: string]: string | null;
}

export interface PreviewResult {
  headers: string[];
  rows: string[][];
  suggestedMapping: ColumnMapping;
  headerRowIndex: number;
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
  businessStatus?: BusinessHoursStatus;
  isFavorite?: boolean;
}

export interface MatchItem {
  deadStockItemId: number;
  drugName: string;
  quantity: number;
  unit: string | null;
  yakkaUnitPrice: number;
  yakkaValue: number;
  expirationDate?: string | null;
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
