// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/** Display formatting. Server timestamps are UTC; everything is shown in the owner's timezone. */

let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
export function setDisplayTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    timezone = tz;
  } catch {
    /* keep previous */
  }
}
export function displayTimezone() {
  return timezone;
}

export function pct(x: number | null | undefined, digits = 0): string {
  if (x == null || Number.isNaN(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

export function duration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return ms > 0 ? '<1 min' : '0 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function intervalText(days: number): string {
  if (days <= 0) return 'later today';
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  if (days < 365 * 1.5) return `in ${Math.round(days / 30)} months`;
  return `in ${(days / 365).toFixed(1)} years`;
}

export function dateTime(ts: number | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }): string {
  if (!ts) return '—';
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: timezone }).format(new Date(ts));
}

export function date(ts: number | null | undefined): string {
  return dateTime(ts, { dateStyle: 'medium' });
}

/**
 * A local day as the server names it (YYYY-MM-DD), as text: "Aug 11" by default, or with other parts ("Tue"). It is a
 * calendar day already, so it is formatted as such, never shifted by a timezone.
 */
export function dayText(day: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
}

export function relative(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return 'never';
  const diff = ts - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < 60_000) return 'just now';
  if (abs < 3600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3600_000), 'hour');
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), 'day');
  return date(ts);
}

/** When a word's review is due: "due now", "due in 3 days", "due tomorrow", "due Dec 30, 2026". */
export function dueText(due: number | null | undefined, now = Date.now()): string {
  if (!due) return 'not scheduled';
  const r = due <= now ? 'just now' : relative(due, now);
  return r === 'just now' ? 'due now' : `due ${r}`;
}

/** A count with thousands separators, as everywhere in the app: 6,000. */
export function count(n: number): string {
  return n.toLocaleString('en');
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${count(n)} ${n === 1 ? one : many}`;
}

/** Remove Russian/Ukrainian learner stress marks (Latin accents and Vietnamese tones are kept). */
export { stripStress as plain } from '../../../shared/text.ts';

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
