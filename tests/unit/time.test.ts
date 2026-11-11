// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Timezone helpers: all timestamps are UTC; days are computed in the owner's timezone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysBetween, endOfLocalDay, isValidTimezone, localDay, startOfLocalDay, tzOffset } from '../../shared/time.ts';

const t = (iso: string) => Date.parse(iso);

test('local day differs from the UTC day near midnight', () => {
  // 00:30 in Kyiv (UTC+2 in November) is still the previous day in UTC.
  const ms = t('2026-11-05T22:30:00Z');
  assert.equal(localDay(ms, 'Europe/Kyiv'), '2026-11-06');
  assert.equal(localDay(ms, 'UTC'), '2026-11-05');
  assert.equal(localDay(ms, 'America/Bogota'), '2026-11-05');
  assert.equal(localDay(t('2026-11-06T04:59:00Z'), 'America/Bogota'), '2026-11-05');
  assert.equal(localDay(t('2026-11-06T05:00:00Z'), 'America/Bogota'), '2026-11-06');
});

test('start and end of the local day', () => {
  assert.equal(startOfLocalDay('2026-11-06', 'Europe/Kyiv'), t('2026-11-05T22:00:00Z'));
  assert.equal(endOfLocalDay(t('2026-11-06T09:00:00Z'), 'Europe/Kyiv'), t('2026-11-06T22:00:00Z'));
  assert.equal(startOfLocalDay('2026-11-06', 'Asia/Ho_Chi_Minh'), t('2026-11-05T17:00:00Z'));
  assert.equal(endOfLocalDay(t('2026-11-06T12:00:00Z'), 'UTC'), t('2026-11-07T00:00:00Z'));
});

test('daylight-saving transitions keep local midnights correct', () => {
  // Kyiv: DST starts 2026-03-29 (UTC+2 → UTC+3) and ends 2026-10-25 (UTC+3 → UTC+2).
  assert.equal(startOfLocalDay('2026-03-29', 'Europe/Kyiv'), t('2026-03-28T22:00:00Z'));
  assert.equal(startOfLocalDay('2026-03-30', 'Europe/Kyiv'), t('2026-03-29T21:00:00Z'));
  assert.equal(endOfLocalDay(t('2026-03-29T12:00:00Z'), 'Europe/Kyiv') - startOfLocalDay('2026-03-29', 'Europe/Kyiv'), 23 * 3600_000);
  assert.equal(endOfLocalDay(t('2026-10-25T12:00:00Z'), 'Europe/Kyiv') - startOfLocalDay('2026-10-25', 'Europe/Kyiv'), 25 * 3600_000);
  assert.equal(tzOffset(t('2026-07-01T00:00:00Z'), 'Europe/Kyiv'), 3 * 3600_000);
  assert.equal(tzOffset(t('2026-12-01T00:00:00Z'), 'Europe/Kyiv'), 2 * 3600_000);
  // Warsaw also observes DST; Bogotá and Ho Chi Minh City do not.
  assert.equal(tzOffset(t('2026-07-01T00:00:00Z'), 'Europe/Warsaw'), 2 * 3600_000);
  assert.equal(tzOffset(t('2026-07-01T00:00:00Z'), 'America/Bogota'), -5 * 3600_000);
});

test('day arithmetic and validation', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(daysBetween('2026-11-01', '2026-11-08'), 7);
  assert.equal(isValidTimezone('Europe/Kyiv'), true);
  assert.equal(isValidTimezone('Mars/Olympus'), false);
});
