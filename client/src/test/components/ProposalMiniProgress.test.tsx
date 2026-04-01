import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProposalMiniProgress } from '../../components/proposal/ProposalMiniProgress';

describe('ProposalMiniProgress', () => {
  it('renders with phaseIndex 1 (negotiating)', () => {
    render(<ProposalMiniProgress phaseIndex={1} isTerminalPhase={false} actionRequired={false} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '33');
  });

  it('renders with phaseIndex 2 (confirmed)', () => {
    render(<ProposalMiniProgress phaseIndex={2} isTerminalPhase={false} actionRequired={false} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '66');
  });

  it('renders with phaseIndex 3 (completed)', () => {
    render(<ProposalMiniProgress phaseIndex={3} isTerminalPhase={false} actionRequired={false} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('renders grey when terminal phase', () => {
    const { container } = render(<ProposalMiniProgress phaseIndex={-1} isTerminalPhase={true} actionRequired={false} />);
    const bar = container.querySelector('.progress-bar');
    expect(bar?.className).toContain('bg-secondary');
  });

  it('shows action-required indicator dot', () => {
    render(<ProposalMiniProgress phaseIndex={1} isTerminalPhase={false} actionRequired={true} />);
    expect(screen.getByLabelText('アクション必要')).toBeInTheDocument();
  });

  it('does not show action-required dot when not required', () => {
    render(<ProposalMiniProgress phaseIndex={1} isTerminalPhase={false} actionRequired={false} />);
    expect(screen.queryByLabelText('アクション必要')).not.toBeInTheDocument();
  });
});
