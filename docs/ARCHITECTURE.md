# Architecture

VocabBuilder is a single Node.js process with a SQLite database, serving a React single-page app that installs as a PWA.
Caddy sits in front of it for HTTPS. There is one user (the owner) and up to a handful of devices.

```
 phone / tablet / desktop browser                         your server (docker compose)
┌──────────────────────────────────────┐   HTTPS   ┌─────────┐  HTTP   ┌───────────────────────────────────┐
│ React app (web/src)                  │──────────▶│  Caddy  │────────▶│ Node 24 app (server/)              │
│  • IndexedDB: outbox of unsent       │◀──────────│  :443   │◀────────│  router → auth/CSRF → transaction  │
│    answers, cached sessions,         │           └─────────┘         │  → services → SQLite (WAL)         │
│    cached dashboard                  │                               │  /data   vocabbuilder.sqlite,      │
│  • service worker: app shell only    │                               │          imports/, audio/ (yours)  │
└───────────────┬──────────────────────┘                               │  /backups verified .sqlite.gz(.enc)│
                │ plays Forvo audio URLs directly (never stored)         │  scheduler: daily backup, cleanup  │
                ▼                                                        └──────────────┬────────────────────┘
        Forvo CDN (*.forvo.com)  ◀───────── API lookups with the server-side key ───────┘
```

## Components

| Layer | Files | Responsibility |
|---|---|---|
| HTTP | `server/http/http.ts`, `server/app.ts` | Router, JSON bodies validated with zod, uniform error envelope `{error:{code,message}}`, security headers and CSP, static files with immutable caching of hashed assets |
| Auth | `server/auth/*` | One owner account, scrypt password hashes, `HttpOnly` session cookie, CSRF token, login throttling, one-time setup code |
| Data | `server/db/*`, `server/db/migrations/*.sql` | `node:sqlite` with WAL, `synchronous=FULL`, foreign keys; checksummed migrations with an automatic pre-migration backup |
| Learning | `server/learning/*`, `shared/fsrs.ts`, `shared/exercises.ts`, `shared/answer.ts` | Session planning, exercise payloads, grading, FSRS scheduling, remediation, summaries |
| Memory model | `shared/fsrs-optimizer.ts`, `server/learning/memory-model.ts`, `web/src/pages/settings/MemoryModel.tsx` | Fits the FSRS-6 parameters to the learner's own reviews in a language (2.0.0), uses them only when they predict the latest reviews better than the standard ones, and reschedules the language from its review log; the parameters are a language setting only the server writes |
| Practice | `server/learning/practice.ts`, `server/learning/identify.ts`, `server/learning/reading.ts`, `server/routes/practice.ts`, `shared/paradigms.ts` | Inflection drills, sentence cloze, Read and say and Identify: batches (words due today first), grading, attempt history. Since 2.0.0 an answer in the drills, the gaps and Identify is also the word's review where the review rules allow it (`scheduleFromPractice` in `server/learning/scheduling.ts`). Identify reads its scenes from `data/identify/identify.json`; the pictures are static files under `/identify/`. `shared/paradigms.ts` lays out, labels and picks the cells of inflection tables for the word page, the drills and the session's form exercise, and gives case roles and regional-person notes. Batches take `scope: 'entries'` for a Comprehensive session's own words (Identify can fill up from `learning` and `all`, for the session's minimum of five Identify questions); `web/src/pages/session/PracticeRounds.tsx` runs those rounds between session exercises with the practice pages' runners (`embedded`) |
| Reading comprehension | `server/learning/comprehension.ts`, `shared/comprehension.ts`, `scripts/reading/build.mjs`, `web/src/pages/practice/ComprehensionPractice.tsx` | AI-written texts with multiple-choice questions, levels A1–C1, of two kinds: short everyday texts (three questions, served easiest first) and longer passages (four questions). They are read from `data/reading/<lang>.json` (`VB_READING_DIR` to override), which the script builds and checks from the reviewed batches. The next unread text of a kind at the learner's reading level (the language setting `readingLevel`), with fallback to other levels; grading with the shared rules on both sides; the level rises one step when every text of it, both kinds, has been read (pass or fail), never past a level without texts; attempts in `comprehension_attempts` (migration 0005). Comprehensive sessions run one short text per turn of practice rounds |
| Writing | `server/learning/writing.ts`, `shared/writing.ts`, `scripts/writing/build.mjs`, `web/src/pages/practice/WritingPractice.tsx` | AI-written English sentences to write in the language, every word right, levels A1–C1, 200 per level in steps. They are read from `data/writing/<lang>.json` (`VB_WRITING_DIR` to override), which the script builds and checks from the reviewed batches; each sentence's accepted translations are patterns expanded on both sides. Grading word by word with the shared rules (capitals, punctuation, stress marks and a few spelling variants forgiven); the next sentence at the learner's writing level (the language setting `writingLevel`): a wrong one whose wait is over, else the next new one in step order, with fallback to other levels; in a session, the sentence that best fits the session's words first. The level rises one step when every sentence of it is done; *I was right* counts an answer and keeps its wording for the learner. Attempts in `writing_attempts`, accepted wordings in `writing_accepted` (migration 0007). Comprehensive sessions run one sentence per Writing slot |
| Grammar explanations | `shared/grammar.ts`, `server/learning/grammar.ts`, `scripts/grammar/build.mjs`, `web/src/components/ParadigmTable.tsx` | Why an answer has its form: the case and what calls for it, or the tense, mood and person and their clue, from the sentence around a gap, the same on the device and the server. For example sentences, the exact cell and its reason come from `data/grammar/<lang>.json` (AI-annotated; `VB_GRAMMAR_DIR` to override), which the script builds and checks against the frequency sets, keyed by `exactKey`. Session cloze payloads and sentence-gap practice items carry it as `exact` when the word's table confirms the cell |
| Vocabulary | `server/vocab/*` | Entries, senses, forms, inflection tables, examples with their sources, tags, frequency; importer with validation and undo |
| Audio | `server/audio/*` | Forvo client (metadata and short-lived links only), honest accent labels, your own recordings |
| Statistics and Progress | `server/services/stats.ts`, `server/services/progress.ts`, `server/services/skills.ts`, `shared/stats.ts`, `shared/progress.ts`, `web/src/pages/ProgressPage.tsx`, `web/src/pages/ProgressDetail.tsx`, `web/src/pages/Dashboard.tsx`, `web/src/components/charts.tsx` | Per-language figures, estimated and observed retention, forecasts. A day's activity adds session answers (`daily_stats`), practice answers (`practice_attempts`, counted per day from the index of migration 0006), reading texts (`comprehension_attempts`) and Writing answers (`writing_attempts`), each stored once, so nothing is counted twice; study time is `daily_stats.study_ms`, from sessions (practice rounds included) and the Practice pages. The Progress page reads `GET /api/stats/progress/:code` (words known, being learned and not started, the 90-day words-known history replayed from the review log, the most frequent words, the next milestone, reviews coming up, words that need work) and `GET /api/stats/progress/:code/period?window=7\|30\|all` (each skill's share right and trend, study time against the daily goal); its closed *More detail* sections read `GET /api/stats/language/:code`. Home shows today's session from `GET /api/sessions/preview` and the week from the bootstrap |
| Backups | `server/backup/backup.ts`, `scripts/*.sh` | Online SQLite backups, integrity checks, gzip, optional AES-256-GCM, retention, offsite copy, restore |
| Web app | `web/src/**` | Screens, keyboard shortcuts and swipe gestures, the outbox, offline cache, service worker. Since 2.0.0 the screens are built from one kit of components in `web/src/components/ui/`, which follows shadcn/ui's components (names, parts, styles) on native browser features (`<dialog>`, ARIA patterns), with neutral colours and one colour per language for identity. Four tabs (Today, Practice, Words, Progress), Settings behind the gear, and sessions and practice runs in a focus mode without the bars |

`shared/` is imported by both the server and the browser, so grading, remediation planning and the FSRS model behave
the same in both places.

## How a request is handled

For every `/api/*` request, in order:

1. Maintenance check. While a restore runs, the API answers `503` with `Retry-After`.
2. Rate limit: 1,200 requests per minute.
3. The session cookie is resolved. The session is touched at most every 5 minutes, and expires after an idle period
   and after a maximum lifetime.
4. Mutations only: the `Origin` must match `VB_PUBLIC_ORIGIN` or the request's host, and the `X-CSRF-Token` header must
   match the session's token.
5. The JSON body is validated with zod.
6. The handler runs inside **one SQLite transaction** (`BEGIN IMMEDIATE`). If the client sent an `Idempotency-Key`,
   the key and the stored response are written in the same transaction. A retry with the same key replays the
   stored response (`Idempotent-Replayed: true`) without running the handler again. Reusing a key with a different
   body gets `422`.
7. Each write increases a global revision counter. Devices poll `/api/sync/state` every 30 seconds and reload changed data.

## Persistence

- **Server is the source of truth.** Progress, FSRS card state, review history, sessions, preferences and
  vocabulary are stored only in SQLite on the server. The browser keeps copies for offline use, plus a queue of
  answers not yet confirmed. Nothing is kept only in `localStorage`, which holds just a device id.
- **Durability.** Write-ahead logging with `synchronous=FULL` means an answer the server acknowledged survives a crash
  or power loss. Every answer is its own transaction: attempt, scheduling event, skill evidence, daily totals and
  session position commit together or not at all.
- **Time.** All instants are stored as UTC milliseconds. "Study days", streaks, due-today and the one-review-per-day
  rule use the owner's timezone (Settings → General), and dates are displayed in that timezone on every device
  (the browser's own timezone until you set one).
- **Schema.** `server/db/migrations/0001_initial.sql` holds the schema; later files add to it
  (`0002_entry_examples_sense_index.sql`, version 1.1.0, adds one index; `0003_paradigms_practice.sql`, version
  1.2.0, adds inflection tables, sentence sources and practice attempts; `0004_terms_acceptance.sql`, 1.6.0;
  `0005_comprehension.sql`, 1.7.0; `0006_practice_day_index.sql`, 1.8.0, adds one index so the statistics count
  practice answers per day from the index alone; `0007_writing.sql`, 1.9.0, adds the Writing tables). Applied migrations are checksummed.
  A modified migration, or a database newer than the app, stops startup with a clear message rather than risking
  data. Before any migration, a verified `pre-migration` backup is written.

Main tables:

- **Vocabulary:** `vocabulary_entries` and their `vocabulary_senses`, `vocabulary_translations`, `vocabulary_forms`,
  `entry_paradigms` (one inflection table per word, as JSON), `example_sentences` (linked through `entry_examples`;
  each keeps its `sources` row and the source's sentence id), `tags` and `vocabulary_frequency`.
- **Learning:** `learning_items` (per-word status), `fsrs_cards` (two per word: receptive and productive),
  `review_logs` (every scheduling event, with the state before and after), `study_sessions`,
  `session_exercises`, `exercise_attempts` (every answer, including practice), `skill_evidence` and `daily_stats`.
  `practice_attempts` holds the answers from the inflection drills, sentence cloze, Identify and Read and say (from
  the Practice pages and from Comprehensive rounds). Since 2.0.0 forms, gap, Identify and Writing answers are also
  scheduling events for the word they test (`review_logs` rows with `prac:` or `wrev:` op ids; see
  docs/LEARNING_ENGINE.md), and the active
  time sent with an answer from a Practice page is added to the day's `daily_stats.study_ms`, once. `comprehension_attempts` holds one row per reading comprehension text read: the
  options chosen, the result and the reading level before and after. `writing_attempts` holds one row per Writing
  answer (the answer, whether it was right or counted as right, the writing level before and after), and
  `writing_accepted` the wordings the learner said were right, per sentence.
- **Settings and system:** `user_settings`, `language_settings`, `auth_sessions`, `idempotency_keys`, `devices`,
  `import_jobs`, `pronunciation_records` and `provider_usage`.

## Sync and conflicts

| What | Strategy |
|---|---|
| Answers | Append-only. Each answer has a client-generated `opId` (unique in `exercise_attempts`), so a retry can never count twice. An answer dated before the card's latest review is inserted in time order, and the card's FSRS state is **replayed** from its full history. Nothing is overwritten. |
| Scheduling | Server-side only. The client never sends FSRS state; it sends what happened, and the server decides whether the answer is a scheduling event or practice. |
| Session position | Comes from the server: the first pending exercise. Remediation exercises are planned the same way in the browser and on the server (`planRemediation` in `shared/exercises.ts`), so an offline device inserts the same follow-up questions the server will. When the two disagree (a stale copy, a different strictness setting), the server's plan wins. A follow-up the device already answered is **adopted** by the server, so the answer is never rejected. |
| Settings and notes | Per-key last-writer-wins by **when the change was made on the device**. The time is sent with the change, bounded to the server's clock and the last 30 days. Changing the accent on one device does not undo a theme change made on another, and an older offline edit that syncs late never overwrites a newer one. The server replies with the value it kept. |
| Vocabulary edits | Optimistic concurrency: an edit carries the entry `version`. If another device changed the entry first, the server answers `409 edit_conflict` and the form asks you to reload the latest version before editing. Nothing is silently overwritten. |
| Deletes | Soft-delete for vocabulary. Learning history is kept. |

## Offline model

- The **service worker** (`web/src/sw.ts`) precaches the app shell for each build: HTML, hashed JS and CSS, fonts
  and icons. A navigation tries the network first, with a 3.5-second timeout, then falls back to the cached shell.
  API responses are never cached. The one exception is your *own* uploaded recordings, so they can play offline.
  Forvo audio is cross-origin and is never touched. Identify pictures (`/identify/`, about 50 MB in all) are not
  precached: each is cached the first time it is shown (cache `vb-identify`, the oldest dropped past 500 files), so
  the pictures of a practice opened once are there offline. Their names carry a content hash, so they never go
  stale; the server marks them immutable too.
- The **outbox** (`web/src/lib/outbox.ts`, IndexedDB) holds every change until the server confirms it: answers,
  session events, settings and notes.
  - Network errors and `5xx`/`429` responses are retried with backoff (2 s, 5 s, 15 s, 30 s, then every 60 s), and
    whenever the device comes back online.
  - After an offline start, the security token is fetched before anything is sent. If the token was replaced
    (a sign-in elsewhere, a restore), it is refreshed and the change resent. If the session has ended, changes wait
    until you sign in again.
  - A permanent rejection (`4xx`) moves the change to a visible **failed** state. A failed answer is not treated as
    progress anywhere: the exercise stays open. Settings → Data and backups lets you retry, export or discard it.
    Nothing is discarded automatically.
  - If the device refuses to store more (storage full or blocked), unsent changes are kept in memory and still sent.
    The study screen warns you to keep the app open until they are saved.
  - The sync indicator always shows *All changes saved*, *Saving n changes*, *Offline, n changes waiting* or
    *n changes could not sync*. A change counts as saved only after the server acknowledges it.
- **Sessions** are cached in IndexedDB as you study, and **Save for offline** downloads a full planned session ahead
  of time. Offline answers are graded in the browser with the same `checkAnswer` code. On reconnect the server
  grades them again, and its result is the one that counts.
- Without a connection you cannot start a brand-new session unless you saved one for offline use beforehand,
  run an import, play Forvo audio or make backups.

## Security model

| Threat | Mitigation |
|---|---|
| Strangers creating accounts | No registration. The owner account is created once with a setup code from the server log or `VB_SETUP_TOKEN`. Only its hash is stored, and the code stops working after use. |
| Password guessing | scrypt (N=2^17), at least 12 characters. Five failed sign-ins per IP per 15 minutes and 30 in total per hour. Checks still running count against the limit, and at most two run at once, so parallel bursts cannot get around it or exhaust memory. Timing is the same for unknown usernames. |
| Session theft or fixation | Random 256-bit tokens, stored hashed. Cookie flags: `HttpOnly`, `SameSite=Lax` and `Secure` behind HTTPS. Idle and absolute expiry. Sign out everywhere; a restore signs out every device. |
| CSRF | Same-origin `Origin` check and a per-session `X-CSRF-Token` on every mutation |
| XSS | React escaping, no `dangerouslySetInnerHTML`, strict CSP (`script-src 'self'`, no inline scripts or styles, `object-src 'none'`, `frame-ancestors 'none'`) |
| Secret exposure | The Forvo key is used only server-side and never appears in responses or bundles. The database is never served. Backups and their metadata are owner-only (mode 600) and can be encrypted (AES-256-GCM, scrypt-derived key). |
| Path traversal | Static files are resolved inside the build folder only. Backup and recording names are matched against strict patterns and `basename`d. |
| Exposure of the app port | In Docker the app listens only on the internal network. Only Caddy publishes ports 80 and 443. |
| Telemetry | None: no analytics, no third-party scripts, no external fonts. Forvo is contacted only when you play or look up audio. |

Private hosting does not replace these controls. Keep the host patched, keep backups off-server, and use a strong
password.

## Build

`scripts/build-web.mjs` bundles `web/src/main.tsx` with esbuild into hashed, code-split chunks. It compiles Tailwind
CSS 4 through its programmatic API, copies `web/public` and the Identify pictures (`data/identify/images` to
`/identify/`, left out of the precache list), writes `index.html` and builds the service worker with the list of
files to precache. There is no Vite dev server; [STACK_DECISIONS.md](STACK_DECISIONS.md) explains why
and how to switch. The server needs no build: Node 24 strips TypeScript types at load time, which is why server code
uses only erasable syntax (`erasableSyntaxOnly`).
