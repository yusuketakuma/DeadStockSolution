import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMatchNotificationToast } from './useMatchNotificationToast';
import type { ReactNode } from 'react';

// Mock contexts
const mockShowInfo = vi.fn();
let mockUnreadCount = 0;

vi.mock('../contexts/ToastContext', () => ({
  useToast: () => ({
    toasts: [],
    showSuccess: vi.fn(),
    showError: vi.fn(),
    showWarning: vi.fn(),
    showInfo: mockShowInfo,
    removeToast: vi.fn(),
  }),
}));

vi.mock('../contexts/NotificationContext', () => ({
  useNotifications: () => ({
    unreadCount: mockUnreadCount,
    refreshCount: vi.fn(),
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

describe('useMatchNotificationToast', () => {
  it('should not show toast on initial render', () => {
    mockUnreadCount = 3;
    renderHook(() => useMatchNotificationToast(), { wrapper });
    expect(mockShowInfo).not.toHaveBeenCalled();
  });

  it('should show toast when unreadCount increases', () => {
    mockUnreadCount = 0;
    const { rerender } = renderHook(() => useMatchNotificationToast(), { wrapper });
    expect(mockShowInfo).not.toHaveBeenCalled();

    mockUnreadCount = 2;
    rerender();
    expect(mockShowInfo).toHaveBeenCalledWith('新しいマッチング候補が見つかりました');
  });

  it('should not show toast when unreadCount decreases', () => {
    mockUnreadCount = 5;
    const { rerender } = renderHook(() => useMatchNotificationToast(), { wrapper });
    mockShowInfo.mockClear();

    mockUnreadCount = 3;
    rerender();
    expect(mockShowInfo).not.toHaveBeenCalled();
  });
});
