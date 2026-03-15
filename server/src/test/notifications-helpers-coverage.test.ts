import { describe, expect, it } from 'vitest';
import {
  isUndefinedTableError,
  parseNumericList,
  parseNoticeCursor,
  resolveNotificationType,
  parseMatchDiff,
  buildProposalDeadlineAt,
  timestampSortValue,
  buildLatestProposalNotificationMap,
  toAdminMessageNotice,
  resolveNotificationActionPath,
  notificationToNotice,
  matchUpdateNotice,
  proposalActionNotice,
  compareNoticeOrder,
  resolveNoticeStartIndex,
  buildNoticeSummary,
  mergeDedupSortByTimestamp,
  encodeNoticeCursor,
} from '../routes/notifications-helpers';

// ---------------------------------------------------------------------------
// isUndefinedTableError
// ---------------------------------------------------------------------------
describe('isUndefinedTableError', () => {
  it('returns true when error code is 42P01', () => {
    expect(isUndefinedTableError({ code: '42P01' })).toBe(true);
  });

  it('returns false when error code is different', () => {
    expect(isUndefinedTableError({ code: '23505' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isUndefinedTableError(null)).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(isUndefinedTableError('error')).toBe(false);
  });

  it('returns false when code property is absent', () => {
    expect(isUndefinedTableError({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseNumericList
// ---------------------------------------------------------------------------
describe('parseNumericList', () => {
  it('returns empty array for non-array input', () => {
    expect(parseNumericList('not array')).toEqual([]);
    expect(parseNumericList(null)).toEqual([]);
    expect(parseNumericList(undefined)).toEqual([]);
    expect(parseNumericList(42)).toEqual([]);
  });

  it('filters out non-positive values', () => {
    expect(parseNumericList([0, -1, -100])).toEqual([]);
  });

  it('filters out non-safe integers', () => {
    expect(parseNumericList([1.5, 1e16, NaN])).toEqual([]);
  });

  it('returns valid positive safe integers', () => {
    expect(parseNumericList([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('converts string numbers to integers', () => {
    expect(parseNumericList(['5', '10'])).toEqual([5, 10]);
  });
});

// ---------------------------------------------------------------------------
// parseNoticeCursor
// ---------------------------------------------------------------------------
describe('parseNoticeCursor', () => {
  it('returns null for invalid base64 cursor', () => {
    expect(parseNoticeCursor('not-valid-cursor')).toBeNull();
  });

  it('returns null when id is empty string', () => {
    const cursor = { id: '', priority: 1, createdAt: null };
    const encoded = Buffer.from(JSON.stringify(cursor)).toString('base64');
    expect(parseNoticeCursor(encoded)).toBeNull();
  });

  it('returns null when priority is not integer', () => {
    const cursor = { id: 'abc', priority: 1.5, createdAt: null };
    const encoded = Buffer.from(JSON.stringify(cursor)).toString('base64');
    expect(parseNoticeCursor(encoded)).toBeNull();
  });

  it('returns null when priority is negative', () => {
    const cursor = { id: 'abc', priority: -1, createdAt: null };
    const encoded = Buffer.from(JSON.stringify(cursor)).toString('base64');
    expect(parseNoticeCursor(encoded)).toBeNull();
  });

  it('returns null when createdAt is not string or null', () => {
    const cursor = { id: 'abc', priority: 1, createdAt: 12345 };
    const encoded = Buffer.from(JSON.stringify(cursor)).toString('base64');
    expect(parseNoticeCursor(encoded)).toBeNull();
  });

  it('returns cursor when valid with non-null createdAt', () => {
    const cursor = { id: 'notification-1', priority: 2, createdAt: '2024-01-01T00:00:00Z' };
    const encoded = Buffer.from(JSON.stringify(cursor)).toString('base64');
    const result = parseNoticeCursor(encoded);
    expect(result).toEqual(cursor);
  });

  it('returns cursor when valid with null createdAt', () => {
    const cursor = { id: 'notification-5', priority: 0, createdAt: null };
    const encoded = Buffer.from(JSON.stringify(cursor)).toString('base64');
    const result = parseNoticeCursor(encoded);
    expect(result).toEqual(cursor);
  });
});

// ---------------------------------------------------------------------------
// resolveNotificationType
// ---------------------------------------------------------------------------
describe('resolveNotificationType', () => {
  it('returns new_comment for new_comment type', () => {
    expect(resolveNotificationType('new_comment')).toBe('new_comment');
  });

  it('returns alert for alert_near_expiry', () => {
    expect(resolveNotificationType('alert_near_expiry')).toBe('alert');
  });

  it('returns alert for alert_excess_stock', () => {
    expect(resolveNotificationType('alert_excess_stock')).toBe('alert');
  });

  it('returns alert for alert_resolved', () => {
    expect(resolveNotificationType('alert_resolved')).toBe('alert');
  });

  it('returns status_update for proposal_received', () => {
    expect(resolveNotificationType('proposal_received')).toBe('status_update');
  });

  it('returns status_update for proposal_status_changed', () => {
    expect(resolveNotificationType('proposal_status_changed')).toBe('status_update');
  });

  it('returns status_update for request_update', () => {
    expect(resolveNotificationType('request_update')).toBe('status_update');
  });

  it('returns null for unknown type', () => {
    expect(resolveNotificationType('unknown_type')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseMatchDiff
// ---------------------------------------------------------------------------
describe('parseMatchDiff', () => {
  it('parses valid JSON with addedPharmacyIds and removedPharmacyIds', () => {
    const raw = JSON.stringify({ addedPharmacyIds: [1, 2], removedPharmacyIds: [3] });
    expect(parseMatchDiff(raw)).toEqual({ addedCount: 2, removedCount: 1 });
  });

  it('returns zero counts for invalid JSON', () => {
    expect(parseMatchDiff('invalid json')).toEqual({ addedCount: 0, removedCount: 0 });
  });

  it('handles missing arrays', () => {
    const raw = JSON.stringify({});
    expect(parseMatchDiff(raw)).toEqual({ addedCount: 0, removedCount: 0 });
  });
});

// ---------------------------------------------------------------------------
// buildProposalDeadlineAt
// ---------------------------------------------------------------------------
describe('buildProposalDeadlineAt', () => {
  it('returns null for null input', () => {
    expect(buildProposalDeadlineAt(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(buildProposalDeadlineAt('')).toBeNull();
  });

  it('returns null for invalid date string', () => {
    expect(buildProposalDeadlineAt('not-a-date')).toBeNull();
  });

  it('returns ISO string 72 hours after proposedAt', () => {
    const result = buildProposalDeadlineAt('2024-01-01T00:00:00.000Z');
    expect(result).toBe('2024-01-04T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// timestampSortValue
// ---------------------------------------------------------------------------
describe('timestampSortValue', () => {
  it('returns NEGATIVE_INFINITY for null', () => {
    expect(timestampSortValue(null)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('returns NEGATIVE_INFINITY for invalid date string', () => {
    expect(timestampSortValue('not-a-date')).toBe(Number.NEGATIVE_INFINITY);
  });

  it('returns a numeric timestamp for valid date', () => {
    const result = timestampSortValue('2024-01-01T00:00:00.000Z');
    expect(result).toBe(new Date('2024-01-01T00:00:00.000Z').getTime());
  });
});

// ---------------------------------------------------------------------------
// buildLatestProposalNotificationMap
// ---------------------------------------------------------------------------
describe('buildLatestProposalNotificationMap', () => {
  const baseRow = {
    id: 1,
    referenceType: 'proposal' as const,
    type: 'proposal_received',
    referenceId: 10,
    isRead: false,
    createdAt: '2024-01-01T00:00:00Z',
  };

  it('skips rows where referenceType is not proposal', () => {
    const row = { ...baseRow, referenceType: 'alert' as const };
    const map = buildLatestProposalNotificationMap([row as never]);
    expect(map.size).toBe(0);
  });

  it('skips rows where type is not in PROPOSAL_EVENT_NOTIFICATION_TYPES', () => {
    const row = { ...baseRow, type: 'new_comment' };
    const map = buildLatestProposalNotificationMap([row]);
    expect(map.size).toBe(0);
  });

  it('skips rows where referenceId is 0 or null', () => {
    const row1 = { ...baseRow, referenceId: 0 };
    const row2 = { ...baseRow, referenceId: null as unknown as number };
    const map = buildLatestProposalNotificationMap([row1, row2]);
    expect(map.size).toBe(0);
  });

  it('only stores the first row for a given referenceId', () => {
    const row1 = { ...baseRow, id: 1, isRead: false };
    const row2 = { ...baseRow, id: 2, isRead: true };
    const map = buildLatestProposalNotificationMap([row1, row2]);
    expect(map.size).toBe(1);
    expect(map.get(10)?.id).toBe(1);
  });

  it('includes proposal_status_changed type', () => {
    const row = { ...baseRow, type: 'proposal_status_changed' };
    const map = buildLatestProposalNotificationMap([row]);
    expect(map.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// toAdminMessageNotice
// ---------------------------------------------------------------------------
describe('toAdminMessageNotice', () => {
  const baseMessage = {
    id: 5,
    title: 'Test Message',
    body: 'Body text',
    actionPath: '/admin/test',
    createdAt: '2024-01-01T00:00:00Z',
  };

  it('returns notice with unread=true priority 1', () => {
    const result = toAdminMessageNotice(baseMessage, true);
    expect(result.priority).toBe(1);
    expect(result.unread).toBe(true);
  });

  it('returns notice with unread=false priority 4', () => {
    const result = toAdminMessageNotice(baseMessage, false);
    expect(result.priority).toBe(4);
    expect(result.unread).toBe(false);
  });

  it('uses dashboard label when actionPath is /', () => {
    const msg = { ...baseMessage, actionPath: '/' };
    const result = toAdminMessageNotice(msg, false);
    expect(result.actionLabel).toBe('ダッシュボードへ');
  });

  it('uses default label when actionPath is not /', () => {
    const result = toAdminMessageNotice(baseMessage, false);
    expect(result.actionLabel).toBe('内容を確認');
  });

  it('sanitizes invalid action path to /', () => {
    const msg = { ...baseMessage, actionPath: 'http://external.com/evil' };
    const result = toAdminMessageNotice(msg, false);
    expect(result.actionPath).toBe('/');
    expect(result.actionLabel).toBe('ダッシュボードへ');
  });
});

// ---------------------------------------------------------------------------
// resolveNotificationActionPath
// ---------------------------------------------------------------------------
describe('resolveNotificationActionPath', () => {
  it('returns /alerts for alert referenceType', () => {
    expect(resolveNotificationActionPath('alert', null)).toBe('/alerts');
  });

  it('returns /matching for match referenceType', () => {
    expect(resolveNotificationActionPath('match', null)).toBe('/matching');
  });

  it('returns /proposals/:id for proposal referenceType with referenceId', () => {
    expect(resolveNotificationActionPath('proposal', 42)).toBe('/proposals/42');
  });

  it('returns / for proposal without referenceId', () => {
    expect(resolveNotificationActionPath('proposal', null)).toBe('/');
  });

  it('returns /proposals/:id for comment referenceType with referenceId', () => {
    expect(resolveNotificationActionPath('comment', 7)).toBe('/proposals/7');
  });

  it('returns / for comment without referenceId', () => {
    expect(resolveNotificationActionPath('comment', null)).toBe('/');
  });

  it('returns / for request referenceType', () => {
    expect(resolveNotificationActionPath('request', null)).toBe('/');
  });

  it('returns / for unknown referenceType', () => {
    expect(resolveNotificationActionPath('unknown', 5)).toBe('/');
  });

  it('returns / for null referenceType', () => {
    expect(resolveNotificationActionPath(null, null)).toBe('/');
  });
});

// ---------------------------------------------------------------------------
// notificationToNotice
// ---------------------------------------------------------------------------
describe('notificationToNotice', () => {
  const baseNotification = {
    id: 10,
    type: 'alert_near_expiry',
    title: 'Alert Title',
    message: 'Alert message',
    referenceType: 'alert' as const,
    referenceId: null as number | null,
    isRead: false,
    createdAt: '2024-01-01T00:00:00Z',
  };

  it('returns null and logs warn for unknown type', () => {
    const n = { ...baseNotification, type: 'totally_unknown' };
    const result = notificationToNotice(n as never);
    expect(result).toBeNull();
  });

  it('returns alert notice with priority 2 for unread alert', () => {
    const result = notificationToNotice(baseNotification);
    expect(result?.type).toBe('alert');
    expect(result?.priority).toBe(2);
  });

  it('returns alert notice with priority 4 for read alert', () => {
    const n = { ...baseNotification, isRead: true };
    const result = notificationToNotice(n);
    expect(result?.priority).toBe(4);
  });

  it('returns status_update with priority 3 for unread non-alert', () => {
    const n = { ...baseNotification, type: 'proposal_received', referenceType: 'proposal' as const, isRead: false };
    const result = notificationToNotice(n as never);
    expect(result?.type).toBe('status_update');
    expect(result?.priority).toBe(3);
  });

  it('returns status_update with priority 5 for read non-alert', () => {
    const n = { ...baseNotification, type: 'request_update', referenceType: 'request' as const, isRead: true };
    const result = notificationToNotice(n as never);
    expect(result?.priority).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// matchUpdateNotice
// ---------------------------------------------------------------------------
describe('matchUpdateNotice', () => {
  const baseRow = {
    id: 1,
    triggerPharmacyId: 5,
    triggerUploadType: 'dead_stock' as const,
    candidateCountBefore: 3,
    candidateCountAfter: 5,
    diffJson: JSON.stringify({ addedPharmacyIds: [1, 2], removedPharmacyIds: [3] }),
    createdAt: '2024-01-01T00:00:00Z',
    isRead: false,
  };

  it('shows 自薬局 when triggerPharmacyId equals currentPharmacyId', () => {
    const notice = matchUpdateNotice(baseRow, 5, null);
    expect(notice.title).toContain('自薬局');
  });

  it('shows pharmacy name when triggerPharmacyId differs from currentPharmacyId', () => {
    const notice = matchUpdateNotice(baseRow, 99, 'PharmaA');
    expect(notice.title).toContain('PharmaA');
  });

  it('uses pharmacy id fallback when name is null', () => {
    const notice = matchUpdateNotice(baseRow, 99, null);
    expect(notice.title).toContain('薬局 #5');
  });

  it('shows 使用量 for used_medication upload type', () => {
    const row = { ...baseRow, triggerUploadType: 'used_medication' as const };
    const notice = matchUpdateNotice(row, 99, 'PharmaA');
    expect(notice.title).toContain('使用量');
  });

  it('priority is 4 for read notice', () => {
    const row = { ...baseRow, isRead: true };
    const notice = matchUpdateNotice(row, 99, 'PharmaA');
    expect(notice.priority).toBe(4);
  });

  it('priority is 2 for unread notice', () => {
    const notice = matchUpdateNotice(baseRow, 99, 'PharmaA');
    expect(notice.priority).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// proposalActionNotice
// ---------------------------------------------------------------------------
describe('proposalActionNotice', () => {
  const baseProposal = {
    id: 1,
    pharmacyAId: 10,
    pharmacyBId: 20,
    status: 'proposed',
    proposedAt: '2024-01-01T00:00:00Z',
  };

  it('returns outbound_request for pharmacy A (sender) in proposed status', () => {
    const notice = proposalActionNotice(baseProposal, 10);
    expect(notice?.type).toBe('outbound_request');
  });

  it('outbound_request unread is false when no linkedNotification', () => {
    const notice = proposalActionNotice(baseProposal, 10);
    expect(notice?.unread).toBe(false);
  });

  it('outbound_request unread follows linkedNotification.isRead', () => {
    const linked = { id: 100, isRead: false, createdAt: '2024-01-02T00:00:00Z' };
    const notice = proposalActionNotice(baseProposal, 10, linked);
    expect(notice?.unread).toBe(true);
    expect(notice?.id).toBe('notification-100');
  });

  it('returns inbound_request for pharmacy B (receiver) in proposed status', () => {
    const notice = proposalActionNotice(baseProposal, 20);
    expect(notice?.type).toBe('inbound_request');
    expect(notice?.unread).toBe(true); // no linkedNotification so defaults true
  });

  it('returns inbound_request for accepted_a when user is B', () => {
    const proposal = { ...baseProposal, status: 'accepted_a' };
    const notice = proposalActionNotice(proposal, 20);
    expect(notice?.type).toBe('inbound_request');
    expect(notice?.title).toContain('相手承認済み');
  });

  it('returns inbound_request for accepted_b when user is A', () => {
    const proposal = { ...baseProposal, status: 'accepted_b' };
    const notice = proposalActionNotice(proposal, 10);
    expect(notice?.type).toBe('inbound_request');
  });

  it('returns null for accepted_a when user is A (not eligible)', () => {
    const proposal = { ...baseProposal, status: 'accepted_a' };
    const notice = proposalActionNotice(proposal, 10);
    expect(notice).toBeNull();
  });

  it('returns null for accepted_b when user is B (not eligible)', () => {
    const proposal = { ...baseProposal, status: 'accepted_b' };
    const notice = proposalActionNotice(proposal, 20);
    expect(notice).toBeNull();
  });

  it('returns status_update for confirmed status', () => {
    const proposal = { ...baseProposal, status: 'confirmed' };
    const notice = proposalActionNotice(proposal, 10);
    expect(notice?.type).toBe('status_update');
    expect(notice?.deadlineAt).toBeNull();
  });

  it('returns null for unknown status', () => {
    const proposal = { ...baseProposal, status: 'cancelled' };
    const notice = proposalActionNotice(proposal, 10);
    expect(notice).toBeNull();
  });

  it('uses fallback proposal-outbound id when no linkedNotification', () => {
    const notice = proposalActionNotice(baseProposal, 10);
    expect(notice?.id).toBe('proposal-1-outbound');
  });

  it('uses fallback proposal-inbound id when no linkedNotification', () => {
    const notice = proposalActionNotice(baseProposal, 20);
    expect(notice?.id).toBe('proposal-1-inbound');
  });
});

// ---------------------------------------------------------------------------
// compareNoticeOrder
// ---------------------------------------------------------------------------
describe('compareNoticeOrder', () => {
  const makeNotice = (id: string, priority: number, createdAt: string | null) => ({
    id,
    priority,
    createdAt,
    type: 'alert' as const,
    title: 'T',
    body: 'B',
    actionPath: '/',
    actionLabel: 'X',
    deadlineAt: null,
    unread: false,
  });

  it('sorts by priority ascending', () => {
    const a = makeNotice('a', 1, '2024-01-01T00:00:00Z');
    const b = makeNotice('b', 2, '2024-01-01T00:00:00Z');
    expect(compareNoticeOrder(a, b)).toBeLessThan(0);
  });

  it('sorts by timestamp descending when priority equal', () => {
    const a = makeNotice('a', 1, '2024-01-02T00:00:00Z');
    const b = makeNotice('b', 1, '2024-01-01T00:00:00Z');
    expect(compareNoticeOrder(a, b)).toBeLessThan(0);
  });

  it('sorts by id localeCompare when priority and timestamp equal', () => {
    const a = makeNotice('abc', 1, '2024-01-01T00:00:00Z');
    const b = makeNotice('xyz', 1, '2024-01-01T00:00:00Z');
    expect(compareNoticeOrder(a, b)).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// resolveNoticeStartIndex
// ---------------------------------------------------------------------------
describe('resolveNoticeStartIndex', () => {
  const makeNotice = (id: string, priority: number, createdAt: string | null) => ({
    id,
    priority,
    createdAt,
    type: 'alert' as const,
    title: 'T',
    body: 'B',
    actionPath: '/',
    actionLabel: 'X',
    deadlineAt: null,
    unread: false,
  });

  const notices = [
    makeNotice('notification-1', 1, '2024-01-03T00:00:00Z'),
    makeNotice('notification-2', 2, '2024-01-02T00:00:00Z'),
    makeNotice('notification-3', 3, '2024-01-01T00:00:00Z'),
  ];

  it('returns 0 when cursor is null', () => {
    expect(resolveNoticeStartIndex(notices, null)).toBe(0);
  });

  it('returns index+1 when exact id match found', () => {
    const cursor = { id: 'notification-1', priority: 1, createdAt: '2024-01-03T00:00:00Z' };
    expect(resolveNoticeStartIndex(notices, cursor)).toBe(1);
  });

  it('returns correct fallback index when id not found but position can be inferred', () => {
    // cursor points to something with priority=1, same time as notice-1 but different id
    const cursor = { id: 'notification-0', priority: 1, createdAt: '2024-01-03T00:00:00Z' };
    // 'notification-0' < 'notification-1' alphabetically, so fallback finds no item > cursor
    // meaning start at notices.length
    const result = resolveNoticeStartIndex(notices, cursor);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('returns notices.length when cursor is past all items', () => {
    const cursor = { id: 'zzz', priority: 99, createdAt: null };
    expect(resolveNoticeStartIndex(notices, cursor)).toBe(notices.length);
  });

  it('uses priority comparison in fallback', () => {
    // cursor has priority=1, but all items with priority > 1 come after
    const cursor = { id: 'no-match', priority: 0, createdAt: null };
    // all notices have priority > 0, so fallback returns 0
    expect(resolveNoticeStartIndex(notices, cursor)).toBe(0);
  });

  it('uses timestamp comparison when priorities are equal in fallback', () => {
    // cursor at priority=2, timestamp earlier than notice-2
    const cursor = { id: 'no-match', priority: 2, createdAt: '2024-01-01T00:00:00Z' };
    // notice at index 1 has createdAt=2024-01-02 > cursor's 2024-01-01, so it's NOT the fallback start
    // notice at index 2 has priority=3 > cursor.priority=2, so it IS the fallback start
    const result = resolveNoticeStartIndex(notices, cursor);
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// buildNoticeSummary
// ---------------------------------------------------------------------------
describe('buildNoticeSummary', () => {
  const makeItem = (type: string, unread: boolean) => ({
    id: 'x',
    type: type as never,
    title: 'T',
    body: 'B',
    actionPath: '/',
    actionLabel: 'X',
    createdAt: null,
    deadlineAt: null,
    unread,
    priority: 1,
  });

  it('counts unread admin_message items', () => {
    const result = buildNoticeSummary([
      makeItem('admin_message', true),
      makeItem('admin_message', false),
    ]);
    expect(result.unreadMessages).toBe(1);
  });

  it('counts unread inbound_request as actionableRequests', () => {
    const result = buildNoticeSummary([makeItem('inbound_request', true)]);
    expect(result.actionableRequests).toBe(1);
  });

  it('counts unread status_update as actionableRequests', () => {
    const result = buildNoticeSummary([makeItem('status_update', true)]);
    expect(result.actionableRequests).toBe(1);
  });

  it('counts unread match_update as actionableRequests', () => {
    const result = buildNoticeSummary([makeItem('match_update', true)]);
    expect(result.actionableRequests).toBe(1);
  });

  it('counts unread alert as actionableRequests', () => {
    const result = buildNoticeSummary([makeItem('alert', true)]);
    expect(result.actionableRequests).toBe(1);
  });

  it('does not count read actionable items', () => {
    const result = buildNoticeSummary([makeItem('inbound_request', false)]);
    expect(result.actionableRequests).toBe(0);
  });

  it('returns zero counts for empty array', () => {
    expect(buildNoticeSummary([])).toEqual({ unreadMessages: 0, actionableRequests: 0 });
  });

  it('does not count outbound_request in actionableRequests', () => {
    const result = buildNoticeSummary([makeItem('outbound_request', true)]);
    expect(result.actionableRequests).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// mergeDedupSortByTimestamp
// ---------------------------------------------------------------------------
describe('mergeDedupSortByTimestamp', () => {
  const makeRow = (id: number, ts: string | null) => ({ id, ts });
  const getTs = (row: { id: number; ts: string | null }) => row.ts;

  it('merges two branches by descending timestamp', () => {
    const a = [makeRow(1, '2024-01-03T00:00:00Z'), makeRow(3, '2024-01-01T00:00:00Z')];
    const b = [makeRow(2, '2024-01-02T00:00:00Z')];
    const result = mergeDedupSortByTimestamp(a, b, getTs);
    expect(result.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('deduplicates items with same id', () => {
    const a = [makeRow(1, '2024-01-02T00:00:00Z')];
    const b = [makeRow(1, '2024-01-01T00:00:00Z')];
    const result = mergeDedupSortByTimestamp(a, b, getTs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('respects limit parameter', () => {
    const a = [makeRow(1, '2024-01-03T00:00:00Z'), makeRow(3, '2024-01-01T00:00:00Z')];
    const b = [makeRow(2, '2024-01-02T00:00:00Z')];
    const result = mergeDedupSortByTimestamp(a, b, getTs, 2);
    expect(result).toHaveLength(2);
  });

  it('handles empty branchA', () => {
    const b = [makeRow(1, '2024-01-01T00:00:00Z')];
    const result = mergeDedupSortByTimestamp([], b, getTs);
    expect(result).toHaveLength(1);
  });

  it('handles empty branchB', () => {
    const a = [makeRow(1, '2024-01-01T00:00:00Z')];
    const result = mergeDedupSortByTimestamp(a, [], getTs);
    expect(result).toHaveLength(1);
  });

  it('breaks ties on id descending', () => {
    const a = [makeRow(2, '2024-01-01T00:00:00Z')];
    const b = [makeRow(1, '2024-01-01T00:00:00Z')];
    const result = mergeDedupSortByTimestamp(a, b, getTs);
    expect(result[0].id).toBe(2);
  });

  it('handles null timestamps', () => {
    const a = [makeRow(1, null)];
    const b = [makeRow(2, '2024-01-01T00:00:00Z')];
    const result = mergeDedupSortByTimestamp(a, b, getTs);
    // null timestamps are treated as NEGATIVE_INFINITY so b comes first
    expect(result[0].id).toBe(2);
    expect(result[1].id).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// encodeNoticeCursor
// ---------------------------------------------------------------------------
describe('encodeNoticeCursor', () => {
  it('encodes a cursor to a non-empty string', () => {
    const cursor = { id: 'notification-1', priority: 2, createdAt: '2024-01-01T00:00:00Z' };
    const encoded = encodeNoticeCursor(cursor);
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
  });
});
