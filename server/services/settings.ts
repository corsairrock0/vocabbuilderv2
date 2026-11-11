// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { z } from 'zod';
import type { Db } from '../db/database.ts';
import { json } from '../db/database.ts';
import { LANGUAGE_CODES, LANGUAGES, type LanguageCode } from '../../shared/languages.ts';
import { GLOBAL_DEFAULTS, languageDefaults, type GlobalSettings, type LanguageSettings } from '../../shared/settings.ts';
import { READING_LEVELS } from '../../shared/comprehension.ts';
import { isValidTimezone } from '../../shared/time.ts';

const langEnum = z.enum(LANGUAGE_CODES as [LanguageCode, ...LanguageCode[]]);

export const globalSettingsSchema = z
  .object({
    theme: z.enum(['system', 'light', 'dark']),
    timezone: z.string().refine(isValidTimezone, 'Unknown timezone'),
    activeLanguage: langEnum,
    interfaceLanguage: z.literal('en'),
    keyboardShortcuts: z.boolean(),
    reducedMotion: z.boolean(),
    fontScale: z.number().min(0.85).max(1.6),
    highContrast: z.boolean(),
    ratingMode: z.enum(['auto', 'confirm']),
    hintBehavior: z.enum(['on_request', 'after_error', 'never']),
    showStressMarks: z.boolean(),
    audioAutoplay: z.boolean(),
    recordingEnabled: z.boolean(),
    onScreenKeyboard: z.boolean(),
  })
  .partial()
  .strict();

export function languageSettingsSchema(code: LanguageCode) {
  const accentIds = LANGUAGES[code].accents.map((a) => a.id) as [string, ...string[]];
  return z
    .object({
      accent: z.enum(accentIds),
      playbackRate: z.union([z.literal(0.75), z.literal(1), z.literal(1.25)]),
      dailyNewTarget: z.number().int().min(0).max(100),
      sessionMinutes: z.number().int().min(3).max(180),
      desiredRetention: z.number().min(0.7).max(0.99),
      spellingStrictness: z.enum(['strict', 'normal', 'lenient']),
      focus: z.enum(['balanced', 'listening', 'speaking', 'reading', 'writing']),
      difficulty: z.enum(['easy', 'normal', 'challenging']),
      frequencyMin: z.number().int().min(1).nullable(),
      frequencyMax: z.number().int().min(1).nullable(),
      ttsFallback: z.boolean(),
      ttsVoice: z.string().max(200).nullable(),
      reviewPriority: z.enum(['balanced', 'due_first', 'difficult_first']),
      repetitions: z.enum(['fewer', 'normal', 'more']),
      frequencySourceId: z.number().int().nullable(),
      includeShadowing: z.boolean(),
      includeSentenceCreation: z.boolean(),
      readingLevel: z.enum(READING_LEVELS),
      writingLevel: z.enum(READING_LEVELS),
      dailyGoalMinutes: z.number().int().min(5).max(240),
    })
    .partial()
    .strict();
}

export function getGlobalSettings(db: Db, fallbackTz = 'UTC'): GlobalSettings {
  const out: Record<string, unknown> = { ...GLOBAL_DEFAULTS, timezone: fallbackTz };
  for (const r of db.all<{ key: string; value: string }>('SELECT key, value FROM user_settings')) {
    if (r.key in GLOBAL_DEFAULTS) out[r.key] = json(r.value, out[r.key]);
  }
  return out as unknown as GlobalSettings;
}

export function getTimezone(db: Db, fallbackTz = 'UTC'): string {
  const row = db.get<{ value: string }>("SELECT value FROM user_settings WHERE key = 'timezone'");
  const tz = row ? json<string>(row.value, fallbackTz) : fallbackTz;
  return isValidTimezone(tz) ? tz : 'UTC';
}

export function getLanguageSettings(db: Db, code: LanguageCode): LanguageSettings {
  const out: Record<string, unknown> = { ...languageDefaults(code) };
  for (const r of db.all<{ key: string; value: string }>('SELECT key, value FROM language_settings WHERE language_code = ?', code)) {
    if (r.key in out) out[r.key] = json(r.value, out[r.key]);
  }
  return out as unknown as LanguageSettings;
}

export function getAllLanguageSettings(db: Db): Record<LanguageCode, LanguageSettings> {
  const out = {} as Record<LanguageCode, LanguageSettings>;
  for (const c of LANGUAGE_CODES) out[c] = getLanguageSettings(db, c);
  return out;
}

/**
 * Per-key last-writer-wins. Each key carries its own server timestamp, so changing the
 * theme on a phone never overwrites a retention change made on the desktop.
 */
export function updateGlobalSettings(db: Db, patch: Partial<GlobalSettings>, now: number, deviceId: string | null): GlobalSettings {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    // `now` is when the change was made on the device (see changedAt()), so an edit made offline earlier never
    // overwrites a newer edit of the same key that reached the server first.
    db.run(
      `INSERT INTO user_settings (key, value, updated_at, updated_by_device) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by_device = excluded.updated_by_device
       WHERE excluded.updated_at >= user_settings.updated_at`,
      k,
      JSON.stringify(v),
      now,
      deviceId,
    );
  }
  return getGlobalSettings(db);
}

export function updateLanguageSettings(db: Db, code: LanguageCode, patch: Partial<LanguageSettings>, now: number, deviceId: string | null): LanguageSettings {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    db.run(
      `INSERT INTO language_settings (language_code, key, value, updated_at, updated_by_device) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(language_code, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by_device = excluded.updated_by_device
       WHERE excluded.updated_at >= language_settings.updated_at`,
      code,
      k,
      JSON.stringify(v),
      now,
      deviceId,
    );
  }
  return getLanguageSettings(db, code);
}

/**
 * When a change was made, for last-writer-wins: the device's own timestamp (sent as `?changedAt=`), bounded to the
 * last 30 days and never later than the server's clock, so a device with a wrong clock cannot win forever.
 */
export function changedAt(raw: string | null, now: number): number {
  const t = Number(raw);
  if (!raw || !Number.isFinite(t)) return now;
  return Math.min(now, Math.max(now - 30 * 86_400_000, Math.round(t)));
}
