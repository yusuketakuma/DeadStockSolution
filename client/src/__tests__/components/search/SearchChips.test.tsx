import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SearchChips from '../../../components/search/SearchChips';

describe('SearchChips', () => {
  it('renders tokens as badges', () => {
    render(<SearchChips tokens={['アムロジピン', 'ファイザー']} onRemove={vi.fn()} />);

    expect(screen.getByText('アムロジピン')).toBeInTheDocument();
    expect(screen.getByText('ファイザー')).toBeInTheDocument();
  });

  it('calls onRemove with token when close button is clicked', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<SearchChips tokens={['アムロジピン', 'ファイザー']} onRemove={onRemove} />);

    const closeButtons = screen.getAllByRole('button', { name: /削除/ });
    await user.click(closeButtons[0]);

    expect(onRemove).toHaveBeenCalledWith('アムロジピン');
  });

  it('renders nothing when tokens is empty', () => {
    const { container } = render(<SearchChips tokens={[]} onRemove={vi.fn()} />);

    expect(container.innerHTML).toBe('');
  });

  it('shows warning when maxTokenWarning is true', () => {
    render(
      <SearchChips tokens={['a', 'b', 'c', 'd', 'e']} onRemove={vi.fn()} maxTokenWarning />,
    );

    expect(screen.getByText('最大5キーワードまで検索できます')).toBeInTheDocument();
  });
});
