import { useEffect, useRef, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface BaseBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  ariaLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxHeight?: string;
}

export default function BaseBottomSheet({
  isOpen,
  onClose,
  title,
  ariaLabel,
  children,
  footer,
  maxHeight,
}: BaseBottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      document.addEventListener('keydown', handleKeyDown);
      // Focus the sheet for accessibility
      requestAnimationFrame(() => {
        sheetRef.current?.focus();
      });
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
    // Restore focus on close
    previousFocusRef.current?.focus();
    return;
  }, [isOpen, handleKeyDown]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
    return;
  }, [isOpen]);

  const sheetStyle = maxHeight ? { maxHeight } : undefined;

  return createPortal(
    <>
      <div
        className={`bottom-sheet-backdrop${isOpen ? ' open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        className={`bottom-sheet${isOpen ? ' open' : ''}`}
        style={sheetStyle}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
        tabIndex={-1}
      >
        <div className="bottom-sheet-handle" />
        <div className="bottom-sheet-header">
          <h2 className="bottom-sheet-header-title">{title}</h2>
          <button
            className="bottom-sheet-close"
            onClick={onClose}
            aria-label="閉じる"
            type="button"
          >
            &times;
          </button>
        </div>
        <div className="bottom-sheet-content">{children}</div>
        {footer && <div className="bottom-sheet-footer">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}
