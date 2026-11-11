// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Honest accent labels for pronunciation recordings.
 * Forvo metadata identifies a speaker's country, never their city or regional accent, so
 * labels only claim what the metadata (or the owner's own verification) supports.
 */
import { COUNTRY_NAMES, countryCodeFromName, LANGUAGES, type LanguageCode } from '../../shared/languages.ts';
import type { AudioSource } from '../../shared/types.ts';

export interface SpeakerProfile {
  preference: 'preferred' | 'neutral' | 'avoid';
  accentNote: string | null;
  verifiedByUser: boolean;
}

export interface AccentLabel {
  accentLabel: string;
  verification: AudioSource['verification'];
  matchesPreference: boolean;
}

function countryDisplay(code: string): string {
  const name = COUNTRY_NAMES[code]?.[0] ?? code;
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function labelRecording(language: LanguageCode, accentId: string, speakerCountry: string | null, profile?: SpeakerProfile | null): AccentLabel {
  const lang = LANGUAGES[language];
  const accent = lang.accents.find((a) => a.id === accentId) ?? lang.accents[0];
  if (profile?.verifiedByUser && profile.accentNote) {
    return { accentLabel: `${profile.accentNote} — verified by you`, verification: 'user_verified', matchesPreference: profile.preference !== 'avoid' };
  }
  const code = countryCodeFromName(speakerCountry);
  if (!code) {
    return { accentLabel: `${lang.name} — speaker country unknown, accent unverified`, verification: 'unverified', matchesPreference: accent.countries.length === 0 };
  }
  const country = countryDisplay(code);
  const matches = accent.countries.length === 0 || accent.countries.includes(code);
  if (accent.id === 'any') {
    return { accentLabel: `${lang.name} (${country}) — country verified, regional accent unverified`, verification: 'country_verified', matchesPreference: true };
  }
  if (matches) {
    if (accent.countryConfirmsVariety) {
      // e.g. "Colombian Spanish — country verified" (city such as Bogotá is never claimed).
      const label = accent.countries.length === 1 ? accent.label : `${lang.name} (${country})`;
      return { accentLabel: `${label} — country verified; city/region unverified`, verification: 'country_verified', matchesPreference: true };
    }
    // Country cannot confirm the variety (Southern Vietnamese, Moscow Russian, Kyiv Ukrainian, Warsaw Polish).
    return { accentLabel: `${lang.name} (${country}) — specific regional accent unverified`, verification: 'country_verified', matchesPreference: true };
  }
  return { accentLabel: `${lang.name} (${country}) — not your preferred variety`, verification: 'country_verified', matchesPreference: false };
}

export interface RankInput {
  word: string;
  queriedWord: string;
  speaker: string | null;
  votes: number | null;
  positiveVotes: number | null;
  rating: number | null;
  hits: number | null;
  matchesPreference: boolean;
  isPreferredRecord: boolean;
  speakerPreference: 'preferred' | 'neutral' | 'avoid';
}

/** Higher is better: explicit choice > preferred speakers > accent match > exact form > community rating. */
export function rankScore(r: RankInput): number {
  let s = 0;
  if (r.isPreferredRecord) s += 10_000;
  if (r.speakerPreference === 'preferred') s += 1_000;
  if (r.speakerPreference === 'avoid') s -= 1_000;
  if (r.matchesPreference) s += 300;
  if (r.word.toLowerCase() === r.queriedWord.toLowerCase()) s += 50;
  s += (r.positiveVotes ?? 0) * 6 + (r.rating ?? 0) * 3 - Math.max(0, (r.votes ?? 0) - (r.positiveVotes ?? 0)) * 6;
  s += Math.log10((r.hits ?? 0) + 1);
  return s;
}
