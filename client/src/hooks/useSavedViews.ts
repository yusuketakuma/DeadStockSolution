import { useEffect, useState } from 'react';
import {
  addSavedView,
  loadSavedViews,
  persistSavedViews,
  removeSavedView,
  type SavedView,
} from '../utils/saved-views';

export function useSavedViews<T>(storageKey: string) {
  const [savedViews, setSavedViews] = useState<Array<SavedView<T>>>(() => loadSavedViews<T>(storageKey));

  useEffect(() => {
    persistSavedViews(storageKey, savedViews);
  }, [savedViews, storageKey]);

  const createSavedView = (name: string, filters: T) => {
    setSavedViews((prev) => addSavedView(prev, name, filters));
  };

  const deleteSavedView = (id: string) => {
    setSavedViews((prev) => removeSavedView(prev, id));
  };

  return {
    savedViews,
    setSavedViews,
    createSavedView,
    deleteSavedView,
  };
}
