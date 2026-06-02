/**
 * VisitPlan scoring types — ClinicalPriority, base_score, priority_weight, audit trail.
 *
 * Guards (from t_fcaf6de0, inherited via t_b38e8223):
 *   - no_free_text: clinical_priority is enum fixed, no free text
 *   - no_direct_0_100_input: no direct numeric input, always 3-choice UI
 *   - no_implicit_default: no default value, required selection
 *   - backend_not_null: DB-level NOT NULL
 *   - api_schema_validation: enum constraint at API layer
 *   - audit_trail: record changed_by/changed_at/old_value/new_value on change
 *   - priority_weight is ALWAYS derived from clinical_priority, never set directly
 */

/** Clinical priority enum — 3-stage, no free text */
export type ClinicalPriority = 'high' | 'medium' | 'low';

/** All valid ClinicalPriority values for runtime iteration */
export const CLINICAL_PRIORITY_VALUES: readonly ClinicalPriority[] = ['high', 'medium', 'low'] as const;

/**
 * Priority weight mapping.
 * This is a pure function — no side effects, no external state.
 */
export const PRIORITY_WEIGHT_MAP: Record<ClinicalPriority, number> = {
  high:   1.5,
  medium: 1.0,
  low:    0.7,
} as const;

/**
 * Input for base_score calculation.
 * base_score aggregates patient attributes EXCLUDING clinical_priority.
 * This interface defines the contract only; full implementation is deferred.
 */
export interface BaseScoreInput {
  patient_id: string;          // UUID
  drug_count: number;           // number of medications taken
  visit_interval_days: number;  // visit interval in days
  special_conditions: string[]; // special condition tags (narcotic, anticancer, insulin, etc.)
}

/** BaseScore: 0+ real number. Current stub; normalization range determined in later phase. */
export type BaseScore = number;

/**
 * VisitPlanScore — the composite score result.
 * visit_plan_score = baseScore(input) × priorityWeight(clinical_priority)
 */
export interface VisitPlanScore {
  visit_plan_id: string;       // UUID
  base_score: BaseScore;
  clinical_priority: ClinicalPriority;
  priority_weight: number;      // derived from clinical_priority
  visit_plan_score: number;     // base_score × priority_weight
  calculated_at: string;        // ISO 8601
}

/**
 * Audit entry for clinical_priority changes.
 * priority_weight is always derived, so we only record clinical_priority changes
 * and include weight values for display convenience.
 */
export interface ClinicalPriorityAuditEntry {
  visit_plan_id: string;        // UUID
  changed_by: string;           // user UUID
  changed_at: string;           // ISO 8601
  old_priority: ClinicalPriority | null;
  new_priority: ClinicalPriority;
  old_weight: number | null;
  new_weight: number;
  source: 'manual' | 'bulk_update' | 'system';
}
