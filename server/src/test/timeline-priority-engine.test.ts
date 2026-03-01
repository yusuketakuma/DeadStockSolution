import { describe, expect, it } from 'vitest';
import { assignPriority } from '../services/timeline-priority-engine';
import type { RawTimelineEvent } from '../types/timeline';

// テスト用ヘルパー: RawTimelineEvent のデフォルト値を持つファクトリ関数
function makeEvent(overrides: Partial<RawTimelineEvent>): RawTimelineEvent {
  return {
    id: 'test_1',
    source: 'notification',
    type: 'generic',
    title: 'テストイベント',
    body: 'テスト本文',
    timestamp: '2026-03-01T10:00:00.000Z',
    isRead: true,
    ...overrides,
  };
}

// 固定のnow: 2026-03-01T12:00:00.000Z を使用
const NOW = new Date('2026-03-01T12:00:00.000Z');

describe('timeline-priority-engine', () => {
  // ============================================================
  // Critical priority
  // ============================================================
  describe('Critical: confirmed提案の取引完了待ち', () => {
    it('source=proposal, type=confirmed, completedAt=null の場合はcritical', () => {
      const event = makeEvent({
        source: 'proposal',
        type: 'confirmed',
        metadata: { completedAt: null },
      });
      expect(assignPriority(event, NOW)).toBe('critical');
    });

    it('source=proposal, type=confirmed でも completedAt が設定されていれば critical にならない', () => {
      const event = makeEvent({
        source: 'proposal',
        type: 'confirmed',
        metadata: { completedAt: '2026-03-01T10:00:00.000Z' },
      });
      expect(assignPriority(event, NOW)).not.toBe('critical');
    });
  });

  describe('Critical: 期限切れ3日以内のデッドストック', () => {
    it('source=expiry_risk の場合はcritical', () => {
      const event = makeEvent({
        source: 'expiry_risk',
        type: 'expiry_alert',
      });
      expect(assignPriority(event, NOW)).toBe('critical');
    });

    it('source が expiry_risk でない場合はcritical にならない', () => {
      const event = makeEvent({
        source: 'notification',
        type: 'expiry_alert',
      });
      expect(assignPriority(event, NOW)).not.toBe('critical');
    });
  });

  // ============================================================
  // High priority
  // ============================================================
  describe('High: 未返信コメント24h以上', () => {
    it('source=comment, isRead=false, timestamp が24h以上前の場合はhigh', () => {
      // 25時間前 (NOW = 2026-03-01T12:00:00.000Z)
      const event = makeEvent({
        source: 'comment',
        isRead: false,
        timestamp: '2026-02-28T11:00:00.000Z', // 25時間前
      });
      expect(assignPriority(event, NOW)).toBe('high');
    });

    it('source=comment, isRead=false でも 24h 以内なら high にならない', () => {
      const event = makeEvent({
        source: 'comment',
        isRead: false,
        timestamp: '2026-03-01T00:00:00.000Z', // 12時間前
      });
      expect(assignPriority(event, NOW)).not.toBe('high');
    });

    it('source=comment, 24h以上前でも isRead=true なら high にならない', () => {
      const event = makeEvent({
        source: 'comment',
        isRead: true,
        timestamp: '2026-02-28T10:00:00.000Z', // 26時間前
      });
      expect(assignPriority(event, NOW)).not.toBe('high');
    });
  });

  describe('High: 受信提案の承認/拒否待ち', () => {
    it('source=proposal, type=proposed, isInbound=true の場合はhigh', () => {
      const event = makeEvent({
        source: 'proposal',
        type: 'proposed',
        metadata: { isInbound: true },
      });
      expect(assignPriority(event, NOW)).toBe('high');
    });

    it('source=proposal, type=proposed でも isInbound=false なら high にならない', () => {
      const event = makeEvent({
        source: 'proposal',
        type: 'proposed',
        metadata: { isInbound: false },
      });
      expect(assignPriority(event, NOW)).not.toBe('high');
    });

    it('旧仕様の isRequester=false でも受信として扱う', () => {
      const event = makeEvent({
        source: 'proposal',
        type: 'proposed',
        metadata: { isRequester: false },
      });
      expect(assignPriority(event, NOW)).toBe('high');
    });
  });

  describe('High: 新規マッチング候補', () => {
    it('source=match, isRead=false の場合はhigh', () => {
      const event = makeEvent({
        source: 'match',
        isRead: false,
      });
      expect(assignPriority(event, NOW)).toBe('high');
    });

    it('source=match でも isRead=true なら high にならない', () => {
      const event = makeEvent({
        source: 'match',
        isRead: true,
      });
      expect(assignPriority(event, NOW)).not.toBe('high');
    });
  });

  // ============================================================
  // Medium priority
  // ============================================================
  describe('Medium: 提案ステータス変更通知', () => {
    it('source=notification, type=proposal_status_changed の場合はmedium', () => {
      const event = makeEvent({
        source: 'notification',
        type: 'proposal_status_changed',
      });
      expect(assignPriority(event, NOW)).toBe('medium');
    });

    it('source=notification でも type が proposal_status_changed でなければ medium にならない（該当しない場合）', () => {
      const event = makeEvent({
        source: 'notification',
        type: 'other_notification',
      });
      // デフォルトはlow
      expect(assignPriority(event, NOW)).toBe('low');
    });
  });

  describe('Medium: 新規コメント受信通知', () => {
    it('source=notification, type=new_comment の場合はmedium', () => {
      const event = makeEvent({
        source: 'notification',
        type: 'new_comment',
      });
      expect(assignPriority(event, NOW)).toBe('medium');
    });

    it('source=comment でも type=new_comment でなければ medium（コメント通知）にはならない', () => {
      // source=comment, isRead=true, 1時間前 → low or medium ではなく low
      const event = makeEvent({
        source: 'comment',
        isRead: true,
        timestamp: '2026-03-01T11:00:00.000Z', // 1時間前
      });
      expect(assignPriority(event, NOW)).toBe('low');
    });
  });

  describe('Medium: 在庫アップロード完了', () => {
    it('source=upload の場合はmedium', () => {
      const event = makeEvent({
        source: 'upload',
        type: 'upload_complete',
      });
      expect(assignPriority(event, NOW)).toBe('medium');
    });

    it('source=upload は常にmedium', () => {
      const event = makeEvent({
        source: 'upload',
        type: 'any_upload_type',
      });
      expect(assignPriority(event, NOW)).toBe('medium');
    });
  });

  // ============================================================
  // Low priority
  // ============================================================
  describe('Low: 管理者メッセージ', () => {
    it('source=admin_message の場合はlow', () => {
      const event = makeEvent({
        source: 'admin_message',
        type: 'info',
      });
      expect(assignPriority(event, NOW)).toBe('low');
    });

    it('source=admin_message は常にlow', () => {
      const event = makeEvent({
        source: 'admin_message',
        type: 'announcement',
        isRead: false,
      });
      expect(assignPriority(event, NOW)).toBe('low');
    });
  });

  describe('Low: 取引完了履歴', () => {
    it('source=exchange_history の場合はlow', () => {
      const event = makeEvent({
        source: 'exchange_history',
        type: 'completed',
      });
      expect(assignPriority(event, NOW)).toBe('low');
    });

    it('source=exchange_history は常にlow', () => {
      const event = makeEvent({
        source: 'exchange_history',
        type: 'archived',
      });
      expect(assignPriority(event, NOW)).toBe('low');
    });
  });

  describe('Low: その他（デフォルト）', () => {
    it('source=activity の場合はlow（デフォルト）', () => {
      const event = makeEvent({
        source: 'activity',
        type: 'logged',
      });
      expect(assignPriority(event, NOW)).toBe('low');
    });

    it('source=feedback の場合はlow（デフォルト）', () => {
      const event = makeEvent({
        source: 'feedback',
        type: 'submitted',
      });
      expect(assignPriority(event, NOW)).toBe('low');
    });
  });

  // ============================================================
  // 優先度の順序確認（Critical > High > Medium > Low）
  // ============================================================
  describe('優先度ルールの優先順位', () => {
    it('criticalルールはhighルールより優先される（source=expiry_risk は critical）', () => {
      // expiry_risk は critical、matchより上
      const criticalEvent = makeEvent({ source: 'expiry_risk' });
      const highEvent = makeEvent({ source: 'match', isRead: false });
      expect(assignPriority(criticalEvent, NOW)).toBe('critical');
      expect(assignPriority(highEvent, NOW)).toBe('high');
    });

    it('now パラメータを省略しても動作する（デフォルトは現在時刻）', () => {
      // 現在時刻をデフォルト引数として使用する場合の smoke test
      const event = makeEvent({
        source: 'admin_message',
        type: 'info',
      });
      // now を省略 → デフォルト引数 new Date() が使われる
      expect(assignPriority(event)).toBe('low');
    });
  });
});
