// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Statistics: observed accuracy vs model-estimated recall, skills, forecast, retention trade-off,
// and rescheduling when the desired retention changes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, startTestServer, wrongAnswer, type TestServer } from '../helpers/harness.ts';
import { importFixture, runSession, shiftHistory, startSession } from '../helpers/study.ts';

let srv: TestServer;
let c: Client;

before(async () => {
  srv = await startTestServer();
  c = new Client(srv.url);
  await c.setup();
  await importFixture(c, 'ru-mini.json', 'ru');
  await runSession(c, (await startSession(c, { language: 'ru', minutes: 45, newWords: 8 })).id);
  shiftHistory(srv.app.db, 4);
  let misses = 0;
  await runSession(c, (await startSession(c, { language: 'ru', mode: 'review', minutes: 30 })).id, (ex) => {
    if (misses < 2 && ex.stage === 'A') {
      misses++;
      return wrongAnswer(ex);
    }
    return undefined;
  });
});
after(() => srv.cleanup());

test('dashboard figures per language and overall', async () => {
  const boot = (await c.get('/api/bootstrap')).body;
  assert.equal(boot.languages.length, 6);
  assert.deepEqual(boot.languages.map((l: any) => l.flag), ['🇨🇴', '🇧🇷', '🇻🇳', '🇷🇺', '🇺🇦', '🇵🇱']);
  const ru = boot.languages.find((l: any) => l.code === 'ru').stats;
  assert.equal(ru.total, 12);
  assert.equal(ru.introduced, 8);
  assert.equal(ru.newAvailable, 4);
  assert.ok(ru.reviewsToday >= 6);
  assert.ok(ru.studiedTodayMs > 0);
  assert.ok(ru.streakDays >= 1);
  assert.equal(ru.activity14d.length, 14);
  assert.ok(ru.accuracy7d > 0 && ru.accuracy7d < 1);
  const es = boot.languages.find((l: any) => l.code === 'es').stats;
  assert.equal(es.total, 0, 'other languages are independent and empty');
  assert.ok(boot.overview.todayMs > 0);
  assert.ok(boot.overview.weekMs >= boot.overview.todayMs);
  assert.equal(typeof boot.overview.dueTotal, 'number');
});

test('detailed statistics separate observed accuracy from estimated recall', async () => {
  const s = (await c.get('/api/stats/language/ru')).body;
  assert.ok(s.retention.cardsInReview >= 8);
  assert.ok(s.retention.estimatedReceptive > 0 && s.retention.estimatedReceptive <= 1);
  assert.ok(s.retention.observedReviews >= 6, 'reviews at least a day after the previous one');
  assert.ok(s.retention.observedDelayedRecall > 0 && s.retention.observedDelayedRecall < 1, 'two misses were recorded');
  assert.match(s.retention.note, /Estimated recall.*Observed delayed recall/s);
  assert.deepEqual(s.skills.map((x: any) => x.skill), ['recognition', 'listening', 'recall', 'comprehension', 'sentence', 'production', 'speaking']);
  assert.ok(s.skills.find((x: any) => x.skill === 'recognition').attempts > 0);
  assert.ok(s.byKind.length >= 3);
  assert.ok(s.byKind.every((k: any) => k.label && k.attempts > 0));
  assert.equal(s.forecast.length, 14);
  assert.ok(s.missed.length >= 1);
  assert.equal(s.history.length, 90);
  assert.ok(s.frequencyTiers.length >= 1, 'curated order is used when no frequency list exists');
  assert.ok(s.efficiency.studyHours30d > 0);
  assert.ok(s.efficiency.reviewsPerDay30d > 0);
});

test('the retention trade-off shows more reviews for higher targets', async () => {
  const t = (await c.get('/api/stats/retention/ru')).body;
  assert.deepEqual(t.options.map((o: any) => o.retention), [0.8, 0.85, 0.9, 0.93, 0.95, 0.97]);
  for (let i = 1; i < t.options.length; i++) assert.ok(t.options[i].reviewsPerDayPer100 > t.options[i - 1].reviewsPerDayPer100);
  assert.ok(t.cardsInReview > 0);
  assert.match(t.note, /no single target is optimal/);
});

test('changing desired retention reschedules from the full review history', async () => {
  // A word with a multi-day interval (a word just missed is due in one day under any target).
  const pick = srv.app.db.get<{ entry_id: number }>(
    "SELECT li.entry_id FROM fsrs_cards c JOIN learning_items li ON li.id = c.item_id WHERE c.skill = 'receptive' AND c.state = 2 ORDER BY c.scheduled_days DESC LIMIT 1",
  )!;
  const detailBefore = { entryId: pick.entry_id };
  const before = (await c.get(`/api/vocab/${detailBefore.entryId}`)).body.cards.find((x: any) => x.skill === 'receptive');
  assert.ok(before.due - Date.now() > 2 * 86_400_000);
  const r = await c.put('/api/languages/ru/settings', { desiredRetention: 0.97 });
  assert.equal(r.status, 200);
  assert.ok(r.body.rescheduled >= 8);
  const after = (await c.get(`/api/vocab/${detailBefore.entryId}`)).body.cards.find((x: any) => x.skill === 'receptive');
  assert.ok(after.due < before.due, 'a higher retention target shortens intervals');
  assert.equal(after.reps, before.reps, 'history is unchanged; only the schedule is recomputed');
  assert.ok(Math.abs(after.stability - before.stability) < 1e-9, 'memory stability does not depend on the target');
  const back = await c.put('/api/languages/ru/settings', { desiredRetention: 0.9 });
  assert.equal(back.status, 200);
  const restored = (await c.get(`/api/vocab/${detailBefore.entryId}`)).body.cards.find((x: any) => x.skill === 'receptive');
  assert.equal(restored.due, before.due, 'rescheduling is deterministic');
});

test('session history lists completed sessions with their figures', async () => {
  const hist = (await c.get('/api/stats/sessions?lang=ru')).body;
  assert.ok(hist.length >= 2);
  assert.ok(hist.every((h: any) => h.language === 'ru' && h.status === 'completed' && h.startedAt));
});

test('self-rated exercises rated Good count as correct in the per-exercise figures, as in the skills', async () => {
  // Words without example sentences get "say it aloud" cards where a sentence exercise would go; all are rated Good.
  for (const [lemma, gloss] of [['dom', 'house'], ['kot', 'cat'], ['woda', 'water']]) {
    const r = await c.post('/api/vocab', { language: 'pl', lemma, senses: [{ gloss }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  await runSession(c, (await startSession(c, { language: 'pl', minutes: 20, newWords: 3 })).id);
  const s = (await c.get('/api/stats/language/pl')).body;
  const selfRated = s.byKind.filter((k: any) => ['speak_flashcard', 'sentence_create', 'shadowing'].includes(k.kind));
  assert.ok(selfRated.length >= 1, `self-rated kinds: ${s.byKind.map((k: any) => k.kind).join(', ')}`);
  for (const k of selfRated) assert.equal(k.accuracy, 1, `${k.kind} rated Good counts as correct`);
  assert.equal(s.skills.find((x: any) => x.skill === 'speaking').accuracy, 1);
});
