import { useState, useEffect } from 'react';
import { Badge, Form, Table } from 'react-bootstrap';
import AppAlert from '../../components/ui/AppAlert';
import AppButton from '../../components/ui/AppButton';
import AppDataPanel from '../../components/ui/AppDataPanel';
import AppField from '../../components/ui/AppField';
import ConflictAlert from '../../components/ConflictAlert';
import InlineLoader from '../../components/ui/InlineLoader';
import AccountInfoForm from '../../components/account/AccountInfoForm';
import BusinessHoursSettings from '../../components/account/BusinessHoursSettings';
import { formatDateTimeJa } from '../../utils/formatters';
import { api } from '../../api/client';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import { useAdminPharmacyEdit } from '../../hooks/useAdminPharmacyEdit';


interface AuditLogEntry {
  id: number;
  adminId: number;
  targetPharmacyId: number;
  action: 'verify' | 'reject' | 're-review';
  previousStatus: string | null;
  newStatus: string;
  reason: string | null;
  createdAt: string;
}

interface AuditLogsResponse {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

function formatAction(action: AuditLogEntry['action']): string {
  switch (action) {
    case 'verify':
      return '承認';
    case 'reject':
      return '拒否';
    case 're-review':
      return '再審査';
    default:
      return action;
  }
}

export default function AdminPharmacyEditPage() {
  const {
    pharmacy, pharmacyLoaded, hasValidId,
    form, message, setMessage, error, setError, loading,
    accountConflict, setAccountConflict, isAccountDirty,
    isTestAccount, testAccountPassword, setTestAccountPassword, handleTestAccountToggle,
    activeUpdating, verifyLoading,
    businessHours, specialHours, hoursLoaded, hoursEditing, hoursLoadFailed,
    hoursSaving, hoursMessage, hoursError, hoursConflict,
    setHoursMessage, setHoursError, setHoursConflict,
    loadPharmacy, handleChange, handleSubmit,
    handleReloadAccount, handleReloadBusinessHours,
    handleToggleActive, handleVerify, navigateToList,
    handleHoursChange, handleClosedChange, handle24HoursChange,
    handleHoursSave, handleHoursEditStart, handleHoursEditCancel,
    handleAddSpecialHour, handleRemoveSpecialHour,
    handleSpecialTypeChange, handleSpecialDateChange, handleSpecialNoteChange,
    handleSpecialHoursChange, handleSpecialClosedChange, handleSpecial24HoursChange,
  } = useAdminPharmacyEdit();

  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditLogsLoading, setAuditLogsLoading] = useState(false);
  const [auditLogsError, setAuditLogsError] = useState('');

  useEffect(() => {
    if (!pharmacy?.id) return;
    const controller = new AbortController();
    const loadAuditLogs = async () => {
      setAuditLogsLoading(true);
      setAuditLogsError('');
      try {
        const response = await api.get<AuditLogsResponse>(
          `/admin/pharmacies/${pharmacy.id}/audit-logs`,
          { signal: controller.signal }
        );
        if (!controller.signal.aborted) {
          setAuditLogs(response.logs);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setAuditLogsError(err instanceof Error ? err.message : '監査ログの取得に失敗しました');
        }
      } finally {
        if (!controller.signal.aborted) {
          setAuditLogsLoading(false);
        }
      }
    };
    void loadAuditLogs();
    return () => controller.abort();
  }, [pharmacy?.id]);

  if (!pharmacyLoaded) {
    return <InlineLoader text="薬局情報を読み込み中..." className="text-muted small" />;
  }

  if (!pharmacy || !hasValidId) {
    return (
      <div>
        <h4 className="page-title mb-3">薬局情報編集</h4>
        {error && <AppAlert variant="danger">{error}</AppAlert>}
        <div className="d-flex gap-2">
          <AppButton variant="outline-secondary" onClick={navigateToList}>一覧へ戻る</AppButton>
          <AppButton variant="outline-primary" onClick={() => void loadPharmacy()}>再読み込み</AppButton>
        </div>
      </div>
    );
  }

  return (
    <PageShell>
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <h4 className="page-title mb-0">薬局情報編集（ID: {pharmacy.id}）</h4>
        <AppButton size="sm" variant="outline-secondary" onClick={navigateToList}>
          一覧へ戻る
        </AppButton>
      </div>
      <ScrollArea>
      {message && <AppAlert variant="success" onClose={() => setMessage('')} dismissible>{message}</AppAlert>}
      {error && <AppAlert variant="danger" onClose={() => setError('')} dismissible>{error}</AppAlert>}

      {pharmacy.verificationStatus === 'pending_verification' && (
        <AppAlert variant="warning" className="mb-3">
          <div className="d-flex align-items-center justify-content-between">
            <span>この薬局は審査中です</span>
            <div className="d-flex gap-2">
              <AppButton
                size="sm"
                variant="success"
                onClick={() => void handleVerify(true)}
                disabled={verifyLoading}
              >
                承認
              </AppButton>
              <AppButton
                size="sm"
                variant="danger"
                onClick={() => {
                  const reason = window.prompt('却下理由を入力してください:');
                  if (reason !== null) void handleVerify(false, reason);
                }}
                disabled={verifyLoading}
              >
                却下
              </AppButton>
            </div>
          </div>
        </AppAlert>
      )}

      <AppDataPanel className="mb-3">
        <div className="d-flex flex-wrap align-items-center gap-2">
          <span>アカウント種別:</span>
          <Badge bg={pharmacy.isAdmin ? 'danger' : 'secondary'}>
            {pharmacy.isAdmin ? '管理者' : '薬局ユーザー'}
          </Badge>
          <Badge bg={pharmacy.isActive ? 'success' : 'secondary'}>
            {pharmacy.isActive ? '有効' : '無効'}
          </Badge>
          {isTestAccount && <Badge bg="warning" text="dark">テストアカウント</Badge>}
        </div>
        <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
          <AppButton
            size="sm"
            variant={pharmacy.isActive ? 'outline-warning' : 'outline-success'}
            onClick={() => void handleToggleActive()}
            disabled={activeUpdating}
          >
            {activeUpdating ? '更新中...' : pharmacy.isActive ? '無効にする' : '有効にする'}
          </AppButton>
          <span className="text-muted small">この操作は即時反映されます</span>
        </div>
        <Form.Check
          className="mt-3"
          type="switch"
          id="admin-pharmacy-test-account-flag"
          label="テストアカウントとして扱う"
          checked={isTestAccount}
          onChange={(event) => handleTestAccountToggle(event.currentTarget.checked)}
        />
        {isTestAccount && (
          <AppField
            className="mt-3"
            controlId="admin-pharmacy-test-account-password"
            label="テストアカウント表示用パスワード"
            type="text"
            value={testAccountPassword}
            onChange={setTestAccountPassword}
            required
            helpText="ログイン画面の「お試しアカウントを選ぶ」で選択した際に自動入力される値です。"
          />
        )}
        <div className="text-muted small mt-2">
          登録日: {formatDateTimeJa(pharmacy.createdAt)}
        </div>
      </AppDataPanel>

      <ConflictAlert
        show={accountConflict}
        onReload={handleReloadAccount}
        onDismiss={() => setAccountConflict(false)}
        message="他の操作で薬局情報が更新されました。最新データを読み込みました。内容確認後に再保存してください。"
      />

      <AccountInfoForm
        form={form}
        loading={loading}
        submitDisabled={!isAccountDirty}
        onSubmit={handleSubmit}
        onChange={handleChange}
        showPasswordSection={false}
      />

      <ConflictAlert
        show={hoursConflict}
        onReload={handleReloadBusinessHours}
        onDismiss={() => setHoursConflict(false)}
        message="他の操作で営業時間が更新されました。最新データを読み込みました。内容確認後に再保存してください。"
      />

      <BusinessHoursSettings
        businessHours={businessHours}
        specialHours={specialHours}
        hoursLoaded={hoursLoaded}
        hoursEditing={hoursEditing}
        hoursEditable={!hoursLoadFailed}
        hoursSaving={hoursSaving}
        hoursMessage={hoursMessage}
        hoursError={hoursError}
        onRetryLoad={() => void handleReloadBusinessHours()}
        onHoursMessage={setHoursMessage}
        onHoursError={setHoursError}
        onHoursChange={handleHoursChange}
        onClosedChange={handleClosedChange}
        on24HoursChange={handle24HoursChange}
        onHoursSave={handleHoursSave}
        onHoursEditStart={handleHoursEditStart}
        onHoursEditCancel={handleHoursEditCancel}
        onAddSpecialHour={handleAddSpecialHour}
        onRemoveSpecialHour={handleRemoveSpecialHour}
        onSpecialTypeChange={handleSpecialTypeChange}
        onSpecialDateChange={handleSpecialDateChange}
        onSpecialNoteChange={handleSpecialNoteChange}
        onSpecialHoursChange={handleSpecialHoursChange}
        onSpecialClosedChange={handleSpecialClosedChange}
        onSpecial24HoursChange={handleSpecial24HoursChange}
      />

      {/* 操作履歴 */}
      <AppDataPanel className="mt-4">
        <h5 className="mb-3">操作履歴</h5>
        {auditLogsLoading ? (
          <InlineLoader text="履歴を読み込み中..." className="text-muted small" />
        ) : auditLogsError ? (
          <AppAlert variant="danger">{auditLogsError}</AppAlert>
        ) : auditLogs.length === 0 ? (
          <p className="text-muted mb-0">操作履歴はありません</p>
        ) : (
          <Table striped bordered hover responsive size="sm" className="mobile-table">
            <thead>
              <tr>
                <th>日時</th>
                <th>アクション</th>
                <th>変更前</th>
                <th>変更後</th>
                <th>理由</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDateTimeJa(log.createdAt)}</td>
                  <td>{formatAction(log.action)}</td>
                  <td>{log.previousStatus ?? '-'}</td>
                  <td>{log.newStatus}</td>
                  <td>{log.reason ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </AppDataPanel>
      </ScrollArea>
    </PageShell>
  );
}
