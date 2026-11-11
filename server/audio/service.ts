// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { randomUUID } from 'node:crypto';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { App } from '../app.ts';
import { LANGUAGES, type LanguageCode } from '../../shared/languages.ts';
import { stripStress } from '../../shared/text.ts';
import type { AudioLookup, AudioSource } from '../../shared/types.ts';
import { getLanguageSettings } from '../services/settings.ts';
import { HttpError, notFound } from '../http/http.ts';
import { FORVO_LINK_LIFETIME_MS, ForvoError, type ForvoItem } from './forvo.ts';
import { labelRecording, rankScore, type SpeakerProfile } from './accent.ts';

export const FORVO_ATTRIBUTION = 'Pronunciations by Forvo';

export function forvoPageUrl(word: string, language: LanguageCode): string {
  return `https://forvo.com/word/${encodeURIComponent(word)}/#${LANGUAGES[language].forvoCode}`;
}

function speakerProfiles(app: App, language: LanguageCode): Map<string, SpeakerProfile> {
  const m = new Map<string, SpeakerProfile>();
  for (const r of app.db.all<any>("SELECT speaker, preference, accent_note, verified_by_user FROM speaker_profiles WHERE language_code = ? AND provider = 'forvo'", language)) {
    m.set(r.speaker, { preference: r.preference, accentNote: r.accent_note, verifiedByUser: !!r.verified_by_user });
  }
  return m;
}

export async function lookupAudio(app: App, entryId: number, opts: { refresh?: boolean; now?: number } = {}): Promise<AudioLookup> {
  const now = opts.now ?? Date.now();
  const db = app.db;
  const entry = db.get<{ id: number; language_code: LanguageCode; lemma: string; display: string | null }>(
    'SELECT id, language_code, lemma, display FROM vocabulary_entries WHERE id = ? AND deleted_at IS NULL',
    entryId,
  );
  if (!entry) throw notFound('Word');
  const language = entry.language_code;
  const settings = getLanguageSettings(db, language);
  const word = stripStress(entry.lemma);
  const preferred = db.get<{ record_id: number | null }>('SELECT record_id FROM pronunciation_preferences WHERE entry_id = ?', entryId)?.record_id ?? null;
  const sources: AudioSource[] = [];

  for (const r of db.all<any>("SELECT * FROM pronunciation_records WHERE entry_id = ? AND provider IN ('user', 'licensed') ORDER BY created_at DESC", entryId)) {
    sources.push({
      id: `rec:${r.id}`,
      provider: 'user',
      kind: r.provider === 'licensed' ? 'human' : 'user',
      url: `/api/audio/file/${r.id}`,
      urlExpiresAt: null,
      speaker: r.speaker,
      sex: null,
      country: null,
      accentLabel: r.provider === 'licensed' ? `Licensed recording${r.license ? ` (${r.license})` : ''}` : 'Your uploaded recording — not a verified native recording',
      verification: 'unverified',
      votes: null,
      preferred: preferred === r.id,
      sourceUrl: null,
      attribution: r.license,
      word: r.word,
    });
  }

  let status: AudioLookup['status'] = 'ok';
  let message: string | null = null;
  if (!app.forvo.configured) {
    status = sources.length ? 'ok' : 'not_configured';
    message = 'Forvo is not configured (add VB_FORVO_API_KEY on the server to enable native-speaker recordings).';
  } else {
    try {
      const accent = LANGUAGES[language].accents.find((a) => a.id === settings.accent) ?? LANGUAGES[language].accents[0];
      const primaryCountry = accent.countries[0] ?? null;
      let items: ForvoItem[] = await app.forvo.wordPronunciations(word, LANGUAGES[language].forvoCode, { country: primaryCountry, refresh: opts.refresh, now });
      if (primaryCountry && items.length < 2) {
        // Fall back to all speakers of the language; non-matching recordings are labelled as such.
        const more = await app.forvo.wordPronunciations(word, LANGUAGES[language].forvoCode, { country: null, refresh: opts.refresh, now });
        const seen = new Set(items.map((i) => i.id));
        items = [...items, ...more.filter((i) => !seen.has(i.id))];
      }
      const profiles = speakerProfiles(app, language);
      db.tx(() => {
        for (const it of items) {
          db.run(
            `INSERT INTO pronunciation_records (entry_id, provider, provider_ref, word, speaker, speaker_sex, speaker_country, rating, votes, positive_votes, audio_kind, created_at, metadata_fetched_at)
             VALUES (?, 'forvo', ?, ?, ?, ?, ?, ?, ?, ?, 'human', ?, ?)
             ON CONFLICT(provider, provider_ref) DO UPDATE SET speaker = excluded.speaker, speaker_country = excluded.speaker_country, rating = excluded.rating,
               votes = excluded.votes, positive_votes = excluded.positive_votes, metadata_fetched_at = excluded.metadata_fetched_at`,
            entryId,
            it.id,
            it.original || it.word || word,
            it.username || null,
            it.sex ?? null,
            it.country ?? null,
            it.rate ?? null,
            it.num_votes ?? null,
            it.num_positive_votes ?? null,
            now,
            now,
          );
        }
        db.run(
          `INSERT INTO audio_lookups (entry_id, provider, status, found_count, checked_at) VALUES (?, 'forvo', ?, ?, ?)
           ON CONFLICT(entry_id, provider) DO UPDATE SET status = excluded.status, found_count = excluded.found_count, checked_at = excluded.checked_at`,
          entryId,
          items.length ? 'found' : 'none',
          items.length,
          now,
        );
      });
      const recordIds = new Map(
        db.all<{ id: number; provider_ref: string }>("SELECT id, provider_ref FROM pronunciation_records WHERE entry_id = ? AND provider = 'forvo'", entryId).map((r) => [r.provider_ref, r.id]),
      );
      const ranked = items
        .map((it) => {
          const profile = it.username ? profiles.get(it.username) : undefined;
          const label = labelRecording(language, settings.accent, it.country ?? null, profile);
          const recId = recordIds.get(it.id) ?? null;
          const score = rankScore({
            word: it.original || it.word || word,
            queriedWord: word,
            speaker: it.username || null,
            votes: it.num_votes ?? null,
            positiveVotes: it.num_positive_votes ?? null,
            rating: it.rate ?? null,
            hits: it.hits ?? null,
            matchesPreference: label.matchesPreference,
            isPreferredRecord: recId != null && recId === preferred,
            speakerPreference: profile?.preference ?? 'neutral',
          });
          const src: AudioSource = {
            id: `forvo:${it.id}`,
            provider: 'forvo',
            kind: 'human',
            url: it.pathmp3 ?? it.pathogg ?? null,
            // Ten minutes before Forvo's two-hour expiry, counted from when Forvo returned the link.
            urlExpiresAt: (it.fetchedAt ?? now) + FORVO_LINK_LIFETIME_MS - 10 * 60_000,
            speaker: it.username || null,
            sex: it.sex ?? null,
            country: it.country ?? null,
            accentLabel: label.accentLabel,
            verification: label.verification,
            votes: it.num_positive_votes ?? it.num_votes ?? null,
            preferred: recId != null && recId === preferred,
            sourceUrl: forvoPageUrl(word, language),
            attribution: FORVO_ATTRIBUTION,
            word: it.original || it.word || word,
          };
          return { src, score };
        })
        .sort((a, b) => b.score - a.score)
        .map((x) => x.src);
      sources.unshift(...ranked);
      if (!items.length) {
        status = sources.length ? 'ok' : 'none_found';
        message = 'No Forvo recording found for this word.';
      }
    } catch (err) {
      if (err instanceof ForvoError) {
        status = err.code === 'quota_exceeded' ? 'quota_exceeded' : err.code === 'not_configured' ? 'not_configured' : 'error';
        message = err.message;
      } else throw err;
    }
  }
  // Preferred source first.
  sources.sort((a, b) => Number(b.preferred) - Number(a.preferred));
  return {
    entryId,
    word,
    status: sources.length && status !== 'quota_exceeded' ? 'ok' : status,
    message,
    sources,
    forvoPageUrl: forvoPageUrl(word, language),
    tts: { enabled: settings.ttsFallback, locales: LANGUAGES[language].ttsLocales, voice: settings.ttsVoice },
  };
}

const AUDIO_TYPES: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aac': 'aac',
};

export function saveUserRecording(app: App, entryId: number, mime: string, data: Buffer, now: number): number {
  const base = mime.split(';')[0].trim().toLowerCase();
  const ext = AUDIO_TYPES[base];
  if (!ext) throw new HttpError(415, 'unsupported_media_type', 'Unsupported audio format');
  if (data.length < 100) throw new HttpError(422, 'validation_failed', 'Recording is empty');
  const entry = app.db.get<{ lemma: string }>('SELECT lemma FROM vocabulary_entries WHERE id = ? AND deleted_at IS NULL', entryId);
  if (!entry) throw notFound('Word');
  const dir = path.join(app.config.dataDir, 'audio');
  mkdirSync(dir, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  writeFileSync(path.join(dir, name), data);
  try {
    return app.db.tx(
      () =>
        app.db.run(
          `INSERT INTO pronunciation_records (entry_id, provider, provider_ref, word, audio_kind, file_name, mime_type, byte_size, created_at)
           VALUES (?, 'user', ?, ?, 'user', ?, ?, ?, ?)`,
          entryId,
          name,
          stripStress(entry.lemma),
          name,
          base,
          data.length,
          now,
        ).lastInsertRowid,
    );
  } catch (err) {
    unlinkSync(path.join(dir, name));
    throw err;
  }
}

export function deleteUserRecording(app: App, recordId: number): void {
  const r = app.db.get<{ file_name: string | null }>("SELECT file_name FROM pronunciation_records WHERE id = ? AND provider = 'user'", recordId);
  if (!r) throw notFound('Recording');
  app.db.run('DELETE FROM pronunciation_records WHERE id = ?', recordId);
  if (r.file_name) {
    try {
      unlinkSync(path.join(app.config.dataDir, 'audio', r.file_name));
    } catch {
      /* already gone */
    }
  }
}
