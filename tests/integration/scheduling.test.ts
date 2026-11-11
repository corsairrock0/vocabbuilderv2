// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Scheduling policy through the API: practice vs scheduling events, one event per card per
// local day, owner-timezone day boundaries, and recognition vs production separation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, nextPending, startTestServer, type TestServer } from '../helpers/harness.ts';
import { answer, duplicateCardDays, importFixture, runSession, shiftHistory, startSession, TZ } from '../helpers/study.ts';
import { addDays, endOfLocalDay, localDay, startOfLocalDay } from '../../shared/time.ts';
import type { Db } from '../../server/db/database.ts';
import { KINDS, type ExerciseKind } from '../../shared/exercises.ts';

let srv: TestServer;
let c: Client;
let db: Db;

before(async () => {
  srv = await startTestServer();
  c = new Client(srv.url);
  await c.setup();
  await importFixture(c, 'ru-mini.json', 'ru');
  db = srv.app.db;
});
after(() => srv.cleanup());

async function finish(sessionId: string) {
  const r = await c.post(`/api/sessions/${sessionId}/complete`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
}

test('new words get one aggregated initial event per card; in-session practice is not logged as reviews', async () => {
  const s = await startSession(c, { language: 'ru', minutes: 30, newWords: 4 });
  const done = await runSession(c, s.id);
  assert.equal(done.status, 'completed');
  const items = Object.keys(s.items).map(Number);
  assert.equal(items.length, 4);
  for (const itemId of items) {
    const attempts = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM exercise_attempts WHERE item_id = ? AND kind != 'intro'", itemId)!.n;
    const reviews = db.all<{ skill: string; rating_source: string }>('SELECT skill, rating_source FROM review_logs WHERE item_id = ?', itemId);
    assert.ok(attempts >= 4, `item ${itemId}: ${attempts} practice attempts`);
    assert.deepEqual(reviews.map((r) => r.skill).sort(), ['productive', 'receptive']);
    assert.ok(reviews.every((r) => r.rating_source === 'aggregate'));
    const cards = db.all<{ state: number; due: number }>('SELECT state, due FROM fsrs_cards WHERE item_id = ?', itemId);
    assert.ok(cards.every((cd) => cd.state === 2 && cd.due > Date.now()), 'both memories scheduled in the future');
  }
  assert.equal(duplicateCardDays(db), 0);
});

test('a card receives at most one scheduling event per local day, even across sessions', async () => {
  shiftHistory(db, 3);
  const s2 = await startSession(c, { language: 'ru', mode: 'review', minutes: 30 });
  assert.ok(s2.exercises.length >= 4, 'previously learned words are due after three days');
  assert.ok(s2.exercises.every((e: any) => e.stage === 'A'));
  const first = nextPending(s2);
  const r1 = await answer(c, s2.id, first, {}, s2.items);
  assert.ok(r1.review, 'the first retrieval of a due card is a scheduling event');
  assert.equal(r1.result.countedAsReview, true);
  const card = db.get<{ id: number; item_id: number }>('SELECT id, item_id FROM fsrs_cards WHERE item_id = ? AND skill = ?', first.itemId, first.cardSkill)!;
  await finish(s2.id);
  // Pretend the card is due again today (e.g. a clock or settings change) and study it again.
  const now = Date.now();
  db.tx(() => {
    db.run('UPDATE fsrs_cards SET due = ?, last_review = ? WHERE id = ?', now - 3600_000, now - 2 * 86_400_000, card.id);
    db.run('UPDATE fsrs_cards SET due = ? WHERE item_id = ? AND id != ?', now + 10 * 86_400_000, card.item_id, card.id);
  });
  const s3 = await startSession(c, { language: 'ru', mode: 'review', minutes: 10 });
  const again = s3.exercises.find((e: any) => e.itemId === card.item_id);
  assert.ok(again, 'the card is offered again');
  const r2 = await answer(c, s3.id, again, {}, s3.items);
  assert.equal(r2.review, null, 'second same-day retrieval is practice only');
  assert.equal(r2.result.countedAsReview, false);
  const today = localDay(now, TZ);
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM review_logs WHERE card_id = ? AND local_day = ?', card.id, today)!.n, 1);
  assert.equal(duplicateCardDays(db), 0);
  await finish(s3.id);
});

test('"due today" uses the owner’s local day: due before local midnight is included, after it is not', async () => {
  const now = Date.now();
  const end = endOfLocalDay(now, TZ);
  const cards = db.all<{ id: number; item_id: number }>("SELECT id, item_id FROM fsrs_cards WHERE skill = 'receptive' AND state = 2 ORDER BY id LIMIT 2");
  assert.equal(cards.length, 2);
  const [p, q] = cards;
  db.tx(() => {
    db.run('UPDATE fsrs_cards SET due = ? WHERE state != 0', now + 30 * 86_400_000);
    db.run('UPDATE fsrs_cards SET due = ?, last_review = ? WHERE id = ?', end - 1000, now - 5 * 86_400_000, p.id);
    db.run('UPDATE fsrs_cards SET due = ?, last_review = ? WHERE id = ?', end + 1000, now - 5 * 86_400_000, q.id);
  });
  const s = await startSession(c, { language: 'ru', mode: 'review', minutes: 10 });
  const itemIds = new Set(s.exercises.map((e: any) => e.itemId));
  assert.ok(itemIds.has(p.item_id), 'due later today (local time) → included');
  assert.ok(!itemIds.has(q.item_id), 'due after local midnight → not yet due');
  await finish(s.id);
});

test('attempt days are recorded in the owner’s timezone, not UTC', async () => {
  const s = await startSession(c, { language: 'ru', minutes: 10, newWords: 1 });
  const intro = s.exercises.find((e: any) => e.kind === 'intro');
  assert.ok(intro, 'a new word is introduced');
  const yesterday = addDays(localDay(Date.now(), TZ), -1);
  const at = startOfLocalDay(yesterday, TZ) + 30 * 60_000; // 00:30 Kyiv = 22:30 UTC the previous day
  assert.notEqual(new Date(at).toISOString().slice(0, 10), yesterday);
  const r = await answer(c, s.id, intro, { answeredAt: at });
  const row = db.get<{ local_day: string; answered_at: number }>('SELECT local_day, answered_at FROM exercise_attempts WHERE id = ?', r.result.attemptId)!;
  assert.equal(row.answered_at, at, 'timestamps are stored as UTC milliseconds');
  assert.equal(row.local_day, yesterday);
  assert.equal(db.get<{ introduced_day: string }>('SELECT introduced_day FROM learning_items WHERE id = ?', intro.itemId)!.introduced_day, yesterday);
  // Future client clocks are clamped to the server time.
  const next = nextPending((await c.get(`/api/sessions/${s.id}`)).body);
  const r2 = await answer(c, s.id, next, { answeredAt: Date.now() + 86_400_000 * 3 });
  assert.ok(r2.result.answeredAt <= Date.now());
  await finish(s.id);
});

test('choosing the word (assisted recall) never schedules the productive memory', async () => {
  const s = await startSession(c, { language: 'ru', minutes: 30, newWords: 3 });
  const newItems = Object.values<any>(s.items).filter((i) => i.isNew).map((i) => i.itemId);
  assert.equal(newItems.length, 3);
  const productiveTyped = new Set(['recall_typed', 'cloze_typed', 'form_typed', 'speak_flashcard', 'sentence_create']);
  const done = await runSession(c, s.id, (ex) => (productiveTyped.has(ex.kind) ? 'skip' : undefined));
  assert.equal(done.status, 'completed');
  const wordChoices = db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM exercise_attempts WHERE session_id = ? AND kind = 'word_choice'`,
    s.id,
  )!.n;
  assert.ok(wordChoices >= 3, 'word_choice exercises were answered');
  for (const itemId of newItems) {
    const productive = db.get<{ state: number }>("SELECT state FROM fsrs_cards WHERE item_id = ? AND skill = 'productive'", itemId)!;
    assert.equal(productive.state, 0, 'productive card is still new (not falsely scheduled)');
    assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM review_logs WHERE item_id = ? AND skill = 'productive'", itemId)!.n, 0);
    assert.equal(db.get<{ state: number }>("SELECT state FROM fsrs_cards WHERE item_id = ? AND skill = 'receptive'", itemId)!.state, 2);
    const skills = db.all<{ skill: string }>('SELECT skill FROM skill_evidence WHERE item_id = ?', itemId).map((r) => r.skill);
    assert.ok(skills.includes('recall_assisted'), skills.join(','));
    assert.ok(!skills.includes('recall'), 'assisted evidence is never stored as recall');
  }
  // The word detail page reports recognition without productive mastery.
  const entryId = db.get<{ entry_id: number }>('SELECT entry_id FROM learning_items WHERE id = ?', newItems[0])!.entry_id;
  const detail = (await c.get(`/api/vocab/${entryId}`)).body;
  assert.equal(detail.mastery.retrievesFromEnglish, false);
  assert.equal(detail.mastery.productiveMastery, false);
});

test('a new word’s initial rating waits for every graded exercise on that memory, optional ones included', async () => {
  await importFixture(c, 'es-mini.json', 'es');
  const rated = (Object.keys(KINDS) as ExerciseKind[]).filter((k) => k !== 'intro' && !KINDS[k].assisted && !KINDS[k].practiceOnly);
  const s = await startSession(c, { language: 'es', minutes: 30, newWords: 3 });
  let session = (await c.get(`/api/sessions/${s.id}`)).body;
  let sawOptionalBeforeRating = false;
  for (let guard = 0; guard < 300; guard++) {
    const ex = nextPending(session);
    if (!ex) break;
    await answer(c, s.id, ex, {}, session.items);
    session = (await c.get(`/api/sessions/${s.id}`)).body;
    for (const card of db.all<{ item_id: number; skill: string; state: number }>(
      "SELECT c.item_id, c.skill, c.state FROM fsrs_cards c JOIN session_exercises e ON e.item_id = c.item_id AND e.session_id = ? GROUP BY c.id",
      s.id,
    )) {
      const pending = session.exercises.filter((e: any) => e.itemId === card.item_id && e.cardSkill === card.skill && e.status === 'pending' && rated.includes(e.kind));
      if (pending.length) {
        assert.equal(card.state, 0, `item ${card.item_id} ${card.skill} is not rated while ${pending.map((e: any) => e.kind).join(', ')} remain`);
        if (pending.some((e: any) => e.priority === 'optional')) sawOptionalBeforeRating = true;
      }
    }
  }
  assert.equal(session.status, 'completed');
  for (const r of db.all<{ item_id: number; skill: string; reviewed_at: number }>("SELECT item_id, skill, reviewed_at FROM review_logs WHERE session_id = ? AND rating_source = 'aggregate'", s.id)) {
    const last = db.get<{ t: number }>(
      `SELECT MAX(answered_at) AS t FROM exercise_attempts WHERE session_id = ? AND item_id = ? AND card_skill = ? AND kind IN (${rated.map(() => '?').join(',')})`,
      s.id,
      r.item_id,
      r.skill,
      ...rated,
    )!;
    assert.equal(r.reviewed_at, last.t, 'the initial rating is dated at the last graded exercise for that memory');
  }
  if (!sawOptionalBeforeRating) console.log('note: this plan had no optional exercises on new words');
});

test('a word’s two memories are never both scheduled on one local day, even in separate sessions', async () => {
  shiftHistory(db, 40);
  const a = await startSession(c, { language: 'ru', mode: 'review', minutes: 30 });
  const first = nextPending(a);
  const r = await answer(c, a.id, first, {}, a.items);
  assert.ok(r.review, 'a scheduling event for one memory of the word');
  await finish(a.id);
  const b = await startSession(c, { language: 'ru', mode: 'review', minutes: 30 });
  const sameWord = b.exercises.filter((e: any) => e.itemId === first.itemId);
  assert.deepEqual(sameWord, [], 'the sibling memory waits until another day');
  assert.ok(b.exercises.length > 0, 'other due words are still offered');
  await finish(b.id);
});

test('an established recognition memory and a newly unlocked recall memory are never both scheduled on one day', async () => {
  // Words whose recall memory is still new while recognition is established and due (e.g. the first session was
  // ended before the production stage).
  const items = db.all<{ item_id: number }>("SELECT DISTINCT item_id FROM fsrs_cards WHERE language_code = 'es' AND state != 0 LIMIT 4").map((r) => r.item_id);
  assert.ok(items.length >= 2);
  const now = Date.now();
  db.tx(() => {
    for (const id of items) {
      db.run("UPDATE fsrs_cards SET state = 0, step = NULL, stability = NULL, difficulty = NULL, due = NULL, last_review = NULL, reps = 0, lapses = 0 WHERE item_id = ? AND skill = 'productive'", id);
      db.run("UPDATE fsrs_cards SET state = 2, reps = 3, stability = 6, difficulty = 5, due = ?, last_review = ? WHERE item_id = ? AND skill = 'receptive'", now - 3600_000, now - 7 * 86_400_000, id);
    }
  });
  const s = await startSession(c, { language: 'es', minutes: 30, newWords: 0 });
  await runSession(c, s.id);
  await finish(s.id);
  const both = db.all(
    `SELECT item_id, local_day, COUNT(DISTINCT card_id) AS cards, SUM(rating_source != 'aggregate') AS regular
       FROM review_logs GROUP BY item_id, local_day HAVING cards > 1 AND regular > 0`,
  );
  assert.deepEqual(both, [], 'no word has a review of one memory and any other scheduling event of its sibling on the same day');
});

test('"I was right" makes a typed answer correct, but a hint before it still rates the review Hard', async () => {
  shiftHistory(db, 60);
  const typedKinds = ['recall_typed', 'meaning_typed', 'cloze_typed', 'form_typed', 'dictation'];
  // Exercise kinds for reviews vary per session; plan until a session contains typed reviews.
  let s: any = null;
  let typed: any[] = [];
  for (let i = 0; i < 12 && typed.length < 2; i++) {
    s = await startSession(c, { language: 'ru', mode: 'review', minutes: 30, focus: 'writing', difficulty: 'challenging', replaceActive: true });
    typed = s.exercises.filter((e: any) => typedKinds.includes(e.kind));
  }
  assert.ok(typed.length >= 1, 'a typed review was planned');
  const withHint = await answer(c, s.id, typed[0], { response: 'zzz', hintsUsed: 1, override: true }, s.items);
  assert.equal(withHint.result.grade, 'correct');
  assert.equal(withHint.review?.rating, 2, `hinted → Hard (${typed[0].kind}, ${JSON.stringify(withHint.review)})`);
  if (typed[1]) {
    const noHint = await answer(c, s.id, typed[1], { response: 'zzz', override: true }, s.items);
    assert.equal(noHint.review?.rating, 3, `no hint → Good (${typed[1].kind}, ${JSON.stringify(noHint.review)})`);
  }
  await finish(s.id);
});
