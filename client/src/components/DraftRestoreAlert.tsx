import AppButton from './ui/AppButton';
import AppAlert from './ui/AppAlert';

interface DraftRestoreAlertProps {
  /** 下書きの保存日時 */
  draftTimestamp: Date | null;
  /** 「復元する」ボタン押下ハンドラ */
  onRestore: () => void;
  /** 「破棄する」ボタン押下ハンドラ */
  onDiscard: () => void;
}

/**
 * 保存済みの下書きがある場合に表示する復元確認バナー。
 */
export default function DraftRestoreAlert({ draftTimestamp, onRestore, onDiscard }: DraftRestoreAlertProps) {
  if (!draftTimestamp) return null;

  const formattedDate = draftTimestamp.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <AppAlert variant="info" className="d-flex align-items-center justify-content-between flex-wrap gap-2">
      <span>保存済みの下書きがあります（{formattedDate}）。復元しますか？</span>
      <div className="d-flex gap-2">
        <AppButton variant="info" size="sm" onClick={onRestore}>
          復元する
        </AppButton>
        <AppButton variant="outline-secondary" size="sm" onClick={onDiscard}>
          破棄する
        </AppButton>
      </div>
    </AppAlert>
  );
}
