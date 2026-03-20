import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SearchInput from '../../components/SearchInput';
import { api } from '../../api/client';

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn(),
    },
  };
});

describe('SearchInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('does not flash stale suggestions after the query changes', async () => {
    const pendingResolvers: Array<(value: string[]) => void> = [];

    vi.mocked(api.get).mockImplementation(() => new Promise((resolve) => {
      pendingResolvers.push(resolve);
    }));

    const onChange = vi.fn();

    const { rerender } = render(
      <SearchInput
        value="asp"
        onChange={onChange}
        onSearch={vi.fn()}
        suggestUrl="/search"
      />,
    );

    act(() => {
      vi.advanceTimersByTime(300);
    });

    await act(async () => {
      pendingResolvers[0](['aspirin']);
    });
    expect(screen.getByRole('option', { name: 'aspirin' })).toBeInTheDocument();

    rerender(
      <SearchInput
        value="ibu"
        onChange={onChange}
        onSearch={vi.fn()}
        suggestUrl="/search"
      />,
    );

    expect(screen.queryByRole('option', { name: 'aspirin' })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(300);
    });

    await act(async () => {
      pendingResolvers[1](['ibuprofen']);
    });
    expect(screen.getByRole('option', { name: 'ibuprofen' })).toBeInTheDocument();
  });
});
