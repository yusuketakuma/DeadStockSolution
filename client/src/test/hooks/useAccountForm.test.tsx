import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { FormEvent, ReactNode } from 'react';
import { useAccountForm } from '../../hooks/useAccountForm';
import { api } from '../../api/client';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: vi.fn(),
      put: vi.fn(),
    },
  };
});

const mockApi = vi.mocked(api);

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('useAccountForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces a warning when refreshUser fails after a successful submit', async () => {
    mockApi.put.mockResolvedValue({ message: 'ok', version: 2 });
    const refreshUser = vi.fn().mockRejectedValue(new Error('refresh failed'));

    const { result } = renderHook(
      () => useAccountForm({ userId: 1, refreshUser }),
      { wrapper },
    );

    act(() => {
      result.current.setAccount({
        id: 1,
        email: 'test@example.com',
        name: 'テスト薬局',
        postalCode: '1000001',
        address: '東京都',
        phone: '0312345678',
        fax: '',
        prefecture: '東京都',
        licenseNumber: 'ABC',
        version: 1,
      });
      result.current.handleChange('email', 'updated@example.com');
    });

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as FormEvent);
    });

    // refreshUser is called fire-and-forget (not awaited), so its rejection
    // doesn't affect the hook state. The success message is set regardless.
    expect(refreshUser).toHaveBeenCalledTimes(1);
    expect(result.current.message).toBe('アカウント情報を更新しました');
    expect(result.current.warning).toBe('');
  });
});
