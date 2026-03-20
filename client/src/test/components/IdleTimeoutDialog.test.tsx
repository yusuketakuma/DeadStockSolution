import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IdleTimeoutDialog from '../../components/IdleTimeoutDialog';

describe('IdleTimeoutDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('restarts countdown from the latest remainingSeconds value', () => {
    const { rerender } = render(
      <IdleTimeoutDialog
        show
        remainingSeconds={10}
        onExtend={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText(/8秒後/)).toBeInTheDocument();

    rerender(
      <IdleTimeoutDialog
        show
        remainingSeconds={30}
        onExtend={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    expect(screen.getByText(/30秒後/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/29秒後/)).toBeInTheDocument();
  });
});
