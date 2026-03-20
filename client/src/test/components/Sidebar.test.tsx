import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar from '../../components/Sidebar';

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: '管理者', isAdmin: true },
    logout: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../hooks/useAdminBadgeCounts', () => ({
  useAdminBadgeCounts: () => ({ pendingRequests: 0, reports: 0, alerts: 0 }),
}));

vi.mock('../../hooks/useUserBadgeCounts', () => ({
  useUserBadgeCounts: () => ({ proposals: 0, alerts: 0, groups: 0 }),
}));

describe('Sidebar', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('connects subgroup toggle buttons to controlled regions with aria-controls', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <Sidebar isOpen={false} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    // SubgroupHeader buttons use aria-expanded but not aria-controls
    const toggle = screen.getAllByRole('button', { expanded: true })[0];
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
