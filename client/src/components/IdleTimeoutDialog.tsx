// 3省2ガイドライン準拠: セッションタイムアウト警告ダイアログ

import { useState, useEffect } from 'react';
import { Button } from 'react-bootstrap';
import AppModalShell from './ui/AppModalShell';

interface Props {
  show: boolean;
  remainingSeconds: number;
  onExtend: () => void;
  onLogout: () => void;
}

export default function IdleTimeoutDialog({ show, remainingSeconds, onExtend, onLogout }: Props) {
  const [seconds, setSeconds] = useState(remainingSeconds);

  useEffect(() => {
    if (show) setSeconds(remainingSeconds);
  }, [show, remainingSeconds]);

  useEffect(() => {
    if (!show) return;
    const interval = setInterval(() => {
      setSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [show]);

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const timeLabel = mins > 0
    ? `${mins}分${secs}秒`
    : `${seconds}秒`;

  const footer = (
    <>
      <Button variant="outline-secondary" onClick={onLogout}>
        今すぐログアウト
      </Button>
      <Button variant="primary" onClick={onExtend}>
        セッションを延長
      </Button>
    </>
  );

  return (
    <AppModalShell
      show={show}
      title="セッションタイムアウト警告"
      backdrop="static"
      keyboard={false}
      closeButton={false}
      onHide={onExtend}
      footer={footer}
    >
      <p>
        操作がない状態が続いているため、<strong>{timeLabel}後</strong>に自動的にログアウトします。
      </p>
      <p className="text-muted small mb-0">
        継続して利用する場合は「セッションを延長」を押してください。
      </p>
    </AppModalShell>
  );
}
