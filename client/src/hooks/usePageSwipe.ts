import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { NAV_ITEMS } from '../components/layout/MobileBottomNav';

interface UsePageSwipeOptions {
  disabled?: boolean;
}

/** タブ間ページスワイプナビゲーション（モバイルのみ） */
export function usePageSwipe(
  containerRef: React.RefObject<HTMLElement | null>,
  options: UsePageSwipeOptions = {},
): void {
  const { disabled = false } = options;
  const location = useLocation();
  const navigate = useNavigate();

  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // Extract route paths from NAV_ITEMS
  const paths = NAV_ITEMS.map((item) => item.to);

  // Find current tab index based on location
  const getCurrentIndex = useCallback((): number => {
    const pathname = location.pathname;
    // Exact match first (for '/')
    const exactIdx = paths.findIndex((p) => p === pathname);
    if (exactIdx !== -1) return exactIdx;
    // Prefix match (for '/matching', '/proposals', etc.)
    const prefixIdx = paths.findIndex((p) => p !== '/' && pathname.startsWith(p));
    if (prefixIdx !== -1) return prefixIdx;
    return -1;
  }, [location.pathname, paths]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Mobile only: max-width 991.98px (lg breakpoint)
    const mql = window.matchMedia('(max-width: 991.98px)');
    if (!mql.matches) return;

    // prefers-reduced-motion check
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const SWIPE_THRESHOLD_PX = 120;
    const SWIPE_VELOCITY = 0.5; // px/ms
    const EDGE_MARGIN = 20;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let tracking = false;

    function shouldIgnore(e: TouchEvent): boolean {
      const touch = e.touches[0];
      if (!touch) return true;
      const target = e.target as HTMLElement | null;
      if (!target) return true;

      // 1. SwipeableListItem active
      if (target.closest('[data-swipe-active]')) return true;

      // 2. Horizontal scrollable container
      if (target.closest('.table-responsive') || target.closest('[style*="overflow-x: auto"]')) return true;
      // Also check computed style for overflow-x auto/scroll
      let node: HTMLElement | null = target;
      while (node && node !== el) {
        const style = window.getComputedStyle(node);
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') return true;
        node = node.parentElement;
      }

      // 3. Near screen edge
      if (touch.clientX < EDGE_MARGIN || touch.clientX > window.innerWidth - EDGE_MARGIN) return true;

      // 4. Bottom sheet / modal / offcanvas open
      if (document.querySelector('.bottom-sheet.open')) return true;
      if (document.querySelector('.modal.show, .offcanvas.show')) return true;

      // 5. Input focused
      const active = document.activeElement;
      if (active) {
        const tag = active.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      }

      return false;
    }

    function onTouchStart(e: Event) {
      if (disabledRef.current) return;
      const te = e as TouchEvent;
      if (shouldIgnore(te)) return;

      const touch = te.touches[0];
      if (!touch) return;

      startX = touch.clientX;
      startY = touch.clientY;
      startTime = Date.now();
      tracking = true;
    }

    function onTouchMove(e: Event) {
      if (!tracking) return;
      const te = e as TouchEvent;
      const touch = te.touches[0];
      if (!touch) return;

      // If vertical movement dominates, abandon tracking
      const dx = Math.abs(touch.clientX - startX);
      const dy = Math.abs(touch.clientY - startY);
      if (dy > dx && dy > 10) {
        tracking = false;
      }
    }

    function onTouchEnd(e: Event) {
      if (!tracking) return;
      tracking = false;

      const te = e as TouchEvent;
      const touch = te.changedTouches[0];
      if (!touch) return;

      const dx = touch.clientX - startX;
      const absDx = Math.abs(dx);
      const elapsed = Date.now() - startTime;
      const velocity = elapsed > 0 ? absDx / elapsed : 0;

      // Must exceed threshold by distance OR velocity
      if (absDx < SWIPE_THRESHOLD_PX && velocity < SWIPE_VELOCITY) return;

      const currentIndex = getCurrentIndex();
      if (currentIndex === -1) return;

      let targetIndex: number;
      if (dx < 0) {
        // Left swipe → next tab
        targetIndex = currentIndex + 1;
      } else {
        // Right swipe → previous tab
        targetIndex = currentIndex - 1;
      }

      // Bounds check
      if (targetIndex < 0 || targetIndex >= paths.length) return;

      // Navigate (skip animation if reduced motion)
      if (reducedMotion) {
        navigateRef.current(paths[targetIndex], { replace: true });
      } else {
        navigateRef.current(paths[targetIndex]);
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [containerRef, getCurrentIndex, paths]);
}
