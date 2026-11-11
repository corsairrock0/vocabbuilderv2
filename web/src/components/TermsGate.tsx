// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { lazy, Suspense, useState } from 'react';
import { ApiError, post, setCsrf } from '../lib/api.ts';
import { listQueue } from '../lib/outbox.ts';
import { clearDeviceData, setState, useApp } from '../lib/store.ts';
import { COPYRIGHT, TERMS_VERSION } from '../lib/brand.ts';
import type { TermsStatus } from '../../../shared/legal.ts';
import { PageLoading } from './ui.tsx';
import { Alert, AlertDescription } from './ui/alert.tsx';
import { Button } from './ui/button.tsx';
import { Card } from './ui/card.tsx';
import { Checkbox } from './ui/controls.tsx';
import { Label } from './ui/basics.tsx';
import { LuScrollText } from 'react-icons/lu';

const TermsPage = lazy(() => import('../pages/TermsPage.tsx').then((m) => ({ default: m.TermsPage })));

/**
 * True when the signed-in account still has to accept the Terms of Service in force. Never while working offline
 * (accepting needs the server), and not for a bootstrap cached by a version without terms.
 */
export function useTermsRequired(): boolean {
  return useApp((s) => !!s.boot?.terms?.required && !s.offlineData);
}

/** Click-wrap: the owner reads the Terms of Service and accepts them before using the app; the server records it. */
export function TermsGate() {
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstTime = useApp((s) => !s.boot?.terms?.acceptedVersion);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const terms = await post<TermsStatus>('/api/legal/accept', { version: TERMS_VERSION });
      setState((s) => (s.boot ? { boot: { ...s.boot, terms } } : {}));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Your acceptance could not be saved. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    const waiting = (await listQueue()).length;
    if (waiting && !confirm(`${waiting} change${waiting === 1 ? ' has' : 's have'} not reached your server yet. They stay on this device and sync after you sign in again. Sign out anyway?`)) return;
    await post('/api/auth/logout').catch(() => undefined);
    await clearDeviceData();
    setCsrf('');
    setState({ auth: 'login', boot: null });
  };

  return (
    <div className="min-h-dvh">
      <main className="mx-auto max-w-2xl px-4 pt-8 pb-60">
        <div className="flex items-center gap-2.5">
          <img src="/icons/icon.svg" alt="" width={32} height={32} className="rounded-[10px]" />
          <p className="text-sm font-medium text-muted-foreground">VocabBuilder by Lango</p>
        </div>
        <Alert variant="info" className="mt-5">
          <LuScrollText aria-hidden="true" />
          <AlertDescription className="text-foreground">
            {firstTime ? 'Before you continue, please read and accept the Terms of Service.' : 'The Terms of Service have changed. Please read and accept the new version to continue.'}
          </AlertDescription>
        </Alert>
        <Card className="mt-5 px-5">
          <Suspense fallback={<PageLoading />}>
            <TermsPage embedded />
          </Suspense>
        </Card>
      </main>
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t bg-background/92 backdrop-blur-md">
        <div className="mx-auto max-w-2xl space-y-3 px-4 py-4">
          <div className="flex items-start gap-3">
            <Checkbox id="terms-accept" className="mt-0.5" checked={accepted} onCheckedChange={setAccepted} />
            <Label htmlFor="terms-accept" className="text-[0.9375rem] leading-snug font-normal">
              I have read and accept the Terms of Service.
            </Label>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="lg" disabled={!accepted || busy} onClick={() => void accept()}>
              {busy ? 'Saving' : 'Accept and continue'}
            </Button>
            <Button variant="ghost" size="lg" onClick={() => void signOut()}>
              Sign out
            </Button>
            <span className="hint ml-auto">{COPYRIGHT}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
