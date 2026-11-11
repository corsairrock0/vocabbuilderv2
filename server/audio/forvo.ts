// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * Forvo API client (server-side only — the API key never reaches the browser).
 *
 * Verified against Forvo's published documentation (api.forvo.com/documentation):
 *  - URL form: {base}/key/{key}/format/json/action/word-pronunciations/word/{word}/language/{code}[/country/{ISO alpha-3}]...
 *  - `country` filter uses ISO 3166-1 alpha-3 codes.
 *  - Audio links are valid for ~2 hours; caching audio is not allowed.
 *  - Every API call AND every audio play counts as a request; limits reset daily at 22:00 UTC.
 * This client never downloads audio. It keeps API responses (metadata + short-lived links)
 * in memory for at most 90 minutes to avoid repeated lookups within a study session.
 */
import { z } from 'zod';
import type { Config } from '../config.ts';
import type { Db } from '../db/database.ts';
import { log } from '../log.ts';

export const forvoItemSchema = z
  .object({
    id: z.union([z.number(), z.string()]).transform((v) => String(v)),
    word: z.string().optional().default(''),
    original: z.string().optional(),
    addtime: z.string().optional(),
    hits: z.coerce.number().optional(),
    username: z.string().optional().default(''),
    sex: z.string().optional(),
    country: z.string().optional(),
    code: z.string().optional(),
    langname: z.string().optional(),
    pathmp3: z.string().url().optional(),
    pathogg: z.string().url().optional(),
    rate: z.coerce.number().optional(),
    num_votes: z.coerce.number().optional(),
    num_positive_votes: z.coerce.number().optional(),
  })
  .passthrough();

/** A Forvo item plus when its (short-lived) audio links were obtained from Forvo. */
export type ForvoItem = z.infer<typeof forvoItemSchema> & { fetchedAt?: number };
/** Forvo audio links expire 2 hours after the API returned them. */
export const FORVO_LINK_LIFETIME_MS = 2 * 60 * 60_000;

export class ForvoError extends Error {
  code: 'not_configured' | 'quota_exceeded' | 'http_error' | 'api_error' | 'timeout' | 'network';
  constructor(code: ForvoError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export const LINK_TTL_MS = 90 * 60_000;

/** Forvo's quota day: limits reset at 22:00 UTC. */
export function forvoUsageDay(now: number): string {
  return new Date(now + 2 * 3600_000).toISOString().slice(0, 10);
}

type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export class ForvoClient {
  private config: Config['forvo'];
  private db: Db;
  private fetchImpl: FetchLike;
  private cache = new Map<string, { at: number; items: ForvoItem[] }>();

  constructor(config: Config['forvo'], db: Db, fetchImpl: FetchLike = fetch as unknown as FetchLike) {
    this.config = config;
    this.db = db;
    this.fetchImpl = fetchImpl;
  }

  get configured(): boolean {
    return !!this.config.apiKey;
  }

  usage(now = Date.now()) {
    const row = this.db.get<{ api_requests: number; audio_plays: number; errors: number }>(
      "SELECT api_requests, audio_plays, errors FROM provider_usage WHERE provider = 'forvo' AND usage_day = ?",
      forvoUsageDay(now),
    );
    const used = (row?.api_requests ?? 0) + (row?.audio_plays ?? 0);
    return {
      day: forvoUsageDay(now),
      apiRequests: row?.api_requests ?? 0,
      audioPlays: row?.audio_plays ?? 0,
      errors: row?.errors ?? 0,
      limit: this.config.dailyLimit,
      remaining: Math.max(0, this.config.dailyLimit - used),
    };
  }

  private bump(column: 'api_requests' | 'audio_plays' | 'errors', n: number, now: number) {
    const day = forvoUsageDay(now);
    const run = () => {
      this.db.run("INSERT INTO provider_usage (provider, usage_day) VALUES ('forvo', ?) ON CONFLICT DO NOTHING", day);
      this.db.run(`UPDATE provider_usage SET ${column} = ${column} + ? WHERE provider = 'forvo' AND usage_day = ?`, n, day);
    };
    if (this.db.inTransaction) run();
    else this.db.tx(run);
  }

  recordPlays(n: number, now = Date.now()) {
    if (n > 0) this.bump('audio_plays', Math.min(n, 100), now);
  }

  buildUrl(word: string, language: string, country?: string | null, limit = 20): string {
    if (!this.config.apiKey) throw new ForvoError('not_configured', 'Forvo API key not configured');
    const seg = (v: string) => encodeURIComponent(v);
    let url = `${this.config.apiBase}/key/${seg(this.config.apiKey)}/format/json/action/word-pronunciations/word/${seg(word)}/language/${seg(language)}`;
    if (country) url += `/country/${seg(country)}`;
    url += `/order/rate-desc/limit/${limit}`;
    return url;
  }

  /** Fetch pronunciations for a word. Throws ForvoError for configuration, quota and API failures. */
  async wordPronunciations(word: string, language: string, opts: { country?: string | null; refresh?: boolean; now?: number } = {}): Promise<ForvoItem[]> {
    const now = opts.now ?? Date.now();
    if (!this.configured) throw new ForvoError('not_configured', 'Forvo API key not configured');
    const key = `${language}|${opts.country ?? ''}|${word}`;
    // The daily limit is checked first: once it is used up, even cached links are not handed out, because
    // playing them would count as further requests.
    if (this.usage(now).remaining <= 0) throw new ForvoError('quota_exceeded', 'Daily Forvo request limit reached (resets 22:00 UTC).');
    const cached = this.cache.get(key);
    if (cached && !opts.refresh && now - cached.at < LINK_TTL_MS) return cached.items;
    const url = this.buildUrl(word, language, opts.country);
    let res;
    try {
      res = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.config.timeoutMs), headers: { Accept: 'application/json' } });
    } catch (err) {
      this.bump('errors', 1, now);
      const timeout = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError';
      throw new ForvoError(timeout ? 'timeout' : 'network', timeout ? 'Forvo did not respond in time.' : 'Could not reach Forvo.');
    }
    this.bump('api_requests', 1, now);
    if (!res.ok) {
      this.bump('errors', 1, now);
      throw new ForvoError('http_error', `Forvo returned HTTP ${res.status}.`);
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      this.bump('errors', 1, now);
      throw new ForvoError('api_error', 'Forvo returned an unreadable response.');
    }
    if (Array.isArray(data) && typeof data[0] === 'string') {
      this.bump('errors', 1, now);
      throw new ForvoError('api_error', `Forvo: ${String(data[0]).slice(0, 200)}`);
    }
    if (data && typeof data === 'object' && 'error' in data) {
      this.bump('errors', 1, now);
      throw new ForvoError('api_error', `Forvo: ${String((data as { error: unknown }).error).slice(0, 200)}`);
    }
    const rawItems = (data as { items?: unknown[] })?.items ?? [];
    const items: ForvoItem[] = [];
    for (const raw of Array.isArray(rawItems) ? rawItems : []) {
      const r = forvoItemSchema.safeParse(raw);
      if (r.success && (r.data.pathmp3 || r.data.pathogg)) items.push({ ...r.data, fetchedAt: now });
      else if (!r.success) log.debug('skipping malformed Forvo item', { issues: r.error.issues.length });
    }
    this.cache.set(key, { at: now, items });
    if (this.cache.size > 2000) {
      for (const [k, v] of this.cache) if (now - v.at >= LINK_TTL_MS) this.cache.delete(k);
    }
    return items;
  }

  /** Drop cached links (e.g. after a playback error indicating expiry). */
  invalidate(word: string, language: string) {
    for (const k of this.cache.keys()) if (k.startsWith(`${language}|`) && k.endsWith(`|${word}`)) this.cache.delete(k);
  }
}
