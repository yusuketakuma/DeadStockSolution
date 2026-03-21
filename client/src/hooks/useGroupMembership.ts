import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { GroupMembershipSummaryResponse } from '../../../server/src/types/group';

interface UseGroupMembershipOptions {
  includeMemberIds?: boolean;
}

interface UseGroupMembershipReturn {
  isGroupMember: boolean;
  groupPharmacyIds: Set<number>;
}

export function useGroupMembership(
  options: UseGroupMembershipOptions = {},
): UseGroupMembershipReturn {
  const { includeMemberIds = false } = options;
  const [isGroupMember, setIsGroupMember] = useState(false);
  const [groupPharmacyIds, setGroupPharmacyIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const loadMembership = async () => {
      try {
        const summary = await api.get<GroupMembershipSummaryResponse>('/groups/membership-summary', {
          signal: controller.signal,
        });
        if (!active || controller.signal.aborted) return;

        const hasGroups = summary.groups.length > 0;
        setIsGroupMember(hasGroups);

        if (!includeMemberIds || !hasGroups) {
          setGroupPharmacyIds(new Set());
          return;
        }

        setGroupPharmacyIds(new Set(summary.groupPharmacyIds));
      } catch {
        if (!active || controller.signal.aborted) return;
        setIsGroupMember(false);
        setGroupPharmacyIds(new Set());
      }
    };

    void loadMembership();

    return () => {
      active = false;
      controller.abort();
    };
  }, [includeMemberIds]);

  return { isGroupMember, groupPharmacyIds };
}
