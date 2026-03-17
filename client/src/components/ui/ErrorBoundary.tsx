import { Component, type ReactNode } from 'react';
import AppAlert from './AppAlert';
import AppButton from './AppButton';

interface ErrorDisplayProps {
  error: Error | null;
  showDetails?: boolean;
  onToggleDetails?: () => void;
  onReload: () => void;
  isDev: boolean;
}

function ErrorDisplay({ error, showDetails, onToggleDetails, onReload, isDev }: ErrorDisplayProps) {
  return (
    <div style={{ maxWidth: '600px', width: '100%' }}>
      <AppAlert variant="danger">
        <div style={{ marginBottom: '1rem' }}>
          <h2 style={{ marginBottom: '0.5rem', fontSize: '1.5rem' }}>
            <span aria-hidden="true">⚠️</span> 予期しないエラーが発生しました
          </h2>
          <p style={{ marginBottom: '1rem', fontSize: '0.95rem' }}>
            申し訳ございません。ページを再読み込みしてお試しください。
          </p>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          {isDev ? (
            <>
              <AppButton
                variant="danger"
                onClick={onReload}
                style={{ marginRight: onToggleDetails ? '0.5rem' : 0 }}
              >
                ページを再読み込み
              </AppButton>
              {onToggleDetails && (
                <AppButton
                  variant="outline-secondary"
                  onClick={onToggleDetails}
                  size="sm"
                >
                  {showDetails ? '詳細を非表示' : '詳細を表示'}
                </AppButton>
              )}
            </>
          ) : (
            <>
              <AppButton
                variant="danger"
                onClick={onReload}
                style={{ marginRight: '0.5rem' }}
              >
                ページを再読み込み
              </AppButton>
              <AppButton
                variant="outline-secondary"
                href="/"
              >
                ホームに戻る
              </AppButton>
            </>
          )}
        </div>

        {isDev && ((showDetails !== undefined ? showDetails : true) && error) && (
          <pre
            style={{
              backgroundColor: '#f5f5f5',
              padding: '1rem',
              borderRadius: '4px',
              fontSize: '0.85rem',
              overflow: 'auto',
              maxHeight: '300px',
              marginTop: '1rem',
              marginBottom: 0,
            }}
          >
            {error.message}
          </pre>
        )}

        {!isDev && (
          <p style={{ marginBottom: 0, fontSize: '0.85rem', color: '#6c757d' }}>
            問題が解決しない場合はサポートにお問い合わせください。
          </p>
        )}
      </AppAlert>
    </div>
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  showDetails: boolean;
}

interface ErrorFallbackProps {
  error?: Error | null;
}

export function ErrorFallback({ error = null }: ErrorFallbackProps) {
  return (
    <div
      className="app-theme"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '2rem',
      }}
    >
      <ErrorDisplay
        error={error}
        onReload={() => window.location.reload()}
        isDev={import.meta.env.DEV}
      />
    </div>
  );
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error) {
    if (import.meta.env.DEV) {
      console.error('ErrorBoundary caught an error:', error);
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  toggleDetails = () => {
    this.setState((prev) => ({
      showDetails: !prev.showDetails,
    }));
  };

  render() {
    if (this.state.hasError) {
      const isDev = import.meta.env.DEV;
      return (
        <div className="app-theme" style={{ minHeight: '100vh' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '2rem' }}>
            <ErrorDisplay
              error={this.state.error}
              showDetails={this.state.showDetails}
              onToggleDetails={isDev ? this.toggleDetails : undefined}
              onReload={this.handleReload}
              isDev={isDev}
            />
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
