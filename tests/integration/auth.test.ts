// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Owner authentication and security: setup token, password rules, rate limiting, CSRF,
// Origin checks, logout/expiry, cookie flags, security headers, and secrets never exposed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, startTestServer } from '../helpers/harness.ts';

const GOOD = 'correct horse battery staple';

test('first-run setup requires the setup code and a strong password, and only works once', async () => {
  const srv = await startTestServer();
  try {
    const c = new Client(srv.url);
    const status = await c.get('/api/auth/status');
    assert.deepEqual(status.body, { setupRequired: true, authenticated: false });
    const wrong = await c.post('/api/auth/setup', { setupToken: 'nope', username: 'owner', password: GOOD });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.error.code, 'bad_setup_token');
    const unaccepted = await c.post('/api/auth/setup', { setupToken: 'TEST-SETUP-TOKEN', username: 'owner', password: GOOD });
    assert.equal(unaccepted.status, 422);
    assert.equal(unaccepted.body.error.code, 'terms_not_accepted', 'the Terms of Service must be accepted to create the account');
    const weak = await c.post('/api/auth/setup', { setupToken: 'TEST-SETUP-TOKEN', username: 'owner', password: 'short', acceptTerms: true });
    assert.equal(weak.status, 422);
    assert.equal(weak.body.error.code, 'weak_password');
    assert.equal((await c.post('/api/auth/setup', { setupToken: 'TEST-SETUP-TOKEN', username: 'owner', password: 'aaaaaaaaaaaaaaaa', acceptTerms: true })).status, 422);
    const ok = await c.post('/api/auth/setup', { setupToken: 'TEST-SETUP-TOKEN', username: 'owner', password: GOOD, timezone: 'America/Bogota', acceptTerms: true });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.csrfToken);
    assert.equal((await c.get('/api/bootstrap')).status, 200, 'setup signs the owner in');
    assert.equal((await c.get('/api/settings')).body.settings.timezone, 'America/Bogota', 'browser timezone is stored at setup');
    const again = await new Client(srv.url).post('/api/auth/setup', { setupToken: 'TEST-SETUP-TOKEN', username: 'intruder', password: GOOD, acceptTerms: true });
    assert.equal(again.status, 409);
    // The password is stored as a scrypt hash, never in plain text.
    const hash = srv.app.db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = 1')!.password_hash;
    assert.match(hash, /^scrypt\$\d+\$8\$1\$/);
    assert.ok(!hash.includes(GOOD));
    assert.equal(srv.app.db.get("SELECT value FROM app_meta WHERE key = 'setup_token_hash'"), undefined, 'the setup code is invalidated');
  } finally {
    await srv.cleanup();
  }
});

test('there is no public registration and protected endpoints require a session', async () => {
  const srv = await startTestServer();
  try {
    const anon = new Client(srv.url);
    for (const p of ['/api/bootstrap', '/api/vocab?lang=es', '/api/backups', '/api/stats/overview', '/api/sessions/active', '/api/system', '/api/export/progress', '/api/audio/usage']) {
      const r = await anon.get(p);
      assert.equal(r.status, 401, p);
    }
    assert.equal((await anon.post('/api/auth/register', { username: 'x', password: GOOD })).status, 404);
    assert.equal((await anon.post('/api/sessions', { id: crypto.randomUUID(), language: 'es' })).status, 401);
  } finally {
    await srv.cleanup();
  }
});

test('login rate limiting locks out an IP after five failures, even with the right password', async () => {
  const srv = await startTestServer();
  try {
    const c = new Client(srv.url);
    await c.setup();
    const attacker = new Client(srv.url);
    for (let i = 0; i < 5; i++) {
      const r = await attacker.post('/api/auth/login', { username: 'owner', password: `wrong-${i}-password` });
      assert.equal(r.status, 401, `attempt ${i + 1}`);
      assert.equal(r.body.error.message, 'Incorrect username or password.');
    }
    const locked = await attacker.post('/api/auth/login', { username: 'owner', password: GOOD });
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error.code, 'too_many_attempts');
    assert.ok(Number(locked.headers.get('retry-after')) > 0);
    // Unknown usernames get the same generic error (no account enumeration).
    srv.app.db.tx(() => srv.app.db.run('DELETE FROM login_attempts'));
    const unknown = await attacker.post('/api/auth/login', { username: 'admin', password: GOOD });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error.message, 'Incorrect username or password.');
    // After the window passes (simulated), the owner can sign in again.
    srv.app.db.tx(() => srv.app.db.run('UPDATE login_attempts SET attempted_at = attempted_at - ?', 16 * 60_000));
    assert.equal((await attacker.post('/api/auth/login', { username: 'OWNER', password: GOOD })).status, 200, 'username is case-insensitive');
  } finally {
    await srv.cleanup();
  }
});

test('mutations require the CSRF token and a same-origin request', async () => {
  const srv = await startTestServer();
  try {
    const c = new Client(srv.url);
    await c.setup();
    const csrf = c.csrf;
    c.csrf = '';
    const missing = await c.put('/api/settings', { theme: 'dark' });
    assert.equal(missing.status, 403);
    assert.equal(missing.body.error.code, 'csrf_failed');
    c.csrf = 'forged-token';
    assert.equal((await c.put('/api/settings', { theme: 'dark' })).status, 403);
    c.csrf = csrf;
    assert.equal((await c.put('/api/settings', { theme: 'dark' })).status, 200);
    const cross = await c.req('PUT', '/api/settings', { theme: 'light' }, { Origin: 'https://evil.example' });
    assert.equal(cross.status, 403);
    assert.equal(cross.body.error.code, 'bad_origin');
    const site = await c.req('PUT', '/api/settings', { theme: 'light' }, { 'Sec-Fetch-Site': 'cross-site' });
    assert.equal(site.status, 403);
    const sameOrigin = await c.req('PUT', '/api/settings', { theme: 'light' }, { Origin: srv.url });
    assert.equal(sameOrigin.status, 200);
    assert.equal((await c.get('/api/settings')).body.settings.theme, 'light');
    // Login itself is also protected against cross-site form posts.
    const crossLogin = await new Client(srv.url).req('POST', '/api/auth/login', { username: 'owner', password: GOOD }, { Origin: 'https://evil.example' });
    assert.equal(crossLogin.status, 403);
  } finally {
    await srv.cleanup();
  }
});

test('logout, logout-everywhere, password change and session expiry invalidate sessions', async () => {
  const srv = await startTestServer();
  try {
    const phone = new Client(srv.url);
    await phone.setup();
    const laptop = new Client(srv.url);
    await laptop.login();
    const sessions = (await laptop.get('/api/auth/sessions')).body;
    assert.equal(sessions.length, 2);
    assert.equal(sessions.filter((s: any) => s.current).length, 1);
    assert.ok(sessions.every((s: any) => s.id.length === 12), 'only a short id prefix is exposed, never the token');
    const oldCookie = laptop.cookie;
    const out = await laptop.post('/api/auth/logout');
    assert.equal(out.status, 200);
    assert.match(out.headers.get('set-cookie') ?? '', /vb_session=;.*Max-Age=0/);
    laptop.cookie = oldCookie;
    assert.equal((await laptop.get('/api/bootstrap')).status, 401, 'the old cookie no longer works');
    assert.equal((await phone.get('/api/bootstrap')).status, 200, 'other devices stay signed in');
    // Idle expiry.
    srv.app.db.tx(() => srv.app.db.run('UPDATE auth_sessions SET idle_expires_at = ?', Date.now() - 1));
    assert.equal((await phone.get('/api/bootstrap')).status, 401);
    assert.equal(srv.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM auth_sessions')!.n, 0, 'expired sessions are deleted');
    // Absolute expiry applies even to active sessions.
    await phone.login();
    srv.app.db.tx(() => srv.app.db.run('UPDATE auth_sessions SET absolute_expires_at = ?', Date.now() - 1));
    assert.equal((await phone.get('/api/bootstrap')).status, 401);
    // Password change signs out every other device.
    await phone.login();
    await laptop.login();
    const weak = await phone.post('/api/auth/password', { currentPassword: GOOD, newPassword: 'short' });
    assert.equal(weak.status, 422);
    const wrongCurrent = await phone.post('/api/auth/password', { currentPassword: 'not it at all', newPassword: 'another long passphrase' });
    assert.equal(wrongCurrent.status, 403);
    const changed = await phone.post('/api/auth/password', { currentPassword: GOOD, newPassword: 'another long passphrase' });
    assert.equal(changed.status, 200);
    assert.equal((await laptop.get('/api/bootstrap')).status, 401);
    assert.equal((await phone.get('/api/bootstrap')).status, 200);
    assert.equal((await new Client(srv.url).post('/api/auth/login', { username: 'owner', password: GOOD })).status, 401);
    assert.equal((await new Client(srv.url).post('/api/auth/login', { username: 'owner', password: 'another long passphrase' })).status, 200);
    await phone.post('/api/auth/logout-all');
    assert.equal(srv.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM auth_sessions')!.n, 0);
  } finally {
    await srv.cleanup();
  }
});

test('session cookies are HttpOnly, SameSite=Lax, and Secure behind HTTPS', async () => {
  const srv = await startTestServer({ env: { VB_TRUST_PROXY: '1' } });
  try {
    const c = new Client(srv.url);
    const r = await c.req('POST', '/api/auth/setup', { setupToken: 'TEST-SETUP-TOKEN', username: 'owner', password: GOOD, acceptTerms: true }, { 'X-Forwarded-Proto': 'https' });
    assert.equal(r.status, 200);
    const cookie = r.headers.get('set-cookie')!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /Path=\//);
    const plain = await new Client(srv.url).post('/api/auth/login', { username: 'owner', password: GOOD });
    assert.doesNotMatch(plain.headers.get('set-cookie')!, /Secure/, 'plain-HTTP LAN testing still works');
  } finally {
    await srv.cleanup();
  }
});

test('security headers are present on API, health and app responses', async () => {
  const srv = await startTestServer();
  try {
    for (const p of ['/api/auth/status', '/healthz', '/', '/vocabulary']) {
      const res = await fetch(srv.url + p);
      const csp = res.headers.get('content-security-policy') ?? '';
      assert.match(csp, /default-src 'self'/, p);
      assert.match(csp, /frame-ancestors 'none'/, p);
      assert.match(csp, /media-src 'self' blob: https:\/\/\*\.forvo\.com/, p);
      assert.doesNotMatch(csp, /unsafe-eval/, p);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', p);
      assert.equal(res.headers.get('x-frame-options'), 'DENY', p);
      assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', p);
      assert.match(res.headers.get('permissions-policy') ?? '', /microphone=\(self\)/, p);
      await res.arrayBuffer();
    }
    const api = await fetch(srv.url + '/api/auth/status');
    assert.equal(api.headers.get('cache-control'), 'no-store');
    const traversal = await fetch(srv.url + '/..%2f..%2fpackage.json');
    assert.notEqual(traversal.status, 200, 'no path traversal out of the static directory');
    await traversal.arrayBuffer();
  } finally {
    await srv.cleanup();
  }
});

test('the Forvo key, password hash and setup code never appear in any API response', async () => {
  const srv = await startTestServer({ env: { VB_FORVO_API_KEY: 'SUPER-SECRET-FORVO-KEY-123' } });
  try {
    const c = new Client(srv.url);
    const statusBefore = await c.get('/api/auth/status');
    await c.setup();
    const hash = srv.app.db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = 1')!.password_hash;
    const texts: string[] = [JSON.stringify(statusBefore.body)];
    for (const p of ['/api/auth/status', '/api/bootstrap', '/api/settings', '/api/system', '/api/audio/usage', '/api/auth/sessions', '/api/backups', '/api/stats/overview', '/api/export/progress']) {
      const r = await c.get(p);
      assert.equal(r.status, 200, p);
      texts.push(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
    }
    for (const t of texts) {
      assert.ok(!t.includes('SUPER-SECRET-FORVO-KEY-123'), 'Forvo key leaked');
      assert.ok(!t.includes(hash) && !t.includes('scrypt$'), 'password hash leaked');
      assert.ok(!t.includes('TEST-SETUP-TOKEN'), 'setup code leaked');
    }
    assert.equal((await c.get('/api/bootstrap')).body.forvo.configured, true, 'clients only learn that Forvo is configured');
  } finally {
    await srv.cleanup();
  }
});

test('request bodies are validated and size-limited', async () => {
  const srv = await startTestServer();
  try {
    const c = new Client(srv.url);
    await c.setup();
    const bad = await c.put('/api/settings', { theme: 'neon' });
    assert.equal(bad.status, 422);
    const unknown = await c.put('/api/settings', { isAdmin: true });
    assert.equal(unknown.status, 422, 'unknown settings keys are rejected');
    const tz = await c.put('/api/settings', { timezone: 'Mars/Base' });
    assert.equal(tz.status, 422);
    const malformed = await c.req('PUT', '/api/settings', '{not json', { 'Content-Type': 'application/json' });
    assert.equal(malformed.status, 400);
    const huge = await c.req('PUT', '/api/settings', JSON.stringify({ theme: 'x'.repeat(2 * 1024 * 1024) }), { 'Content-Type': 'application/json' });
    assert.equal(huge.status, 413);
  } finally {
    await srv.cleanup();
  }
});

test('parallel sign-in attempts cannot get around the limit', async () => {
  const burst = await startTestServer();
  try {
    const owner = new Client(burst.url);
    await owner.setup();
    const results = await Promise.all(
      Array.from({ length: 30 }, () => fetch(`${burst.url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: 'wrong password guess' }) }).then((r) => r.status)),
    );
    const checked = results.filter((s) => s === 401).length;
    assert.ok(checked <= 5, `at most five passwords were actually checked (got ${checked})`);
    assert.equal(results.filter((s) => s === 429).length, 30 - checked);
    // Attempts refused as "busy" are not counted as failures; the per-IP lock still follows the checked ones.
    const recorded = burst.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM login_attempts WHERE success = 0')!.n;
    assert.equal(recorded, checked);
  } finally {
    await burst.cleanup();
  }
});
