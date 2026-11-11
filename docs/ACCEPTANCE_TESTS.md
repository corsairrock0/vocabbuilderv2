# Acceptance tests

Each acceptance scenario from the specification is listed below with the automated tests that cover it and the
latest result. Results come from actual runs in the build environment on 2026-11-10 (version 2.0.0: 456 unit and
integration tests and 30 browser tests on Node 24; the update of real 1.9.1 word sets to the 2.0.0 sets ran for all
six languages, the upgrade from 1.7.0 data ran for 1.8.0, and the container smoke test below last ran for 1.5.0):

- `npm test`: unit and integration tests, Node 24.
- `npm run test:e2e`: Playwright with headless Chromium against a real server.
- The container smoke test (`deploy/test/container-smoke.mjs`) and the backup/restore/upgrade scripts. For 1.0.0
  these ran against a Compose project in the same environment; for 1.1.0 and 1.2.0 no Docker daemon was available
  (see "Private-server deployment" for what ran instead and what could not run).

Re-run everything with `npm run test:all` (typecheck, unit and integration tests, build, then browser tests).

| # | Scenario | Covered by | Result |
|---|---|---|---|
| 1 | Progress made on a desktop appears on a phone | e2e: *progress made on a desktop continues on a phone, and back*; integration: *study on the desktop, then see the same progress and schedules on the phone* | Pass |
| 2 | Scheduling done on a tablet is reflected on a desktop | integration: *review on the tablet, then the desktop shows the updated schedule*; *devices can detect remote changes cheaply through the revision counter* | Pass |
| 3 | Server restart loses nothing | integration: *progress, schedules, settings, sessions and sign-in survive a server restart*; *a second restart after more study is also lossless*; container: hard kill (`docker rm -f`) and a new container on the same volumes, with identical row counts | Pass |
| 4 | Closing the browser and resuming | e2e: *a session runs from the keyboard and resumes exactly where it stopped after the browser is closed*; integration: *an interrupted session resumes at the latest saved position on another browser* | Pass |
| 5 | Languages are isolated | e2e: *languages are isolated: a Spanish session leaves the Russian session and statistics untouched*; integration: *switching languages keeps sessions and progress separate*; *Vietnamese studied on the phone appears on the tablet and desktop without touching Russian* | Pass |
| 6 | Accent preferences persist | e2e: *pronunciation preferences persist across devices*; integration: *settings — including regional accent preferences — follow you across devices*; *speaker preferences and accent verification by the owner are saved per language*; restart test (3) | Pass |
| 7 | A failed request never marks an exercise complete | e2e: *an answer the server did not accept is never shown or stored as completed* (simulated 503, then 422, then recovery); integration: idempotent retries, *retried uploads of queued offline answers are applied exactly once* | Pass |
| 8 | Offline recovery | e2e: *answers given offline are kept, shown as waiting, and synced when the connection returns*; *after one visit the app opens without a connection and shows that it is offline*; *starting the app offline, answering, then reconnecting saves every answer in order*; integration: *a follow-up exercise planned only on an offline device is adopted by the server, never rejected*; integration: *a late offline review is inserted chronologically and the card is replayed*; *offline answers for a session that another device already ended are still saved*; *two devices answering the same exercise: one completion, both attempts kept, one scheduling event* | Pass |
| 9 | Restoring a backup preserves review history | integration: *restore returns review history to the backed-up state; a pre-restore backup keeps the newer data*; *encrypted backups round-trip and reject a wrong passphrase*; *verification and a recovery drill confirm the backup can be restored*; scripts: `restore.sh` by name and from a host file, over a deliberately corrupted database, and an upgrade rollback | Pass |
| 10 | Private-server deployment | Container smoke test: the image's runtime stage, healthcheck, setup code, studying, CLI backups, security headers and clean shutdown; `docker compose config` validation; lockfile checks (`npm ci --dry-run`) | **Partial**: see below |

## Private-server deployment

These ran in the build environment:

- The runtime stage of the real `Dockerfile` was built on a stand-in Node 24 base image, with the build stage
  replaced by prebuilt files. The container:
  - became healthy through its `HEALTHCHECK`
  - printed the setup code
  - rejected a wrong code
  - imported vocabulary
  - saved answers
  - served security headers and immutable asset caching
  - shut down cleanly on SIGTERM
- After a hard kill, all data survived on the named volumes.
- `scripts/restore.sh`, `backup.sh` and `upgrade.sh`, including an upgrade to a newer schema and a rollback, ran
  against a Compose project.
- `docker compose config` validates, with and without `ACME_EMAIL`. A missing `VB_DOMAIN` gives a clear error.
- **Version 1.1.0**, without a Docker daemon: the build stage's copy commands from the `Dockerfile` were replayed
  into a folder, and the server was started from it with the runtime stage's settings. The container smoke test
  then passed: all six frequency sets and their reports are present, the Polish set loads, a hard kill (SIGKILL)
  loses nothing, and a database created on the 1.0.0 schema is upgraded to 1.1.0 after a pre-migration backup.
- **Version 1.2.0**, the same way (with `node_modules` reduced to the one runtime dependency, as `npm prune
  --omit=dev` leaves it). The smoke test passed: the six sets are present, Polish words come with their declension
  tables and sourced sentences, the practice summary finds 3,981 Polish tables and 5,894 words with sentences, a
  hard kill loses nothing, and a database created by the 1.1.0 release is upgraded to schema 3 after a
  pre-migration backup, with progress, the session position and the loaded Polish set intact.
- **Version 1.2.1**, the same way: all 28 smoke checks passed, including 3,981 Polish tables and 6,000 Polish words
  with sentences, and nothing was lost after a hard kill. 1.2.1 has no new migration.
- **Version 1.3.0**, the same way: the seed and verify runs passed (setup, fixture and starter imports, all six sets
  and reports present, the Polish set loaded, session answers; after a hard kill the session position, progress,
  language separation and the Polish set were intact). 1.3.0 has no new migration. Separately, updating a loaded
  Russian set to the reviewed one (6,000 words) was run against a test server: 5,999 words refreshed in under 4
  seconds after a pre-upgrade backup, an edited word kept, a sentence's practice history kept.

- **Version 1.4.0**, the same way: the seed and verify runs passed. New checks: Identify has pictures for the
  loaded Polish set (596 words in 188 pictures), a batch comes with four options per picture, and a picture is
  served from the image as `image/webp` with immutable caching. The layout is 130 MB, of which the pictures are
  47 MB. 1.4.0 has no new migration.

- **Version 1.5.0**, the same way: seed, a hard kill (`kill -9`), a restart from the same data, and verify all passed.
  1.5.0 has no new migration. An upgrade from 1.2.1 data was also run: a 1.2.1 data folder (Polish set, a finished
  session, a favourite and a note) opened in 1.4.0 code with nothing lost, and the set update kept progress and edits;
  1.5.0 changes nothing in the database.

- **Version 1.5.1** changes only the stylesheet: hover styles now apply only where the pointer can hover, because on
  phones a tap left the next screen's answer choice looking selected. A unit test fails if any `:hover` rule in
  `app.css` is outside `@media (hover: hover)`; the built stylesheet was checked the same way (15 hover rules, all
  inside it, Tailwind's included).

- **Version 1.6.0** adds migration 0004 (`terms_acceptances`). Data made by 1.5.1 (an owner created without any
  terms record) opened in 1.6.0: the server made its pre-migration backup and applied the migration, the owner signed
  in, was asked to accept the Terms of Service (`terms.required`), accepted, and was let through. New tests: setup is
  refused without accepting the terms; each accepted version is recorded once; an older acceptance makes the app ask
  again; only the version in force can be accepted; accepting needs a session; `/api/legal` is public and reads
  `VB_LEGAL_*`; every Lango source file carries the copyright header; the third-party notices hold the licence texts
  and credits. The browser tests tick the terms box at setup and open the notices and `/third-party-notices.txt`.

- **Version 1.7.0** also adds grammar explanations (`shared/grammar.ts`, 13 unit tests: cases and their triggers in
  Polish, Russian and Ukrainian, tense, mood and person with their clues in Spanish and Portuguese; the owner's
  Ukrainian example was checked in the browser with the full Ukrainian set: “чого” is the genitive of “що”: it
  follows “для” (for), which always takes the genitive). It adds Reading comprehension and migration 0005 (`comprehension_attempts`). A database made on the
  1.6.0 schema (migrations 0001–0004, with a Spanish setting stored) opened in 1.7.0: the server wrote its
  pre-migration backup, applied 0005, kept the setting, gave the new `readingLevel` setting its default (A1) and
  served the first Spanish A1 passage. The texts come from `data/reading/<lang>.json`, built by
  `scripts/reading/build.mjs` from the reviewed batches; the released build has 180 longer passages (A1: 20 in each
  of the six languages; A2: 20 each in Spanish, Portuguese and Vietnamese) and 20 everyday texts (Spanish A1); the
  other batches are still being written and come as data updates. Two builds from the
  same batches gave byte-identical files. The Dockerfile's copy step was replayed into a folder: it ships the six
  `data/reading/*.json` files and leaves the batches out. New tests (23): the pass rule (3 of 4, 2 of 3), the level
  after a pass or a fail (one above the text, never down, C1 at most), where the next text comes from (the level,
  then higher, then lower, within its kind; short texts by step), the checks of the passage build (fields, levels,
  the language and kind of the file, the questions, duplicate ids, the order and bytes it writes); against the real
  Spanish files: the summary per kind and level, the first A1 passage, all right raising the level to A2 as the
  `readingLevel` setting, a repeated `opId` stored once with the same result, read and excluded texts not served
  again, a fail keeping the level, 404 and 422 answers; against a fixture of short texts served through
  `VB_READING_DIR`: the kind chosen, step order, 2 of 3 passing and 1 of 3 not, one level shared by both kinds, and
  the fallback staying within the kind. The new browser test opens the practice on a phone in Spanish, answers a
  passage's four questions from the server's own answers (options in shuffled order), sees "4 of 4 right" and the level
  go up to A2, opens the translation and gets a different next passage; the page is also in the every-page checks at
  all sizes and in both themes. In one-off browser runs outside the suite, a Comprehensive session reached its reading
  round (one text, then back to the session), and a short dialogue from the fixture kept its line breaks.

- **Version 1.8.0** makes Comprehensive study the default and makes the statistics count what it trains.
  - *The default.* Every one-tap start (*Start studying* on the dashboard, *Quick study* and its home-screen shortcut,
    *Study more* after a session) and a session request that names no mode plan a Comprehensive session; Study setup
    opens on it and still offers *Reviews and new words* and *Reviews only*; *Save for offline* saves reviews and new
    words, because rounds need a connection. The app had never stored the mode chosen in Study setup (it always opened
    on *Reviews and new words*), so there was no stored choice to convert.
  - *The statistics.* Today's figures, the streak, the daily charts and study time add practice answers and reading
    texts to session answers, each stored once, so nothing is counted twice; time on the Practice pages is sent with
    each answer and counted once; a Comprehensive session's round time is sent as session time. A new Skills section
    shows, per language over 7 days, 30 days or all time, vocabulary, declension or conjugation (with the weakest
    cases or tenses), sentence gaps, Identify, Read and say, reading, listening and speaking. The session summary
    breaks the rounds down by skill.
  - *Migration 0006* adds one index (practice answers by language and local day). A database on the 1.7.0 schema
    (migrations 0001–0005, with a finished Russian session and a practice answer) was opened by 1.8.0: the server
    wrote its pre-migration backup, applied 0006 and kept every row, and the streak, today's practice and the Skills
    figures came out right. Every statistics query is an index range scan (`EXPLAIN QUERY PLAN`). With 200,000
    practice answers over a 400-day streak, the dashboard's figures took about 150 ms (377 ms without the index); with
    25,000, about 26 ms.
  - *New tests (19).* 11 unit tests of the pure helpers (the default mode, windows, streaks, what a study day is, the
    weakest cases or tenses, the active-time clock, splitting long stretches, round tallies); 1 migration test (a 1.7.0
    database gets the index after a pre-migration backup); 7 integration tests built from real answers: a session
    started without a mode is Comprehensive, and its listening and speaking answers and the due reviews (by ear, aloud,
    per memory) match the Skills figures; forms answers, accuracy and the weakest tenses over 7 days, 30 days and all
    time; sentence gaps, Identify with the different things named, Read and Say it; the reading level, texts per kind
    and level and question accuracy; activity counting session answers, practice answers and reading questions once
    each, a practice-only day in the history, a three-day streak from practice alone, and today's figures across
    languages; practice study time counted once per attempt and capped at 5 minutes (10 for a text), and practice
    leaving FSRS alone; the empty states and a skill a language lacks. The browser test of Comprehensive study now
    starts from Study setup as it opens (on Comprehensive), ends the session after a round, and finds the round's skill
    in the summary and its answers in Stats → Skills, in both periods; the resume test picks *Reviews and new words*,
    because its session is studied offline later.
  - *Reading texts.* The 1.8.0 build has 240 longer passages (A1 and A2: 20 each in all six languages) and 100
    everyday texts (A1: 20 each in Spanish, Portuguese, Vietnamese, Russian and Ukrainian), all reviewed; the other
    batches are still being written. The full test run above (319 tests) ran with these files in `data/reading/`.

- **Version 1.8.1** makes grammar explanations name the one case, or the one tense, mood and person, that a form is in
  in its sentence, with the reason, where they used to list every cell the form fills (“українське” can be the
  nominative or accusative neuter of “український”: they are spelled the same).
  - *The annotations.* The cells for example sentences come from `data/grammar/<lang>.json` (Ukrainian, Russian,
    Polish, Spanish, Portuguese): the cell each annotated sentence uses and why, AI-annotated. `scripts/grammar/build.mjs`
    builds them from `data/grammar/src/<lang>.jsonl` (`--import <folder>` copies `<lang>.jsonl` there first), checks
    every record against `data/frequency/<lang>.json` (the lemma has a table there or a built-in one, the table has the
    cell, the cell holds the target, or *no*/*não* + the target for a negative imperative, and the reason is not
    empty), prints and drops the others, and writes one entry per line with sorted keys (`exactKey`), byte-identical on
    rebuild. Annotated sentences in this version: Ukrainian 3,040, Russian 3,296, Polish 4,139, Spanish 818,
    Portuguese 679 (11,972, by Claude Opus 5.5, including the 1,062 sentences written in 1.8.2 to replace crude ones and
    ones on politics, war or violence and the 75 written in 1.8.3, 74 for words left without any and one more
    replacement; 244 of them are "no note", cell `-`: the word only looks like a form of the listed one, or fills a
    cell its table lacks, so that sentence shows no grammar line). The build kept all 11,972 (none dropped, none
    unmatched). Checked against the 1,199 of them that come from local UD treebanks, whose features
    the annotators never saw: 1,192 agree (99.4 %). The tests below use fixtures; the full suite was also run with the
    real files in place, and a phone screenshot of the owner's sentence ("У нього українське громадянство.") shows
    "“українське” is the nominative neuter of “український”: it describes “громадянство” …" with "here: nominative
    neuter" in the hint.
  - *Where they are used.* `server/learning/grammar.ts` reads the files (`VB_GRAMMAR_DIR` to use another folder; read
    again when a file changes; a missing or broken file means no annotations). Session cloze exercises (choosing and
    typing the form, and their follow-up variants) and the sentence-gap practice (also in Comprehensive rounds) carry
    `exact: { cell, why }` when the word's table in the database confirms the cell. `explainForm` then names that
    cell alone with the reason, the table shown with the feedback marks only that cell, and the hint's needed form
    names it. An annotation without a reason gets the rules' reason for that cell, or its general use; one whose cell
    does not hold the form is ignored. Sessions planned before an annotation arrives keep their payloads. No
    migration.
  - *New tests (15).* 5 unit tests of the explanations: the owner's sentence with `nom|n` gives one cell and the exact
    text; an annotation without a reason (the rule for that cell, or its general use); a cell that does not hold the
    form is ignored (prototype keys too); Portuguese “Não me obrigue a fazer isso.” with `imp.neg|3s`; `exactKey` with
    stress marks, capitals, spacing, punctuation, apostrophes and ё. 5 unit tests of the build: each check and its
    message, dropped lines with their numbers, the later line winning, unmatched sentences, the same bytes in any line
    order, the import copying only `<lang>.jsonl`, and the browser test's fixture rebuilt from its record against the
    real Polish set. 4 integration tests, with a fixture Ukrainian set and its annotations built by the script and
    served through `VB_GRAMMAR_DIR`: a session's cloze exercises and variants carry `exact` for the annotated
    sentence and no other, the hint names the cell, and the explanation built from the payload is the exact text;
    the practice batch and a Comprehensive round's batch carry it with the needed form; a cell the word's table does
    not confirm is not sent, a changed file is read again, and a missing or broken file means none. 1 browser test:
    with one annotated Polish sentence (tests/fixtures/grammar/, “Powiem tej kobiecie to, co wiem.”, the dative
    singular), sentence practice shows “kobiecie” is the dative singular of “kobieta”: …, nothing spelled the same,
    the needed form, and one marked cell in the table, where the dative and the locative singular both hold kobiecie.
  - *The image.* The Dockerfile copies `data/grammar/*.json` the way it copies the reading texts and leaves `src/`
    out. The new copy line was replayed in a scratch folder: with annotation files it copied the `.json` files only
    (no `src/`, no README); with none it copied nothing.
  - *The reading level* (the owner: “The reading comprehension in Comprehensive practice should not move you up a
    level until all of the texts from the current level are completed”). The level now moves up one step only when
    every text of the learner's level, everyday texts and longer passages together, has been read, pass or fail
    (`levelAfter` in `shared/comprehension.ts`, worked out by the server in `submitComprehension` from the texts read
    before and this one). Texts at other levels never count toward it (they count for their own level, so a learner
    who reaches a level whose texts were all read already moves on through it); a level with no texts never counts
    as read; C1 is the top. One setting per language, so the Practice page and Comprehensive rounds follow the same
    rule. The next-text and attempt responses and both summaries carry `progress` (the level's texts and those read).
    The Practice page shows it (“12 of 40 A2 texts read. Read them all to move up to B1.”; on its card “Your level:
    A2. 12 of 40 A2 texts read.”), the result card says how far through the level the learner is or that the level
    moved up, and the device shows that at once from the progress sent with the text. No migration: attempts keep
    `level_before` and `level_after`.
  - *Five Identify questions in Comprehensive sessions* (the owner: “Study mode should also include at least 5
    Identification questions”). While a session has shown fewer than five, its Identify rounds ask for everything
    owed (at least three, so the first asks for five) with `fill: ['learning', 'all']`: in one request the server
    takes the pictures of the session's own words first, then those of the words being learned, then all the
    learner's words, and relaxes its one-word-once and two-per-picture rules only when the learner's words have too
    few pictures for them. At the end of the session Identify gets an extra round for whatever is still missing; a
    filled-up batch that comes back short means there are no more pictures, and the session shows as many as there
    are. *Reviews and new words* and *Reviews only* are unchanged, rounds are still skipped offline, and *End session
    now* still goes straight to the summary.
  - *New tests for these (13), and changed ones.* 10 unit tests: the level rule (every text of the level, both kinds,
    read: up one step; one left of either kind: it stays; texts at other levels count only for their own level; a
    level with no texts and C1 stay; never down) and the browser's prediction from the progress; the Identify plan
    (questions owed, the first round of five, an extra round for just what is missing, the usual round once the
    minimum is met or the words have no more pictures, the end of the session owing Identify) and the fill-up order
    of a batch (the session's words, then the words being learned, then all words; each word once and each picture at
    most twice, relaxed only when that leaves the batch short). 3 integration tests: with the reading fixture (now also
    two C1 passages) through the attempts API, a pass and a fail leave the level, a fallback text from B1 counts
    nowhere near A1, a C1 reader with every C1 text read stays at C1, the last unread A1 text, failed, moves the
    learner one step to A2, and the last A2 text moves them on through B1 (read before as a fallback) to B2, which has
    no texts, although every C1 text is read; the progress in both summaries, the next text (skipped texts counted)
    and every result; a replay keeps its stored levels and never moves the level; and Identify through the batch API:
    the session's word first, then the words being learned, before the learner's other words, every picture of a few
    words when filling up from them alone, an unknown fill scope refused. The tests against the real Spanish texts and
    the reading Skills test now expect the level to stay A1 while A1 texts are left. Two browser tests changed: reading
    comprehension passes a text and sees the level stay (“1 of 40 A1 texts read. Read them all to move up to A2.”),
    has the other A1 texts read through the API, fails the last one and sees “You have read every A1 text: your reading
    level is now A2.” and an A2 text next; the Comprehensive session goes on to its Identify round, which asks for
    five pictures filled up from the learner's other words and shows all five with a line saying where they come from,
    and the summary lists “Identify: 5 answers”.
  - *No note for look-alikes.* An annotation with the cell `-` (`NO_NOTE` in `shared/grammar.ts`) means the sentence's
    word only looks like a form of the listed one (the noun *parte* under *partir*, a name, an imperative under a noun)
    or fills a cell its table lacks (a vocative, the Russian locative in *-у*, the Ukrainian locative in *-у* after
    *по*). Such a sentence gets no grammar line, nothing marked in the table and no "here: …" hint, instead of a list of
    what the form could be. 2 unit tests (the explanation is null for it; the build keeps such records for any word of
    the set and still needs the note).
  - *Reading texts.* The 1.8.1 build has 400 texts: 240 longer passages (A1 and A2, 20 each in all six languages) and
    160 everyday texts (A1 in all six languages; A2 in Spanish and Portuguese), all reviewed. The 1.8.3 build has 540:
    300 longer passages (A1 and A2 in all six languages, B1 in Spanish, Portuguese and Vietnamese) and 240 everyday
    texts (A1 and A2 in all six), all reviewed. The 1.8.4 build has 600: Russian, Ukrainian and Polish B1 longer passages were added. The 1.8.5 build has 640:
    Spanish and Portuguese B1 everyday texts were added.

- **Version 2.0.0** rebuilds every screen, makes every answer count toward the word it tests, adds the learner's own
  memory model and applies the rest of the meaning review. No migration.
  - *The screens.* Every page is built from one kit of components that follows shadcn/ui (`web/src/components/ui/`),
    with four destinations (Today, Practice, Words, Progress), Settings behind the gear, and a focus view without
    navigation for sessions and practice runs. All 30 browser tests run on it at 390, 820 and 1440 px in light and
    dark; *every page renders without errors or sideways scrolling* covers 22 routes at each size and theme. The
    tests found two defects, both fixed: the language menu did not take the keyboard focus when it opened (its panel
    was still becoming visible, a 150 ms transition), and between two practice slots of a session the exercise
    answered before showed again for a moment (the answered screen now stays, Continue waiting, until the next slot
    has loaded).
  - *Every answer counts* (`tests/integration/practice-schedule.test.ts`, 8 tests): a grammar form is the word's
    recall review once a day and never both memories in a day; a word whose other memory is due waits for that
    review; an early answer counts and an early miss brings the word back soon; a named picture is a recall review
    (with a hint, *Hard*) and a picked name a recognition review; no review for a word that is not scheduled yet or
    not being learned; practice asks the words whose memory is due first; Writing rates each word being learned in
    the translation, and *I was right* turns a miss into *Good* with the card recomputed.
  - *Your memory model* (`tests/unit/fsrs-optimizer.test.ts`, 4 tests; `tests/integration/memory-model.test.ts`, 5;
    the browser test *Settings → Learning shows the memory model…*): the optimizer's memory steps give the
    scheduler's predictions to 1e-12, same-day reviews included; a simulated learner whose memories grow more slowly
    than the standard model says gets fitted parameters that predict the latest fifth of their reviews, unseen by the
    fit, better (lower log loss by more than 1 % and 1.5 standard errors), the same parameters every time; a learner
    the standard model fits keeps it; under 1,000 reviews no fit is tried. Through the API: the fit goes into use at
    once, every card equals a replay of its review log with the new parameters, a review given afterwards is
    scheduled with them, going back to the standard model restores every card's stability, difficulty and due date
    exactly, and the settings API refuses the parameters (only the server sets them).
  - *Verb notes from annotations* (`tests/unit/grammar.test.ts`): a Russian, Ukrainian or Polish verb form that
    fills two cells (Polish *wynosi*, present and future; Russian *договоритесь*, command and future) is named by its
    sentence's annotation alone. The grammar build keeps all 12,100 annotations (none dropped, none unmatched).
  - *The applied meaning review* ([FREQUENCY_SETS.md](FREQUENCY_SETS.md#meaning-review)): 2,500 more words. The
    consolidated review files and the sets rebuild byte for byte from the reviewers' checked output; against the sets
    before, only 2,494 of those words changed, and only in their meanings, sentences and combinations. Updating the
    real 1.9.1 sets to the new ones on a test server (what *Update* does), with 34 or 35 words studied beforehand:

    | Language | Words refreshed | Removed | Time | Changed words read back through the API |
    |---|---|---|---|---|
    | Spanish | 5,972 | 0 | 6.1 s | 299, with 965 sentences and 95 combinations |
    | Portuguese | 5,963 | 0 | 13.5 s | 397, with 1,310 sentences and 102 combinations |
    | Vietnamese | 5,977 | 0 | 2.3 s | 499, with 1,574 sentences and 253 combinations |
    | Russian | 5,991 | 0 | 13.6 s | 400, with 1,309 sentences and 63 combinations |
    | Ukrainian | 5,971 | 0 | 11.1 s | 500, with 1,527 sentences and 44 combinations |
    | Polish | 5,965 | 0 | 11.5 s | 399, with 1,244 sentences and 69 combinations |

    Every changed word then had the new set's meanings in order, each sentence under the meaning the review linked it
    to, and its combinations; every studied word kept its cards and review log unchanged.
  - *Spelling.* The interface, the docs and the content say "practice" for the verb too; an English answer with
    "practise" counts the same (`tests/unit/answer.test.ts`), and the set and Writing builds respell or refuse it.
  - *Writing content.* 1,300 sentences: all of A1 (200) in the six languages and Spanish A2 steps 1–100.
  - Not run for 2.0.0: a Docker build; Safari and Firefox; a native speaker's read of the review's new sentences
    (their English was read for the content rules; their target-language text had no second reviewer).

These did **not** run here:

- **The 1.1.0, 1.2.0, 1.2.1, 1.3.0, 1.4.0, 1.5.0, 1.5.1, 1.6.0, 1.7.0, 1.8.0, 1.8.1, 1.8.2, 1.8.3, 1.8.4, 1.8.5, 1.9.0, 1.9.1 and 2.0.0 images themselves.** Only their file layout was reproduced, as described above. For 1.8.0 the copy step was not replayed: its new files are under `server/`, `shared/` and `web/src/`, which the image copies whole (the web app through `dist`). For 1.8.1 only the new `data/grammar` line was replayed. 1.8.2, 1.8.3, 1.8.4 and 1.8.5 add no file the image's copy step does not already take (their data changes are in `data/frequency`, `data/grammar` and `data/reading`; `data/review`, `scripts/review` and the new `scripts/freq` files of 1.8.4 and 1.8.5 are build-time only, and the new `shared/vietnamese.ts` of 1.8.4 is copied with `shared/`). 1.9.0 adds `data/writing/*.json`, copied by a new line of the build stage (written like the `data/reading` line above it, and not run here); its new migration (`0007_writing.sql`) runs at start-up like the others, after the pre-migration backup.

- **The image's build stage** (`npm ci`, `npm run build`, `npm prune`). It needs the npm registry. The lockfile was
  checked instead: `npm ls --package-lock-only` and `npm ci --dry-run` both succeed.
- **Caddy.** The image could not be pulled. `deploy/Caddyfile` and `Caddyfile.lan` were checked against Caddy's
  official documentation only. Automatic HTTPS, the LAN internal CA and the full-stack `docker compose up` are
  untested.
- **rclone.** `offsite-sync.sh` ran against a local stub, not a real remote.

**First run on your server:** after `docker compose up -d --build`, check `docker compose ps` (both services healthy),
then open `https://<domain>`. Run a recovery drill with `docker compose exec app node server/cli.ts backup
test-restore <file>`. [DEPLOYMENT.md](DEPLOYMENT.md) has the full checklist.

## Independent review

An independent review agent read the code without having seen it being written. It reported 11 defects, all now
fixed:

- Findings 1–4 and 6–9 have automated tests, named below.
- The reviewer's own reproduction scripts for 1, 3, 5 and 9 were re-run against the fixes: offline start, CSRF
  race, IndexedDB quota, login burst and a 160,000-row CSV. All now behave correctly.
- 10 and 11 were checked by reading the code.

The findings:

1. **High:** after an offline start, queued answers were sent before the security token was known and failed
   permanently. Fix: the token is now fetched first, and refreshed on `csrf_failed`. A rejected answer is no
   longer treated as local progress. Test: e2e *starting the app offline, answering, then reconnecting…*
2. **High:** a word's recall memory could be introduced on the same day its recognition memory was reviewed. Fix:
   the unlock rule, plus a server-side guard in `applyReview`. Test: *an established recognition memory and a newly
   unlocked recall memory are never both scheduled on one day*.
3. **Medium:** parallel sign-in attempts could get around the rate limit. Fix: checks still in progress count, and
   at most two run at once. Test: *parallel sign-in attempts cannot get around the limit*.
4. **Medium:** a follow-up exercise planned only on a device could be rejected by the server. Fix: the device
   plan is reconciled with the server's, and the server adopts answered follow-ups. Test: *a follow-up exercise
   planned only on an offline device is adopted…*
5. **Medium:** if device storage was full, an answer could be lost. Fix: unsent changes fall back to memory, with a
   warning in the study screen.
6. **Low–medium:** a stale offline edit of a setting or note could overwrite a newer one, and a mnemonic could not
   be cleared. Fix: last-writer-wins by device change time. Test: *a setting or note changed offline earlier never
   overwrites a newer change…*
7. **Low:** "I was right" ignored hints. Fix: a hint keeps the rating at Hard. Test: *"I was right" makes a typed
   answer correct, but a hint before it still rates the review Hard*.
8. **Low:** Forvo plays could exceed the daily limit, play counts could be lost when the tab closed, and links could
   outlive their 2 hours. Fix:
   - the limit is checked before cached links are returned
   - the browser stops Forvo playback once the limit is used up
   - play counts go through the durable queue
   - link expiry counts from Forvo's response. Test: *once the daily limit is used up, even cached links are
     withheld…*
9. **Low:** a CSV of more than about 100,000 rows failed. Fix: no argument spreading. The reviewer's 160,000-row
   file now imports. Test: *very large delimited files parse*.
10. **Low:** an answer queued during a send waited for the next trigger. Fix: the queue sends again after the
    current send finishes.
11. **Low:** a file deleted during a download could crash the server. Fix: stream errors end only that response.

### Review of the 1.8.2 code

A further independent review read the 1.8.2 changes (the Study and Progress redesign and set updates that leave words
out) and reported 11 findings and two minor ones, all fixed; the ones marked † have new automated tests:

1. Home's *Today's session* and the start screen planned different sessions (Home counted only the new words left for
   today). Fix: the start screen defaults to the same number. †
2. A left-out word only planned in an unfinished session survived the update for good. Fix: such words are marked
   deleted; only answered or marked words count as started. †
3. A left-out word kept because of the learner's own import lost a meaning their file shared with the set. Fix: kept
   words keep their meanings; an undo never leaves a word without a meaning. †
4. Homographs were matched by id order during an update. Fix: the one whose meanings the row shares is chosen. †
5. A reading text resumed halfway counted its answered questions twice. Fix: a text's answers count when it is
   submitted.
6. With the frequency fields empty, the preview and Start planned different words. Fix: both send an empty range. †
7. Removing a left-out word deleted the exercises of finished sessions that planned it. Fix: as in 2. †
8. Goal days and averages counted days before the learner began the language. Fix: periods start on the first study
   day. †
9. After a failed Start, changed options reused the old session id. Fix: a new id when the options change.
10. Chart values were only in hover titles. Fix: a line under each chart, tap and arrow keys, and a table for screen
    readers. †
11. The version number still said 1.8.1. Fixed.

Minor: a practice slot reached before any exercise now still loads texts, sentences and pictures from the learner's
other words; sessions started under 1.8.1 get their practice spread over the exercises left.

## Other verified behaviour (selection)

- **Scheduling policy:**
  - one aggregated initial event per card for new words
  - at most one scheduling event per card per local day
  - the initial rating waits for every graded exercise on that memory
  - a word's two memories are never both scheduled on one day, across sessions too
  - assisted recall never schedules the productive memory
  - days follow the owner's timezone, including daylight-saving transitions
- **FSRS-6:** matches py-fsrs 6.3.0 to 1e-9 on recorded fixtures, including rounding and fuzz.
- **Grading:** in all six languages — Vietnamese tones, Russian ё/е, stress marks, Ukrainian apostrophes,
  diacritics, inflected forms, same-meaning words, confusables and typo allowances. Imported accents survive into
  exercises (regression test for a bug fixed during development).
- **Security:**
  - the setup code works once and only with a strong password
  - no public registration
  - login rate limiting, CSRF and same-origin checks
  - cookie flags, security headers, body size limits
  - the Forvo key, the password hash and the setup code never appear in any API response
- **Import:** CSV, TSV, JSON, Kaikki and frequency lists; duplicates and homographs; all-or-nothing commit; undo
  that keeps studied words; a JSON export that re-imports unchanged.
- **Inflection tables and practice** (`tests/unit/paradigms.test.ts`, `tests/unit/sentences.test.ts`,
  `tests/integration/practice.test.ts`, e2e *a Polish word shows its declension, and forms and sentence practice
  grade answers; a word not learned yet stays new*):
  - the table readers and rules: voseo from *vosotros*, Brazilian spelling, Portuguese participles and imperatives,
    choosing between two sources cell by cell, Polish homonyms and spelling variants, Russian and Ukrainian layouts
  - table layout, labels, drill groups and answer specs (negative imperatives with or without *no* / *não*)
  - sentence choice: Tatoeba first, near-copies skipped, an unambiguous blank, long or numbered treebank text only
    when nothing else exists, spaced punctuation closed up
  - practice batches put recent misses first; attempts are graded again on the server, saved once per operation id,
    and never change FSRS state or review logs
  - a word opened from its page is practiced in its own language
  - Ukrainian *у* is accepted where a sentence has *в*, and sound variants never appear as wrong options
  - AI-written sentences fill only words that have no other sentence, and a row with an ambiguous blank or a form
    outside the word's table is left out; the app marks them as AI-written on the word page, in sentence practice,
    in session exercises and in exports (unit, integration, and the e2e test *sentences written by an AI are marked
    as such on the word page and in sentence practice*)
  - every AI-written sentence passed a script check (the word once, an allowed form, no digits, length), and a
    separate AI review of each language corrected 84 and dropped 2; no native speaker checked them
  - the shipped sets were built twice from the pinned sources with byte-identical results
- **Identify** (`tests/integration/identify.test.ts`, browser test "Identify: …"): all 194 scenes have both picture
  files and every object a box, a point inside it and words; batches give each word once with four distinct options
  that include the answer and no other right answer; the server grades other names of the object and noun plurals
  as right, other forms as close with a note asking for the dictionary form (a plural of the other gender too), and
  the names of other objects in the picture as wrong (never typos); attempts are idempotent; a missed object comes
  back first; nothing reaches the review log; the word page counts a word's pictures, also after a flag change; a
  Comprehensive session's batch fills up from the words being learned, then all the learner's words.
- **Most frequent words sets** (`tests/unit/frequency-build.test.ts`, `tests/integration/frequency-sets.test.ts`):
  - each shipped set has the ranks 1–6,000 less the crude words left out (`data/review/crude/<lang>-words.jsonl`)
  - every word has an English gloss and a valid part of speech, with no duplicates
  - loading a set after a starter set merges the shared words without duplicating them and gives them ranks
  - the set becomes the frequency source and *el* comes first in Spanish
  - Ukrainian fallback-dictionary words are tagged and keep their stress marks
  - the report lists sources and skipped words
  - undo restores the starter words' order
  - after undo the set loads again: started words keep their progress and rank, and nothing is duplicated
  - the build's Wiktionary parsing, lemmatization, name subtraction and Kaikki reader are tested on small inputs,
    as are the flashcard gloss rules, contraction meanings, the filters for letter names and symbols, and the
    preposition fallback
  - the shipped files come from a full rebuild from the pinned sources (`fetch-sources.sh`). Five full rebuilds were
    run while the definition rules changed, and the ranks came out the same each time, apart from four Russian
    letter names below rank 6,000 that stopped counting as words
- **Crude, politics and war sentences** (`tests/unit/crude.test.ts`, `tests/unit/politics.test.ts`): the detectors,
  each kind of decision (replace with a meaning number, keep with a corrected meaning, drop), undecided matches dropped
  by the build, crude meanings dropped and reworded with sentence links remapped, and words left out; the shipped sets
  are rebuilt from the decisions byte for byte. Since 1.8.3 a meanings decision can also replace a meaning's usage note
  and the word's written form (Ukrainian *москва*, which the dictionary data matched to an insulting collective word,
  becomes the city *Москва́* "Moscow"), and the topic detector finds the plural of the Bible word in Spanish and
  Portuguese and the Mother of God in Polish (`tests/unit/topics.test.ts`).
- **Sentences for words left without any** (`tests/unit/added.test.ts`, and the real sets): the build adds the written
  sentences only to a word that has no sentence at that point, with their meaning numbers, the AI label and their
  credits, and reports them; a rebuild that gives a word sentences of its own never stacks these on top. In the
  shipped sets every word of all six languages has at least one sentence (180 words got 359 sentences), and every
  script under `scripts/` and `deploy/` parses (`tests/unit/scripts-syntax.test.ts`, which would have caught the
  duplicate declaration that stopped `scripts/freq/build.mjs` in 1.8.2). A full build from the sources with the fixed
  script reproduced the shipped Spanish, Portuguese, Vietnamese and Ukrainian sets byte for byte. The Russian and
  Polish ones could not be compared: four treebanks were missing from the local sources (UD Russian Taiga and GSD,
  Polish LFG and PUD), so other sentences were attached and the decisions met different ones, and those treebanks
  could not be downloaded here.
- **Updating a set that leaves words out** (`tests/integration/meanings.test.ts`, and a run on the real sets): a word
  not started is removed with its sentences; a started word, one with a note, or one of the learner's own stays with
  its progress and meanings but loses the set's sentences, combinations and rank, and is not counted again by the next
  update; a word a session planned is marked deleted so the session keeps its exercises; homographs are matched by
  meaning; undoing an import never leaves a word without a meaning; a word the set created takes the new version's
  written form, while a word the learner edited keeps theirs. Updating the real 1.8.1 Ukrainian and Portuguese
  sets to 1.8.2, with three left-out words started or annotated, removed 26 and 34 words, kept the 3, left no sentence
  outside the new set and no orphaned sentence, in 12 and 6 seconds. Updating the real 1.8.2 Ukrainian and Spanish
  sets to 1.8.3 gave sentences to all 62 and 19 words that had none (two of them started by the learner), removed no
  word, left no sentence outside the new set and no orphaned sentence, and showed Ukrainian *москва* as *Москва́*
  "Moscow (the capital of Russia)", in 12 and 6 seconds.
- **Study and Progress redesign** (`tests/unit/mix.test.ts`, `tests/unit/summary.test.ts`, `tests/unit/progress.test.ts`,
  `tests/integration/sessions.test.ts`, `tests/integration/progress.test.ts`, browser test *Comprehensive study is the
  default: …*): the mixed plan (slot sizes, turns, the reading text in the second half, the total staying the same from
  first question to last), every practice answer counted once in the counter and the summary (replayed and offline
  `round` events never double-count, a half-read text is counted only when submitted), the preview writing nothing and
  matching the plan Start gets (default new words, an empty frequency range), the words-known history ending on
  today's counts, skill trends and the weakest skill only with enough answers, goal days counted from the first study
  day, Coming up, the words that need work, and the chart values readable by tapping, by keyboard and in a table for
  screen readers.
- **Conjugation tables for Russian, Ukrainian and Polish verbs (1.8.4)** (`tests/unit/verb-tables.test.ts`, browser
  test *a Polish verb shows its conjugation, the past by person and gender, and its forms can be practiced*, and the
  real sets): Polish Morfologik tags read as tenses, the past and the conditional by person and gender, imperatives and
  participles; a Polish table without emphatic imperatives (*bądźże*), and the word's forms list without the copies
  that only lack the Polish letters (*miec*, *mial*); Russian tables from OpenRussian with the present or the future
  by aspect, the past by gender and the future of *быть*; Ukrainian tables from dmklinger with the one-word future
  kept, short colloquial forms left out and *мати* built in; the layout (forms, then each tense with its pronouns, the
  Polish past and conditional by gender, then the imperative); cells named with their pronoun, drilled by tense and
  number and summed up on the new-word card; a verb form in an answer explained by its tense. The tables are attached
  after the sentences, so they never change which sentences a word gets: adding them changed only verb entries (the
  Russian and Ukrainian tables; the Polish tables and forms lists), left the credits as they were, and all 11,972
  grammar annotations still matched. In the shipped sets 1,224 Russian, 1,139 Ukrainian and 1,464 Polish verbs have a
  table. Updating the real 1.8.3 Polish and Ukrainian sets to 1.8.4 gave those 1,464 and 1,139 verbs their tables, in
  14 and 13 seconds, and forms practice then asked for them ("conditional (wy, other) → miałybyście", "present (ви) →
  пи́шете"). The browser test opens *mieć*: the Conjugation heading, *mam*, the past by gender (*miałam*), the
  Imperative fold, the Verb tenses group in forms practice and a question naming its tense in Polish (*czas
  przeszły*).
- **Gender and number tables for Spanish and Portuguese, and clean forms lists (1.8.5)**
  (`tests/unit/nominal-tables.test.ts`, `tests/integration/nominal-tables.test.ts`, browser test *a Portuguese word
  shows its gender and number table, and forms practice asks for the feminine and the plurals*, and the real sets):
  the spelling rules that place the dictionary's unlabeled forms (feminines, plurals with moving accents such as
  *inglés, ingleses*, *canción, canciones*, *papel, papéis*, *homem, homens*, the Spanish short form *buen*, *algún*,
  *gran*), our own tables for *seu*, *meu*, *bom*, *el*, *uno* and the others, words filed under another part of
  speech (*bueno*, *bajo*) and the ones left without a table (*contra*, *cuatro*), a crude feminine left out; forms
  lists losing misspelt copies (*dia*, *juz*) but keeping pairs that are both words (*esta*, *ésta*) and Polish forms
  PoliMorf confirms (*największa*, *największą*), function words keeping only their real variants (Russian *во*,
  the case forms of *что*; nothing under *на*), adverbs their comparatives; misspelt copies never reaching a table;
  the layout (singular and plural down the side, masculine and feminine across, one column with *the same for
  masculine and feminine*, *before a noun*, the neuter apart, *yo* by use), titles, labels, drills (every cell but the
  dictionary form, with the *Gender and number* group, never for *yo* and *tú*) and explanations ("“sua” is the
  feminine singular of “seu”. It agrees with the noun it goes with."). Through the server, an update gives *seu* its
  table, labels its forms from it and takes out a misspelt form, and forms practice asks for and grades the three
  cells. Rebuilding the sets changed only tables and forms lists; credits and the 11,972 grammar annotations stayed the
  same, and apply-review gave the same bytes twice. In the shipped sets 3,817 Spanish and 3,499 Portuguese words have
  a gender and number table; the forms lists lost 362 Spanish, 231 Portuguese, 2,324 Polish, 65 Russian and 57
  Ukrainian forms. Updating the real 1.8.4 sets to 1.8.5: Portuguese gave 3,499 words their tables in 6 seconds and
  Spanish 3,817 in 14 (forms practice then asked "feminine singular → sua", "short form before a masculine noun →
  buen"); Polish dropped 2,303 form rows (*juz* gone from *już*) in 10 seconds and Russian 65 (*нахуй* gone from
  *на*) in 15, with no word removed. The browser test opens *seu* on a phone: the *Gender and number* heading, the
  feminine column, *sua* and *suas*, no *Case* header, the *Gender and number* toggle on in forms practice, and a
  right answer.
- **Writing (1.9.0)** (`tests/unit/writing.test.ts`, `tests/integration/writing.test.ts`, the Comprehensive preview
  in `tests/integration/sessions.test.ts`, and the browser test *Writing on a phone: Spanish sentences in step order,
  graded word by word, and "I was right" counting a wrong one*): patterns (alternatives, optional parts,
  nesting, tidied spaces, no repeats, malformed ones refused); word keys that forgive capitals, punctuation, stress
  marks, ё, apostrophes, Vietnamese tone placement and the Ukrainian alternations but not a missing accent or tone;
  grading against every accepted translation, with the nearest one and the wrong and missing words marked; the build's
  checks (fields, ids and steps, lengths per level, letters, repeats within a language) and the same bytes from the
  same batches. Through the server: sentences in step order at the writing level, graded again on the server; a wrong
  one waiting while others come and coming back when nothing else is left; repeated answers counted once; the level
  rising only with the last sentence of the level written right, and saved as the language setting; *My answer was
  right* counting an answer, remembering its wording for the next time and refusing an empty answer; a sentence of
  another level refused; the summaries, the Progress page's Writing card and the practice summary; a Comprehensive
  session of 20 minutes planning three Writing slots of one sentence (none for a language without sentences) and
  keeping a Writing round's answer in its tallies. A session's words come first: with Portuguese sentences, the one
  using the session's word comes before the first in step order, a rare word beats one in three sentences, as good a
  fit gives the easier sentence, two of the words beat one, words of another language change nothing, a sentence
  answered wrong just now waits even when it uses the word, and a sentence done never comes again; a unit test checks
  the word runs (a Vietnamese word of two syllables, in order only) and the weights (a word in every sentence counts
  for nothing). The browser test, on a phone: Study's mix lists Writing; the Practice card shows the level and "0 of
  100 A1 sentences done"; the first sentence typed in lower case without punctuation is right and counted; the second,
  with a word too many, is wrong with that word struck through, then counted as right with *I was right* (*My answer was right* until 2.0.0)
  (the server confirms it, progress 2); *I don't know* shows the usual translation; *Done for now* says "2 of 3
  right"; nothing scrolls sideways. 1.9.0 shipped 400 sentences (Spanish, Portuguese, Vietnamese and Russian A1 steps
  1–100) and 1.9.1 ships 600 (A1 steps 1–100 in all six languages), each batch written by one Claude pass and
  reviewed by another. Test servers have no Writing sentences
  unless a test brings its own, so the other session tests stay the same as batches are added. One browser test was
  made sturdier: *an answer the server did not accept…* now adds a handler that lets requests through before it
  removes the one that rejects them, since a request caught while the last handler was being removed could hang (it
  did once in a full run).
- **Sessions planned at the learner's pace (1.8.4)** (`tests/integration/sessions.test.ts`): a session's plan fills
  its minutes divided by the learner's pace, measured as real time against the model time their plans filled. With
  nothing to measure the pace is 2: a 10-minute Comprehensive session plans 28 questions, 20 minutes 40 and 30 minutes
  58, where the model's own speed gave 40, 71 and 94. The test: a 1.8.3 session whose ten minutes took twenty gives 2;
  one planned at pace 2 and ended halfway after 9 minutes brings it to 2.53 (weighted by the minutes done); sessions
  with under 2 active minutes, under half their exercises done or a plan that filled under 85 % of its time are left
  out; a 200-minute outlier stops at 3, the top (1 is the bottom). Only the last 10 such sessions of the last 30 days
  count, and the plan keeps the pace it used.
- **Vietnamese tone keys (1.8.4)** (`tests/unit/vietnamese.test.ts`): the typing helper's five tone keys put the mark
  on the vowel that carries it in the syllable before the caret (*qu-* and *gi-* included), a tone already there is
  taken off by its own key and replaced by another, and the rest of the text and the caret stay right; grading takes
  either placement of a tone on two vowels, so the helper never makes an answer wrong. Next to them are the letters
  ă, â, ê, ô, ơ, ư and đ.
- **Backups:**
  - owner-only file permissions
  - no leftover scratch or WAL files
  - hand-copied backups are listed
  - uploads never overwrite an existing backup
  - every device is signed out after a restore
  - the CLI restores over a damaged database and keeps the damaged file
- **Layout:** every page renders without page errors or sideways scrolling at phone (390 px), tablet (820 px) and
  desktop (1440 px) widths, in light and dark themes.

## Not covered by automated tests

- Live Forvo playback: the API is mocked in tests. See [FORVO.md](FORVO.md) for a manual check.
- Rebuilding the frequency sets with a full Kaikki.org download: the reader is tested on a small sample in Kaikki's
  format only, because kaikki.org was not reachable from the build environment.
- Safari on iOS and macOS, and Firefox. Only Chromium was run. Safari-specific handling exists, such as byte-range
  responses for audio and `apple-touch-icon`, but it has not been exercised in Safari.
- Real microphone recording and speech playback: `MediaRecorder` and `speechSynthesis` need real devices.
- Screen-reader use: semantic roles, labels, focus handling and live regions are in place, but no screen-reader
  audit was done.
