import type { ReactNode } from 'react';

interface PageShellProps {
  children: ReactNode;
  className?: string;
}

/** ページのビューポートフィットラッパー。PC では flex+overflow:hidden で高さ固定。 */
export default function PageShell({ children, className }: PageShellProps) {
  return (
    <div className={className ? `page-viewport ${className}` : 'page-viewport'}>
      {children}
    </div>
  );
}

/** スクロール可能なコンテンツ領域。PageShell 内で使用。 */
export function ScrollArea({ children, className }: PageShellProps) {
  return (
    <div className={className ? `page-scroll-area ${className}` : 'page-scroll-area'}>
      {children}
    </div>
  );
}
