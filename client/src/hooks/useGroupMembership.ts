import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { GroupDetailResponse, GroupListResponse } from '../../../server/src/types/group';

interface UseGroupMembershipOptions {
  includeMemberIds?: boolean;
}

interface UseGroupMembershipReturn {
  isGroupMember: boolean;
  groupPharmacyIds: Set<number>;
}

function collectGroupPharmacyIds(groupDetails: GroupDetailResponse[]): Set<number> {
  const ids = new Set<number>();
  for (const detail of groupDetails) {
    for (const member of detail.members) {
      ids.add(member.pharmacyId);
    }
  }
  return ids;
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
        const listRes = await api.get<GroupListResponse>('/groups?tab=mine', {
          signal: controller.signal,
        });
        if (!active || controller.signal.aborted) return;

        const hasGroups = listRes.groups.length > 0;
        setIsGroupMember(hasGroups);

        if (!includeMemberIds || !hasGroups) {
          setGroupPharmacyIds(new Set());
          return;
        }

        const details = await Promise.all(
          listRes.groups.map((group) =>
            api.get<GroupDetailResponse>(`/groups/${group.id}`, {
              signal: controller.signal,
            })
          ),
        );
        if (!active || controller.signal.aborted) return;

        setGroupPharmacyIds(collectGroupPharmacyIds(details));
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
