import type { ReactNode } from 'react';

interface PageShellProps {
  children: ReactNode;
  className?: string;
}

/** ページの共通ラッパー。現在は通常のドキュメントスクロールを使う。 */
export default function PageShell({ children, className }: PageShellProps) {
  return (
    <div className={className ? `page-viewport dl-page-shell ${className}` : 'page-viewport dl-page-shell'}>
      {children}
    </div>
  );
}

/** 互換性のため残しているラッパー。現在は独立スクロールを持たない。 */
export function ScrollArea({ children, className }: PageShellProps) {
  return (
    <div className={className ? `page-scroll-area dl-page-section ${className}` : 'page-scroll-area dl-page-section'}>
      {children}
    </div>
  );
}
