import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import QuickJumpPalette, { type QuickJumpItem } from '../../components/header/QuickJumpPalette';
import { renderWithProviders } from '../helpers';

const routeItems: QuickJumpItem[] = [
  {
    id: 'route-upload',
    label: 'アップロード品質',
    to: '/upload-quality',
    section: '更新と確認',
    subtitle: 'アップロード',
  },
  {
    id: 'route-matching',
    label: 'マッチング一覧',
    to: '/proposals',
    section: '交換と対応',
    subtitle: 'マッチング',
  },
  {
    id: 'route-alerts',
    label: '通知センター',
    to: '/notifications',
    section: '通知と連絡',
    subtitle: 'ダッシュボード',
  },
];

describe('QuickJumpPalette', () => {
  it('groups route items by user-facing work sections when query is empty', () => {
    renderWithProviders(
      <QuickJumpPalette
        show
        onHide={vi.fn()}
        routes={routeItems}
        recentWork={[]}
        cases={[]}
        loadingCases={false}
      />,
    );

    expect(screen.getByText('画面を確認')).toBeInTheDocument();
    expect(screen.getByText('更新と確認')).toBeInTheDocument();
    expect(screen.getByText('交換と対応')).toBeInTheDocument();
    expect(screen.getByText('通知と連絡')).toBeInTheDocument();
  });

  it('switches to search-result mode when query is entered', async () => {
    renderWithProviders(
      <QuickJumpPalette
        show
        onHide={vi.fn()}
        routes={routeItems}
        recentWork={[]}
        cases={[]}
        loadingCases={false}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'クイックジャンプ検索' });
    fireEvent.change(input, { target: { value: '通知' } });

    expect(screen.getByText('一致する画面')).toBeInTheDocument();
    expect(screen.queryByText('通知と連絡')).not.toBeInTheDocument();
    expect(screen.getByText('通知センター')).toBeInTheDocument();
  });
});
