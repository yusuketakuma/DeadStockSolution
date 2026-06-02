import type { EnrichedProposalTimelineEvent } from '../../types/timeline';

export interface PharmacyInfo {
  id: number;
  name: string;
  phone: string;
  fax: string;
  address: string;
  prefecture: string;
}

export interface ProposalItem {
  id: number;
  fromPharmacyId: number;
  toPharmacyId: number;
  quantity: number;
  yakkaValue: number;
  drugName: string;
  unit: string | null;
  packageLabel?: string | null;
  packageQuantity?: number | null;
  packageUnit?: string | null;
  yakkaUnitPrice: number | null;
}

export interface ProposalDetail {
  proposal: {
    id: number;
    pharmacyAId: number;
    pharmacyBId: number;
    status: string;
    totalValueA: number;
    totalValueB: number;
    valueDifference: number;
    proposedAt: string;
    expiresAt?: string | null;
    expiryReminderSentAt?: string | null;
  };
  items: ProposalItem[];
  pharmacyA: PharmacyInfo;
  pharmacyB: PharmacyInfo;
  enrichedTimeline?: EnrichedProposalTimelineEvent[];
}
