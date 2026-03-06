import { MatchCandidate } from '../../types';
import { MAX_CANDIDATES } from '../matching-filter-service';
import { sortMatchCandidatesByPriority } from '../matching-priority-service';
import type { MatchingRuleProfile } from './matching-candidate-builder';

export function sortAndLimitCandidates(
  candidates: MatchCandidate[],
  matchingRuleProfile: MatchingRuleProfile,
  now: Date,
): MatchCandidate[] {
  return sortMatchCandidatesByPriority(candidates, matchingRuleProfile.nearExpiryDays, now)
    .slice(0, MAX_CANDIDATES);
}
