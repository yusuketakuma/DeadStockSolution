import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export interface ToastItem {
  id: string;
  variant: 'success' | 'danger' | 'warning' | 'info';
  message: string;
  autoDismissMs: number | null;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
}

interface ToastOptions {
  autoDismissMs?: number | null;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
}

interface ToastDataValue {
  toasts: ToastItem[];
  removeToast: (id: string) => void;
}

interface ToastActionsValue {
  showSuccess: (message: string, options?: ToastOptions) => void;
  showError: (message: string, options?: ToastOptions) => void;
  showWarning: (message: string, options?: ToastOptions) => void;
  showInfo: (message: string, options?: ToastOptions) => void;
}

const MAX_TOASTS = 5;

const ToastDataContext = createContext<ToastDataValue>({
  toasts: [],
  removeToast: () => {},
});

const ToastActionsContext = createContext<ToastActionsValue>({
  showSuccess: () => {},
  showError: () => {},
  showWarning: () => {},
  showInfo: () => {},
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((variant: ToastItem['variant'], message: string, options?: ToastOptions) => {
    const autoDismissMs = options?.autoDismissMs ?? (variant === 'danger' ? null : 3000);
    const toast: ToastItem = {
      id: crypto.randomUUID(),
      variant,
      message,
      autoDismissMs,
      actionLabel: options?.actionLabel,
      onAction: options?.onAction,
    };
    setToasts((prev) => {
      const next = [...prev, toast];
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
    });
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showSuccess = useCallback((message: string, options?: ToastOptions) => addToast('success', message, options), [addToast]);
  const showError = useCallback((message: string, options?: ToastOptions) => addToast('danger', message, options), [addToast]);
  const showWarning = useCallback((message: string, options?: ToastOptions) => addToast('warning', message, options), [addToast]);
  const showInfo = useCallback((message: string, options?: ToastOptions) => addToast('info', message, options), [addToast]);

  const dataValue = useMemo<ToastDataValue>(() => ({
    toasts, removeToast,
  }), [toasts, removeToast]);

  const actionsValue = useMemo<ToastActionsValue>(() => ({
    showSuccess, showError, showWarning, showInfo,
  }), [showSuccess, showError, showWarning, showInfo]);

  return (
    <ToastActionsContext.Provider value={actionsValue}>
      <ToastDataContext.Provider value={dataValue}>
        {children}
      </ToastDataContext.Provider>
    </ToastActionsContext.Provider>
  );
}

/** トーストのデータ（toasts 配列 + removeToast）。AppToastContainer 専用。 */
export function useToastData() {
  return useContext(ToastDataContext);
}

/** トースト表示アクション。toasts 配列の変更で再レンダリングされない。 */
export function useToast() {
  return useContext(ToastActionsContext);
}
