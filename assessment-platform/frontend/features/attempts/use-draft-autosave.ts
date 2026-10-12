'use client';
import { useEffect } from 'react';
import type { DraftStore } from './draft-store';
/** Bound the unsaved interval even when continuous typing prevents the 800ms debounce. */
export function useDraftAutosave(store: DraftStore, readOnly: boolean) {
  useEffect(() => {
    store.setEnabled(!readOnly);
    const interval = readOnly
      ? undefined
      : window.setInterval(() => {
          void store.flushAll().catch(() => undefined); // Each buffer retains its error/unsent source.
        }, 5000);
    return () => {
      if (interval !== undefined) window.clearInterval(interval);
      store.setEnabled(false);
    };
  }, [store, readOnly]);
}
