import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SearchChips from '../../components/search/SearchChips';

describe('SearchChips', () => {
  it('renders chips in a wrapped row without horizontal auto-scroll', () => {
    const { container } = render(
      <SearchChips
        tokens={['アセトアミノフェン', 'ロキソニン', 'メトホルミン']}
        onRemove={vi.fn()}
      />,
    );

    const chipRow = container.querySelector('div.d-flex.flex-wrap.gap-1');
    expect(chipRow).toBeInTheDocument();
    expect(chipRow).not.toHaveClass('overflow-auto');
    expect(screen.getByText('アセトアミノフェン')).toBeInTheDocument();
  });

  it('calls onRemove when a chip close button is clicked', () => {
    const onRemove = vi.fn();
    render(
      <SearchChips
        tokens={['ワルファリン']}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'ワルファリンを削除' }));
    expect(onRemove).toHaveBeenCalledWith('ワルファリン');
  });
});
