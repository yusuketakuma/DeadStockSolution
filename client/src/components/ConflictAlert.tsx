import AppButton from './ui/AppButton';
import AppAlert from './ui/AppAlert';

interface ConflictAlertProps {
  /** 表示/非表示 */
  show: boolean;
  /** 再読み込みボタンのコールバック */
  onReload: () => void;
  /** 閉じるボタンのコールバック（任意） */
  onDismiss?: () => void;
  /** カスタムメッセージ（省略時はデフォルトメッセージ） */
  message?: string;
}

/**
 * 楽観的ロック競合時に表示する通知コンポーネント。
 * 他のデバイス/タブで更新された場合に、ユーザーに再読み込みを促す。
 */
export default function ConflictAlert({ show, onReload, onDismiss, message }: ConflictAlertProps) {
  if (!show) return null;

  return (
    <AppAlert variant="warning" onClose={onDismiss} dismissible={!!onDismiss}>
      <h6 className="mb-2">更新の競合が発生しました</h6>
      <p className="mb-2">
        {message || '他のデバイスまたはタブでデータが更新されました。最新のデータを読み込んでから再度お試しください。'}
      </p>
      <AppButton variant="outline-warning" size="sm" onClick={onReload}>
        最新データを読み込む
      </AppButton>
    </AppAlert>
  );
}
