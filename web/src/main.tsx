// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { startSyncLoop } from './lib/outbox.ts';
import { checkAuth, getState, startRevisionPolling, toast } from './lib/store.ts';
import { isSessionRunning } from './pages/session/runtime.ts';

createRoot(document.getElementById('root')!).render(<App />);

startSyncLoop();
startRevisionPolling(() => isSessionRunning());
void checkAuth();
// After starting offline, sign-in state, the CSRF token and fresh data are fetched as soon as the network returns.
window.addEventListener('online', () => {
  if (getState().offlineData || getState().auth !== 'ready') void checkAuth();
});

// Service workers need a secure context: HTTPS, or localhost during development.
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((reg) => {
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A new version of VocabBuilder is ready.', 'info', {
              label: 'Reload',
              run: () => {
                worker.postMessage({ type: 'SKIP_WAITING' });
                location.reload();
              },
            });
          }
        });
      });
    })
    .catch(() => {
      /* service worker unavailable (e.g. private mode) — app still works online */
    });
}
