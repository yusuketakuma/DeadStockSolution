import { describe, expect, test } from 'vitest';
import {
  calculateVisitPlanScore,
  createClinicalPriorityAuditEntry,
  priorityWeight,
} from '../services/visit-plan-scoring';
import { CLINICAL_PRIORITY_VALUES, ClinicalPriority } from '../types';

describe('priorityWeight()', () => {
  test('high returns 1.5', () => {
    expect(priorityWeight('high')).toBe(1.5);
  });

  test('medium returns 1.0', () => {
    expect(priorityWeight('medium')).toBe(1.0);
  });

  test('low returns 0.7', () => {
    expect(priorityWeight('low')).toBe(0.7);
  });

  test('order invariant: high > medium > low', () => {
    expect(priorityWeight('high')).toBeGreaterThan(priorityWeight('medium'));
    expect(priorityWeight('medium')).toBeGreaterThan(priorityWeight('low'));
  });

  test('medium is baseline 1.0 (no amplification, no suppression)', () => {
    expect(priorityWeight('medium')).toBe(1.0);
  });

  test('all enum values map to a defined number', () => {
    for (const value of CLINICAL_PRIORITY_VALUES) {
      expect(priorityWeight(value)).toBeDefined();
      expect(typeof priorityWeight(value)).toBe('number');
      expect(Number.isFinite(priorityWeight(value))).toBe(true);
    }
  });
});

describe('visit_plan_score = baseScore × priorityWeight', () => {
  const input = {
    patient_id: 'uuid-1',
    drug_count: 10,
    visit_interval_days: 20,
    special_conditions: ['insulin', 'narcotic'],
  };

  test('medium priority does not change base_score', () => {
    const base = 100;
    const score = base * priorityWeight('medium');
    expect(score).toBe(100);
  });

  test('high priority amplifies score by 1.5x', () => {
    const base = 100;
    const score = base * priorityWeight('high');
    expect(score).toBe(150);
  });

  test('low priority suppresses score to 0.7x', () => {
    const base = 100;
    const score = base * priorityWeight('low');
    expect(score).toBe(70);
  });

  test('zero base_score results in zero regardless of priority', () => {
    expect(0 * priorityWeight('high')).toBe(0);
    expect(0 * priorityWeight('medium')).toBe(0);
    expect(0 * priorityWeight('low')).toBe(0);
  });

  test('priority ranking preserved across different base_score values', () => {
    const bases = [1, 10, 50, 100, 500];
    for (const b of bases) {
      const high = b * priorityWeight('high');
      const med = b * priorityWeight('medium');
      const low = b * priorityWeight('low');
      expect(high).toBeGreaterThan(med);
      expect(med).toBeGreaterThan(low);
    }
  });

  test('calculateVisitPlanScore uses baseScore × priorityWeight', () => {
    const result = calculateVisitPlanScore('vp-1', input, 'high', '2026-05-22T12:00:00Z');
    expect(result.visit_plan_id).toBe('vp-1');
    expect(result.base_score).toBeGreaterThan(0);
    expect(result.clinical_priority).toBe('high');
    expect(result.priority_weight).toBe(1.5);
    expect(result.visit_plan_score).toBe(result.base_score * 1.5);
    expect(result.calculated_at).toBe('2026-05-22T12:00:00Z');
  });
});

describe('boundary and edge cases', () => {
  test('small base_score (0.001) preserves ratio', () => {
    const base = 0.001;
    expect(base * priorityWeight('high')).toBeCloseTo(0.0015, 5);
    expect(base * priorityWeight('low')).toBeCloseTo(0.0007, 5);
  });

  test('large base_score (1e6) preserves ratio', () => {
    const base = 1_000_000;
    expect(base * priorityWeight('high')).toBe(1_500_000);
    expect(base * priorityWeight('low')).toBe(700_000);
  });

  test('type safe enum contract is preserved at runtime via values list', () => {
    const allowed: ClinicalPriority[] = ['high', 'medium', 'low'];
    expect(allowed).toEqual(CLINICAL_PRIORITY_VALUES);
  });
});

describe('audit trail integration', () => {
  test('priority change creates audit entry with old/new values', () => {
    const entry = createClinicalPriorityAuditEntry({
      visitPlanId: 'uuid-123',
      changedBy: 'user-uuid-456',
      changedAt: '2026-05-22T12:00:00Z',
      oldPriority: 'low',
      newPriority: 'high',
      source: 'manual',
    });
    expect(entry.old_weight).toBe(0.7);
    expect(entry.new_weight).toBe(1.5);
    expect(entry.changed_by).toBeDefined();
    expect(entry.changed_at).toBeDefined();
    expect(entry.source).toBe('manual');
  });
});
