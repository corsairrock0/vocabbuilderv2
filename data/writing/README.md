# Writing sentences

The Writing practice (VocabBuilder 1.9.0 and later) uses the files in this folder:

| File | What it is | Made by |
| --- | --- | --- |
| `src/<lang>-<level>-<batch>.jsonl` | reviewed batches as delivered: 100 sentences per file, one JSON object per line | writing and review, below |
| `<lang>.json` | what the server reads: the language's sentences in serving order | `scripts/writing/build.mjs` |

The English sentences and their accepted translations are **AI-written**: Claude wrote them for Lango and a second
Claude pass reviewed them. No native speaker has checked them. They are © 2026 Lango, all rights reserved (see
[LICENSE](../../LICENSE)), and every `<lang>.json` says so in its `copyright` and `credit` fields.

## What a sentence holds

- `en`: the English sentence the learner writes in the language, and sometimes a short `context` ("to a friend",
  "polite", "a woman speaking") that settles what the English leaves open. The app shows the context under the
  English.
- `answers`: every translation the app accepts, as patterns. In a pattern, `{a|b|c}` is one of the alternatives (an
  alternative may hold several words or nothing, and groups nest) and `{a|}` makes a part optional; spaces are tidied
  after expansion. The first expansion of the first pattern is the **main translation**, the one the learner is shown
  after a mistake. A sentence accepts at most 120 translations.
- Grading is word by word and every word must be right. Capitals and punctuation don't count, nor do Russian and
  Ukrainian stress marks, Russian ё written as е, the shape of an apostrophe, where a Vietnamese tone mark sits on a
  vowel pair (hoá/hóa) or a final i/y (công ty/công ti), the Ukrainian alternations у/в, і/й and з/із/зі, and
  Ukrainian -ся or -сь after a vowel (втомилася/втомилась).
  Everything else counts: accents and other letters, endings, every word, and word order.
- When the learner presses *I was right*, the answer counts as right and its wording is accepted for that
  sentence from then on, on every device. Those wordings are kept in the learner's database (`writing_accepted`),
  never in these files.

## Levels, order and the learner's level

The plan is 1,000 sentences per language (Colombian Spanish, Brazilian Portuguese, Southern Vietnamese, Russian,
Ukrainian, Polish): 200 at each level from A1 to C1, in steps 1–200, easiest first. They are written in batches of
100: batch 1 holds steps 1–100 of a level and batch 2 steps 101–200.

The learner's writing level (a language setting, A1 at first) decides where sentences come from. Within the level,
a sentence answered wrong comes back once five other sentences have been answered or twelve hours have passed;
otherwise the next unanswered sentence comes, in step order; when only sentences answered wrong are left, they come
back at once. A sentence answered right, or counted as right, is done. Once every sentence of the level is done, the
level moves up one (past levels already done, never past C1 or to a level with no sentences). When the level has
nothing left, sentences come from the nearest higher level with some left, then the nearest lower one.

In a Comprehensive study session, Writing questions come in among the other practice, one sentence at a time: two in
a 10-minute session, about three in 20 minutes and about seven in an hour (fewer when the learner's sessions run
slower than planned; never more than eight). Among the sentences that could come next at the learner's level, the
one that uses the session's words comes first, a rare word counting for more than a common one (see
[docs/LEARNING_ENGINE.md](../../docs/LEARNING_ENGINE.md#writing-serverlearningwritingts-sharedwritingts)). A
language with no sentences left has none, and the other modes have none.

In this version (2.0.0) there are 1,300 sentences: all of A1 (steps 1–200) in each of the six languages (Colombian
Spanish, Brazilian Portuguese, Southern Vietnamese, Russian, Ukrainian and Polish) and A2 steps 1–100 in Spanish.
1.9.0 had 400 and 1.9.1 had 600 (A1 steps 1–100).

## How the sentences are made

1. **Writing.** A Claude Opus model writes a batch to written rules:
   - the variety of each language and conventions per language that keep the batches consistent (for example:
     *ustedes* and Colombian words for Spanish; *você* and Brazilian spelling for Portuguese; Southern words beside
     their standard synonyms and fixed notes for who is speaking to whom in Vietnamese; Russian and Ukrainian written
     without stress marks; no Russianisms in Ukrainian);
   - grammar, vocabulary and length for the level, from present-tense sentences of the most common words at A1 to
     complex, idiomatic sentences at C1 (the limits are below), and difficulty rising step by step;
   - the same content rules as the reading texts: set in the language's own country or nowhere in particular; no
     personal names, and place names only from A2; no living people, brands, politics, war, crime or disasters;
     nothing about Africa, India, the Middle East, Islam, the Bible or religion; Ukrainian sentences stay off Russian
     themes and Russian sentences off Ukrainian ones;
   - the English decides everything the translation must decide (tense, number, who is spoken to), or a context note
     does;
   - the accepted list holds **every correct, natural translation** a learner could write (optional pronouns, neutral
     word orders, synonyms of the variety, both genders where the English leaves it open) and **nothing wrong**.
2. **Review.** A second Claude Opus model, which did not write the batch, reads every accepted translation, removes
   or repairs the wrong ones, adds the missing ones, and checks the English, the level, the order and the content
   rules.
3. **Checks by script.** Each batch passes the writers' checker before review and again after it (ids and steps,
   lengths, letters, repeats within the language, rare words at A1–B1, the content filters, alternatives glued to a
   neighbouring word, Vietnamese syllables), and `scripts/writing/build.mjs` checks every sentence once more before
   the app gets it.

| Level | Words in the main translation (Vietnamese: syllables) | Words in the English |
| --- | --- | --- |
| A1 | 2–9 (2–14) | 2–10 |
| A2 | 4–13 (5–18) | 4–14 |
| B1 | 6–18 (8–26) | 6–20 |
| B2 | 8–24 (10–34) | 8–26 |
| C1 | 10–30 (12–42) | 10–32 |

## Adding batches

Batches can be added at any time; the build is re-run each time and depends only on `src/`:

```bash
node scripts/writing/build.mjs --import <folder>   # copies <folder>/*.jsonl into src/ (same name: replaced), then builds
node scripts/writing/build.mjs                     # builds from src/ as it is
```

The build checks every sentence: only the fields below, with `lang`, the level and the batch matching the file name;
a whole-number `step` in the batch's range and the `id` it implies; a `topic` of one to three lower-case English
words; an `en` with a capital letter at the start, `.`, `?` or `!` at the end, no digits, no brackets and a length
within the level's limits; a `context` of at most 40 characters, starting lower-case, with no digits and no final
full stop; one to eight patterns that parse, in Unicode NFC, with no digits, brackets or straight double quotes, that
accept at most 120 translations, all written in the language's own letters, with a main translation ending in `.`,
`?`, `!` or `…` and within the level's limits; and, within a language, no repeated id, step, English sentence or
main translation. If anything is wrong, it lists every problem and writes nothing. Otherwise it writes one
`<lang>.json` per language that has sentences and prints the counts per level. The same batches always give the same
bytes, and `version` is a hash of the sentences.

A running server picks up a new `<lang>.json` without a restart (it re-reads a file when it changes). The Docker image
ships `data/writing/*.json`, so rebuild the image after adding batches. A learner's answers are kept by sentence id:
never reuse an id for a different sentence, and keep the ids of sentences already shipped. Correcting or adding
accepted translations of a shipped sentence is fine; answers given before keep the grade they had.

## Formats

A line of a batch file:

```json
{"id":"es-A1-1-004","lang":"es","level":"A1","step":4,"topic":"work","en":"I am a teacher.",
 "answers":["{|Yo }soy {profesor|profesora|maestro|maestra}."]}
```

`<lang>.json`: `{format: "vocabbuilder-writing-v1", language, version, copyright, credit, sentences}`, one sentence
per line, each as in the batch without `lang` (`context` only when there is one), in serving order: by level, then
step.
