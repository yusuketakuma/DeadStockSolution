import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import AppBreadcrumb from '../../components/ui/AppBreadcrumb';
import { renderWithProviders } from '../helpers';

describe('AppBreadcrumb', () => {
  it('should render nothing when on root path (/)', () => {
    const { container } = renderWithProviders(<AppBreadcrumb />, { route: '/' });

    expect(container.firstChild).toBeNull();
  });

  it('should render breadcrumb chain for a detail page (/proposals/123)', () => {
    renderWithProviders(<AppBreadcrumb />, { route: '/proposals/123' });

    // "ホーム" should always be first
    expect(screen.getByText('ホーム')).toBeInTheDocument();
    // parent page
    expect(screen.getByText('マッチング一覧')).toBeInTheDocument();
    // current page
    expect(screen.getByText('提案詳細')).toBeInTheDocument();
  });

  it('should always show "ホーム" link as the first item', () => {
    renderWithProviders(<AppBreadcrumb />, { route: '/proposals/123' });

    const nav = screen.getByRole('navigation', { name: 'パンくずナビゲーション' });
    const links = nav.querySelectorAll('a, .breadcrumb-item');
    const firstItem = links[0];

    expect(firstItem.textContent).toContain('ホーム');
  });

  it('should render breadcrumb for a top-level page (/proposals)', () => {
    renderWithProviders(<AppBreadcrumb />, { route: '/proposals' });

    expect(screen.getByText('ホーム')).toBeInTheDocument();
    expect(screen.getByText('マッチング一覧')).toBeInTheDocument();
  });

  it('should render breadcrumb for a page with inferred parent (/inventory/dead-stock)', () => {
    renderWithProviders(<AppBreadcrumb />, { route: '/inventory/dead-stock' });

    expect(screen.getByText('ホーム')).toBeInTheDocument();
    // inferred parent from path '/inventory'
    expect(screen.getByText('在庫管理')).toBeInTheDocument();
    expect(screen.getByText('デッドストック')).toBeInTheDocument();
  });

  it('should render breadcrumb nav with aria-label', () => {
    renderWithProviders(<AppBreadcrumb />, { route: '/proposals' });

    expect(
      screen.getByRole('navigation', { name: 'パンくずナビゲーション' }),
    ).toBeInTheDocument();
  });

  it('should not render breadcrumb when path has no matching route meta', () => {
    const { container } = renderWithProviders(<AppBreadcrumb />, {
      route: '/no-such-route-xyz',
    });

    expect(container.firstChild).toBeNull();
  });

  it('should mark the last item as active (non-link)', () => {
    renderWithProviders(<AppBreadcrumb />, { route: '/proposals/123' });

    const nav = screen.getByRole('navigation', { name: 'パンくずナビゲーション' });
    // React Bootstrap renders active breadcrumb items without a link
    const activeItems = nav.querySelectorAll('.breadcrumb-item.active');
    expect(activeItems).toHaveLength(1);
    expect(activeItems[0].textContent).toContain('提案詳細');
  });

  it('should render "ホーム" as a link (not active) on detail pages', () => {
    renderWithProviders(<AppBreadcrumb />, { route: '/proposals/123' });

    const homeLink = screen.getByText('ホーム');
    // "ホーム" should not be in an active breadcrumb item
    expect(homeLink.closest('.breadcrumb-item')).not.toHaveClass('active');
  });
});
