import {
  BaseScore,
  BaseScoreInput,
  ClinicalPriority,
  ClinicalPriorityAuditEntry,
  PRIORITY_WEIGHT_MAP,
  VisitPlanScore,
} from '../types';

export function priorityWeight(priority: ClinicalPriority): number {
  return PRIORITY_WEIGHT_MAP[priority];
}

/**
 * Stub implementation for the current phase.
 * Contract: base_score is independent from clinical_priority.
 * Current behavior is deterministic and stable for tests.
 */
export function baseScore(input: BaseScoreInput): BaseScore {
  const conditionBonus = input.special_conditions.length * 10;
  return Math.max(0, input.drug_count * 5 + input.visit_interval_days + conditionBonus);
}

export function calculateVisitPlanScore(
  visitPlanId: string,
  input: BaseScoreInput,
  clinicalPriority: ClinicalPriority,
  calculatedAt = new Date().toISOString(),
): VisitPlanScore {
  const base_score = baseScore(input);
  const priority_weight = priorityWeight(clinicalPriority);
  return {
    visit_plan_id: visitPlanId,
    base_score,
    clinical_priority: clinicalPriority,
    priority_weight,
    visit_plan_score: base_score * priority_weight,
    calculated_at: calculatedAt,
  };
}

export function createClinicalPriorityAuditEntry(params: {
  visitPlanId: string;
  changedBy: string;
  oldPriority: ClinicalPriority | null;
  newPriority: ClinicalPriority;
  changedAt?: string;
  source?: ClinicalPriorityAuditEntry['source'];
}): ClinicalPriorityAuditEntry {
  const oldWeight = params.oldPriority ? priorityWeight(params.oldPriority) : null;
  const newWeight = priorityWeight(params.newPriority);
  return {
    visit_plan_id: params.visitPlanId,
    changed_by: params.changedBy,
    changed_at: params.changedAt ?? new Date().toISOString(),
    old_priority: params.oldPriority,
    new_priority: params.newPriority,
    old_weight: oldWeight,
    new_weight: newWeight,
    source: params.source ?? 'manual',
  };
}
