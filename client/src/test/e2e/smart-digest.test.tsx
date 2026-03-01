import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SmartDigest from '../../components/timeline/SmartDigest';
import type { TimelineEvent } from '../../types/timeline';

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'evt-1',
    source: 'notification',
    type: 'test',
    title: 'テストイベント',
    body: '本文',
    timestamp: '2026-03-01T00:00:00Z',
    priority: 'critical',
    isRead: false,
    actionPath: '/proposals/1',
    ...overrides,
  };
}

function renderDigest(props: Partial<Parameters<typeof SmartDigest>[0]> = {}) {
  return render(
    <MemoryRouter>
      <SmartDigest events={[]} loading={false} {...props} />
    </MemoryRouter>
  );
}

describe('SmartDigest', () => {
  it('criticalイベントを緊急バッジ付きで表示する', () => {
    const events = [makeEvent({ priority: 'critical', title: '緊急テスト案件' })];
    renderDigest({ events });

    expect(screen.getByText('緊急')).toBeInTheDocument();
    expect(screen.getByText('緊急テスト案件')).toBeInTheDocument();
  });

  it('highイベントを重要バッジ付きで表示する', () => {
    const events = [makeEvent({ priority: 'high', title: '重要テスト案件' })];
    renderDigest({ events });

    expect(screen.getByText('重要')).toBeInTheDocument();
    expect(screen.getByText('重要テスト案件')).toBeInTheDocument();
  });

  it('空状態メッセージを表示する', () => {
    renderDigest({ events: [] });

    expect(screen.getByText('対応が必要なタスクはありません')).toBeInTheDocument();
  });

  it('ローディング状態を表示する', () => {
    renderDigest({ loading: true });

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('イベントクリック時にonEventClickコールバックを呼ぶ', () => {
    const onEventClick = vi.fn();
    const event = makeEvent({ title: 'クリックテスト' });
    renderDigest({ events: [event], onEventClick });

    fireEvent.click(screen.getByText('確認する →'));

    expect(onEventClick).toHaveBeenCalledOnce();
    expect(onEventClick).toHaveBeenCalledWith(event);
  });

  it('件数バッジにイベント数を正確に表示する', () => {
    const events = [
      makeEvent({ id: 'e1', priority: 'critical' }),
      makeEvent({ id: 'e2', priority: 'high' }),
      makeEvent({ id: 'e3', priority: 'critical' }),
    ];
    renderDigest({ events });

    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('6件渡しても最大5件しか表示しない', () => {
    const events = Array.from({ length: 6 }, (_, i) =>
      makeEvent({ id: `e${i}`, title: `イベント${i + 1}` })
    );
    renderDigest({ events });

    // 「確認する →」リンクの数が5件以下であることを確認
    const actionLinks = screen.getAllByText('確認する →');
    expect(actionLinks).toHaveLength(5);
  });
});
