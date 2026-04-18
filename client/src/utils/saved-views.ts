export interface SavedView<T> {
  id: string;
  name: string;
  filters: T;
  createdAt: string;
}

const MAX_SAVED_VIEWS = 5;

function isSavedViewArray<T>(value: unknown): value is Array<SavedView<T>> {
  return Array.isArray(value);
}

export function loadSavedViews<T>(storageKey: string): Array<SavedView<T>> {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!isSavedViewArray<T>(parsed)) return [];
    return parsed.filter((entry) =>
      typeof entry?.id === 'string'
      && typeof entry?.name === 'string'
      && typeof entry?.createdAt === 'string');
  } catch {
    return [];
  }
}

export function persistSavedViews<T>(storageKey: string, views: Array<SavedView<T>>): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey, JSON.stringify(views.slice(0, MAX_SAVED_VIEWS)));
}

export function addSavedView<T>(
  existingViews: Array<SavedView<T>>,
  name: string,
  filters: T,
): Array<SavedView<T>> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return existingViews;
  }

  const id = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  return [
    {
      id,
      name: trimmedName,
      filters,
      createdAt: new Date().toISOString(),
    },
    ...existingViews,
  ].slice(0, MAX_SAVED_VIEWS);
}

export function removeSavedView<T>(existingViews: Array<SavedView<T>>, id: string): Array<SavedView<T>> {
  return existingViews.filter((view) => view.id !== id);
}
