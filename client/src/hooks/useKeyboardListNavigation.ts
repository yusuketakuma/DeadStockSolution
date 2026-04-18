import { useEffect } from 'react';

interface UseKeyboardListNavigationOptions<TId extends string | number> {
  ids: TId[];
  selectedId: TId | null;
  setSelectedId: (id: TId) => void;
  onEnter?: (id: TId) => void;
  onPrimaryAction?: (id: TId) => void;
  onSecondaryAction?: (id: TId) => void;
  searchTargetId?: string;
  enabled?: boolean;
}

function shouldIgnoreKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable
    || tagName === 'input'
    || tagName === 'textarea'
    || tagName === 'select'
    || Boolean(target.closest('[contenteditable="true"]'));
}

export function useKeyboardListNavigation<TId extends string | number>({
  ids,
  selectedId,
  setSelectedId,
  onEnter,
  onPrimaryAction,
  onSecondaryAction,
  searchTargetId,
  enabled = true,
}: UseKeyboardListNavigationOptions<TId>) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreKeyboardTarget(event.target)) return;
      if (ids.length === 0) return;

      const currentIndex = selectedId == null ? -1 : ids.findIndex((id) => id === selectedId);
      const nextIndex = (delta: number) => {
        if (currentIndex < 0) return delta > 0 ? 0 : ids.length - 1;
        return (currentIndex + delta + ids.length) % ids.length;
      };

      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedId(ids[nextIndex(1)]);
        return;
      }
      if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedId(ids[nextIndex(-1)]);
        return;
      }
      if (event.key === 'Enter' && selectedId != null && onEnter) {
        event.preventDefault();
        onEnter(selectedId);
        return;
      }
      if (event.key.toLowerCase() === 'e' && selectedId != null && onPrimaryAction) {
        event.preventDefault();
        onPrimaryAction(selectedId);
        return;
      }
      if (event.key.toLowerCase() === 's' && selectedId != null && onSecondaryAction) {
        event.preventDefault();
        onSecondaryAction(selectedId);
        return;
      }
      if (event.key === '/' && searchTargetId) {
        event.preventDefault();
        const element = document.getElementById(searchTargetId);
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          element.focus();
          element.select();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, ids, onEnter, onPrimaryAction, onSecondaryAction, searchTargetId, selectedId, setSelectedId]);
}
