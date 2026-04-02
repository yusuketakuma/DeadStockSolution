import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import OpenClawHealthCard from '../../components/admin/openclaw/OpenClawHealthCard';

describe('OpenClawHealthCard', () => {
  it('masks the bootstrap token in the UI', () => {
    render(
      <OpenClawHealthCard
        health={null}
        ddsStatus={null}
        bootstrapToken={{
          token: '12345678-secret-9876',
          expiresAt: '2026-04-02T00:00:00.000Z',
          environment: 'preview',
          registerUrl: 'https://example.test/register',
          callbackUrl: 'https://example.test/callback',
          reportUrl: 'https://example.test/report',
          commandsUrl: 'https://example.test/commands',
          healthUrl: 'https://example.test/health',
        }}
        issuingBootstrapToken={false}
        rotatingControlToken={false}
        onIssueBootstrapToken={() => {}}
        onRotateControlToken={() => {}}
      />,
    );

    expect(screen.getByText('12345678...9876')).toBeInTheDocument();
    expect(screen.queryByText('12345678-secret-9876')).not.toBeInTheDocument();
  });

  it('swallows clipboard write failures when copying the bootstrap token', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('clipboard denied'));
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText,
      },
    });

    render(
      <OpenClawHealthCard
        health={null}
        ddsStatus={null}
        bootstrapToken={{
          token: '12345678-secret-9876',
          expiresAt: '2026-04-02T00:00:00.000Z',
          environment: 'preview',
          registerUrl: 'https://example.test/register',
          callbackUrl: 'https://example.test/callback',
          reportUrl: 'https://example.test/report',
          commandsUrl: 'https://example.test/commands',
          healthUrl: 'https://example.test/health',
        }}
        issuingBootstrapToken={false}
        rotatingControlToken={false}
        onIssueBootstrapToken={() => {}}
        onRotateControlToken={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'コピー' }));

    expect(writeText).toHaveBeenCalledWith('12345678-secret-9876');
  });
});
