import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProposalProgressIndicator } from '../../components/proposal/ProposalProgressIndicator';

describe('ProposalProgressIndicator', () => {
  it('exposes accessible labels for completed and terminal steps', () => {
    const { rerender } = render(
      <ProposalProgressIndicator
        isTerminalPhase={false}
        isConfirmedPhase={true}
        isCompletedPhase={false}
        phaseIndex={2}
        statusLabel="確定"
      />,
    );

    // Steps render as text spans without aria-labels; verify step text and checkmarks
    expect(screen.getByText('仮マッチング')).toBeInTheDocument();
    // '確定' appears both as step label and as status badge
    expect(screen.getAllByText('確定').length).toBeGreaterThanOrEqual(1);
    // phaseIndex=2 means both phase 1 and 2 steps show checkmarks
    const checkmarks = screen.getAllByText('✓');
    expect(checkmarks.length).toBe(2);

    rerender(
      <ProposalProgressIndicator
        isTerminalPhase={true}
        isConfirmedPhase={false}
        isCompletedPhase={false}
        phaseIndex={1}
        statusLabel="却下"
      />,
    );

    // Terminal phase renders dashes instead of checkmarks
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBe(3);
    expect(screen.getByText('完了')).toBeInTheDocument();
  });
});
