// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Statistics that match what Comprehensive study trains (GET /api/stats/skills/:code, server/services/skills.ts) and
// activity that counts practice answers and reading texts as well as reviews (server/services/stats.ts), all built
// from real answers: a default (Comprehensive) session and a review session, forms, sentence gaps, Identify, Read and
// Say it, and reading comprehension texts from a fixture. Covered: the window, no double counting (answers and study
// time), a day with practice only in the streak, study time from the Practice pages (capped, counted once), the empty
// states, a skill the language does not have, and practice adding no second review on a day its words were reviewed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, FIXTURE, nextPending, startTestServer, wrongAnswer, type TestServer } from '../helpers/harness.ts';
import { answer, shiftHistory, startSession, TZ } from '../helpers/study.ts';
import { KINDS, type ExerciseKind } from '../../shared/exercises.ts';
import { addDays, localDay } from '../../shared/time.ts';
import { loadComprehension } from '../../server/learning/comprehension.ts';
import type { ComprehensionPassage } from '../../shared/comprehension.ts';
// @ts-expect-error plain JavaScript build script
import { languageFile, readBatches } from '../../scripts/reading/build.mjs';

const DAY = 86_400_000;
let srv: TestServer;
let c: Client;
let readingDir: string;
const ids: Record<string, number> = {};
const sentences: Record<string, number> = {};

const hablar = {
  lemma: 'hablar',
  pos: 'verb',
  senses: [{ gloss: 'to speak' }],
  examples: [{ text: 'Quiero hablar contigo.', translation: 'I want to talk to you.', target: 'hablar' }],
  paradigm: {
    kind: 'verb',
    source: 'test',
    cells: {
      'ind.pres|1s': ['hablo'],
      'ind.pres|3s': ['habla'],
      'ind.pret|1s': ['hablé'],
      'ind.pret|3s': ['habló'],
      'sbjv.pres|1s': ['hable'],
      'nfin|inf': ['hablar'],
      'nfin|ger': ['hablando'],
    },
  },
};
const noun = (lemma: string, gloss: string, gender: string, text?: string, translation?: string) => ({
  lemma,
  pos: 'noun',
  gender,
  senses: [{ gloss }],
  ...(text ? { examples: [{ text, translation, target: lemma }] } : {}),
});
const esDoc = {
  format: 'vocabbuilder-v1',
  language: 'es',
  source: { name: 'Skills test set (es)', kind: 'curated', license: 'CC0-1.0' },
  entries: [
    hablar,
    noun('escuela', 'school', 'f', 'La escuela está cerca.', 'The school is near.'),
    noun('tren', 'train', 'm', 'El tren llega tarde.', 'The train is late.'),
    noun('árbol', 'tree', 'm', 'El árbol es alto.', 'The tree is tall.'),
    noun('caballo', 'horse', 'm'),
    noun('paraguas', 'umbrella', 'm'),
    noun('estación', 'station', 'f'),
  ],
};
const ptDoc = {
  format: 'vocabbuilder-v1',
  language: 'pt',
  source: { name: 'Skills test set (pt)', kind: 'curated', license: 'CC0-1.0' },
  entries: [{ lemma: 'casa', pos: 'noun', gender: 'f', senses: [{ gloss: 'house' }], examples: [{ text: 'A casa é grande.', translation: 'The house is big.', target: 'casa' }] }],
};

async function importDoc(lang: string, doc: unknown) {
  const up = await c.post(`/api/import/upload?lang=${lang}&kind=vocabulary&filename=set.json`, Buffer.from(JSON.stringify(doc)), { 'Content-Type': 'application/octet-stream' });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const commit = await c.post(`/api/import/${up.body.id}/commit`, { mapping: {}, options: {} });
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
}

before(async () => {
  // Reading comprehension texts from the fixture (tests/fixtures/reading), so the figures do not depend on data/reading.
  const src = path.join(FIXTURE, 'reading');
  const built = readBatches(readdirSync(src).map((name: string) => path.join(src, name)));
  assert.deepEqual(built.problems, []);
  readingDir = mkdtempSync(path.join(tmpdir(), 'vb-skills-reading-'));
  writeFileSync(path.join(readingDir, 'es.json'), languageFile('es', built.byLang.get('es')));
  srv = await startTestServer({ env: { VB_READING_DIR: readingDir } });
  c = new Client(srv.url);
  await c.setup();
  await importDoc('es', esDoc);
  await importDoc('pt', ptDoc);
  for (const r of srv.app.db.all<{ id: number; lemma: string }>("SELECT id, lemma FROM vocabulary_entries WHERE language_code IN ('es', 'pt')")) ids[r.lemma] = r.id;
  for (const r of srv.app.db.all<{ id: number; lemma: string }>(
    'SELECT s.id, e.lemma FROM example_sentences s JOIN entry_examples ee ON ee.sentence_id = s.id JOIN vocabulary_entries e ON e.id = ee.entry_id',
  ))
    sentences[r.lemma] = r.id;
});
after(async () => {
  await srv.cleanup();
  rmSync(readingDir, { recursive: true, force: true });
});

const skills = async (lang: string, window?: string) => {
  const r = await c.get(`/api/stats/skills/${lang}${window ? `?window=${window}` : ''}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};
const languageSummary = async (lang: string) => (await c.get('/api/bootstrap')).body.languages.find((l: any) => l.code === lang).stats;
const practice = (body: Record<string, unknown>) => c.post('/api/practice/attempts', { opId: randomUUID(), answeredAt: Date.now(), ...body });
const sayRead = (body: Record<string, unknown>) => c.post('/api/practice/read/attempts', { opId: randomUUID(), answeredAt: Date.now(), ...body });
const today = () => localDay(Date.now(), TZ);

interface Logged {
  kind: ExerciseKind;
  cardSkill: string | null;
  right: boolean;
  review: boolean;
}

/** Answer every exercise of a session, wrong where `miss` says so, and log what each answer was and did. */
async function study(sessionId: string, miss: (ex: any, log: Logged[]) => boolean): Promise<Logged[]> {
  const log: Logged[] = [];
  let session = (await c.get(`/api/sessions/${sessionId}`)).body;
  for (let guard = 0; guard < 400; guard++) {
    const ex = nextPending(session);
    if (!ex || session.status === 'completed') break;
    const wrong = ex.kind !== 'intro' && miss(ex, log);
    const r = await answer(c, sessionId, ex, wrong ? wrongAnswer(ex) : {}, session.items);
    if (ex.kind !== 'intro') log.push({ kind: ex.kind, cardSkill: ex.cardSkill, right: !wrong, review: !!r.review });
    session = (await c.get(`/api/sessions/${sessionId}`)).body;
  }
  return log;
}

const isListening = (k: ExerciseKind) => KINDS[k].skill === 'listening';
const isSpeaking = (k: ExerciseKind) => KINDS[k].skill === 'speaking';
const count = (log: Logged[], f: (l: Logged) => boolean) => ({ answers: log.filter(f).length, correct: log.filter((l) => f(l) && l.right).length });

let sessionLog: Logged[] = [];
let reviewLog: Logged[] = [];

test('a session started without a mode is Comprehensive, and its answers feed listening, speaking and vocabulary', async () => {
  // Device speech makes listening exercises possible without recordings.
  assert.equal((await c.put('/api/languages/es/settings', { ttsFallback: true })).status, 200);
  const s = await startSession(c, { language: 'es', minutes: 30, newWords: 7, focus: 'listening' });
  assert.equal(s.config.mode, 'comprehensive', 'Comprehensive is the default study');
  assert.equal(s.mode, 'comprehensive');
  // One listening answer is wrong.
  sessionLog = await study(s.id, (ex, log) => isListening(ex.kind) && !log.some((l) => isListening(l.kind)));
  assert.ok(sessionLog.some((l) => isListening(l.kind)), `listening exercises are planned: ${sessionLog.map((l) => l.kind).join(', ')}`);
  // Days later, a review session with two misses: reviews of due words, a day or more after the previous one.
  shiftHistory(srv.app.db, 4);
  const r = await startSession(c, { language: 'es', mode: 'review', minutes: 30 });
  let misses = 0;
  reviewLog = await study(r.id, (ex) => ex.stage === 'A' && misses++ < 2);
  assert.ok(reviewLog.filter((l) => l.review).length >= 4, 'due reviews were scheduled');

  const all = [...sessionLog, ...reviewLog];
  const sk = await skills('es', 'all');
  const listening = count(all, (l) => isListening(l.kind));
  assert.deepEqual([sk.listening.answers, sk.listening.correct], [listening.answers, listening.correct]);
  assert.ok(sk.listening.correct < sk.listening.answers, 'the wrong listening answer counts');
  const byEar = count(all, (l) => l.review && isListening(l.kind));
  assert.deepEqual([sk.listening.reviews.answers, sk.listening.reviews.correct], [byEar.answers, byEar.correct]);
  const speaking = count(all, (l) => isSpeaking(l.kind));
  assert.deepEqual([sk.speaking.answers, sk.speaking.correct], [speaking.answers, speaking.correct]);
  // Vocabulary: due reviews per memory; the first ratings of new words are not reviews.
  for (const [memory, skill] of [['recognition', 'receptive'], ['recall', 'productive']] as const) {
    const due = count(reviewLog, (l) => l.review && l.cardSkill === skill);
    assert.deepEqual([sk.vocabulary[memory].reviews, sk.vocabulary[memory].recalled], [due.answers, due.correct], memory);
  }
  const v = sk.vocabulary;
  assert.equal(v.recognition.reviews + v.recall.reviews, reviewLog.filter((l) => l.review).length);
  assert.ok(v.recognition.recalled + v.recall.recalled < v.recognition.reviews + v.recall.reviews, 'the two misses count');
  for (const m of [v.recognition, v.recall]) assert.equal(m.retention, m.reviews ? m.recalled / m.reviews : null);
  assert.ok(sk.vocabulary.recognition.estimated > 0 && sk.vocabulary.recognition.estimated <= 1);
  const words = srv.app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM learning_items WHERE language_code = 'es' AND status IN ('introduced', 'active')")!.n;
  assert.equal(sk.vocabulary.learning + sk.vocabulary.learned, words, 'every word met is learning or learned');
  assert.equal(sk.nothingYet, false);
});

let fsrsBefore = '';

test('word forms: answers, accuracy and the weakest tenses with enough answers, over the window', async () => {
  fsrsBefore = JSON.stringify(srv.app.db.all('SELECT id, state, stability, difficulty, due, reps, lapses FROM fsrs_cards ORDER BY id'));
  const reviewsBefore = srv.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_logs')!.n;
  const form = (cell: string, response: string, extra: Record<string, unknown> = {}) => practice({ mode: 'forms', entryId: ids.hablar, cell, response, ...extra });
  // Today: the preterite missed 5 times, the present right 5 of 6, the subjunctive missed twice (too few to rank),
  // the infinitive right once.
  for (const cell of ['ind.pret|1s', 'ind.pret|1s', 'ind.pret|3s', 'ind.pret|3s', 'ind.pret|1s']) assert.equal((await form(cell, 'zzz')).body.grade, 'incorrect');
  for (const [cell, f] of [['ind.pres|1s', 'hablo'], ['ind.pres|1s', 'hablo'], ['ind.pres|3s', 'habla'], ['ind.pres|3s', 'habla'], ['ind.pres|1s', 'hablo']]) {
    assert.equal((await form(cell, f)).body.grade, 'correct');
  }
  await form('ind.pres|3s', 'hablaz');
  await form('sbjv.pres|1s', 'zzz');
  await form('sbjv.pres|1s', 'zzz');
  await form('nfin|inf', 'hablar');
  // Earlier: two right 10 days ago, one right 40 days ago.
  await form('nfin|ger', 'hablando', { answeredAt: Date.now() - 10 * DAY });
  await form('nfin|ger', 'hablando', { answeredAt: Date.now() - 10 * DAY });
  await form('nfin|ger', 'hablando', { answeredAt: Date.now() - 40 * DAY });

  const w7 = (await skills('es', '7')).forms;
  assert.deepEqual([w7.answers, w7.minAnswers, w7.rated], [14, 5, 2]);
  assert.equal(w7.correct, 6, 'hablaz is close, not right');
  assert.deepEqual(
    w7.weakest.map((g: any) => [g.key, g.label, g.answers, g.correct]),
    [
      ['ind.pret', 'preterite', 5, 0],
      ['ind.pres', 'present', 6, 5],
    ],
  );
  const w30 = (await skills('es', '30')).forms;
  assert.deepEqual([w30.answers, w30.correct], [16, 8]);
  const all = (await skills('es', 'all')).forms;
  assert.deepEqual([all.answers, all.correct], [17, 9]);
  assert.ok(Math.abs(all.accuracy - 9 / 17) < 1e-9);
  assert.equal((await skills('es')).window, '30', 'the default window');
  assert.equal((await skills('es', 'bogus')).window, '30');
  // Every word was reviewed today, so these answers add no second review (one per memory a day, one memory per word).
  assert.equal(srv.app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_logs')!.n, reviewsBefore);
});

test('sentence gaps, Identify (with different things named) and Read and Say it count their own answers', async () => {
  const gap = (lemma: string, response: string) => practice({ mode: 'cloze', entryId: ids[lemma], sentenceId: sentences[lemma], response });
  assert.equal((await gap('escuela', 'escuela')).body.grade, 'correct');
  assert.equal((await gap('tren', 'zzz')).body.grade, 'incorrect');
  assert.equal((await gap('árbol', 'árbol')).body.grade, 'correct');

  const batch = await c.post('/api/practice/identify/batch', { language: 'es', scope: 'all', size: 5 });
  assert.equal(batch.status, 200, JSON.stringify(batch.body));
  const [first, second] = batch.body.items;
  assert.ok(first && second, 'two pictured things for the Spanish words');
  const name = (item: any, response: string) => practice({ mode: 'identify', entryId: item.entryId, cell: item.id, response });
  assert.equal((await name(first, first.lemma)).body.grade, 'correct');
  assert.equal((await name(first, first.lemma)).body.grade, 'correct', 'the same thing named again');
  assert.equal((await name(second, 'zzz')).body.grade, 'incorrect');

  for (const grade of ['understood', 'partly', 'not']) assert.equal((await sayRead({ mode: 'read', sentenceId: sentences.escuela, grade })).status, 200);
  for (const grade of ['correct', 'close']) assert.equal((await sayRead({ mode: 'say', sentenceId: sentences.tren, grade, response: 'el tren' })).status, 200);

  const sk = await skills('es', '7');
  assert.deepEqual([sk.cloze.answers, sk.cloze.correct], [3, 2]);
  assert.deepEqual([sk.identify.answers, sk.identify.correct, sk.identify.named], [3, 2, 1]);
  assert.deepEqual([sk.read.answers, sk.read.correct, sk.read.partly], [3, 1, 1]);
  assert.deepEqual([sk.say.answers, sk.say.correct], [2, 1]);
  assert.ok(Math.abs(sk.read.accuracy - 1 / 3) < 1e-9, 'read: understood in full');
});

test('reading: the level, texts read and passed per kind and level, and question accuracy, over the window', async () => {
  const passages = loadComprehension(srv.app, 'es')!.passages;
  const firstLong = passages.find((p) => p.kind === 'long' && p.level === 'A1')!;
  const firstShort = passages.find((p) => p.kind === 'short' && p.level === 'A1' && p.step === 1)!;
  const read = (p: ComprehensionPassage, right: number, answeredAt: number, activeMs?: number) =>
    c.post('/api/practice/comprehension/attempts', {
      opId: randomUUID(),
      language: 'es',
      passageId: p.id,
      answers: p.questions.map((q, i) => (i < right ? q.answer : (q.answer + 1) % q.options.length)),
      answeredAt,
      ...(activeMs ? { activeMs } : {}),
    });
  // A longer passage 12 days ago, all right; an everyday text today, 2 of 3 right: both passed. The level stays A1,
  // because A1 has more texts than these two.
  assert.equal((await read(firstLong, 4, Date.now() - 12 * DAY)).body.levelAfter, 'A1');
  const before = (await languageSummary('es')).studiedTodayMs;
  const short = await read(firstShort, 2, Date.now(), 15 * 60_000);
  assert.deepEqual([short.body.correct, short.body.total, short.body.passed], [2, 3, true]);
  // A text may carry up to 10 minutes of reading and answering.
  assert.equal((await languageSummary('es')).studiedTodayMs - before, 10 * 60_000);

  const w7 = (await skills('es', '7')).reading;
  assert.deepEqual([w7.level, w7.texts, w7.passed, w7.questions.answers, w7.questions.correct], ['A1', 1, 1, 3, 2]);
  assert.deepEqual(w7.byKind, [{ kind: 'short', texts: 1, passed: 1, levels: [{ level: 'A1', texts: 1, passed: 1 }] }]);
  const w30 = (await skills('es', '30')).reading;
  assert.deepEqual([w30.texts, w30.passed, w30.questions.answers, w30.questions.correct], [2, 2, 7, 6]);
  assert.deepEqual(
    w30.byKind.map((k: any) => [k.kind, k.texts]),
    [
      ['short', 1],
      ['long', 1],
    ],
  );
});

test('activity counts session answers, practice answers and reading texts once each, and practice alone makes a study day', async () => {
  const db = srv.app.db;
  const day = today();
  const detailed = (await c.get('/api/stats/language/es')).body;
  const t = detailed.history.find((h: any) => h.day === day);
  const practiceToday = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM practice_attempts WHERE language_code = 'es' AND local_day = ?", day)!.n;
  const sessionToday = db.get<{ n: number }>("SELECT attempts AS n FROM daily_stats WHERE language_code = 'es' AND local_day = ?", day)!.n;
  assert.equal(practiceToday, 14 + 3 + 3 + 5, 'forms, gaps, Identify, Read and Say it today');
  assert.deepEqual([t.attempts, t.practice, t.texts, t.questions], [sessionToday, practiceToday, 1, 3]);
  assert.equal(t.answers, sessionToday + practiceToday + 3, 'reviews are session answers: not added again');
  assert.ok(t.reviews > 0 && t.reviews <= t.attempts);
  // Days with practice only are in the history too (and the efficiency figures count them).
  const tenDaysAgo = detailed.history.find((h: any) => h.day === localDay(Date.now() - 10 * DAY, TZ));
  assert.deepEqual([tenDaysAgo.practice, tenDaysAgo.attempts, tenDaysAgo.answers], [2, 0, 2]);
  assert.equal(detailed.efficiency.practice30d, practiceToday + 2);
  assert.equal(detailed.efficiency.texts30d, 2);

  const es = await languageSummary('es');
  assert.deepEqual([es.practiceToday, es.textsToday], [practiceToday, 1]);
  assert.equal(es.activity14d[13].answers, t.answers);

  // Portuguese: sentence gaps on three days in a row and nothing else is a three-day streak.
  for (const daysAgo of [2, 1, 0]) {
    const r = await practice({ mode: 'cloze', entryId: ids.casa, sentenceId: sentences.casa, response: 'casa', answeredAt: Date.now() - daysAgo * DAY });
    assert.equal(r.body.grade, 'correct');
  }
  const pt = await languageSummary('pt');
  assert.deepEqual([pt.streakDays, pt.practiceToday, pt.reviewsToday, pt.studiedTodayMs], [3, 1, 0, 0]);
  assert.deepEqual(
    pt.activity14d.slice(-3).map((d: any) => d.answers),
    [1, 1, 1],
  );
  assert.ok(pt.lastStudiedAt > Date.now() - 60_000, 'practice counts as studying the language');
  const overview = (await c.get('/api/bootstrap')).body.overview;
  assert.equal(overview.practiceToday, practiceToday + 1);
  assert.equal(overview.textsToday, 1);
  assert.ok(overview.streakDays >= 3);
});

test('study time from the Practice pages counts once per answer and is capped; answers without time add none', async () => {
  const before = (await languageSummary('pt')).studiedTodayMs;
  const opId = randomUUID();
  const body = { opId, mode: 'cloze', entryId: ids.casa, sentenceId: sentences.casa, response: 'casa', answeredAt: Date.now(), activeMs: 90_000 };
  assert.equal((await c.post('/api/practice/attempts', body)).status, 200);
  assert.equal((await c.post('/api/practice/attempts', body)).body.duplicate, true);
  assert.equal((await languageSummary('pt')).studiedTodayMs - before, 90_000, 'a retried upload counts once');
  await practice({ mode: 'cloze', entryId: ids.casa, sentenceId: sentences.casa, response: 'casa', activeMs: 3_600_000 });
  assert.equal((await languageSummary('pt')).studiedTodayMs - before, 90_000 + 5 * 60_000, 'one answer carries at most five minutes');
  // A round inside a study session sends no time of its own: the session counts it.
  await practice({ mode: 'cloze', entryId: ids.casa, sentenceId: sentences.casa, response: 'casa' });
  const rs = await sayRead({ mode: 'read', sentenceId: sentences.casa, grade: 'understood', activeMs: 20_000 });
  assert.equal(rs.status, 200);
  const after = await languageSummary('pt');
  assert.equal(after.studiedTodayMs - before, 90_000 + 5 * 60_000 + 20_000);
  const overview = (await c.get('/api/bootstrap')).body.overview;
  assert.ok(overview.todayMs >= after.studiedTodayMs);
  // The schedule is untouched by all of the practice above.
  assert.equal(JSON.stringify(srv.app.db.all('SELECT id, state, stability, difficulty, due, reps, lapses FROM fsrs_cards ORDER BY id')), fsrsBefore);
});

test('empty states: nothing yet in a language, nothing in a window, and a skill the language does not have', async () => {
  const uk = await skills('uk', 'all');
  assert.equal(uk.nothingYet, true);
  assert.ok(uk.forms, 'Ukrainian has declension');
  assert.deepEqual([uk.forms.answers, uk.forms.accuracy, uk.forms.weakest.length, uk.forms.rated], [0, null, 0, 0]);
  assert.equal(uk.reading, null, 'no Ukrainian texts in this installation');
  assert.ok(uk.identify, 'the pictures are installed');
  assert.deepEqual([uk.identify.answers, uk.identify.named, uk.cloze.answers, uk.listening.answers], [0, 0, 0, 0]);
  assert.deepEqual([uk.vocabulary.learning, uk.vocabulary.recognition.reviews, uk.vocabulary.recognition.retention], [0, 0, null]);
  const vi = await skills('vi', '7');
  assert.equal(vi.forms, null, 'no forms for Vietnamese');
  // Portuguese has practice but no forms answers: its window has figures, not the "nothing yet" state.
  const pt = await skills('pt', '7');
  assert.equal(pt.nothingYet, false);
  assert.deepEqual([pt.forms.answers, pt.forms.accuracy, pt.cloze.answers], [0, null, 6]);
  assert.equal(pt.vocabulary.learning, 0);
  // Spanish 40 days ago is outside 30 days: only all time sees it. The window is today and the 29 calendar days
  // before it (counted in days, not 24-hour steps, which drift by an hour across a daylight-saving change).
  assert.equal((await skills('es', '30')).firstDay, addDays(localDay(Date.now(), TZ), -29));
  assert.equal((await skills('es', 'all')).firstDay, null);
});
