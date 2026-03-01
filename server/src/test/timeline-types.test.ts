import { describe, expect, it } from 'vitest';
import { TIMELINE_EVENT_TYPES, toTimelineEventType } from '../types/timeline';

describe('TIMELINE_EVENT_TYPES', () => {
  const eventTypes: ReadonlySet<string> = TIMELINE_EVENT_TYPES;

  it('全ての既知イベントタイプが含まれる', () => {
    expect(eventTypes.has('match_update')).toBe(true);
    expect(eventTypes.has('new_comment')).toBe(true);
    expect(eventTypes.has('exchange_feedback')).toBe(true);
    expect(eventTypes.has('admin_message')).toBe(true);
    expect(eventTypes.has('exchange_completed')).toBe(true);
    expect(eventTypes.has('near_expiry')).toBe(true);
    expect(eventTypes.has('proposal_proposed')).toBe(true);
    expect(eventTypes.has('proposal_accepted_a')).toBe(true);
    expect(eventTypes.has('proposal_accepted_b')).toBe(true);
    expect(eventTypes.has('proposal_confirmed')).toBe(true);
    expect(eventTypes.has('proposal_rejected')).toBe(true);
    expect(eventTypes.has('proposal_completed')).toBe(true);
    expect(eventTypes.has('proposal_cancelled')).toBe(true);
    expect(eventTypes.has('proposal_received')).toBe(true);
    expect(eventTypes.has('proposal_status_changed')).toBe(true);
    expect(eventTypes.has('upload_dead_stock')).toBe(true);
    expect(eventTypes.has('upload_used_medication')).toBe(true);
    expect(eventTypes.has('request_update')).toBe(true);
  });

  it('未知の値は含まれない', () => {
    expect(eventTypes.has('')).toBe(false);
    expect(eventTypes.has('unknown_type')).toBe(false);
    expect(eventTypes.has('proposal_xyz')).toBe(false);
  });
});

describe('toTimelineEventType', () => {
  it('正常値: 既知のイベントタイプをそのまま返す', () => {
    expect(toTimelineEventType('match_update')).toBe('match_update');
    expect(toTimelineEventType('new_comment')).toBe('new_comment');
    expect(toTimelineEventType('proposal_received')).toBe('proposal_received');
    expect(toTimelineEventType('upload_dead_stock')).toBe('upload_dead_stock');
    expect(toTimelineEventType('request_update')).toBe('request_update');
  });

  it('不正値: 未知のイベントタイプは request_update にフォールバックする', () => {
    expect(toTimelineEventType('unknown_type')).toBe('request_update');
    expect(toTimelineEventType('')).toBe('request_update');
    expect(toTimelineEventType('proposal_xyz')).toBe('request_update');
    expect(toTimelineEventType('MATCH_UPDATE')).toBe('request_update');
  });

  it('フォールバック: フォールバック値 request_update 自体を渡すと request_update を返す', () => {
    expect(toTimelineEventType('request_update')).toBe('request_update');
  });
});
