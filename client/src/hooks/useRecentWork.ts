import { useEffect, useRef, useState } from 'react';
import { addRecentWork, loadRecentWork, subscribeRecentWork, type RecentWorkItem } from '../utils/recent-work';

export function useRecentWorkList(limit = 6) {
  const [items, setItems] = useState<RecentWorkItem[]>(() => loadRecentWork().slice(0, limit));

  useEffect(() => {
    const sync = () => setItems(loadRecentWork().slice(0, limit));
    sync();
    return subscribeRecentWork(sync);
  }, [limit]);

  return items;
}

export function useTrackRecentWork(item: Omit<RecentWorkItem, 'updatedAt'> | null) {
  const lastSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!item) {
      lastSignatureRef.current = null;
      return;
    }
    const signature = [item.id, item.label, item.to, item.section, item.subtitle ?? ''].join('::');
    if (lastSignatureRef.current === signature) return;
    lastSignatureRef.current = signature;
    addRecentWork({
      id: item.id,
      label: item.label,
      to: item.to,
      section: item.section,
      subtitle: item.subtitle,
    });
  }, [item]);
}
