import { describe, expect, it, vi } from 'vitest';
import { collectCandidates } from '../services/matching/matching-candidate-builder';
import { buildUsedMedIndex, prepareDrugName, DEFAULT_MATCHING_SCORING_RULES } from '../services/matching-score-service';
import type { MatchingRuleProfile, PreparedStockRow } from '../types/matching';

function makePreparedStockRow(params: {
  id: number;
  pharmacyId: number;
  drugName: string;
  quantity: number;
  yakkaUnitPrice: number;
  expirationDateIso: string;
  packageLabel?: string;
}): PreparedStockRow {
  return {
    stock: {
      id: params.id,
      pharmacyId: params.pharmacyId,
      drugCode: `CODE-${params.id}`,
      drugName: params.drugName,
      quantity: params.quantity,
      unit: '錠',
      packageLabel: params.packageLabel ?? 'PTP',
      yakkaUnitPrice: params.yakkaUnitPrice,
      expirationDate: params.expirationDateIso,
      expirationDateIso: params.expirationDateIso,
      lotNumber: null,
      createdAt: '2024-01-01T00:00:00.000Z',
    },
    preparedDrugName: prepareDrugName(params.drugName),
  };
}

function makeMatchingRuleProfile(): MatchingRuleProfile {
  return {
    id: 1,
    profileName: 'default',
    isActive: true,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    source: 'database',
    ...DEFAULT_MATCHING_SCORING_RULES,
  };
}

describe('matching-candidate-builder', () => {
  it('uses the provided reference date when calculating near-expiry score', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T00:00:00.000Z'));

    const referenceNow = new Date('2025-01-01T00:00:00.000Z');
    const otherPharmacyId = 2;

    const myPreparedDeadStock = [
      makePreparedStockRow({
        id: 101,
        pharmacyId: 1,
        drugName: '薬A',
        quantity: 100,
        yakkaUnitPrice: 100,
        expirationDateIso: '2025-01-05',
      }),
    ];
    const theirPreparedDeadStock = [
      makePreparedStockRow({
        id: 202,
        pharmacyId: otherPharmacyId,
        drugName: '薬B',
        quantity: 100,
        yakkaUnitPrice: 100,
        expirationDateIso: '2025-01-06',
      }),
    ];

    const candidates = collectCandidates({
      pharmaciesWithDistance: [{
        id: otherPharmacyId,
        name: '相手薬局',
        phone: null,
        fax: null,
        latitude: 35.0,
        longitude: 139.0,
        distance: 2,
      }],
      myPreparedDeadStock,
      myUsedMedIndex: buildUsedMedIndex([{ pharmacyId: 1, drugName: '薬B' }]),
      preparedDeadStockByPharmacy: new Map<number, PreparedStockRow[]>([
        [otherPharmacyId, theirPreparedDeadStock],
      ]),
      usedMedIndexByPharmacy: new Map([
        [otherPharmacyId, buildUsedMedIndex([{ pharmacyId: otherPharmacyId, drugName: '薬A' }])],
      ]),
      businessHoursByPharmacy: new Map(),
      specialHoursByPharmacy: new Map(),
      matchingRuleProfile: makeMatchingRuleProfile(),
      favoriteIds: new Set<number>(),
      groupMemberIds: new Set<number>(),
      now: referenceNow,
      includeIsConfiguredInBusinessStatus: false,
      equivalenceMap: new Map(),
      successCountByPharmacy: new Map(),
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.scoreBreakdown?.expiryScore ?? 0).toBeGreaterThan(0);

    vi.useRealTimers();
  });

  it('drops equivalence-based candidates when the matched package forms are incompatible', () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    const otherPharmacyId = 2;
    const matchingRuleProfile = makeMatchingRuleProfile();
    const equivalenceMap = new Map<string, string[]>([
      ['先発薬錠100mg', ['後発薬錠100mg']],
      ['後発薬錠100mg', ['先発薬錠100mg']],
    ]);

    const myPreparedDeadStock = [
      makePreparedStockRow({
        id: 101,
        pharmacyId: 1,
        drugName: '先発薬錠100mg',
        quantity: 200,
        yakkaUnitPrice: 100,
        expirationDateIso: '2026-12-31',
        packageLabel: '100T PTP',
      }),
    ];
    const theirPreparedDeadStock = [
      makePreparedStockRow({
        id: 202,
        pharmacyId: otherPharmacyId,
        drugName: '後発薬錠100mg',
        quantity: 200,
        yakkaUnitPrice: 100,
        expirationDateIso: '2026-12-31',
        packageLabel: '100T バラ',
      }),
    ];

    const candidates = collectCandidates({
      pharmaciesWithDistance: [{
        id: otherPharmacyId,
        name: '相手薬局',
        phone: null,
        fax: null,
        latitude: 35.0,
        longitude: 139.0,
        distance: 2,
      }],
      myPreparedDeadStock,
      myUsedMedIndex: buildUsedMedIndex([{ pharmacyId: 1, drugName: '先発薬錠100mg' }]),
      preparedDeadStockByPharmacy: new Map<number, PreparedStockRow[]>([
        [otherPharmacyId, theirPreparedDeadStock],
      ]),
      usedMedIndexByPharmacy: new Map([
        [otherPharmacyId, buildUsedMedIndex([{ pharmacyId: otherPharmacyId, drugName: '後発薬錠100mg' }])],
      ]),
      businessHoursByPharmacy: new Map(),
      specialHoursByPharmacy: new Map(),
      matchingRuleProfile,
      favoriteIds: new Set<number>(),
      groupMemberIds: new Set<number>(),
      now,
      includeIsConfiguredInBusinessStatus: false,
      equivalenceMap,
      successCountByPharmacy: new Map(),
    });

    expect(candidates).toEqual([]);
  });
});
