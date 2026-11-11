#!/usr/bin/env node
// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// TEST ONLY — drives a running VocabBuilder container through the HTTP API.
//   node deploy/test/container-smoke.mjs seed   <baseUrl> <stateFile> <fixture.json>
//   node deploy/test/container-smoke.mjs verify <baseUrl> <stateFile>
// "seed": first-run setup, import a fixture, start a session and answer exercises.
// "verify": sign in again (new device) and check that the saved progress is unchanged.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const [mode, base, stateFile, fixture] = process.argv.slice(2);
const USER = 'owner';
const PASS = 'container test passphrase 2026';

function client(deviceId) {
  let cookie = '';
  let csrf = '';
  return {
    get cookie() {
      return cookie;
    },
    async req(method, path, body, headers = {}) {
      const h = { 'X-Device-Id': deviceId, ...headers };
      if (cookie) h.Cookie = cookie;
      if (method !== 'GET' && csrf) h['X-CSRF-Token'] = csrf;
      let payload;
      if (body instanceof Uint8Array || typeof body === 'string') payload = body;
      else if (body !== undefined) {
        h['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      const res = await fetch(base + path, { method, headers: h, body: payload });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        if (pair.slice(0, i) === 'vb_session') cookie = `vb_session=${pair.slice(i + 1)}`;
      }
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      if (json && typeof json === 'object' && json.csrfToken) csrf = json.csrfToken;
      return { status: res.status, body: json, headers: res.headers };
    },
  };
}

function answerFor(ex) {
  const p = ex.payload;
  if (ex.kind === 'intro') return {};
  if (p.correctId) return { choiceId: p.correctId };
  if (p.answer) return { response: p.answer.accepted[0] };
  return { selfRating: 3 };
}

function check(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
}

if (mode === 'seed') {
  const c = client(`device-a-${randomUUID().slice(0, 8)}`);
  const status = await c.req('GET', '/api/auth/status');
  check(status.body.setupRequired === true, 'fresh volume requires first-run setup');
  const bad = await c.req('POST', '/api/auth/setup', { setupToken: 'WRONG', username: USER, password: PASS });
  check(bad.status === 403, 'setup rejects a wrong setup code');
  const setup = await c.req('POST', '/api/auth/setup', { setupToken: process.env.SETUP_TOKEN, username: USER, password: PASS, timezone: 'Europe/Kyiv', acceptTerms: true });
  check(setup.status === 200, `owner account created (${setup.status})`);
  const up = await c.req('POST', '/api/import/upload?lang=ru&kind=vocabulary&filename=ru-mini.json', readFileSync(fixture), { 'Content-Type': 'application/json' });
  check(up.status === 200, `fixture uploaded (${up.body?.rowCount} rows)`);
  const commit = await c.req('POST', `/api/import/${up.body.id}/commit`, { mapping: {}, options: {} });
  check(commit.status === 200 && commit.body.stats.created > 0, `fixture imported (${commit.body?.stats?.created} words)`);
  const starter = await c.req('POST', '/api/import/starter', { language: 'es' });
  check(starter.status === 200, `bundled Spanish starter set imported (${starter.body?.stats?.created} words)`);
  const sets = await c.req('GET', '/api/import/frequency-sets');
  const bundled = Object.entries(sets.body ?? {}).filter(([, s]) => s && s.words === 6000);
  check(sets.status === 200 && bundled.length === 6, `all six most-frequent-word sets are in the image (${bundled.map(([code]) => code).join(', ')})`);
  const report = await c.req('GET', '/api/import/frequency-sets/uk/report');
  check(report.status === 200 && String(report.body).includes('## Skipped words'), 'the Ukrainian build report is served');
  const pl = await c.req('POST', '/api/import/frequency-set', { language: 'pl' });
  check(pl.status === 200 && pl.body.stats.created === 6000, `the 6,000 most frequent Polish words load (${pl.body?.stats?.created} words)`);
  const found = await c.req('GET', `/api/vocab?lang=pl&q=${encodeURIComponent('kobieta')}&limit=20`);
  const kobieta = found.body?.items?.find((e) => e.lemma === 'kobieta');
  const detail = kobieta ? await c.req('GET', `/api/vocab/${kobieta.entryId}`) : null;
  check(!!detail && detail.body.paradigm?.cells?.['ins|pl']?.includes('kobietami'), 'Polish words come with their declension tables');
  check(!!detail && detail.body.examples.some((x) => x.target && x.source), 'and with sourced example sentences');
  const practice = await c.req('GET', '/api/practice/summary/pl');
  check(practice.status === 200 && practice.body.forms?.words > 3000 && practice.body.cloze?.words > 5000, `forms and sentence practice have material (${practice.body?.forms?.words} tables, ${practice.body?.cloze?.words} words with sentences)`);
  check(practice.body.identify?.words > 500 && practice.body.identify?.scenes > 150, `Identify has pictures for the Polish words (${practice.body?.identify?.words} words in ${practice.body?.identify?.scenes} pictures)`);
  const pics = await c.req('POST', '/api/practice/identify/batch', { language: 'pl', scope: 'all', choices: true, size: 3 });
  const first = pics.body?.items?.[0];
  const img = first ? await fetch(base + first.scene.src.small, { headers: { Cookie: c.cookie } }) : null;
  const bytes = img?.ok ? (await img.arrayBuffer()).byteLength : 0;
  check(pics.status === 200 && pics.body.items.length === 3 && first.choices.length === 4, 'an Identify batch comes with four options per picture');
  check(img?.ok && img.headers.get('content-type') === 'image/webp' && /immutable/.test(img.headers.get('cache-control') ?? '') && bytes > 10_000, `its picture is served from the image (${bytes} bytes, ${img?.headers.get('cache-control')})`);
  const sessionId = randomUUID();
  const s = await c.req('POST', '/api/sessions', { id: sessionId, language: 'ru', minutes: 20, newWords: 5 });
  check(s.status === 200, `study session planned (${s.body.exercises?.length} exercises)`);
  const pending = s.body.exercises.filter((e) => e.status === 'pending').sort((a, b) => a.seq - b.seq);
  let answered = 0;
  for (const ex of pending.slice(0, 12)) {
    const opId = randomUUID();
    const r = await c.req('POST', `/api/sessions/${sessionId}/attempts`, { opId, exerciseId: ex.id, answeredAt: Date.now(), latencyMs: 3000, activeMsDelta: 4000, ...answerFor(ex) }, { 'Idempotency-Key': opId });
    check(r.status === 200, `answered ${ex.kind}`);
    answered++;
  }
  const after = await c.req('GET', `/api/sessions/${sessionId}`);
  const done = after.body.exercises.filter((e) => e.status !== 'pending').length;
  const home = await c.req('GET', '/');
  check(home.status === 200 && String(home.headers.get('content-security-policy')).includes("default-src 'self'"), 'static app shell served with security headers');
  const cssPath = String(home.body).match(/\/assets\/app-[\w-]+\.css/)?.[0];
  check(!!cssPath, `app shell links its hashed stylesheet (${cssPath})`);
  const css = await c.req('GET', cssPath);
  check(css.status === 200 && css.headers.get('cache-control')?.includes('immutable'), 'hashed assets served as immutable');
  writeFileSync(stateFile, JSON.stringify({ sessionId, done, answered, cookie: c.cookie }, null, 2));
  console.log(JSON.stringify({ sessionId, done, answered }));
} else if (mode === 'verify') {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const c = client(`device-b-${randomUUID().slice(0, 8)}`);
  const status = await c.req('GET', '/api/auth/status');
  check(status.body.setupRequired === false, 'owner account still exists (no setup prompt)');
  const login = await c.req('POST', '/api/auth/login', { username: USER, password: PASS });
  check(login.status === 200, 'signed in from a new device');
  const s = await c.req('GET', `/api/sessions/${state.sessionId}`);
  check(s.status === 200, 'interrupted session still exists');
  const done = s.body.exercises.filter((e) => e.status !== 'pending').length;
  check(done === state.done, `session position preserved (${done} of ${s.body.exercises.length} done)`);
  const active = await c.req('GET', '/api/sessions/active?lang=ru');
  check(active.body.some((x) => x.id === state.sessionId), 'session offered for resume');
  const boot = await c.req('GET', '/api/bootstrap');
  const ru = boot.body.languages.find((l) => l.code === 'ru');
  const es = boot.body.languages.find((l) => l.code === 'es');
  check(ru.stats.total === 12 && es.stats.total > 0, `vocabulary intact (ru ${ru.stats.total}, es ${es.stats.total})`);
  check(ru.stats.introduced > 0, `learning progress intact (${ru.stats.introduced} ru words introduced)`);
  check(es.stats.introduced === 0, 'languages stay separate (no Spanish progress)');
  const pl = boot.body.languages.find((l) => l.code === 'pl');
  check(pl.stats.total === 6000 && pl.frequencySet?.loaded === true, `the Polish frequency set survived the restart (${pl.stats.total} words)`);
  const words = await c.req('GET', '/api/vocab?lang=ru&status=introduced&limit=50');
  console.log(JSON.stringify({ done, introduced: ru.stats.introduced, introducedWords: words.body.total }));
} else {
  console.error('usage: container-smoke.mjs seed|verify <baseUrl> <stateFile> [fixture]');
  process.exit(2);
}
