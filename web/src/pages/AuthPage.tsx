// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useState, type FormEvent } from 'react';
import { ApiError, post, setCsrf } from '../lib/api.ts';
import { loadBootstrap, setState } from '../lib/store.ts';
import { flush } from '../lib/outbox.ts';
import { Link } from '../lib/router.tsx';
import { COPYRIGHT } from '../lib/brand.ts';
import { Alert, AlertDescription } from '../components/ui/alert.tsx';
import { Spinner } from '../components/ui/basics.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { Checkbox } from '../components/ui/controls.tsx';
import { Field, FieldDescription, FieldLabel } from '../components/ui/field.tsx';
import { Input } from '../components/ui/input.tsx';

const SAMPLES = ['вода́', 'tiếng Việt', 'dziękuję', 'дя́кую', 'obrigado', '¿qué más?'];

export function AuthPage({ mode }: { mode: 'setup' | 'login' }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [token, setToken] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'setup' && password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    if (mode === 'setup' && !accepted) {
      setError('Accept the Terms of Service to create the account.');
      return;
    }
    setBusy(true);
    try {
      const body =
        mode === 'setup'
          ? { username, password, setupToken: token, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, acceptTerms: accepted }
          : { username, password };
      const r = await post<{ csrfToken: string; user: { username: string } }>(mode === 'setup' ? '/api/auth/setup' : '/api/auth/login', body);
      setCsrf(r.csrfToken);
      setState({ auth: 'ready', username: r.user.username });
      await loadBootstrap();
      void flush();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const link = 'rounded underline decoration-dotted underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-[25rem]">
        <div className="mb-6 flex items-center gap-3">
          <img src="/icons/icon.svg" alt="" width={44} height={44} className="rounded-xl" />
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.015em]">VocabBuilder</h1>
            <p className="text-sm text-muted-foreground">by Lango · your private vocabulary trainer</p>
          </div>
        </div>
        <p className="word mb-7 flex flex-wrap gap-x-4 gap-y-0.5 text-[1.375rem] leading-snug text-muted-foreground/80" aria-hidden="true">
          {SAMPLES.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </p>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              <h2>{mode === 'setup' ? 'Create the owner account' : 'Sign in'}</h2>
            </CardTitle>
            {mode === 'setup' && <CardDescription>This app has one account: yours. Nobody else can register.</CardDescription>}
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-4">
              {mode === 'setup' && (
                <Field className="gap-1.5">
                  <FieldLabel htmlFor="token">Setup code</FieldLabel>
                  <Input id="token" autoComplete="one-time-code" value={token} onChange={(e) => setToken((e.target as HTMLInputElement).value)} required />
                  <FieldDescription className="text-xs">Printed in the server log on first start (docker compose logs app), or the VB_SETUP_TOKEN you set.</FieldDescription>
                </Field>
              )}
              <Field className="gap-1.5">
                <FieldLabel htmlFor="username">Username</FieldLabel>
                <Input id="username" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername((e.target as HTMLInputElement).value)} required />
              </Field>
              <Field className="gap-1.5">
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
                  minLength={mode === 'setup' ? 12 : undefined}
                  required
                />
                {mode === 'setup' && <FieldDescription className="text-xs">At least 12 characters. A passphrase of several words works well.</FieldDescription>}
              </Field>
              {mode === 'setup' && (
                <Field className="gap-1.5">
                  <FieldLabel htmlFor="confirm">Repeat password</FieldLabel>
                  <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm((e.target as HTMLInputElement).value)} required />
                </Field>
              )}
              {mode === 'setup' && (
                <div className="flex items-start gap-3 text-[0.9375rem]">
                  <Checkbox id="accept" className="mt-0.5" checked={accepted} onCheckedChange={setAccepted} aria-label="I have read and accept the Terms of Service" />
                  <label htmlFor="accept">
                    I have read and accept the{' '}
                    <a href="/terms" target="_blank" rel="noopener" className="font-medium underline underline-offset-2">
                      Terms of Service
                    </a>
                    .
                  </label>
                </div>
              )}
              {error && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" size="xl" className="w-full" disabled={busy}>
                {busy && <Spinner />} {busy ? 'Please wait' : mode === 'setup' ? 'Create account' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {mode === 'login' ? 'By signing in you agree to the ' : ''}
          <Link to="/terms" className={link}>
            Terms of Service
          </Link>
          {' · '}
          <Link to="/notices" className={link}>
            Third-party notices
          </Link>
          <br />
          {COPYRIGHT}
        </p>
      </div>
    </div>
  );
}
