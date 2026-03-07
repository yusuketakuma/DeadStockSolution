import { Component, type ReactNode } from 'react';
import AppAlert from './AppAlert';
import AppButton from './AppButton';

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
      <div style={{ maxWidth: '600px', width: '100%' }}>
        <AppAlert variant="danger">
          <div style={{ marginBottom: '1rem' }}>
            <h2 style={{ marginBottom: '0.5rem', fontSize: '1.5rem' }}>
              ⚠️ 予期しないエラーが発生しました
            </h2>
            <p style={{ marginBottom: '1rem', fontSize: '0.95rem' }}>
              申し訳ございません。ページを再読み込みしてお試しください。
            </p>
          </div>

          <div style={{ marginBottom: error ? '1rem' : 0 }}>
            <AppButton
              variant="danger"
              onClick={() => window.location.reload()}
              style={{ marginRight: error ? '0.5rem' : 0 }}
            >
              ページを再読み込み
            </AppButton>
          </div>

          {error && (
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
        </AppAlert>
      </div>
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
    console.error('ErrorBoundary caught an error:', error);
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
      return (
        <div className="app-theme" style={{ minHeight: '100vh' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '2rem' }}>
            <div style={{ maxWidth: '600px', width: '100%' }}>
              <AppAlert variant="danger">
                <div style={{ marginBottom: '1rem' }}>
                  <h2 style={{ marginBottom: '0.5rem', fontSize: '1.5rem' }}>
                    ⚠️ 予期しないエラーが発生しました
                  </h2>
                  <p style={{ marginBottom: '1rem', fontSize: '0.95rem' }}>
                    申し訳ございません。ページを再読み込みしてお試しください。
                  </p>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <AppButton
                    variant="danger"
                    onClick={this.handleReload}
                    style={{ marginRight: '0.5rem' }}
                  >
                    ページを再読み込み
                  </AppButton>
                  <AppButton
                    variant="outline-secondary"
                    onClick={this.toggleDetails}
                    size="sm"
                  >
                    {this.state.showDetails ? '詳細を非表示' : '詳細を表示'}
                  </AppButton>
                </div>

                {this.state.showDetails && this.state.error && (
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
                    {this.state.error.message}
                  </pre>
                )}
              </AppAlert>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
