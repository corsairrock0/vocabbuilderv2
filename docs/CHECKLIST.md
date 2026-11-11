# Development checklist

Status of every requirement in the specification. ✅ done and tested · 🟡 done with a limitation · ⬜ not done.
Last updated 2026-11-06.

## Languages and content

- ✅ Six languages and varieties: Colombian Spanish (Bogotá preferred), Brazilian Portuguese, Southern Vietnamese
  (Ho Chi Minh City), Moscow Russian, Kyiv Ukrainian and Warsaw Polish, with English as the reference language.
- ✅ Language profiles (`shared/languages.ts`): Forvo codes, alpha-3 country codes, accent options with honest
  descriptions, typing helpers (Vietnamese letters and tone keys that mark the right vowel of the word just typed, Cyrillic keyboard), stress-mark handling, Russian ё.
- 🟡 Starter sets of 61–64 curated words for each language, with examples, forms and notes (CC0). They are small,
  and their order is a teaching order, not corpus frequency.
- 🟡 The 6,000 most frequent words for each language, ranked from open frequency lists, less the crude words left
  out (5,963–5,991 per set). Definitions and parts of speech come from English Wiktionary. A tagged fallback dictionary covers about 1,400 Ukrainian words Wiktionary
  data lacks. The sets load from Today or Settings, merge with existing words, and can be undone. Limitations:
  the Wiktionary data for five languages is a 2022–23 extraction that loses some parent senses; no list is
  region-specific except Brazilian Portuguese. See [FREQUENCY_SETS.md](FREQUENCY_SETS.md).
- ✅ Inflection tables for the frequency sets: declensions of Russian, Ukrainian and Polish nouns, adjectives,
  pronouns and numerals, full conjugations of Spanish and Portuguese verbs, and since 1.8.4 conjugations of Russian,
  Ukrainian and Polish verbs (present or future, past by gender and person, imperative, Polish conditional,
  participles), from open morphological data. They
  show on the word page and feed the forms practice and the session's form exercise. The few words without a table
  are listed in each set's report.
- 🟡 Cloze sentences: up to three everyday sentences per word, from Tatoeba (with English translations) and then
  annotated treebank text, each with its source. For the 2,296 words no collection covers, Claude wrote two each,
  checked by a script and a separate AI review but not by native speakers; the app marks them as AI-written. Since
  1.8.3 every word has at least one: the 180 words left without any, by the passes on left-out topics, crude content
  and politics or because no source had one, got two AI-written sentences each (see [FREQUENCY_SETS.md](FREQUENCY_SETS.md#sentences-for-words-left-without-any)).
- ✅ Lemmas and inflected forms, with "right word, wrong form" feedback. Aspect pairs, gender and register fields.

## Learning engine

- ✅ Integrated sessions with stages A–H, interleaving, time budgets, adaptive new-word counts, focus and
  difficulty, and a Quick Study button.
- ✅ Remediation with a different exercise type, at most two follow-ups per word, planned identically on browser and
  server.
- ✅ FSRS-6 port, verified against py-fsrs 6.3.0. Desired retention per language, with a trade-off table and
  rescheduling from full history.
- ✅ Practice versus scheduling events, documented in [LEARNING_ENGINE.md](LEARNING_ENGINE.md):
  - at most one scheduling event per card per local day
  - one aggregated initial rating for new words
  - hints downgrade to Hard
  - assisted exercises never schedule the recall memory
  - siblings are never scheduled on the same day
- ✅ Receptive and productive memories, six skills tracked separately, delayed-correct evidence, mastery levels 0–6.
- ✅ Practice on its own page: forms drills (chosen cases and numbers, or tenses and persons) and sentence cloze
  (typed, or choosing from four), for one word, the words being learned or all words. Answers are graded on the
  device and again on the server and saved through the outbox.
- ✅ Every answer counts (2.0.0): a forms, sentence, picture or Writing answer about a word being learned is that
  word's review (right *Good*, close or hinted *Hard*, wrong or revealed *Again*), under the schedule's rules: one
  review per memory a day, never both memories of a word in a day, never a word's first review. Practice asks due
  words first. Read and say and reading comprehension leave the schedule alone.
- ✅ Your memory model (2.0.0): the FSRS-6 parameters fitted to a language's reviews (1,000 needed), judged on the
  latest fifth of them and used only when better than the standard parameters; every card is then recomputed from
  its review history, and going back to the standard model restores it exactly.
- ✅ Answer checking: Unicode, diacritics and tones, synonyms, inflections, confusables, typos, three strictness
  levels, an "I was right" override and self-rating.
- 🟡 Pronunciation and speaking are self-assessed (shadowing with on-device recording, speaking flashcards). There
  is no automatic speech scoring, by design: the app does not pretend to grade speech.
- 🟡 Picture exercises run only for words with an `imageUrl`. No images are bundled.
- ⬜ Personalised FSRS parameters (optimiser). The default parameters are used; the review log keeps everything
  an optimiser needs.

## Pronunciation

- ✅ Forvo through the official API, with a server-side key, alpha-3 country filters and a fallback query.
  Metadata only, no audio caching, an in-memory link lifetime under 2 hours, plays counted against the daily limit,
  the quota day at 22:00 UTC, attribution.
- ✅ Honest accent labels: city or region is never claimed. You can mark speakers as preferred, avoided or verified.
- ✅ Playback controls: play, pause, replay, 0.75×/1×/1.25×, alternative speakers, source link, a Vietnamese
  slowed-audio note.
- ✅ Fallbacks: your own uploads and recordings (byte ranges, offline after the first play), and labelled device
  text-to-speech (off by default).
- 🟡 **Live Forvo playback is unverified**: no API key was available. It is tested against a mocked API.

## Vocabulary management

- ✅ Importer: CSV, TSV, JSON, JSONL, Kaikki/Wiktextract, `vocabbuilder-v1` and frequency lists. Column mapping,
  preview, validation, per-row homograph decisions, an all-or-nothing commit, undo.
- ✅ Duplicate and homograph detection that is POS-aware, where an unknown POS matches any.
- ✅ Word browser with search, filters and sorting over a virtualised list. Word detail shows meanings, examples,
  forms, mastery, schedules, review history, notes and recordings. Manual add and edit with conflict detection.
- ✅ Exports: vocabulary as CSV, or full-fidelity JSON that re-imports unchanged; all learning progress as JSON.
- ✅ The Kaikki filter script for large dictionary dumps.
- 🟡 Reproducible frequency-set build (`scripts/freq/`): pinned source fetch, lemma ranking, Wiktionary attachment
  and per-language reports. Rebuilding with a current Kaikki.org download is supported, but it has been tested only
  on a small fixture; kaikki.org was unreachable from the build environment.

## App and interface

- ✅ Screens (rebuilt in 2.0.0 on a shadcn/ui-style component kit): Today (the session to do now, the last seven
  days against the daily goal, the other languages, Resume), Session options, the session itself, Review, Words,
  Word detail (overview, forms with its declension or conjugation table, history) and edit, Practice (pictures,
  forms, sentences, read and say, reading, writing), Progress (words known, skills, study time, coming up, words
  that need work, more detail), Import, Settings (general, learning, audio, data and backups, account), first-run
  setup and sign-in. Sessions and practice runs open in a focus view without the navigation.
- ✅ Responsive layouts: a bottom navigation bar on phones, a side rail on tablets, a wide rail on desktops. Touch
  and swipe on cards; keyboard shortcuts (Enter, Space, 1–4, R, Esc, ?). Tested at 390, 820 and 1440 px.
- ✅ Light and dark themes, plus high contrast, text size, reduced motion and per-language accent colours that never
  resemble right/wrong colours.
- ✅ PWA: manifest, icons including maskable and Apple ones, an app-shell service worker, the offline start screen,
  and an update prompt.
- 🟡 Accessibility: labelled controls, focus rings, sheets that take and return focus, live regions, keyboard-only study. No
  screen-reader audit was done.
- 🟡 Browsers: tested in Chromium only. Safari and Firefox were not run.

## Persistence, sync and offline

- ✅ The server is authoritative, and nothing is stored only in `localStorage`. Each mutation runs in one SQLite
  transaction (WAL, `synchronous=FULL`), with idempotency keys.
- ✅ Automatic saving after every answer. Resume on any device at the same exercise.
- ✅ The IndexedDB outbox:
  - ordered replay, with backoff
  - a visible pending and failed state, and a sync indicator
  - retry, export or discard of failed changes
  - nothing is dropped silently
- ✅ Conflicts:
  - answers are append-only, with chronological replay
  - per-key last-writer-wins for settings
  - version checks on vocabulary edits
- ✅ UTC storage; local days in the owner's timezone; dates displayed in the owner's timezone.
- ✅ Sessions can be saved for offline study, and the cached session continues offline.

## Security

- ✅ Single owner and no registration. One-time setup code, scrypt, login throttling, `HttpOnly`/`SameSite`/`Secure`
  cookies, idle and absolute expiry, sign-out everywhere.
- ✅ CSRF token and same-origin check, strict CSP, security headers, body limits, path-traversal guards.
- ✅ The Forvo key, the database and the password hash are never exposed. Backups are owner-only and can be
  encrypted. No trackers or telemetry.

## Backups and operations

- ✅ Daily online SQLite backups at a set time in your timezone, with a catch-up run after downtime. Integrity check,
  gzip, optional AES-256-GCM, grandfather-father-son retention, an offsite directory with checksum verification.
- ✅ In the app: back up now, download, upload, test restore, restore with confirmation and a pre-restore backup.
- ✅ CLI and scripts: `backup.sh`, `restore.sh` (also for damaged databases and upgrade rollbacks), `upgrade.sh`
  (pre-upgrade backup), `offsite-sync.sh` (rclone).
- ✅ Docker Compose with Caddy (automatic HTTPS, a LAN and Tailscale variant), persistent named volumes, healthchecks,
  log rotation, a non-root container.
- 🟡 The Docker build stage and Caddy were not run in the build environment; the 1.0.0 runtime image and scripts were.
  The 1.1.0, 1.2.0 and 1.2.1 images were not built (no Docker daemon); their file layout was reproduced and
  smoke-tested instead. See [ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md).

## Review

- ✅ An independent code review found 11 defects (2 high, 3 medium, 6 low). All are fixed, and eight have new
  automated tests; see [ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md#independent-review).

## Documentation

- ✅ README, architecture, learning engine, Forvo, import formats, vocabulary sources, stack decisions, deployment,
  backup and restore, troubleshooting, this checklist, acceptance tests.
