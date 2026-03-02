import { useRef, type ReactNode } from 'react';

/**
 * タブの遅延マウント: 初回アクティブ時にマウントし、以降は display:none で保持。
 */
export default function LazyTab({ active, children }: { active: boolean; children: ReactNode }) {
  const hasMounted = useRef(active);
  if (active) hasMounted.current = true;
  if (!hasMounted.current) return null;
  return <div style={active ? undefined : { display: 'none' }}>{children}</div>;
}
