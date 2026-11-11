// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// The Progress page's figures (GET /api/stats/progress/:code and …/period, server/services/progress.ts), from real study
// moved into the past and from practice answers dated in the past: words known, being learned and not started (the
// Words page's statuses, the same on Home); the words-known history rebuilt from the review log, with words marked known
// (on their page or on a session's new-word card), suspended and deleted on their days; the 1,000 most common words;
// the milestone pace; each skill's answers, accuracy and trend per period, every answer in exactly one skill; study time
// against the daily goal, and the setting; the reviews coming up and the minutes a day that keep up; the words missed most.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client, nextPending, startTestServer, wrongAnswer, type TestServer } from '../helpers/harness.ts';
import { answer, importFixture, runSession, shiftHistory, startSession, TZ } from '../helpers/study.ts';
import { skillOf } from '../../shared/activity.ts';
import { practiceLeft } from '../../shared/mix.ts';
import { minutesToKeepUp, nextMilestone, weeklyBars } from '../../shared/progress.ts';
import { addDays, localDay, startOfLocalDay } from '../../shared/time.ts';

const DAY = 86_400_000;
let srv: TestServer;
let c: Client;
const today = () => localDay(Date.now(), TZ);
const db = () => srv.app.db;

const progress = async (lang: string) => {
  const r = await c.get(`/api/stats/progress/${lang}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const period = async (lang: string, window?: string) => {
  const r = await c.get(`/api/stats/progress/${lang}/period${window ? `?window=${window}` : ''}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const wordsWith = async (lang: string, status: string) => (await c.get(`/api/vocab?lang=${lang}&status=${status}&limit=1`)).body.total as number;
const entryId = (lang: string, lemma: string) => db().get<{ id: number }>('SELECT id FROM vocabulary_entries WHERE language_code = ? AND lemma = ?', lang, lemma)!.id;
const sentenceOf = (entry: number) => db().get<{ id: number }>('SELECT sentence_id AS id FROM entry_examples WHERE entry_id = ?', entry)!.id;
const learnedEntries = () =>
  db()
    .all<{ entry_id: number }>(
      `SELECT li.entry_id FROM learning_items li JOIN vocabulary_entries e ON e.id = li.entry_id AND e.deleted_at IS NULL
         JOIN fsrs_cards r ON r.item_id = li.id AND r.skill = 'receptive'
        WHERE li.language_code = 'ru' AND li.status = 'active' AND r.reps >= 2 AND r.stability >= 3 ORDER BY li.id`,
    )
    .map((r) => r.entry_id);

async function importDoc(lang: string, entries: unknown[]) {
  const doc = { format: 'vocabbuilder-v1', language: lang, source: { name: `Progress test set (${lang})`, kind: 'curated', license: 'CC0-1.0' }, entries };
  const up = await c.post(`/api/import/upload?lang=${lang}&kind=vocabulary&filename=set.json`, Buffer.from(JSON.stringify(doc)), { 'Content-Type': 'application/octet-stream' });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const commit = await c.post(`/api/import/${up.body.id}/commit`, { mapping: {}, options: {} });
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
}

before(async () => {
  srv = await startTestServer();
  c = new Client(srv.url);
  await c.setup();
  // Russian: eight new words ten days ago, reviewed six days ago with two misses.
  await importFixture(c, 'ru-mini.json', 'ru');
  await runSession(c, (await startSession(c, { language: 'ru', minutes: 45, newWords: 8 })).id);
  shiftHistory(db(), 4);
  let misses = 0;
  await runSession(c, (await startSession(c, { language: 'ru', mode: 'review', minutes: 30 })).id, (ex) => {
    if (misses < 2 && ex.stage === 'A') {
      misses++;
      return wrongAnswer(ex);
    }
    return undefined;
  });
  shiftHistory(db(), 6);
});
after(() => srv.cleanup());

let reviewDayKnown = 0;

test('the Words page’s quick filters count what the list shows for each', async () => {
  const id = entryId('ru', db().get<{ lemma: string }>("SELECT lemma FROM vocabulary_entries WHERE language_code = 'ru' ORDER BY id LIMIT 1")!.lemma);
  assert.equal((await c.post(`/api/vocab/${id}/flags`, { favorite: true })).status, 200);
  const meta = (await c.get('/api/vocab/meta?lang=ru')).body;
  const total = async (filter: string) => (await c.get(`/api/vocab?lang=ru&limit=1${filter}`)).body.total as number;
  assert.deepEqual(meta.counts, { all: await total(''), due: await total('&due=1'), difficult: await total('&difficult=1'), favorite: await total('&favorite=1') });
  assert.equal(meta.counts.favorite, 1);
  assert.ok(meta.counts.all > meta.counts.due);
  assert.equal((await c.post(`/api/vocab/${id}/flags`, { favorite: false })).status, 200);
});

test('known, being learned and not started are the Words page’s statuses, and Home shows the same counts', async () => {
  const p = await progress('ru');
  assert.equal(p.language, 'ru');
  assert.equal(p.words.known, (await wordsWith('ru', 'learned')) + (await wordsWith('ru', 'known')));
  assert.equal(p.words.learning, await wordsWith('ru', 'learning'));
  assert.equal(p.words.notStarted, await wordsWith('ru', 'new'));
  assert.equal(p.words.known + p.words.learning + p.words.notStarted, 12);
  assert.ok(p.words.known >= 3, `words recalled after a delay are known: ${p.words.known}`);
  assert.equal(p.words.learning, 8 - p.words.known, 'the words met and not yet learned');
  const ru = (await c.get('/api/bootstrap')).body.languages.find((l: any) => l.code === 'ru').stats;
  assert.deepEqual([ru.known, ru.learning], [p.words.known, p.words.learning]);
  reviewDayKnown = p.words.known;
});

test('the 90-day history comes from the review log: nothing known until the reviews six days ago, then every word learned in them', async () => {
  const p = await progress('ru');
  const h = p.words.history;
  assert.equal(h.firstDay, addDays(today(), -89));
  assert.equal(h.known.length, 90);
  // A new word's first rating is one review, so the session ten days ago taught words without making them known.
  assert.deepEqual(h.known.slice(0, 83), Array(83).fill(0));
  assert.deepEqual(h.known.slice(83), Array(7).fill(reviewDayKnown));
  assert.equal(h.known[89], p.words.known, 'today is the count now');
  // The pace of the last 30 days, and the milestone it leads to.
  assert.ok(Math.abs(p.words.pacePerDay - reviewDayKnown / 30) < 1e-9);
  assert.deepEqual(p.words.milestone, nextMilestone(reviewDayKnown, reviewDayKnown / 30));
  assert.equal(p.words.milestone.target, 100);
  assert.ok(Number.isInteger(p.words.milestone.weeks) && p.words.milestone.weeks >= 1);
});

let markedOnPage = 0;

test('a word marked known on its page counts from that moment; starring it or flagging it difficult later leaves that day alone', async () => {
  const before = await progress('ru');
  markedOnPage = db().get<{ id: number }>(
    "SELECT e.id FROM vocabulary_entries e LEFT JOIN learning_items li ON li.entry_id = e.id WHERE e.language_code = 'ru' AND (li.id IS NULL OR li.status = 'new') ORDER BY e.id LIMIT 1",
  )!.id;
  assert.equal((await c.post(`/api/vocab/${markedOnPage}/flags`, { status: 'known' })).status, 200);
  let p = await progress('ru');
  assert.deepEqual([p.words.known, p.words.notStarted], [before.words.known + 1, before.words.notStarted - 1]);
  assert.deepEqual([p.words.history.known[88], p.words.history.known[89]], [before.words.history.known[88], before.words.history.known[89] + 1]);
  const markedAt = () => db().get<{ t: number }>('SELECT updated_at AS t FROM learning_items WHERE entry_id = ?', markedOnPage)!.t;
  const at = markedAt();
  assert.equal((await c.post(`/api/vocab/${markedOnPage}/flags`, { favorite: true })).status, 200);
  assert.equal((await c.post(`/api/vocab/${markedOnPage}/flags`, { difficult: true })).status, 200);
  assert.equal(markedAt(), at, 'the time it was marked known stays');
  // Marked ten days ago: counted from that day on.
  db().run('UPDATE learning_items SET updated_at = ? WHERE entry_id = ?', Date.now() - 10 * DAY, markedOnPage);
  p = await progress('ru');
  const gained = p.words.history.known.map((n: number, i: number) => n - before.words.history.known[i]);
  assert.deepEqual(gained.slice(76), [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
});

test('a word marked known on a session’s new-word card counts from the day of that answer', async () => {
  for (const [lemma, gloss] of [['dom', 'house'], ['kot', 'cat'], ['woda', 'water']]) {
    assert.equal((await c.post('/api/vocab', { language: 'pl', lemma, senses: [{ gloss }] })).status, 200);
  }
  const s = await startSession(c, { language: 'pl', minutes: 10, newWords: 2 });
  let session = s;
  for (let guard = 0; guard < 20; guard++) {
    const ex = nextPending(session);
    assert.ok(ex, 'the session has a new-word card');
    if (ex.kind === 'intro') {
      await answer(c, s.id, ex, { markKnown: true }, session.items);
      break;
    }
    await answer(c, s.id, ex, {}, session.items);
    session = (await c.get(`/api/sessions/${s.id}`)).body;
  }
  // The answer was given 20 days ago on a device without a connection and arrived today.
  db().run("UPDATE exercise_attempts SET local_day = ?, answered_at = answered_at - ? WHERE language_code = 'pl' AND feedback_code = 'marked_known'", addDays(today(), -20), 20 * DAY);
  const p = await progress('pl');
  assert.equal(p.words.known, 1);
  assert.deepEqual([p.words.history.known[68], p.words.history.known[69], p.words.history.known[89]], [0, 1, 1]);
});

let deleted = 0;

test('suspended and deleted words count until the day they were suspended or deleted', async () => {
  const before = await progress('ru');
  const [suspended, gone] = learnedEntries();
  assert.ok(suspended && gone, 'two learned words');
  deleted = gone;
  assert.equal((await c.post(`/api/vocab/${suspended}/flags`, { status: 'suspended' })).status, 200);
  db().run('UPDATE learning_items SET updated_at = ? WHERE entry_id = ?', Date.now() - 3 * DAY, suspended);
  assert.equal((await c.req('DELETE', `/api/vocab/${gone}`)).status, 200);
  const p = await progress('ru');
  assert.equal(p.words.known, before.words.known - 2);
  const lost = before.words.history.known.map((n: number, i: number) => n - p.words.history.known[i]);
  // Both were learned six days ago: the suspended word is gone from three days ago, the deleted one from today.
  assert.deepEqual(lost.slice(82), [0, 0, 0, 0, 1, 1, 1, 2]);
  assert.equal(p.words.history.known[89], p.words.known);
  const ru = (await c.get('/api/bootstrap')).body.languages.find((l: any) => l.code === 'ru').stats;
  assert.deepEqual([ru.known, ru.learning], [p.words.known, p.words.learning]);
});

test('the most common words are the 1,000 with the lowest frequency ranks; a language without ranks has none', async () => {
  // Russian: every word ranked (the deleted one is not among the words).
  db().run("UPDATE vocabulary_entries SET frequency_rank = curated_order WHERE language_code = 'ru'");
  const ru = await progress('ru');
  assert.deepEqual(ru.words.common, { size: 11, known: ru.words.known });
  const tiers = (await c.get('/api/stats/language/ru')).body.frequencyTiers;
  assert.equal(tiers.reduce((n: number, t: any) => n + t.known, 0), ru.words.known, 'the frequency bands count known words alike');

  // Ukrainian: 1,010 ranked words, 300 of the first 1,000 marked known and 5 after them; 100 were marked 40 days ago.
  // "40 days ago" is noon of that local day: 40 × 24 hours back lands a day off when a clock change lies between
  // (as it does for some weeks after the last Sunday of October, in the hour before midnight).
  const now = Date.now();
  const noonAgo = (days: number) => startOfLocalDay(addDays(today(), -days), TZ) + 12 * 3_600_000;
  db().tx(() => {
    let marked = 0;
    for (let i = 1; i <= 1010; i++) {
      const id = db().run(
        "INSERT INTO vocabulary_entries (language_code, lemma, lemma_key, pos, frequency_rank, created_at, updated_at) VALUES ('uk', ?, ?, 'noun', ?, ?, ?)",
        `слово${i}`,
        `слово${i}`,
        i,
        now,
        now,
      ).lastInsertRowid;
      if ((i <= 1000 && i % 10 < 3) || i > 1005) {
        const at = marked++ < 100 ? noonAgo(40) : noonAgo(5);
        db().run("INSERT INTO learning_items (entry_id, language_code, status, created_at, updated_at) VALUES (?, 'uk', 'known', ?, ?)", id, at, at);
      }
    }
  });
  const uk = await progress('uk');
  assert.deepEqual([uk.words.known, uk.words.learning, uk.words.notStarted], [305, 0, 705]);
  assert.deepEqual(uk.words.common, { size: 1000, known: 300 });
  const h = uk.words.history.known;
  assert.deepEqual([h[48], h[49], h[83], h[84], h[89]], [0, 100, 100, 305, 305]);
  // 205 words in the last 30 days: about 6.8 a day, so 195 more words to 500 take about 4 weeks.
  assert.ok(Math.abs(uk.words.pacePerDay - 205 / 30) < 1e-9);
  assert.deepEqual(uk.words.milestone, { target: 500, weeks: 4 });

  const vi = await progress('vi');
  assert.deepEqual([vi.words.known, vi.words.learning, vi.words.notStarted, vi.words.common, vi.words.pacePerDay], [0, 0, 0, null, null]);
  assert.deepEqual(vi.words.milestone, { target: 100, weeks: null });
  assert.equal(vi.words.history.known.every((n: number) => n === 0), true);
});

test('each skill counts its own answers in the period, with the trend against the period before when both have enough', async () => {
  await importDoc('pt', [{ lemma: 'casa', pos: 'noun', gender: 'f', senses: [{ gloss: 'house' }], examples: [{ text: 'A casa é grande.', translation: 'The house is big.', target: 'casa' }] }]);
  const casa = entryId('pt', 'casa');
  const sentenceId = sentenceOf(casa);
  const gap = async (right: boolean, daysAgo: number) => {
    const r = await c.post('/api/practice/attempts', { opId: randomUUID(), mode: 'cloze', entryId: casa, sentenceId, response: right ? 'casa' : 'zzz', answeredAt: Date.now() - daysAgo * DAY });
    assert.equal(r.body.grade, right ? 'correct' : 'incorrect');
  };
  // Sentence gaps: 8 of 10 right this week, 5 of 10 the week before, 4 of 4 twenty days ago, 0 of 2 forty days ago.
  for (let i = 0; i < 10; i++) await gap(i < 8, 0);
  for (let i = 0; i < 10; i++) await gap(i < 5, 10);
  for (let i = 0; i < 4; i++) await gap(true, 20);
  for (let i = 0; i < 2; i++) await gap(false, 40);
  // Speaking: 15 of 20 sentences said right this week. Reading: 3 sentences read, 1 understood in full.
  const sayRead = (body: Record<string, unknown>) => c.post('/api/practice/read/attempts', { opId: randomUUID(), sentenceId, answeredAt: Date.now(), ...body });
  for (let i = 0; i < 20; i++) assert.equal((await sayRead({ mode: 'say', grade: i < 15 ? 'correct' : 'incorrect', response: 'a casa' })).status, 200);
  for (const grade of ['understood', 'partly', 'not']) assert.equal((await sayRead({ mode: 'read', grade })).status, 200);

  const card = (p: any, key: string) => p.skills.find((s: any) => s.key === key);
  const w7 = await period('pt', '7');
  assert.equal(w7.firstDay, addDays(today(), -6));
  assert.deepEqual(
    w7.skills.map((s: any) => s.key),
    ['words', 'listening', 'grammar', 'sentences', 'pictures', 'speaking', 'reading', 'writing'],
    'every skill a Portuguese session trains, in the page’s order',
  );
  const s7 = card(w7, 'sentences');
  assert.deepEqual([s7.answers, s7.correct, s7.accuracy], [10, 8, 0.8]);
  assert.deepEqual(s7.previous, { answers: 10, correct: 5, accuracy: 0.5 });
  assert.equal(s7.trend, 30, 'up 30 points');
  assert.deepEqual([card(w7, 'speaking').answers, card(w7, 'speaking').correct, card(w7, 'speaking').trend], [20, 15, null], 'nothing the week before');
  assert.deepEqual([card(w7, 'reading').answers, card(w7, 'reading').correct], [3, 1], 'a sentence read counts as right when understood in full');
  // The level and its texts read, as the reading page counts them (the texts are installation data, data/reading).
  const level = (await c.get('/api/practice/comprehension/summary/pt')).body.progress;
  assert.deepEqual(card(w7, 'reading').reading, { level: 'A1', levelTexts: level.total, levelRead: level.read });
  for (const key of ['words', 'listening', 'grammar', 'pictures', 'writing']) assert.deepEqual([card(w7, key).answers, card(w7, key).accuracy, card(w7, key).trend], [0, null, null], key);
  assert.equal(w7.weakest, null, 'only speaking has 20 answers this week');

  const w30 = await period('pt', '30');
  const s30 = card(w30, 'sentences');
  assert.deepEqual([s30.answers, s30.correct, s30.previous.answers, s30.trend], [24, 17, 2, null], 'two answers in the 30 days before are too few to compare');
  assert.equal(w30.weakest, 'sentences', '17 of 24 against speaking’s 15 of 20');

  const all = await period('pt', 'all');
  assert.deepEqual([card(all, 'sentences').answers, card(all, 'sentences').correct, card(all, 'sentences').previous, card(all, 'sentences').trend], [26, 17, null, null]);
  assert.equal(all.firstDay, null);
  assert.equal((await period('pt')).window, '30', 'the default period');
  assert.equal((await period('pt', 'bogus')).window, '30');
  // Vietnamese has no word forms to practice.
  assert.equal(card(await period('vi', '7'), 'grammar'), undefined);
});

test('study time per day against the daily goal (a setting per language), the days it was met, the streak, and all time by week', async () => {
  const boot = async () => (await c.get('/api/bootstrap')).body;
  assert.equal((await boot()).languageSettings.pt.dailyGoalMinutes, 20, 'twenty minutes by default');
  for (const bad of [0, 4, 241, 12.5, 'twenty']) assert.equal((await c.put('/api/languages/pt/settings', { dailyGoalMinutes: bad })).status, 422, String(bad));
  assert.equal((await c.put('/api/languages/pt/settings', { dailyGoalMinutes: 30 })).status, 200);
  assert.equal((await boot()).languageSettings.pt.dailyGoalMinutes, 30);
  assert.equal((await boot()).languageSettings.es.dailyGoalMinutes, 20, 'each language has its own');

  // Study time (sessions and the Practice pages add it to daily_stats): 10 minutes today, 35, 30, then 45 eight days ago
  // and 25 forty days ago (the first day studied, with the practice answers of that day).
  const add = (daysAgo: number, minutes: number) =>
    db().run(
      `INSERT INTO daily_stats (language_code, local_day, study_ms) VALUES ('pt', ?, ?)
       ON CONFLICT(language_code, local_day) DO UPDATE SET study_ms = study_ms + excluded.study_ms`,
      addDays(today(), -daysAgo),
      minutes * 60_000,
    );
  for (const [daysAgo, minutes] of [[0, 10], [1, 35], [2, 30], [8, 45], [40, 25]]) add(daysAgo, minutes);

  const w7 = (await period('pt', '7')).time;
  assert.deepEqual(w7.bars, [6, 5, 4, 3, 2, 1, 0].map((d, i) => ({ day: addDays(today(), -d), minutes: [0, 0, 0, 0, 30, 35, 10][i] })));
  assert.deepEqual([w7.unit, w7.goalMinutes, w7.totalMs, w7.days, w7.averageMinutes], ['day', 30, 75 * 60_000, 7, 11]);
  assert.deepEqual(w7.goal, { met: 2, of: 6 }, 'today is not over and has not met it yet');
  assert.equal(w7.streakDays, 3);
  // Portuguese was first studied 40 days ago: the 7 and 30 days count in full.
  assert.deepEqual([w7.from, w7.shortened, w7.begun], [addDays(today(), -6), false, addDays(today(), -40)]);

  const w30 = (await period('pt', '30')).time;
  assert.equal(w30.bars.length, 30);
  assert.deepEqual([w30.totalMs, w30.averageMinutes, w30.goal.met, w30.goal.of], [120 * 60_000, 4, 3, 29]);

  const all = (await period('pt', 'all')).time;
  const first = addDays(today(), -40);
  const days = Array.from({ length: 41 }, (_, i) => {
    const day = addDays(first, i);
    return { day, minutes: ({ [addDays(today(), -40)]: 25, [addDays(today(), -8)]: 45, [addDays(today(), -2)]: 30, [addDays(today(), -1)]: 35, [today()]: 10 } as Record<string, number>)[day] ?? 0 };
  });
  assert.deepEqual([all.unit, all.from, all.shortened, all.days, all.totalMs, all.averageMinutes], ['week', first, false, 41, 145 * 60_000, 4]);
  assert.deepEqual(all.bars, weeklyBars(days, first, today()));
  assert.deepEqual(all.goal, { met: 3, of: 40 });
});

test('study time and the goal count from the day a language was first studied when that is later than the period’s start, or not at all before it', async () => {
  // Vietnamese, first studied two days ago (25 minutes), then 10 minutes yesterday, nothing yet today; goal 20 minutes.
  for (const [daysAgo, minutes] of [[2, 25], [1, 10]]) {
    db().run("INSERT INTO daily_stats (language_code, local_day, study_ms) VALUES ('vi', ?, ?)", addDays(today(), -daysAgo), minutes * 60_000);
  }
  const begun = addDays(today(), -2);
  for (const window of ['7', '30']) {
    const t = (await period('vi', window)).time;
    assert.deepEqual([t.from, t.shortened, t.begun, t.days], [begun, true, begun, 3], `${window} days start at the first day studied`);
    assert.deepEqual(t.bars, [{ day: begun, minutes: 25 }, { day: addDays(today(), -1), minutes: 10 }, { day: today(), minutes: 0 }]);
    assert.deepEqual([t.totalMs, t.averageMinutes, t.goal], [35 * 60_000, 12, { met: 1, of: 2 }], 'not “1 of 29 days”: the days before were not missed');
  }
  const all = (await period('vi', 'all')).time;
  assert.deepEqual([all.from, all.shortened, all.days, all.averageMinutes, all.goal], [begun, false, 3, 12, { met: 1, of: 2 }]);
  // Home gets the first day studied, and counts its week from it.
  const vi = (await c.get('/api/bootstrap')).body.languages.find((l: any) => l.code === 'vi').stats;
  assert.equal(vi.firstStudyDay, begun);
  // Ukrainian has words marked known but nothing studied: nothing is counted, nothing missed.
  const uk = (await period('uk', '30')).time;
  assert.deepEqual([uk.begun, uk.from, uk.days, uk.totalMs, uk.goal], [null, today(), 1, 0, { met: 0, of: 0 }]);
  assert.equal((await c.get('/api/bootstrap')).body.languages.find((l: any) => l.code === 'uk').stats.firstStudyDay, null);
});

test('every answer counts in exactly one skill: by ear, typed recall, sentence gaps and forms apart, the rest of a session as words', async () => {
  const all = await period('ru', 'all');
  const one = (sql: string) => db().get<{ n: number }>(sql)!.n;
  const session = one("SELECT COUNT(*) AS n FROM exercise_attempts WHERE language_code = 'ru' AND kind != 'intro'");
  const practice = one("SELECT COUNT(*) AS n FROM practice_attempts WHERE language_code = 'ru'");
  const questions = one("SELECT COALESCE(SUM(total), 0) AS n FROM comprehension_attempts WHERE language_code = 'ru'");
  assert.ok(session > 10);
  assert.equal(
    all.skills.reduce((n: number, s: any) => n + s.answers, 0),
    session + practice + questions,
  );
  const kinds: Record<string, number> = Object.fromEntries(
    db()
      .all<{ kind: string; n: number }>("SELECT kind, COUNT(*) AS n FROM exercise_attempts WHERE language_code = 'ru' AND kind != 'intro' GROUP BY kind")
      .map((r) => [r.kind, r.n]),
  );
  const k = (...xs: string[]) => xs.reduce((n, x) => n + (kinds[x] ?? 0), 0);
  const card = (key: string) => all.skills.find((s: any) => s.key === key);
  assert.equal(card('writing').answers, k('recall_typed'));
  assert.equal(card('listening').answers, k('listen_meaning', 'listen_choice', 'dictation'));
  assert.equal(card('grammar').answers, k('form_typed') + one("SELECT COUNT(*) AS n FROM practice_attempts WHERE language_code = 'ru' AND mode = 'forms'"));
  assert.equal(card('sentences').answers, k('cloze_choice', 'cloze_typed') + one("SELECT COUNT(*) AS n FROM practice_attempts WHERE language_code = 'ru' AND mode = 'cloze'"));
  assert.equal(card('words').answers, k('meaning_choice', 'meaning_typed', 'context_meaning', 'word_choice', 'picture_choice', 'speak_flashcard', 'sentence_create', 'shadowing'));
  const right = one(
    "SELECT COUNT(*) AS n FROM exercise_attempts WHERE language_code = 'ru' AND kind != 'intro' AND (grade = 'correct' OR (grade = 'self' AND COALESCE(self_rating, 0) >= 2))",
  );
  assert.equal(
    all.skills.filter((s: any) => ['words', 'writing', 'listening'].includes(s.key)).reduce((n: number, s: any) => n + s.correct, 0) +
      card('grammar').correct -
      one("SELECT COUNT(*) AS n FROM practice_attempts WHERE language_code = 'ru' AND mode = 'forms' AND grade = 'correct'") +
      card('sentences').correct -
      one("SELECT COUNT(*) AS n FROM practice_attempts WHERE language_code = 'ru' AND mode = 'cloze' AND grade = 'correct'"),
    right,
    'answers right: correct, or rated Hard or better when self-rated',
  );
});

test('reviews coming up: each of the next 7 days, today with the overdue ones, a word once a day, and the minutes a day that keep up', async () => {
  const items = db()
    .all<{ id: number }>(
      `SELECT li.id FROM learning_items li JOIN vocabulary_entries e ON e.id = li.entry_id AND e.deleted_at IS NULL
        WHERE li.language_code = 'ru' AND li.status = 'active'
        ORDER BY (SELECT COUNT(*) FROM fsrs_cards c WHERE c.item_id = li.id AND c.state != 0) DESC, li.id`,
    )
    .map((r) => r.id);
  assert.ok(items.length >= 5, `active words: ${items.length}`);
  const at = (daysAhead: number, hour: number) => startOfLocalDay(addDays(today(), daysAhead), TZ) + hour * 3_600_000;
  db().run("UPDATE fsrs_cards SET due = ? WHERE language_code = 'ru' AND state != 0", Date.now() + 60 * DAY);
  const due = (item: number, when: number) => db().run('UPDATE fsrs_cards SET due = ? WHERE item_id = ? AND state != 0', when, item);
  const dueCard = (item: number, skill: string, when: number) => db().run('UPDATE fsrs_cards SET due = ? WHERE item_id = ? AND skill = ? AND state != 0', when, item, skill);
  dueCard(items[0], 'receptive', at(-1, 9)); // overdue: today
  dueCard(items[0], 'productive', at(0, 20)); // the same word, the same day: one review
  due(items[1], at(3, 8)); // both memories on day 3: one review
  dueCard(items[2], 'receptive', at(1, 0));
  dueCard(items[3], 'receptive', at(6, 23));
  dueCard(items[4], 'receptive', at(7, 0)); // the eighth day: not this week
  // Deleted and suspended words are not reviewed.
  db().run("UPDATE fsrs_cards SET due = ? WHERE item_id IN (SELECT li.id FROM learning_items li WHERE li.entry_id = ? OR li.status = 'suspended')", at(0, 10), deleted);

  const c7 = (await progress('ru')).comingUp;
  assert.deepEqual(
    c7.days.map((d: any) => d.day),
    [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(today(), i)),
  );
  assert.deepEqual(
    c7.days.map((d: any) => d.due),
    [1, 1, 0, 1, 0, 0, 1],
  );
  assert.equal(c7.total, 4);
  // The learner's own median answer time of recent reviews (3 seconds in these tests) plus 3 seconds of feedback.
  const timed = db().get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM exercise_attempts WHERE language_code = 'ru' AND counted_as_review = 1 AND latency_ms > 0 AND latency_ms < 120000 AND local_day >= ?",
    addDays(today(), -29),
  )!.n;
  const seconds = timed >= 10 ? 6 : 15;
  assert.deepEqual([c7.ownTiming, c7.secondsPerReview, c7.minutesPerDay], [timed >= 10, seconds, minutesToKeepUp(4, seconds)]);
  const quiet = (await progress('vi')).comingUp;
  assert.deepEqual([quiet.total, quiet.ownTiming, quiet.secondsPerReview, quiet.minutesPerDay], [0, false, 15, 0]);
});

test('words that need work: the five missed most in the last 30 days, sessions and practice together, deleted words left out', async () => {
  const kot = entryId('ru', 'кот');
  const kod = entryId('ru', 'код');
  const gap = (entry: number, response: string, daysAgo = 0) =>
    c.post('/api/practice/attempts', { opId: randomUUID(), mode: 'cloze', entryId: entry, sentenceId: sentenceOf(entry), response, answeredAt: Date.now() - daysAgo * DAY });
  for (let i = 0; i < 4; i++) assert.equal((await gap(kot, 'zzz')).body.grade, 'incorrect');
  assert.equal((await gap(kot, 'кот')).body.grade, 'correct');
  assert.equal((await gap(kod, 'zzz', 40)).body.grade, 'incorrect', 'too long ago to count');
  // A deleted word missed many times today (stored before it was deleted) is not listed.
  for (let i = 0; i < 9; i++) {
    db().run(
      "INSERT INTO practice_attempts (op_id, language_code, mode, entry_id, grade, answered_at, local_day, received_at) VALUES (?, 'ru', 'forms', ?, 'incorrect', ?, ?, ?)",
      randomUUID(),
      deleted,
      Date.now(),
      today(),
      Date.now(),
    );
  }
  const sessionFor = (entry: number) =>
    db().get<{ n: number; misses: number }>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(a.grade = 'incorrect' OR (a.grade = 'self' AND a.self_rating = 1)), 0) AS misses
         FROM exercise_attempts a JOIN learning_items li ON li.id = a.item_id WHERE li.entry_id = ? AND a.kind != 'intro' AND a.local_day >= ?`,
      entry,
      addDays(today(), -29),
    )!;
  const list = (await progress('ru')).needWork;
  assert.ok(list.length >= 1 && list.length <= 5);
  const top = list[0];
  assert.deepEqual([top.entryId, top.lemma, top.gloss], [kot, 'кот', 'cat']);
  assert.deepEqual([top.misses, top.answers], [4 + sessionFor(kot).misses, 5 + sessionFor(kot).n]);
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].misses >= list[i].misses, 'most misses first');
  for (const w of list) assert.ok(w.misses >= 1 && w.misses <= w.answers);
  assert.equal(list.some((w: any) => w.entryId === deleted), false);
  const kodListed = list.find((w: any) => w.entryId === kod);
  assert.ok(!kodListed || kodListed.misses === sessionFor(kod).misses, 'the miss of 40 days ago is not counted');
  assert.deepEqual((await progress('vi')).needWork, []);
  assert.equal((await c.get('/api/stats/progress/xx')).status, 404);
  assert.equal((await c.get('/api/stats/progress/xx/period')).status, 404);
});

test('Home’s unfinished session counts questions as the session’s counter does: exercises and practice answers, and the practice still to come', async () => {
  for (const [lemma, gloss] of [['perro', 'dog'], ['gato', 'cat'], ['agua', 'water']]) {
    assert.equal((await c.post('/api/vocab', { language: 'es', lemma, senses: [{ gloss }] })).status, 200);
  }
  const s = await startSession(c, { language: 'es', minutes: 20, newWords: 3 });
  assert.equal(s.config.mode, 'comprehensive');
  let session = s;
  for (let i = 0; i < 3; i++) {
    await answer(c, s.id, nextPending(session), {}, session.items);
    session = (await c.get(`/api/sessions/${s.id}`)).body;
  }
  // Two answers of the first practice slot (of three questions).
  const slot = session.meta.practice[0];
  const r = await c.post(`/api/sessions/${s.id}/events`, { type: 'round', roundId: slot.id, skill: skillOf(slot.kind), grades: ['correct', 'incorrect'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  session = (await c.get(`/api/sessions/${s.id}`)).body;
  const done = session.exercises.filter((e: any) => e.status !== 'pending').length + 2;
  const total = session.exercises.length + 2 + practiceLeft(session.meta.practice, session.meta);
  assert.ok(total > done + session.exercises.filter((e: any) => e.status === 'pending').length, 'the practice to come is counted');
  const active = (await c.get('/api/sessions/active?lang=es')).body;
  assert.deepEqual([active[0].id, active[0].done, active[0].total], [s.id, done, total]);
  const home = (await c.get('/api/bootstrap')).body.languages.find((l: any) => l.code === 'es').activeSession;
  assert.deepEqual([home.done, home.total], [done, total]);
});
