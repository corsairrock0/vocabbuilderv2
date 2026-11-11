// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Forvo integration with a mocked fetch: URL format, honest accent labels, ranking,
// quota, errors, link expiry and the "never fetch or cache audio" rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../../server/db/database.ts';
import { migrate } from '../../server/db/migrate.ts';
import { loadConfig } from '../../server/config.ts';
import { FORVO_LINK_LIFETIME_MS, ForvoClient, ForvoError, forvoUsageDay, LINK_TTL_MS } from '../../server/audio/forvo.ts';
import { labelRecording, rankScore } from '../../server/audio/accent.ts';
import { lookupAudio, forvoPageUrl } from '../../server/audio/service.ts';
import { createEntry } from '../../server/vocab/repo.ts';
import { updateLanguageSettings } from '../../server/services/settings.ts';
import { loadStudyEntries, ensureItem } from '../../server/vocab/repo.ts';
import { LANGUAGE_CODES, LANGUAGES, type LanguageCode } from '../../shared/languages.ts';
import type { App } from '../../server/app.ts';

type Call = { url: string };

function mockFetch(handler: (url: string) => { status?: number; body?: unknown; throws?: Error; rawText?: string }) {
  const calls: Call[] = [];
  const fn = async (url: string) => {
    calls.push({ url });
    const r = handler(url);
    if (r.throws) throw r.throws;
    return {
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      async json() {
        if (r.rawText != null) return JSON.parse(r.rawText);
        return r.body;
      },
      async text() {
        return r.rawText ?? JSON.stringify(r.body);
      },
    };
  };
  return { fn, calls };
}

const item = (id: number, country: string, user: string, votes = 0, extra: Record<string, unknown> = {}) => ({
  id,
  word: 'agua',
  original: 'agua',
  addtime: '2015-01-01 00:00:00',
  hits: 100,
  username: user,
  sex: 'f',
  country,
  code: 'es',
  langname: 'Spanish',
  pathmp3: `https://apifree.forvo.com/audio/mp3/${id}`,
  pathogg: `https://apifree.forvo.com/audio/ogg/${id}`,
  rate: votes,
  num_votes: votes,
  num_positive_votes: votes,
  ...extra,
});

async function freshDb() {
  const db = new Db(':memory:');
  await migrate(db);
  return db;
}

function client(db: Db, fetchFn: any, limit = 100, key: string | null = 'TEST-FORVO-KEY') {
  return new ForvoClient({ apiKey: key, apiBase: 'https://apifree.forvo.com', dailyLimit: limit, timeoutMs: 1000 }, db, fetchFn);
}

async function appWith(fetchFn: any, opts: { key?: string | null; limit?: number } = {}): Promise<{ app: App; db: Db }> {
  const db = await freshDb();
  const config = loadConfig({ ...process.env, NODE_ENV: 'test', VB_DATA_DIR: '/tmp/vb-forvo-unused', VB_FORVO_API_KEY: opts.key === undefined ? 'TEST-FORVO-KEY' : (opts.key ?? '') });
  const forvo = new ForvoClient({ ...config.forvo, dailyLimit: opts.limit ?? 100 }, db, fetchFn);
  return { app: { config, db, forvo, backups: null as any, maintenance: { active: false, reason: null } }, db };
}

function addWord(db: Db, language: LanguageCode, lemma: string, gloss = 'water') {
  return db.tx(() => createEntry(db, language, { lemma, senses: [{ gloss }] }, Date.now(), { custom: true }));
}

test('URL format: action, Forvo language code and ISO alpha-3 country filter', () => {
  const c = client(new Db(':memory:'), async () => ({}));
  assert.equal(
    c.buildUrl('agua', 'es', 'COL'),
    'https://apifree.forvo.com/key/TEST-FORVO-KEY/format/json/action/word-pronunciations/word/agua/language/es/country/COL/order/rate-desc/limit/20',
  );
  // Multi-word terms and diacritics are URL-encoded as one path segment.
  assert.match(c.buildUrl('cảm ơn', 'vi', 'VNM'), /\/word\/c%E1%BA%A3m%20%C6%A1n\/language\/vi\/country\/VNM\//);
  assert.doesNotMatch(c.buildUrl('agua', 'es'), /country/);
});

test('default accent profiles use alpha-3 countries and Forvo language codes for all six languages', async () => {
  const expected: Record<LanguageCode, [string, string]> = { es: ['es', 'COL'], pt: ['pt', 'BRA'], vi: ['vi', 'VNM'], ru: ['ru', 'RUS'], uk: ['uk', 'UKR'], pl: ['pl', 'POL'] };
  const words: Record<LanguageCode, string> = { es: 'agua', pt: 'água', vi: 'nước', ru: 'вода', uk: 'вода', pl: 'woda' };
  for (const code of LANGUAGE_CODES) {
    const { fn, calls } = mockFetch(() => ({ body: { attributes: { total: 2 }, items: [item(1, 'X', 'a', 1), item(2, 'X', 'b', 1)] } }));
    const { app, db } = await appWith(fn);
    const id = addWord(db, code, words[code]);
    await lookupAudio(app, id);
    const [lang, country] = expected[code];
    assert.equal(LANGUAGES[code].forvoCode, lang);
    assert.ok(calls.length >= 1);
    assert.match(calls[0].url, new RegExp(`/language/${lang}/country/${country}/`), `${code}: ${calls[0].url}`);
    db.close();
  }
});

test('honest accent labels: country verified at most, never a city or region claim', () => {
  const cities = /Bogot|Moscow|Москв|Kyiv|Kiev|Київ|Warsaw|Warszaw|Saigon|Ho Chi Minh|Southern/i;
  const cases: Array<[LanguageCode, string, string]> = [
    ['es', 'es-CO', 'Colombia'],
    ['pt', 'pt-BR', 'Brazil'],
    ['vi', 'vi-South', 'Vietnam'],
    ['ru', 'ru-RU', 'Russia'],
    ['uk', 'uk-UA', 'Ukraine'],
    ['pl', 'pl-PL', 'Poland'],
  ];
  for (const [lang, accent, country] of cases) {
    const l = labelRecording(lang, accent, country);
    assert.doesNotMatch(l.accentLabel, cities, `${lang}: ${l.accentLabel}`);
    assert.equal(l.verification, 'country_verified');
    assert.equal(l.matchesPreference, true);
  }
  assert.match(labelRecording('es', 'es-CO', 'Colombia').accentLabel, /^Colombian Spanish — country verified/);
  assert.match(labelRecording('pt', 'pt-BR', 'Brazil').accentLabel, /^Brazilian Portuguese — country verified/);
  assert.match(labelRecording('vi', 'vi-South', 'Vietnam').accentLabel, /regional accent unverified/);
  assert.match(labelRecording('ru', 'ru-RU', 'Russian Federation').accentLabel, /Russian \(Russia\) — specific regional accent unverified/);
  // A different country is labelled as such and does not match the preference.
  const mx = labelRecording('es', 'es-CO', 'Mexico');
  assert.match(mx.accentLabel, /not your preferred variety/);
  assert.equal(mx.matchesPreference, false);
  // Unknown country: unverified.
  const unknown = labelRecording('uk', 'uk-UA', null);
  assert.equal(unknown.verification, 'unverified');
  assert.match(unknown.accentLabel, /unknown/);
  // Only the owner's own verification can confirm a region.
  const mine = labelRecording('vi', 'vi-South', 'Vietnam', { preference: 'preferred', accentNote: 'Southern (Saigon)', verifiedByUser: true });
  assert.equal(mine.verification, 'user_verified');
  assert.equal(mine.accentLabel, 'Southern (Saigon) — verified by you');
});

test('ranking: explicit choice > preferred speaker > accent match > community votes', () => {
  const base = { word: 'agua', queriedWord: 'agua', speaker: 's', votes: 0, positiveVotes: 0, rating: 0, hits: 0, matchesPreference: false, isPreferredRecord: false, speakerPreference: 'neutral' as const };
  const popularForeign = rankScore({ ...base, votes: 30, positiveVotes: 30 });
  const matching = rankScore({ ...base, matchesPreference: true, votes: 1, positiveVotes: 1 });
  const preferredSpeaker = rankScore({ ...base, speakerPreference: 'preferred' });
  const chosen = rankScore({ ...base, isPreferredRecord: true });
  const avoided = rankScore({ ...base, matchesPreference: true, speakerPreference: 'avoid', votes: 10, positiveVotes: 10 });
  assert.ok(matching > popularForeign);
  assert.ok(preferredSpeaker > matching);
  assert.ok(chosen > preferredSpeaker);
  assert.ok(avoided < matching);
});

test('lookupAudio ranks recordings by preference and labels each one', async () => {
  const { fn } = mockFetch((url) =>
    url.includes('/country/COL/')
      ? { body: { items: [item(11, 'Colombia', 'carla', 2), item(12, 'Colombia', 'pedro', 1)] } }
      : { body: { items: [item(13, 'Mexico', 'popular', 40)] } },
  );
  const { app, db } = await appWith(fn);
  const id = addWord(db, 'es', 'agua');
  db.tx(() => db.run("INSERT INTO speaker_profiles (language_code, provider, speaker, preference, updated_at) VALUES ('es', 'forvo', 'pedro', 'preferred', 1)"));
  const r = await lookupAudio(app, id);
  assert.equal(r.status, 'ok');
  assert.deepEqual(
    r.sources.map((s) => s.speaker),
    ['pedro', 'carla'],
    'two Colombian recordings found, so no fallback query; the preferred speaker comes first',
  );
  assert.ok(r.sources.every((s) => s.kind === 'human' && s.provider === 'forvo' && s.attribution === 'Pronunciations by Forvo'));
  assert.ok(
    r.sources.every((s) => s.urlExpiresAt! - Date.now() <= FORVO_LINK_LIFETIME_MS - 10 * 60_000),
    'links are reported as expiring 10 minutes before Forvo’s 2-hour limit',
  );
  assert.equal(r.forvoPageUrl, forvoPageUrl('agua', 'es'));
  assert.equal(r.forvoPageUrl, 'https://forvo.com/word/agua/#es');
  // Metadata (not audio) is stored for preferences; the result is remembered as "found".
  assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM pronunciation_records WHERE provider = 'forvo'")!.n, 2);
  assert.equal(db.get<{ status: string }>('SELECT status FROM audio_lookups WHERE entry_id = ?', id)!.status, 'found');
  // An explicitly chosen recording wins over everything.
  const rec = db.get<{ id: number }>("SELECT id FROM pronunciation_records WHERE provider_ref = '11'")!;
  db.tx(() => db.run('INSERT INTO pronunciation_preferences (entry_id, record_id, updated_at) VALUES (?, ?, 1)', id, rec.id));
  const again = await lookupAudio(app, id);
  assert.equal(again.sources[0].speaker, 'carla');
  assert.equal(again.sources[0].preferred, true);
  db.close();
});

test('falls back to all speakers when the preferred country has too few recordings, labelling mismatches', async () => {
  const { fn, calls } = mockFetch((url) => (url.includes('/country/') ? { body: { items: [] } } : { body: { items: [item(21, 'Spain', 'madrid', 5), item(22, 'Colombia', 'bogo', 1)] } }));
  const { app, db } = await appWith(fn);
  const id = addWord(db, 'es', 'agua');
  const r = await lookupAudio(app, id);
  assert.equal(calls.length, 2);
  assert.equal(r.sources[0].speaker, 'bogo', 'the Colombian speaker ranks first despite fewer votes');
  assert.match(r.sources[1].accentLabel, /Spain\) — not your preferred variety/);
  db.close();
});

test('audio URLs are never fetched or cached: only API metadata requests are made', async () => {
  const { fn, calls } = mockFetch(() => ({ body: { items: [item(31, 'Colombia', 'a', 1), item(32, 'Colombia', 'b', 1)] } }));
  const { app, db } = await appWith(fn);
  const id = addWord(db, 'es', 'agua');
  const r = await lookupAudio(app, id);
  for (const c of calls) assert.match(c.url, /\/action\/word-pronunciations\//);
  for (const s of r.sources) assert.ok(!calls.some((c) => c.url === s.url));
  // No table stores audio links or audio bytes.
  const cols = db.all<{ name: string }>("SELECT name FROM pragma_table_info('pronunciation_records')").map((c) => c.name);
  assert.ok(!cols.some((c) => /url|path|blob|audio_data/.test(c)), cols.join(','));
  // The API key never appears in what the browser receives.
  assert.doesNotMatch(JSON.stringify(r), /TEST-FORVO-KEY/);
  db.close();
});

test('link cache: reused within the 2-hour validity window, refreshed on demand or after expiry', async () => {
  const db = await freshDb();
  const { fn, calls } = mockFetch(() => ({ body: { items: [item(41, 'Brazil', 'ana', 1)] } }));
  const c = client(db, fn);
  const t0 = Date.parse('2026-11-05T10:00:00Z');
  await c.wordPronunciations('água', 'pt', { country: 'BRA', now: t0 });
  await c.wordPronunciations('água', 'pt', { country: 'BRA', now: t0 + 60_000 });
  assert.equal(calls.length, 1, 'second lookup served from the short-lived cache');
  await c.wordPronunciations('água', 'pt', { country: 'BRA', now: t0 + 120_000, refresh: true });
  assert.equal(calls.length, 2, 'refresh forces a new link (e.g. after a playback error)');
  await c.wordPronunciations('água', 'pt', { country: 'BRA', now: t0 + 120_000 + LINK_TTL_MS + 1 });
  assert.equal(calls.length, 3, 'expired links are fetched again');
  assert.ok(LINK_TTL_MS < 2 * 3600_000, 'links are never kept as long as their 2-hour validity');
  c.invalidate('água', 'pt');
  await c.wordPronunciations('água', 'pt', { country: 'BRA', now: t0 + 120_000 + LINK_TTL_MS + 2 });
  assert.equal(calls.length, 4);
  db.close();
});

test('quota: plays and API calls count toward the daily limit; exhausted quota never calls Forvo', async () => {
  const db = await freshDb();
  const { fn, calls } = mockFetch(() => ({ body: { items: [item(51, 'Poland', 'ola', 1)] } }));
  const c = client(db, fn, 3);
  const now = Date.parse('2026-11-05T12:00:00Z');
  await c.wordPronunciations('woda', 'pl', { now });
  c.recordPlays(2, now);
  const u = c.usage(now);
  assert.equal(u.apiRequests, 1);
  assert.equal(u.audioPlays, 2);
  assert.equal(u.remaining, 0);
  await assert.rejects(c.wordPronunciations('kawa', 'pl', { now }), (e: unknown) => e instanceof ForvoError && e.code === 'quota_exceeded');
  assert.equal(calls.length, 1);
  // Forvo's quota day resets at 22:00 UTC.
  assert.equal(forvoUsageDay(Date.parse('2026-11-05T21:59:00Z')), '2026-11-05');
  assert.equal(forvoUsageDay(Date.parse('2026-11-05T22:00:00Z')), '2026-11-06');
  assert.equal(c.usage(Date.parse('2026-11-05T22:30:00Z')).remaining, 3);
  db.close();
});

test('API errors are reported clearly and counted', async () => {
  const db = await freshDb();
  const scenarios: Array<[string, any, ForvoError['code']]> = [
    ['expired key string', { body: ['Your API key has expired.'] }, 'api_error'],
    ['error object', { body: { error: 'Invalid key' } }, 'api_error'],
    ['HTTP 500', { status: 500, body: {} }, 'http_error'],
    ['network', { throws: new TypeError('fetch failed') }, 'network'],
    ['timeout', { throws: Object.assign(new Error('timed out'), { name: 'TimeoutError' }) }, 'timeout'],
    ['bad JSON', { rawText: '<html>' }, 'api_error'],
  ];
  for (const [name, response, code] of scenarios) {
    const { fn } = mockFetch(() => response);
    const c = client(db, fn);
    await assert.rejects(c.wordPronunciations(`w-${name}`, 'ru'), (e: unknown) => e instanceof ForvoError && e.code === code, name);
  }
  assert.ok(client(db, async () => ({})).usage().errors >= scenarios.length);
  // Malformed items (no audio path) are skipped instead of breaking playback.
  const { fn } = mockFetch(() => ({ body: { items: [{ id: 1, username: 'x' }, item(61, 'Russia', 'ok', 1)] } }));
  const items = await client(db, fn).wordPronunciations('вода', 'ru');
  assert.equal(items.length, 1);
  db.close();
});

test('lookupAudio: unconfigured Forvo and API failures degrade gracefully', async () => {
  const { app, db } = await appWith(async () => assert.fail('must not call Forvo when unconfigured'), { key: null });
  const id = addWord(db, 'uk', 'вода');
  const r = await lookupAudio(app, id);
  assert.equal(r.status, 'not_configured');
  assert.equal(r.sources.length, 0);
  assert.match(r.message ?? '', /VB_FORVO_API_KEY/);
  assert.equal(r.forvoPageUrl, 'https://forvo.com/word/%D0%B2%D0%BE%D0%B4%D0%B0/#uk');
  // Study planning treats the word as having no Forvo audio.
  const itemId = db.tx(() => ensureItem(db, id, 'uk', Date.now()));
  assert.equal(loadStudyEntries(db, [itemId], app.forvo.configured, Date.now()).get(itemId)!.audio.forvo, false);
  db.close();

  const failing = mockFetch(() => ({ status: 503, body: {} }));
  const b = await appWith(failing.fn);
  const id2 = addWord(b.db, 'ru', 'вода');
  const r2 = await lookupAudio(b.app, id2);
  assert.equal(r2.status, 'error');
  assert.match(r2.message ?? '', /HTTP 503/);
  b.db.close();
});

test('a word without recordings is remembered so no listening exercises are planned for it', async () => {
  const { fn, calls } = mockFetch(() => ({ body: { items: [] } }));
  const { app, db } = await appWith(fn);
  const id = addWord(db, 'pl', 'źdźbło', 'blade of grass');
  const r = await lookupAudio(app, id);
  assert.equal(r.status, 'none_found');
  assert.equal(calls.length, 2, 'country query, then all speakers');
  const itemId = db.tx(() => ensureItem(db, id, 'pl', Date.now()));
  assert.equal(loadStudyEntries(db, [itemId], true, Date.now()).get(itemId)!.audio.forvo, false);
  db.close();
});

test('changing the preferred accent changes the country filter', async () => {
  const { fn, calls } = mockFetch(() => ({ body: { items: [item(71, 'Portugal', 'lx', 1), item(72, 'Portugal', 'lx2', 1)] } }));
  const { app, db } = await appWith(fn);
  db.tx(() => updateLanguageSettings(db, 'pt', { accent: 'pt-PT' }, Date.now(), null));
  const id = addWord(db, 'pt', 'água');
  const r = await lookupAudio(app, id);
  assert.match(calls[0].url, /\/country\/PRT\//);
  assert.match(r.sources[0].accentLabel, /European Portuguese — country verified/);
  db.close();
});

test('once the daily limit is used up, even cached links are withheld, and expiry counts from Forvo’s response', async () => {
  let calls = 0;
  const db = await freshDb();
  const c = client(db, async () => {
    calls++;
    return new Response(JSON.stringify({ items: [item(1, 'Poland', 'ania')] }), { status: 200 });
  }, 3);
  const t0 = Date.UTC(2026, 10, 5, 12, 0);
  const first = await c.wordPronunciations('dom', 'pl', { now: t0 });
  assert.equal(first[0].fetchedAt, t0);
  const again = await c.wordPronunciations('dom', 'pl', { now: t0 + 60_000 });
  assert.equal(again[0].fetchedAt, t0, 'a cached link keeps its original fetch time');
  assert.equal(calls, 1);
  c.recordPlays(2, t0 + 61_000); // 1 lookup + 2 plays = the daily limit of 3
  await assert.rejects(c.wordPronunciations('dom', 'pl', { now: t0 + 62_000 }), (e: unknown) => e instanceof ForvoError && e.code === 'quota_exceeded');
});
