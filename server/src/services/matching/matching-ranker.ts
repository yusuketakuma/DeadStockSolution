import { MatchCandidate } from '../../types';
import { sortMatchCandidatesByPriority } from '../matching-priority-service';
import type { MatchingRuleProfile } from '../../types/matching';

export function sortAndLimitCandidates(
  candidates: MatchCandidate[],
  matchingRuleProfile: MatchingRuleProfile,
  now: Date,
): MatchCandidate[] {
  return sortMatchCandidatesByPriority(candidates, matchingRuleProfile.nearExpiryDays, now)
    .slice(0, matchingRuleProfile.maxCandidates);
}
