// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Helpers for driving study sessions and manipulating time in integration tests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Db } from '../../server/db/database.ts';
import { localDay } from '../../shared/time.ts';
import { Client, correctAnswer, FIXTURE, nextPending } from './harness.ts';

export const TZ = 'Europe/Kyiv';

export async function importFixture(client: Client, file: string, lang: string) {
  const up = await client.post(`/api/import/upload?lang=${lang}&kind=vocabulary&filename=${file}`, readFileSync(path.join(FIXTURE, file)), {
    'Content-Type': 'application/octet-stream',
  });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const commit = await client.post(`/api/import/${up.body.id}/commit`, { mapping: {}, options: {} });
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  return commit.body;
}

export async function startSession(client: Client, body: Record<string, unknown>) {
  const r = await client.post('/api/sessions', { id: randomUUID(), ...body });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

export async function answer(client: Client, sessionId: string, ex: any, extra: Record<string, unknown> = {}, items: Record<string, any> = {}) {
  const opId = randomUUID();
  const r = await client.post(
    `/api/sessions/${sessionId}/attempts`,
    { opId, exerciseId: ex.id, answeredAt: Date.now(), latencyMs: 3000, activeMsDelta: 4000, ...correctAnswer(ex, items), ...extra },
    { 'Idempotency-Key': opId },
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

/** Answer every pending exercise; `decide` may return 'skip' or an answer override. */
export async function runSession(client: Client, sessionId: string, decide: (ex: any) => 'skip' | Record<string, unknown> | undefined = () => undefined) {
  let session = (await client.get(`/api/sessions/${sessionId}`)).body;
  for (let guard = 0; guard < 500; guard++) {
    const ex = nextPending(session);
    if (!ex || session.status === 'completed') break;
    const d = decide(ex);
    if (d === 'skip') {
      const r = await client.post(`/api/sessions/${sessionId}/events`, { type: 'skip', exerciseId: ex.id });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    } else {
      await answer(client, sessionId, ex, d ?? {}, session.items);
    }
    session = (await client.get(`/api/sessions/${sessionId}`)).body;
  }
  return session;
}

/** Move all recorded learning history `days` into the past (as if it happened earlier). */
export function shiftHistory(db: Db, days: number, tz = TZ) {
  const ms = Math.round(days * 86_400_000);
  db.tx(() => {
    db.run('UPDATE fsrs_cards SET due = due - ?, last_review = last_review - ? WHERE state != 0', ms, ms);
    for (const r of db.all<{ id: number; reviewed_at: number }>('SELECT id, reviewed_at FROM review_logs ORDER BY reviewed_at ASC')) {
      db.run(
        `UPDATE review_logs SET reviewed_at = ?, local_day = ?, due_after = due_after - ?, due_before = CASE WHEN due_before IS NULL THEN NULL ELSE due_before - ? END,
           received_at = received_at - ? WHERE id = ?`,
        r.reviewed_at - ms,
        localDay(r.reviewed_at - ms, tz),
        ms,
        ms,
        ms,
        r.id,
      );
    }
    for (const a of db.all<{ id: number; answered_at: number }>('SELECT id, answered_at FROM exercise_attempts')) {
      db.run('UPDATE exercise_attempts SET answered_at = ?, received_at = received_at - ?, local_day = ? WHERE id = ?', a.answered_at - ms, ms, localDay(a.answered_at - ms, tz), a.id);
    }
    for (const it of db.all<{ id: number; introduced_at: number }>('SELECT id, introduced_at FROM learning_items WHERE introduced_at IS NOT NULL')) {
      db.run(
        'UPDATE learning_items SET introduced_at = ?, introduced_day = ?, first_scheduled_at = first_scheduled_at - ?, last_studied_at = last_studied_at - ? WHERE id = ?',
        it.introduced_at - ms,
        localDay(it.introduced_at - ms, tz),
        ms,
        ms,
        it.id,
      );
    }
    db.run('UPDATE study_sessions SET created_at = created_at - ?, started_at = started_at - ?, last_activity_at = last_activity_at - ?, ended_at = ended_at - ?', ms, ms, ms, ms);
    db.run('UPDATE skill_evidence SET last_attempt_at = last_attempt_at - ?, last_correct_at = last_correct_at - ?, last_incorrect_at = last_incorrect_at - ?', ms, ms, ms);
  });
}

export function duplicateCardDays(db: Db): number {
  return db.all('SELECT card_id, local_day, COUNT(*) AS n FROM review_logs GROUP BY card_id, local_day HAVING n > 1').length;
}
