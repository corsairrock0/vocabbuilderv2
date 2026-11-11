// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Cross-device synchronisation: the server is authoritative; devices see each other's
// progress, schedules and settings; settings use per-key last-writer-wins.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, startTestServer, type TestServer } from '../helpers/harness.ts';
import { importFixture, runSession, shiftHistory, startSession } from '../helpers/study.ts';

let srv: TestServer;
let desktop: Client;
let phone: Client;
let tablet: Client;

before(async () => {
  srv = await startTestServer();
  desktop = new Client(srv.url, 'desktop-aaaa-0001');
  phone = new Client(srv.url, 'iphone-bbbb-0002');
  tablet = new Client(srv.url, 'ipad-cccc-0003');
  await desktop.setup();
  await phone.login();
  await tablet.login();
  await importFixture(desktop, 'ru-mini.json', 'ru');
  await importFixture(desktop, 'vi-mini.json', 'vi');
});
after(() => srv.cleanup());

const stats = async (client: Client, code: string) => (await client.get('/api/bootstrap')).body.languages.find((l: any) => l.code === code).stats;

test('study on the desktop, then see the same progress and schedules on the phone', async () => {
  const s = await startSession(desktop, { language: 'ru', minutes: 30, newWords: 4 });
  await runSession(desktop, s.id);
  const onPhone = await stats(phone, 'ru');
  assert.equal(onPhone.introduced, 4);
  assert.ok(onPhone.studiedTodayMs > 0);
  const list = (await phone.get('/api/vocab?lang=ru&status=learning&limit=50')).body;
  assert.equal(list.total, 4);
  for (const item of list.items) {
    const a = (await desktop.get(`/api/vocab/${item.entryId}`)).body;
    const b = (await phone.get(`/api/vocab/${item.entryId}`)).body;
    assert.deepEqual(
      a.cards.map((c: any) => [c.skill, c.due, c.stability, c.reps]),
      b.cards.map((c: any) => [c.skill, c.due, c.stability, c.reps]),
    );
    assert.equal(b.reviews.length, a.reviews.length);
    assert.ok(b.cards.every((c: any) => c.due > Date.now()), 'next review dates are already updated');
  }
});

test('review on the tablet, then the desktop shows the updated schedule', async () => {
  shiftHistory(srv.app.db, 3);
  const before = (await desktop.get('/api/vocab?lang=ru&due=1&limit=50')).body;
  assert.ok(before.total >= 1);
  const dueCards = (st: any) => st.dueReceptive + st.dueProductive;
  const cardsBefore = dueCards(await stats(desktop, 'ru'));
  const s = await startSession(tablet, { language: 'ru', mode: 'review', minutes: 20 });
  await runSession(tablet, s.id);
  // One memory (recognition or recall) per word is reviewed per session, so compare due memories.
  const cardsAfter = dueCards(await stats(desktop, 'ru'));
  assert.equal(cardsAfter, cardsBefore - s.exercises.filter((e: any) => e.stage === 'A').length, `due memories on desktop: ${cardsBefore} → ${cardsAfter}`);
  const detail = (await desktop.get(`/api/vocab/${before.items[0].entryId}`)).body;
  assert.ok(detail.reviews.some((r: any) => r.reviewedAt > Date.now() - 60_000), 'the tablet review appears in the desktop history');
});

test('Vietnamese studied on the phone appears on the tablet and desktop without touching Russian', async () => {
  const ruBefore = await stats(desktop, 'ru');
  const s = await startSession(phone, { language: 'vi', minutes: 20, newWords: 3 });
  await runSession(phone, s.id);
  const viTablet = await stats(tablet, 'vi');
  assert.equal(viTablet.introduced, 3);
  const ruAfter = await stats(desktop, 'ru');
  assert.equal(ruAfter.introduced, ruBefore.introduced);
  assert.equal(ruAfter.due, ruBefore.due);
});

test('settings — including regional accent preferences — follow you across devices', async () => {
  const r = await desktop.put('/api/languages/es/settings', { accent: 'es-419', playbackRate: 0.75, dailyNewTarget: 15 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const viAccent = await phone.put('/api/languages/vi/settings', { accent: 'vi-South', ttsFallback: true });
  assert.equal(viAccent.status, 200);
  for (const client of [desktop, phone, tablet]) {
    const s = (await client.get('/api/settings')).body;
    assert.equal(s.languageSettings.es.accent, 'es-419');
    assert.equal(s.languageSettings.es.playbackRate, 0.75);
    assert.equal(s.languageSettings.es.dailyNewTarget, 15);
    assert.equal(s.languageSettings.vi.accent, 'vi-South');
    assert.equal(s.languageSettings.vi.ttsFallback, true);
    assert.equal(s.languageSettings.ru.accent, 'ru-RU', 'other languages keep their defaults');
  }
  // Invalid accents for a language are rejected.
  const bad = await desktop.put('/api/languages/ru/settings', { accent: 'es-CO' });
  assert.equal(bad.status, 422);
});

test('settings use per-key last-writer-wins, so concurrent changes never overwrite unrelated keys', async () => {
  await desktop.put('/api/settings', { theme: 'dark' });
  await phone.put('/api/settings', { fontScale: 1.15 });
  let s = (await tablet.get('/api/settings')).body.settings;
  assert.equal(s.theme, 'dark');
  assert.equal(s.fontScale, 1.15);
  await phone.put('/api/settings', { theme: 'light' });
  s = (await desktop.get('/api/settings')).body.settings;
  assert.equal(s.theme, 'light', 'the later write wins for the same key');
  assert.equal(s.fontScale, 1.15);
  const row = srv.app.db.get<{ updated_by_device: string }>("SELECT updated_by_device FROM user_settings WHERE key = 'theme'")!;
  assert.equal(row.updated_by_device, 'iphone-bbbb-0002');
});

test('devices can detect remote changes cheaply through the revision counter', async () => {
  const r1 = (await phone.get('/api/sync/state')).body.revision;
  await desktop.put('/api/settings', { highContrast: true });
  const r2 = (await phone.get('/api/sync/state')).body.revision;
  assert.ok(r2 > r1);
  const devices = (await tablet.get('/api/system')).body.devices.map((d: any) => d.id);
  for (const id of ['desktop-aaaa-0001', 'iphone-bbbb-0002', 'ipad-cccc-0003']) assert.ok(devices.includes(id), id);
});

test('a setting or note changed offline earlier never overwrites a newer change from another device', async () => {
  const t = Date.now();
  // The desktop changes the daily target now; the phone's older offline change arrives afterwards.
  assert.equal((await desktop.put(`/api/languages/es/settings?changedAt=${t}`, { dailyNewTarget: 20 })).status, 200);
  const stale = await phone.put(`/api/languages/es/settings?changedAt=${t - 3_600_000}`, { dailyNewTarget: 5 });
  assert.equal(stale.status, 200);
  assert.equal(stale.body.settings.dailyNewTarget, 20, 'the server answers with the value it kept');
  assert.equal((await phone.get('/api/settings')).body.languageSettings.es.dailyNewTarget, 20);
  // Notes behave the same way, and a mnemonic can be cleared explicitly.
  const entryId = (await desktop.get('/api/vocab?lang=vi&limit=1')).body.items[0].entryId;
  await desktop.put(`/api/vocab/${entryId}/note?changedAt=${t}`, { note: 'newer note', mnemonic: 'a hook' });
  await phone.put(`/api/vocab/${entryId}/note?changedAt=${t - 7_200_000}`, { note: 'older note', mnemonic: null });
  let detail = (await desktop.get(`/api/vocab/${entryId}`)).body;
  assert.equal(detail.note, 'newer note');
  assert.equal(detail.mnemonic, 'a hook');
  await desktop.put(`/api/vocab/${entryId}/note?changedAt=${Date.now() + 1}`, { note: 'newer note', mnemonic: null });
  detail = (await desktop.get(`/api/vocab/${entryId}`)).body;
  assert.equal(detail.mnemonic, null, 'an explicitly cleared mnemonic stays cleared');
});
