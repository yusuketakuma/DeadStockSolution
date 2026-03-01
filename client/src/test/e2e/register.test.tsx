import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegisterPage from '../../pages/RegisterPage';
import { renderWithProviders, mockUser } from '../helpers';

/** Find an input/select field by the label text in the same form group */
function getInputByLabel(labelText: string): HTMLInputElement | HTMLSelectElement {
  const labels = document.querySelectorAll('.form-label');
  for (const label of labels) {
    if (label.textContent?.includes(labelText)) {
      const group = label.closest('.mb-3') || label.parentElement;
      const input = group?.querySelector('input, select, textarea');
      if (input) return input as HTMLInputElement | HTMLSelectElement;
    }
  }
  throw new Error(`Could not find input for label: ${labelText}`);
}

function mockUnauthenticatedFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }));
}

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the registration form with all required fields', async () => {
    mockUnauthenticatedFetch();
    renderWithProviders(<RegisterPage />, { route: '/register' });

    await waitFor(() => {
      expect(screen.getByText('新規薬局登録')).toBeInTheDocument();
    });

    // Check labels exist
    expect(screen.getByText(/メールアドレス/)).toBeInTheDocument();
    expect(screen.getByText((content, element) => element?.tagName === 'LABEL' && /パスワード/.test(content))).toBeInTheDocument();
    expect(screen.getByText((content, element) => element?.tagName === 'LABEL' && content.trim() === '薬局名 *')).toBeInTheDocument();
    expect(screen.getByText(/薬局開設許可番号/)).toBeInTheDocument();
    expect(screen.getByText((content, element) => element?.tagName === 'LABEL' && content.trim() === '許可証記載の許可番号 *')).toBeInTheDocument();
    expect(screen.getByText((content, element) => element?.tagName === 'LABEL' && content.trim() === '許可証記載の薬局名 *')).toBeInTheDocument();
    expect(screen.getByText((content, element) => element?.tagName === 'LABEL' && content.trim() === '許可証記載の所在地 *')).toBeInTheDocument();
    expect(screen.getByText(/都道府県/)).toBeInTheDocument();
    expect(screen.getByText(/郵便番号/)).toBeInTheDocument();
    expect(screen.getByText((content, element) => element?.tagName === 'LABEL' && /住所/.test(content))).toBeInTheDocument();
    expect(screen.getByText(/電話番号/)).toBeInTheDocument();
    expect(screen.getByText(/FAX番号/)).toBeInTheDocument();

    // Check inputs exist with correct types
    expect(getInputByLabel('メールアドレス')).toHaveAttribute('type', 'email');
    expect(getInputByLabel('パスワード')).toHaveAttribute('type', 'password');
    expect(getInputByLabel('薬局名')).toHaveAttribute('type', 'text');
    expect(getInputByLabel('電話番号')).toHaveAttribute('type', 'tel');
    expect(getInputByLabel('FAX番号')).toHaveAttribute('type', 'tel');
  });

  it('has a disclaimer agreement checkbox', async () => {
    mockUnauthenticatedFetch();
    renderWithProviders(<RegisterPage />, { route: '/register' });

    await waitFor(() => {
      expect(screen.getByText(/本システムはあくまで業務補助ツール/)).toBeInTheDocument();
    });
  });

  it('disables submit button when disclaimer is not agreed', async () => {
    mockUnauthenticatedFetch();
    renderWithProviders(<RegisterPage />, { route: '/register' });

    await waitFor(() => {
      const submitButton = screen.getByRole('button', { name: '登録' });
      expect(submitButton).toBeDisabled();
    });
  });

  it('enables submit button when disclaimer is agreed', async () => {
    const user = userEvent.setup();
    mockUnauthenticatedFetch();
    renderWithProviders(<RegisterPage />, { route: '/register' });

    await waitFor(() => {
      expect(screen.getByText(/本システムはあくまで業務補助ツール/)).toBeInTheDocument();
    });

    const checkbox = screen.getByRole('checkbox');
    await user.click(checkbox);

    expect(screen.getByRole('button', { name: '登録' })).not.toBeDisabled();
  });

  it('submit button is disabled when disclaimer not agreed', async () => {
    mockUnauthenticatedFetch();
    renderWithProviders(<RegisterPage />, { route: '/register' });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '登録' })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: '登録' })).toBeDisabled();
  });

  it('submits registration form with correct data', async () => {
    const user = userEvent.setup();

    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/register')) {
        return new Response(JSON.stringify(mockUser), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<RegisterPage />, { route: '/register' });

    await waitFor(() => {
      expect(screen.getByText('新規薬局登録')).toBeInTheDocument();
    });

    await user.type(getInputByLabel('メールアドレス'), 'new@pharmacy.com');
    await user.type(getInputByLabel('パスワード'), 'securepass123');
    await user.type(getInputByLabel('薬局名'), '新規薬局');
    await user.type(getInputByLabel('薬局開設許可番号'), 'LIC-001');
    await user.type(getInputByLabel('許可証記載の許可番号'), 'LIC-001');
    await user.type(getInputByLabel('許可証記載の薬局名'), '新規薬局');
    await user.type(getInputByLabel('許可証記載の所在地'), '東京都千代田区1-1');

    // Select prefecture
    await user.selectOptions(getInputByLabel('都道府県') as HTMLSelectElement, '東京都');

    await user.type(getInputByLabel('郵便番号'), '1000001');
    await user.type(getInputByLabel('住所'), '東京都千代田区1-1');
    await user.type(getInputByLabel('電話番号'), '03-1234-5678');
    await user.type(getInputByLabel('FAX番号'), '03-1234-5679');

    // Agree to disclaimer
    await user.click(screen.getByRole('checkbox'));

    // Submit form
    await user.click(screen.getByRole('button', { name: '登録' }));

    await waitFor(() => {
      const registerCall = fetchMock.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('/api/auth/register')
      );
      expect(registerCall).toBeTruthy();
      const body = JSON.parse((registerCall![1] as RequestInit).body as string);
      expect(body.email).toBe('new@pharmacy.com');
      expect(body.name).toBe('新規薬局');
      expect(body.prefecture).toBe('東京都');
      expect(body.permitLicenseNumber).toBe('LIC-001');
      expect(body.permitPharmacyName).toBe('新規薬局');
    });
  });

  it('shows field validation errors from the server', async () => {
    const user = userEvent.setup();

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/auth/register')) {
        return new Response(JSON.stringify({
          error: '入力内容にエラーがあります',
          errors: [
            { field: 'email', message: 'このメールアドレスは既に登録されています' },
          ],
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    renderWithProviders(<RegisterPage />, { route: '/register' });

    await waitFor(() => {
      expect(screen.getByText('新規薬局登録')).toBeInTheDocument();
    });

    await user.type(getInputByLabel('メールアドレス'), 'existing@pharmacy.com');
    await user.type(getInputByLabel('パスワード'), 'securepass123');
    await user.type(getInputByLabel('薬局名'), '新規薬局');
    await user.type(getInputByLabel('薬局開設許可番号'), 'LIC-001');
    await user.type(getInputByLabel('許可証記載の許可番号'), 'LIC-001');
    await user.type(getInputByLabel('許可証記載の薬局名'), '新規薬局');
    await user.type(getInputByLabel('許可証記載の所在地'), '東京都千代田区1-1');
    await user.selectOptions(getInputByLabel('都道府県') as HTMLSelectElement, '東京都');
    await user.type(getInputByLabel('郵便番号'), '1000001');
    await user.type(getInputByLabel('住所'), '東京都千代田区1-1');
    await user.type(getInputByLabel('電話番号'), '03-1234-5678');
    await user.type(getInputByLabel('FAX番号'), '03-1234-5679');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '登録' }));

    await waitFor(() => {
      expect(screen.getByText('このメールアドレスは既に登録されています')).toBeInTheDocument();
    });
  });

  it('has a link to login page', async () => {
    mockUnauthenticatedFetch();
    renderWithProviders(<RegisterPage />, { route: '/register' });

    await waitFor(() => {
      const loginLink = screen.getByText('ログインはこちら');
      expect(loginLink).toBeInTheDocument();
      expect(loginLink.closest('a')).toHaveAttribute('href', '/login');
    });
  });

  it('renders all 47 prefectures in the dropdown', async () => {
    mockUnauthenticatedFetch();
    renderWithProviders(<RegisterPage />, { route: '/register' });

    await waitFor(() => {
      expect(screen.getByText('新規薬局登録')).toBeInTheDocument();
    });

    const select = getInputByLabel('都道府県') as HTMLSelectElement;
    // 47 prefectures + 1 placeholder option
    expect(select.options.length).toBe(48);
    expect(screen.getByText('北海道')).toBeInTheDocument();
    expect(screen.getByText('沖縄県')).toBeInTheDocument();
  });
});
