import { Component, type ReactNode } from 'react';
import AppAlert from './AppAlert';
import AppButton from './AppButton';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function isChunkLoadError(error: Error): boolean {
  return (
    error.name === 'ChunkLoadError' ||
    error.message.includes('Failed to fetch dynamically imported module') ||
    error.message.includes('Loading chunk') ||
    error.message.includes('Loading CSS chunk')
  );
}

class RouteErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const chunkError = this.state.error && isChunkLoadError(this.state.error);

    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', padding: '2rem' }}>
        <div style={{ maxWidth: '500px', width: '100%' }}>
          <AppAlert variant={chunkError ? 'warning' : 'danger'}>
            <h5 style={{ marginBottom: '0.5rem' }}>
              {chunkError
                ? 'ページの読み込みに失敗しました'
                : '予期しないエラーが発生しました'}
            </h5>
            <p style={{ marginBottom: '1rem', fontSize: '0.9rem' }}>
              {chunkError
                ? 'ネットワーク接続を確認し、再試行してください。アプリが更新された可能性があります。'
                : '申し訳ございません。再試行するか、ページを再読み込みしてください。'}
            </p>
            <AppButton variant={chunkError ? 'warning' : 'danger'} onClick={this.handleRetry} style={{ marginRight: '0.5rem' }}>
              再試行
            </AppButton>
            <AppButton variant="outline-secondary" onClick={this.handleReload}>
              ページを再読み込み
            </AppButton>
          </AppAlert>
        </div>
      </div>
    );
  }
}

export default RouteErrorBoundary;
