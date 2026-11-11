// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Active study time on a page (shared/activity.ts): the clock runs while the page is visible and the learner tapped,
 * clicked or typed in the last 90 seconds. Study sessions send it with their answers and events; the Practice pages
 * send it with each practice answer. A practice round inside a session uses no clock of its own (the session's counts).
 */
import { useEffect, useMemo, useRef } from 'react';
import { ActiveClock } from '../../../shared/activity.ts';

const pageVisible = () => document.visibilityState === 'visible';

/**
 * A clock that starts when the component mounts (mounting counts as activity: the learner just pressed Start).
 * `take()` returns the active time since the previous take and starts again; `peek()` reads it without taking.
 * With `enabled` false both return 0, as in a round embedded in a session.
 */
export function useActiveClock(enabled = true): { take: () => number; peek: () => number } {
  const ref = useRef<ActiveClock | null>(null);
  if (enabled && !ref.current) ref.current = new ActiveClock(Date.now, pageVisible());
  useEffect(() => {
    const clock = ref.current;
    if (!clock) return;
    // Capture phase: a control that stops propagation still counts as activity.
    const input = () => clock.input();
    const visibility = () => clock.setVisible(pageVisible());
    document.addEventListener('keydown', input, true);
    document.addEventListener('pointerdown', input, true);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('keydown', input, true);
      document.removeEventListener('pointerdown', input, true);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  return useMemo(() => ({ take: () => Math.round(ref.current?.take() ?? 0), peek: () => Math.round(ref.current?.peek() ?? 0) }), []);
}
