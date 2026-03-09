import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

interface SWUpdateState {
  needsUpdate: boolean;
  updateSW: () => void;
}

export function useSWUpdate(): SWUpdateState {
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const { needRefresh, updateServiceWorker } = useRegisterSW({
    onRegistered() {
      // SW registered
    },
    onRegisterError(error: Error) {
      console.error('SW registration error:', error);
    },
  });

  useEffect(() => {
    // needRefresh is a tuple [boolean, () => void]
    if (Array.isArray(needRefresh)) {
      setNeedsUpdate(needRefresh[0]);
    } else {
      setNeedsUpdate(needRefresh ?? false);
    }
  }, [needRefresh]);

  const updateSW = () => {
    setNeedsUpdate(false);
    updateServiceWorker(true);
  };

  return {
    needsUpdate,
    updateSW,
  };
}
