// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Pronunciation playback.
 * - One shared <audio> element: starting a word stops the previous one (never overlapping audio).
 * - Forvo links are fetched live from the server (never cached/downloaded); each play is
 *   reported because Forvo counts plays as API requests. Expired links are refreshed once.
 * - Speed 0.75/1/1.25 with pitch preserved where the browser supports it.
 * - Optional device text-to-speech fallback, always labelled as synthesized.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AudioLookup, AudioSource } from '../../../shared/types.ts';
import { get } from './api.ts';
import { enqueue } from './outbox.ts';
import { plain } from './format.ts';

const lookups = new Map<number, { validUntil: number; promise: Promise<AudioLookup> }>();
const audioEl = typeof Audio !== 'undefined' ? new Audio() : (null as unknown as HTMLAudioElement);
if (audioEl) {
  audioEl.preload = 'none';
  (audioEl as HTMLAudioElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean }).preservesPitch = true;
  (audioEl as any).webkitPreservesPitch = true;
}

interface PlayerState {
  entryId: number | null;
  sourceId: string | null;
  playing: boolean;
  error: string | null;
  needsGesture: boolean;
}
let player: PlayerState = { entryId: null, sourceId: null, playing: false, error: null, needsGesture: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function setPlayer(p: Partial<PlayerState>) {
  player = { ...player, ...p };
  emit();
}
if (audioEl) {
  audioEl.addEventListener('playing', () => setPlayer({ playing: true, error: null, needsGesture: false }));
  audioEl.addEventListener('pause', () => setPlayer({ playing: false }));
  audioEl.addEventListener('ended', () => setPlayer({ playing: false }));
}

// Forvo counts every play as an API request. Plays are reported in small batches through the durable outbox, so a
// count is not lost when the tab closes; when the server reports the daily limit as used up, Forvo playback stops
// until Forvo's daily reset (22:00 UTC).
let pendingPlays = 0;
let playsTimer: ReturnType<typeof setTimeout> | null = null;
let forvoBlockedUntil = 0;
function nextForvoReset(now = Date.now()): number {
  const d = new Date(now);
  const reset = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 22);
  return reset > now ? reset : reset + 86_400_000;
}
function reportPlays() {
  if (playsTimer) clearTimeout(playsTimer);
  playsTimer = null;
  const n = pendingPlays;
  pendingPlays = 0;
  if (!n) return;
  void enqueue(
    { method: 'POST', url: '/api/audio/usage', body: { plays: Math.min(n, 100) }, label: 'Pronunciation plays' },
    {
      onResult: (r: { usage?: { remaining?: number } }) => {
        if ((r?.usage?.remaining ?? 1) <= 0) forvoBlockedUntil = nextForvoReset();
      },
    },
  );
}
function countForvoPlay() {
  pendingPlays++;
  if (!playsTimer) playsTimer = setTimeout(reportPlays, 4000);
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', reportPlays);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && reportPlays());
}

/** Lookups are kept until the first Forvo link in them is about to expire (the server says when). */
export function lookupAudio(entryId: number, refresh = false): Promise<AudioLookup> {
  const cached = lookups.get(entryId);
  if (cached && !refresh && Date.now() < cached.validUntil) return cached.promise;
  const entry = { validUntil: Date.now() + 60 * 60_000, promise: get<AudioLookup>(`/api/audio/${entryId}${refresh ? '?refresh=1' : ''}`) };
  lookups.set(entryId, entry);
  entry.promise
    .then((l) => {
      const expiries = l.sources.filter((x) => x.provider === 'forvo' && x.urlExpiresAt).map((x) => x.urlExpiresAt!);
      if (expiries.length) entry.validUntil = Math.min(entry.validUntil, Math.min(...expiries) - 60_000);
    })
    .catch(() => lookups.delete(entryId));
  return entry.promise;
}

export function stopAudio() {
  audioEl?.pause();
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  setPlayer({ playing: false });
}

function pickVoice(locales: string[], preferred: string | null): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const voices = speechSynthesis.getVoices();
  if (preferred) {
    const v = voices.find((x) => x.name === preferred);
    if (v) return v;
  }
  for (const loc of locales) {
    const v = voices.find((x) => x.lang.toLowerCase() === loc.toLowerCase()) ?? voices.find((x) => x.lang.toLowerCase().startsWith(loc.toLowerCase().split('-')[0] + '-') && loc.includes('-') === false);
    if (v) return v;
  }
  const base = locales[0]?.split('-')[0];
  return voices.find((x) => x.lang.toLowerCase().startsWith(base)) ?? null;
}

export function ttsVoices(locales: string[]): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  const base = locales[0]?.split('-')[0];
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(base));
}

export async function playSource(entryId: number, source: AudioSource, rate: number, lookup: AudioLookup | null): Promise<void> {
  stopAudio();
  setPlayer({ entryId, sourceId: source.id, error: null });
  if (source.provider === 'tts') {
    const voice = pickVoice(lookup?.tts.locales ?? [], lookup?.tts.voice ?? null);
    if (!voice && typeof speechSynthesis === 'undefined') {
      setPlayer({ error: 'This device has no speech synthesis.' });
      return;
    }
    const u = new SpeechSynthesisUtterance(plain(source.word));
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? lookup?.tts.locales[0] ?? 'en';
    u.rate = rate;
    u.onstart = () => setPlayer({ playing: true });
    u.onend = () => setPlayer({ playing: false });
    u.onerror = () => setPlayer({ playing: false, error: 'Speech synthesis failed.' });
    speechSynthesis.speak(u);
    return;
  }
  if (!source.url) return;
  if (source.provider === 'forvo' && Date.now() < forvoBlockedUntil) {
    setPlayer({ error: 'The daily Forvo request limit is used up; it resets at 22:00 UTC. Your own recordings still play.' });
    return;
  }
  audioEl.src = source.url;
  audioEl.playbackRate = rate;
  try {
    await audioEl.play();
    if (source.provider === 'forvo') countForvoPlay();
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === 'NotAllowedError') setPlayer({ needsGesture: true, error: null });
    else if (source.provider === 'forvo') {
      // The 2-hour link may have expired: fetch fresh links once and retry.
      try {
        const fresh = await lookupAudio(entryId, true);
        const again = fresh.sources.find((s) => s.id === source.id) ?? fresh.sources.find((s) => s.provider === 'forvo');
        if (again?.url) {
          audioEl.src = again.url;
          audioEl.playbackRate = rate;
          await audioEl.play();
          countForvoPlay();
          return;
        }
      } catch {
        /* fall through */
      }
      setPlayer({ error: 'Could not play this recording.' });
    } else setPlayer({ error: 'Could not play this recording.' });
  }
}

export function setRate(rate: number) {
  if (audioEl) audioEl.playbackRate = rate;
}

export function usePlayer() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => player,
  );
}

/** Lookup hook with TTS fallback source appended when enabled. */
export function useAudioLookup(entryId: number | null, enabled = true) {
  const [lookup, setLookup] = useState<AudioLookup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!entryId || !enabled) return;
    let alive = true;
    setLoading(true);
    setError(null);
    lookupAudio(entryId)
      .then((l) => alive && setLookup(l))
      .catch((e) => alive && setError(e?.isNetwork ? 'offline' : (e?.message ?? 'Audio unavailable')))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [entryId, enabled]);
  const sources: AudioSource[] = [...(lookup?.sources ?? [])];
  if (lookup?.tts.enabled && typeof speechSynthesis !== 'undefined') {
    sources.push({
      id: 'tts',
      provider: 'tts',
      kind: 'synthesized',
      url: null,
      urlExpiresAt: null,
      speaker: null,
      sex: null,
      country: null,
      accentLabel: 'Made on this device, not a native recording',
      verification: 'unverified',
      votes: null,
      preferred: false,
      sourceUrl: null,
      attribution: null,
      word: lookup.word,
    });
  }
  return { lookup, sources, loading, error };
}

/**
 * Speak a sentence with the device's voice for a language (only when the learner turned on device speech for it in
 * Settings → Audio). Returns false when this device has no voice for the language. Always labelled as synthesized.
 */
export function speakSentence(text: string, locales: string[], preferred: string | null, rate = 1): boolean {
  if (typeof speechSynthesis === 'undefined') return false;
  const voice = pickVoice(locales, preferred);
  if (!voice) return false;
  stopAudio();
  const u = new SpeechSynthesisUtterance(plain(text));
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = rate;
  u.onstart = () => setPlayer({ playing: true });
  u.onend = () => setPlayer({ playing: false });
  u.onerror = () => setPlayer({ playing: false });
  speechSynthesis.speak(u);
  return true;
}
