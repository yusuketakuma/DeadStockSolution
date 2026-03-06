import { useState, useEffect } from 'react';
import { Form } from 'react-bootstrap';
import AppAlert from '../components/ui/AppAlert';
import AppButton from '../components/ui/AppButton';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import { useNavigate } from 'react-router-dom';
import ConfirmActionModal from '../components/ConfirmActionModal';
import ConflictAlert from '../components/ConflictAlert';
import DraftRestoreAlert from '../components/DraftRestoreAlert';
import AccountInfoForm from '../components/account/AccountInfoForm';
import BusinessHoursSettings from '../components/account/BusinessHoursSettings';
import WithdrawSection from '../components/account/WithdrawSection';
import AppDataPanel from '../components/ui/AppDataPanel';
import InlineLoader from '../components/ui/InlineLoader';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import { useAccountForm } from '../hooks/useAccountForm';
import { useBusinessHoursForm } from '../hooks/useBusinessHoursForm';
import { useNotificationSettings } from '../hooks/useNotificationSettings';

export default function AccountPage() {
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();

  // --- Account form hook ---
  const accountForm = useAccountForm({ userId: user?.id, refreshUser });

  // --- Business hours hook ---
  const hoursForm = useBusinessHoursForm({ userId: user?.id });

  // --- Notification settings hook ---
  const notification = useNotificationSettings({
    account: accountForm.account,
    setAccount: accountForm.setAccount,
    applyLatestAccountData: accountForm.applyLatestAccountData,
    setError: accountForm.setError,
    setAccountConflict: accountForm.setAccountConflict,
  });

  // --- Withdraw (inline, small enough) ---
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawPassword, setWithdrawPassword] = useState('');
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);

  const handleWithdraw = () => {
    if (!withdrawPassword) {
      accountForm.setError('退会には現在のパスワードが必要です');
      return;
    }
    setShowWithdrawConfirm(true);
  };

  const handleWithdrawConfirmed = async () => {
    setShowWithdrawConfirm(false);
    setWithdrawing(true);
    accountForm.setError('');
    accountForm.setMessage('');
    try {
      await api.delete<{ message: string }>('/account', { currentPassword: withdrawPassword });
      setWithdrawPassword('');
      await logout();
      navigate('/login');
    } catch (err) {
      accountForm.setError(err instanceof Error ? err.message : '退会処理に失敗しました');
    } finally {
      setWithdrawing(false);
    }
  };

  // --- Initial data load ---
  useEffect(() => {
    accountForm.initialLoadAbortRef.current?.abort();
    const controller = new AbortController();
    accountForm.initialLoadAbortRef.current = controller;
    void Promise.all([
      accountForm.loadAccount(controller.signal),
      hoursForm.loadBusinessHours(controller.signal),
    ]);
    return () => {
      controller.abort();
      if (accountForm.initialLoadAbortRef.current === controller) {
        accountForm.initialLoadAbortRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountForm.loadAccount, hoursForm.loadBusinessHours]);

  // --- Render ---
  if (!accountForm.accountLoaded) {
    return (
      <InlineLoader text="アカウント情報を読み込み中..." className="text-muted small" />
    );
  }

  if (!accountForm.account) {
    return (
      <PageShell>
        <h4 className="page-title mb-3">薬局登録情報の編集</h4>
        {accountForm.error && <AppAlert variant="danger">{accountForm.error}</AppAlert>}
        <AppButton variant="outline-secondary" onClick={() => void accountForm.loadAccount()}>
          再読み込み
        </AppButton>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <h4 className="page-title mb-3">薬局登録情報の編集</h4>
      {accountForm.message && <AppAlert variant="success" onClose={() => accountForm.setMessage('')} dismissible>{accountForm.message}</AppAlert>}
      {accountForm.warning && <AppAlert variant="warning" onClose={() => accountForm.setWarning('')} dismissible>{accountForm.warning}</AppAlert>}
      {accountForm.error && <AppAlert variant="danger" onClose={() => accountForm.setError('')} dismissible>{accountForm.error}</AppAlert>}

      <ScrollArea>
      <ConflictAlert
        show={accountForm.accountConflict}
        onReload={accountForm.handleReloadAccount}
        onDismiss={() => accountForm.setAccountConflict(false)}
        message="他のデバイスまたはタブでアカウント情報が更新されました。最新のデータを読み込みました。内容を確認してから再度保存してください。"
      />

      {accountForm.accountAutoSave.hasDraft && (
        <DraftRestoreAlert
          draftTimestamp={accountForm.accountAutoSave.draftTimestamp}
          onRestore={accountForm.handleAccountDraftRestore}
          onDiscard={accountForm.handleAccountDraftDiscard}
        />
      )}

      <AccountInfoForm
        form={accountForm.form}
        loading={accountForm.loading}
        submitDisabled={!accountForm.isAccountDirty}
        onSubmit={accountForm.handleSubmit}
        onChange={accountForm.handleChange}
      />

      <AppDataPanel title="通知設定" className="mb-3">
        <Form.Check
          type="switch"
          id="matching-auto-notify"
          label="マッチング候補更新の自動通知"
          checked={notification.matchingAutoNotify}
          disabled={notification.notifySaving}
          onChange={notification.handleNotifyToggle}
        />
        <Form.Text className="text-muted">
          他薬局のアップロードでマッチング候補が更新された時に通知を受け取ります。
        </Form.Text>
      </AppDataPanel>

      <ConflictAlert
        show={hoursForm.hoursConflict}
        onReload={hoursForm.handleReloadBusinessHours}
        onDismiss={() => hoursForm.setHoursConflict(false)}
        message="他のデバイスまたはタブで営業時間が更新されました。最新のデータを読み込みました。内容を確認してから再度保存してください。"
      />

      {hoursForm.hoursAutoSave.hasDraft && (
        <DraftRestoreAlert
          draftTimestamp={hoursForm.hoursAutoSave.draftTimestamp}
          onRestore={hoursForm.handleHoursDraftRestore}
          onDiscard={hoursForm.handleHoursDraftDiscard}
        />
      )}

      <BusinessHoursSettings
        businessHours={hoursForm.businessHours}
        specialHours={hoursForm.specialHours}
        hoursLoaded={hoursForm.hoursLoaded}
        hoursEditing={hoursForm.hoursEditing}
        hoursEditable={!hoursForm.hoursLoadFailed}
        hoursSaving={hoursForm.hoursSaving}
        hoursMessage={hoursForm.hoursMessage}
        hoursError={hoursForm.hoursError}
        onRetryLoad={() => void hoursForm.handleReloadBusinessHours()}
        onHoursMessage={hoursForm.setHoursMessage}
        onHoursError={hoursForm.setHoursError}
        onHoursChange={hoursForm.handleHoursChange}
        onClosedChange={hoursForm.handleClosedChange}
        on24HoursChange={hoursForm.handle24HoursChange}
        onHoursSave={hoursForm.handleHoursSave}
        onHoursEditStart={hoursForm.handleHoursEditStart}
        onHoursEditCancel={hoursForm.handleHoursEditCancel}
        onAddSpecialHour={hoursForm.handleAddSpecialHour}
        onRemoveSpecialHour={hoursForm.handleRemoveSpecialHour}
        onSpecialTypeChange={hoursForm.handleSpecialTypeChange}
        onSpecialDateChange={hoursForm.handleSpecialDateChange}
        onSpecialNoteChange={hoursForm.handleSpecialNoteChange}
        onSpecialHoursChange={hoursForm.handleSpecialHoursChange}
        onSpecialClosedChange={hoursForm.handleSpecialClosedChange}
        onSpecial24HoursChange={hoursForm.handleSpecial24HoursChange}
      />

      <WithdrawSection
        withdrawPassword={withdrawPassword}
        withdrawing={withdrawing}
        onPasswordChange={setWithdrawPassword}
        onWithdraw={handleWithdraw}
      />
      </ScrollArea>

      <ConfirmActionModal
        show={showWithdrawConfirm}
        title="退会の確認"
        body="退会するとアカウントは無効化され、現在のセッションは終了します。実行してよろしいですか？"
        confirmLabel="退会する"
        confirmVariant="danger"
        onCancel={() => setShowWithdrawConfirm(false)}
        onConfirm={handleWithdrawConfirmed}
        pending={withdrawing}
      />
    </PageShell>
  );
}
