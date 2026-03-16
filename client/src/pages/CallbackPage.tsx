import { useEffect } from 'react';

export default function CallbackPage() {
  useEffect(() => {
    // WorkOS callback はサーバー側で処理され、
    // 適切なページにリダイレクトされます。
    // このページは callback 処理中のローディング表示のみ。
    // 直接アクセスされた場合はログインに戻す。
    const timeout = setTimeout(() => {
      window.location.href = '/login';
    }, 5000);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className="d-flex flex-column align-items-center justify-content-center vh-100">
      <div className="spinner-border text-primary mb-3" role="status">
        <span className="visually-hidden">認証処理中...</span>
      </div>
      <p className="text-muted">認証処理中です。しばらくお待ちください...</p>
    </div>
  );
}
