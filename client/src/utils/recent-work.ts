import { sanitizeInternalPath } from './navigation';

const RECENT_WORK_STORAGE_KEY = 'dss:recent-work';
const RECENT_WORK_EVENT = 'dss:recent-work-updated';
const MAX_RECENT_WORK_ITEMS = 12;

export interface RecentWorkItem {
  id: string;
  label: string;
  to: string;
  section: string;
  subtitle?: string;
  updatedAt: string;
}

function canUseWindow() {
  return typeof window !== 'undefined';
}

function normalizeRecentWorkItem(raw: unknown): RecentWorkItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<RecentWorkItem>;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return null;
  if (typeof candidate.label !== 'string' || candidate.label.length === 0) return null;
  if (typeof candidate.section !== 'string' || candidate.section.length === 0) return null;
  const safePath = sanitizeInternalPath(candidate.to, '');
  if (!safePath) return null;
  return {
    id: candidate.id,
    label: candidate.label,
    to: safePath,
    section: candidate.section,
    subtitle: typeof candidate.subtitle === 'string' && candidate.subtitle.length > 0 ? candidate.subtitle : undefined,
    updatedAt: typeof candidate.updatedAt === 'string' && candidate.updatedAt.length > 0
      ? candidate.updatedAt
      : new Date().toISOString(),
  };
}

function emitRecentWorkUpdate() {
  if (!canUseWindow()) return;
  window.dispatchEvent(new CustomEvent(RECENT_WORK_EVENT));
}

export function loadRecentWork(): RecentWorkItem[] {
  if (!canUseWindow()) return [];
  try {
    const raw = window.localStorage.getItem(RECENT_WORK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeRecentWorkItem)
      .filter((item): item is RecentWorkItem => item !== null)
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .slice(0, MAX_RECENT_WORK_ITEMS);
  } catch {
    return [];
  }
}

function persistRecentWork(items: RecentWorkItem[]) {
  if (!canUseWindow()) return;
  window.localStorage.setItem(RECENT_WORK_STORAGE_KEY, JSON.stringify(items.slice(0, MAX_RECENT_WORK_ITEMS)));
  emitRecentWorkUpdate();
}

export function addRecentWork(item: Omit<RecentWorkItem, 'updatedAt'> & { updatedAt?: string }) {
  if (!canUseWindow()) return;
  const normalized = normalizeRecentWorkItem({
    ...item,
    updatedAt: item.updatedAt ?? new Date().toISOString(),
  });
  if (!normalized) return;
  const next = [
    normalized,
    ...loadRecentWork().filter((entry) => entry.id !== normalized.id && entry.to !== normalized.to),
  ].slice(0, MAX_RECENT_WORK_ITEMS);
  persistRecentWork(next);
}

export function clearRecentWork() {
  if (!canUseWindow()) return;
  window.localStorage.removeItem(RECENT_WORK_STORAGE_KEY);
  emitRecentWorkUpdate();
}

export function subscribeRecentWork(listener: () => void) {
  if (!canUseWindow()) {
    return () => {};
  }
  const handleStorage = (event: StorageEvent) => {
    if (event.key === RECENT_WORK_STORAGE_KEY) listener();
  };
  window.addEventListener(RECENT_WORK_EVENT, listener);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(RECENT_WORK_EVENT, listener);
    window.removeEventListener('storage', handleStorage);
  };
}
