// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Focus mode (2.0.0): while a practice run is on screen, the shell hides its tab bar, top bar and sidebar, as it does
 * for a study session, so the question has the whole screen.
 */
import { useEffect, useSyncExternalStore } from 'react';

let depth = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Turn focus mode on while `on` (and the calling component is mounted). */
export function useFocusMode(on: boolean) {
  useEffect(() => {
    if (!on) return;
    depth++;
    emit();
    return () => {
      depth--;
      emit();
    };
  }, [on]);
}

export function useIsFocusMode(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => depth > 0,
  );
}
