import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SWUpdateBanner from '../../components/pwa/SWUpdateBanner';

const mockUpdateSW = vi.fn();

vi.mock('../../hooks/useSWUpdate', () => ({
  useSWUpdate: vi.fn(() => ({
    needsUpdate: false,
    isUpdating: false,
    updateSW: mockUpdateSW,
  })),
}));

import { useSWUpdate } from '../../hooks/useSWUpdate';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SWUpdateBanner', () => {
  it('renders nothing when no update', () => {
    const { container } = render(<SWUpdateBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('shows update banner when needsUpdate is true', () => {
    vi.mocked(useSWUpdate).mockReturnValue({
      needsUpdate: true,
      isUpdating: false,
      updateSW: mockUpdateSW,
    });

    render(<SWUpdateBanner />);
    expect(screen.getByText('新しいバージョンがあります。更新しますか？')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更新する' })).toBeInTheDocument();
  });

  it('calls updateSW when button clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(useSWUpdate).mockReturnValue({
      needsUpdate: true,
      isUpdating: false,
      updateSW: mockUpdateSW,
    });

    render(<SWUpdateBanner />);
    await user.click(screen.getByRole('button', { name: '更新する' }));
    expect(mockUpdateSW).toHaveBeenCalledOnce();
  });
});
