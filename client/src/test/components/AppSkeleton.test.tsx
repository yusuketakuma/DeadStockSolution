import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import AppSkeleton from '../../components/ui/AppSkeleton';
import { renderWithProviders } from '../helpers';

describe('AppSkeleton', () => {
  describe('text variant', () => {
    it('should render default 3 lines', () => {
      const { container } = renderWithProviders(<AppSkeleton variant="text" />);

      const skeletonLines = container.querySelectorAll('.dl-skeleton-text');
      expect(skeletonLines).toHaveLength(3);
    });

    it('should render specified number of lines', () => {
      const { container } = renderWithProviders(<AppSkeleton variant="text" lines={5} />);

      const skeletonLines = container.querySelectorAll('.dl-skeleton-text');
      expect(skeletonLines).toHaveLength(5);
    });

    it('should have role="status" and aria-busy="true"', () => {
      renderWithProviders(<AppSkeleton variant="text" />);

      const statusEl = screen.getByRole('status');
      expect(statusEl).toBeInTheDocument();
      expect(statusEl).toHaveAttribute('aria-busy', 'true');
    });

    it('should use default aria-label when label is not provided', () => {
      renderWithProviders(<AppSkeleton variant="text" />);

      expect(screen.getByRole('status')).toHaveAttribute('aria-label', '読み込み中');
    });

    it('should use custom aria-label when label is provided', () => {
      renderWithProviders(<AppSkeleton variant="text" label="ユーザー情報を読み込み中" />);

      expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'ユーザー情報を読み込み中');
    });
  });

  describe('table variant', () => {
    it('should render rows x cols cells by default (5 rows x 4 cols)', () => {
      const { container } = renderWithProviders(<AppSkeleton variant="table" />);

      const cells = container.querySelectorAll('td');
      expect(cells).toHaveLength(20); // 5 * 4
    });

    it('should render specified rows x cols cells', () => {
      const { container } = renderWithProviders(
        <AppSkeleton variant="table" rows={3} cols={2} />,
      );

      const cells = container.querySelectorAll('td');
      expect(cells).toHaveLength(6); // 3 * 2
    });

    it('should render correct number of header columns', () => {
      const { container } = renderWithProviders(
        <AppSkeleton variant="table" rows={3} cols={6} />,
      );

      const headerCells = container.querySelectorAll('thead th');
      expect(headerCells).toHaveLength(6);
    });

    it('should have role="status" and aria-busy="true"', () => {
      renderWithProviders(<AppSkeleton variant="table" />);

      const statusEl = screen.getByRole('status');
      expect(statusEl).toBeInTheDocument();
      expect(statusEl).toHaveAttribute('aria-busy', 'true');
    });
  });

  describe('card variant', () => {
    it('should render card skeleton', () => {
      const { container } = renderWithProviders(<AppSkeleton variant="card" />);

      expect(container.querySelector('.dl-skeleton-card')).toBeInTheDocument();
    });

    it('should have role="status" and aria-busy="true"', () => {
      renderWithProviders(<AppSkeleton variant="card" />);

      const statusEl = screen.getByRole('status');
      expect(statusEl).toBeInTheDocument();
      expect(statusEl).toHaveAttribute('aria-busy', 'true');
    });
  });

  describe('circle variant', () => {
    it('should render circle skeleton', () => {
      const { container } = renderWithProviders(<AppSkeleton variant="circle" />);

      expect(container.querySelector('.dl-skeleton-circle')).toBeInTheDocument();
    });

    it('should have role="status" and aria-busy="true"', () => {
      // CircleSkeleton without a label sets aria-hidden="true", so use { hidden: true }
      renderWithProviders(<AppSkeleton variant="circle" />);

      const statusEl = screen.getByRole('status', { hidden: true });
      expect(statusEl).toBeInTheDocument();
      expect(statusEl).toHaveAttribute('aria-busy', 'true');
    });

    it('should be accessible (role="status" visible) when label is provided', () => {
      renderWithProviders(<AppSkeleton variant="circle" label="アバター読み込み中" />);

      const statusEl = screen.getByRole('status');
      expect(statusEl).toBeInTheDocument();
      expect(statusEl).toHaveAttribute('aria-busy', 'true');
      expect(statusEl).toHaveAttribute('aria-label', 'アバター読み込み中');
    });
  });

  describe('accessibility', () => {
    it.each(['text', 'card', 'table'] as const)(
      'should have role="status" on %s variant',
      (variant) => {
        renderWithProviders(<AppSkeleton variant={variant} />);
        expect(screen.getByRole('status')).toBeInTheDocument();
      },
    );

    it('should include visually-hidden loading text for screen readers on text variant', () => {
      renderWithProviders(<AppSkeleton variant="text" />);

      // visually-hidden span contains the label text
      const hiddenSpan = screen.getByText('読み込み中');
      expect(hiddenSpan).toHaveClass('visually-hidden');
    });
  });
});
