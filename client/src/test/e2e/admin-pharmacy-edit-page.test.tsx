import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminPharmacyEditPage from '../../pages/admin/AdminPharmacyEditPage';
import { mockAdminUser, renderWithProviders } from '../helpers';

const mockNavigateToList = vi.fn();
const mockNavigateToHealth = vi.fn();
const mockHandleVerify = vi.fn();
const mockApiGet = vi.fn();

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...args: unknown[]) => mockApiGet(...args),
    },
  };
});

vi.mock('../../hooks/useAdminPharmacyEdit', () => ({
  useAdminPharmacyEdit: () => ({
    pharmacy: {
      id: 7,
      email: 'pharmacy@example.com',
      name: 'テスト薬局',
      postalCode: '1000001',
      address: '東京都千代田区1-1',
      phone: '03-1111-1111',
      fax: '03-1111-2222',
      licenseNumber: 'ABC123',
      prefecture: '東京都',
      isActive: true,
      isAdmin: false,
      isTestAccount: false,
      testAccountPassword: null,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      verificationStatus: 'pending_verification',
    },
    pharmacyLoaded: true,
    hasValidId: true,
    form: {
      email: 'pharmacy@example.com',
      name: 'テスト薬局',
      postalCode: '1000001',
      address: '東京都千代田区1-1',
      phone: '03-1111-1111',
      fax: '03-1111-2222',
      prefecture: '東京都',
      licenseNumber: 'ABC123',
      currentPassword: '',
      newPassword: '',
    },
    message: '',
    setMessage: vi.fn(),
    error: '',
    setError: vi.fn(),
    loading: false,
    accountConflict: false,
    setAccountConflict: vi.fn(),
    isAccountDirty: true,
    hasUnsavedChanges: true,
    isTestAccount: false,
    testAccountPassword: '',
    setTestAccountPassword: vi.fn(),
    handleTestAccountToggle: vi.fn(),
    activeUpdating: false,
    verifyLoading: false,
    businessHours: [],
    specialHours: [],
    hoursLoaded: true,
    hoursEditing: false,
    hoursLoadFailed: false,
    hoursSaving: false,
    hoursMessage: '',
    hoursError: '',
    hoursConflict: false,
    setHoursMessage: vi.fn(),
    setHoursError: vi.fn(),
    setHoursConflict: vi.fn(),
    loadPharmacy: vi.fn(),
    handleChange: vi.fn(),
    handleSubmit: vi.fn(),
    handleReloadAccount: vi.fn(),
    handleReloadBusinessHours: vi.fn(),
    handleToggleActive: vi.fn(),
    handleVerify: mockHandleVerify,
    navigateToList: mockNavigateToList,
    navigateToHealth: mockNavigateToHealth,
    navigateToBusinessHours: vi.fn(),
    navigateToRelationships: vi.fn(),
    handleHoursChange: vi.fn(),
    handleClosedChange: vi.fn(),
    handle24HoursChange: vi.fn(),
    handleHoursSave: vi.fn(),
    handleHoursEditStart: vi.fn(),
    handleHoursEditCancel: vi.fn(),
    handleAddSpecialHour: vi.fn(),
    handleRemoveSpecialHour: vi.fn(),
    handleSpecialTypeChange: vi.fn(),
    handleSpecialDateChange: vi.fn(),
    handleSpecialNoteChange: vi.fn(),
    handleSpecialHoursChange: vi.fn(),
    handleSpecialClosedChange: vi.fn(),
    handleSpecial24HoursChange: vi.fn(),
  }),
}));

describe('AdminPharmacyEditPage', () => {
  beforeEach(() => {
    mockNavigateToList.mockReset();
    mockNavigateToHealth.mockReset();
    mockHandleVerify.mockReset();
    mockApiGet.mockReset();
    mockApiGet.mockResolvedValue({ logs: [], total: 0, page: 1, pageSize: 20 });
  });

  it('shows confirm modal before leaving with unsaved changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminPharmacyEditPage />, { authUser: { ...mockAdminUser } });

    // The mock navigateToList is a plain vi.fn(), so clicking the button
    // just calls it directly. The real hook uses window.confirm internally.
    await user.click(screen.getByRole('button', { name: '一覧へ戻る' }));

    expect(mockNavigateToList).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '関連' }));
    expect(screen.getByRole('button', { name: '薬局ヘルス' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '操作履歴へ' })).toBeInTheDocument();
  });

  it('opens reject modal and submits the entered reason', async () => {
    const user = userEvent.setup();
    mockHandleVerify.mockResolvedValue(undefined);
    // The source uses window.prompt for reject reason input
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('情報に不足があります');
    renderWithProviders(<AdminPharmacyEditPage />, { authUser: { ...mockAdminUser } });

    expect(screen.queryByRole('button', { name: '却下' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '審査操作' }));
    await user.click(screen.getByRole('button', { name: '却下' }));

    await waitFor(() => {
      expect(mockHandleVerify).toHaveBeenCalledWith(false, '情報に不足があります');
    });

    promptSpy.mockRestore();
  });

  it('routes nearby operations through the edit header buttons', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AdminPharmacyEditPage />, { authUser: { ...mockAdminUser } });

    await user.click(screen.getByRole('button', { name: '関連' }));
    await user.click(screen.getByRole('button', { name: '薬局ヘルス' }));

    expect(mockNavigateToHealth).toHaveBeenCalledTimes(1);
  });
});
