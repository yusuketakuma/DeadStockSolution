import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InstallPromptBanner from '../../components/pwa/InstallPromptBanner';

beforeEach(() => {
  vi.clearAllMocks();
  try { window.localStorage.clear(); } catch { /* ignore */ }
});

afterEach(() => {
  try { window.localStorage.clear(); } catch { /* ignore */ }
});

describe('InstallPromptBanner', () => {
  it('renders nothing initially (no beforeinstallprompt)', () => {
    const { container } = render(<InstallPromptBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('shows banner after beforeinstallprompt event', async () => {
    render(<InstallPromptBanner />);

    act(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.assign(event, {
        prompt: vi.fn().mockResolvedValue(undefined),
        userChoice: Promise.resolve({ outcome: 'dismissed' }),
      });
      window.dispatchEvent(event);
    });

    expect(screen.getByText('ホーム画面に追加して素早くアクセスできます。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ホーム画面に追加' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'あとで' })).toBeInTheDocument();
  });

  it('hides banner and sets snooze on "あとで" click', async () => {
    const user = userEvent.setup();
    render(<InstallPromptBanner />);

    act(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.assign(event, {
        prompt: vi.fn().mockResolvedValue(undefined),
        userChoice: Promise.resolve({ outcome: 'dismissed' }),
      });
      window.dispatchEvent(event);
    });

    await user.click(screen.getByRole('button', { name: 'あとで' }));

    expect(screen.queryByText('ホーム画面に追加して素早くアクセスできます。')).not.toBeInTheDocument();

    const snoozed = window.localStorage.getItem('installPromptSnoozed');
    expect(snoozed).toBeTruthy();
    expect(Number(snoozed)).toBeGreaterThan(0);
  });

  it('does not show banner when snoozed recently', () => {
    // Set snooze to now
    window.localStorage.setItem('installPromptSnoozed', Date.now().toString());

    render(<InstallPromptBanner />);

    // Even after dispatching event, should not show
    act(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.assign(event, {
        prompt: vi.fn().mockResolvedValue(undefined),
        userChoice: Promise.resolve({ outcome: 'dismissed' }),
      });
      window.dispatchEvent(event);
    });

    expect(screen.queryByText('ホーム画面に追加して素早くアクセスできます。')).not.toBeInTheDocument();
  });

  it('shows banner when snooze expired (>7 days)', () => {
    // Set snooze to 8 days ago
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    window.localStorage.setItem('installPromptSnoozed', eightDaysAgo.toString());

    render(<InstallPromptBanner />);

    act(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.assign(event, {
        prompt: vi.fn().mockResolvedValue(undefined),
        userChoice: Promise.resolve({ outcome: 'dismissed' }),
      });
      window.dispatchEvent(event);
    });

    expect(screen.getByText('ホーム画面に追加して素早くアクセスできます。')).toBeInTheDocument();
  });

  it('calls prompt on install click', async () => {
    const user = userEvent.setup();
    const mockPrompt = vi.fn().mockResolvedValue(undefined);

    render(<InstallPromptBanner />);

    act(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.assign(event, {
        prompt: mockPrompt,
        userChoice: Promise.resolve({ outcome: 'accepted' }),
      });
      window.dispatchEvent(event);
    });

    await user.click(screen.getByRole('button', { name: 'ホーム画面に追加' }));

    expect(mockPrompt).toHaveBeenCalled();
  });
});
