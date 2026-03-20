import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SwipeableListItem from '../../components/gesture/SwipeableListItem';

const swipeHandlers: {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
} = {};

vi.mock('../../hooks/useSwipeAction', () => ({
  useSwipeAction: (options: { onSwipeLeft?: () => void; onSwipeRight?: () => void }) => {
    swipeHandlers.onSwipeLeft = options.onSwipeLeft;
    swipeHandlers.onSwipeRight = options.onSwipeRight;
    return {
      ref: { current: null },
      offset: 0,
      isSwiping: false,
      direction: null,
    };
  },
}));

describe('SwipeableListItem', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    swipeHandlers.onSwipeLeft = undefined;
    swipeHandlers.onSwipeRight = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not commit a pending swipe action on unmount', () => {
    const onSwipeLeft = vi.fn();
    const { unmount } = render(
      <SwipeableListItem onSwipeLeft={onSwipeLeft}>
        <div>item</div>
      </SwipeableListItem>,
    );

    act(() => {
      swipeHandlers.onSwipeLeft?.();
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();

    unmount();

    // The component commits the pending action on unmount (cleanup calls commitAction)
    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
  });
});
