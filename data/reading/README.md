# Reading comprehension texts

The Reading comprehension practice (VocabBuilder 1.7.0) uses the files in this folder:

| File | What it is | Made by |
| --- | --- | --- |
| `src/<lang>-<level>-<batch>.jsonl` | reviewed batches of longer passages as delivered: 20 per file, one JSON object per line | writing and review, below |
| `src/<lang>-<level>-S<batch>.jsonl` | reviewed batches of short everyday texts, the same way | writing and review, below |
| `<lang>.json` | what the server reads: the language's texts in serving order | `scripts/reading/build.mjs` |

The texts, their translations and their questions are **AI-written**: Claude wrote them for Lango and a second Claude
pass reviewed them. No native speaker has checked them. They are © 2026 Lango, all rights reserved (see
[LICENSE](../../LICENSE)), and every `<lang>.json` says so in its `copyright` and `credit` fields. The app marks every
text as an *AI-written passage*.

## Two kinds

| Kind | Id | Length | Content | Questions | Order within a level |
| --- | --- | --- | --- | --- | --- |
| long (*Longer passages*) | `es-B1-1-07` | about 150 words (140–165; Vietnamese 190–250 syllables), at most three paragraphs | literature, history, humanities or science (`genre`), five of each per batch | 4 | by id |
| short (*Everyday texts*) | `es-B1-S1-07` | about 75 words (65–85; Vietnamese 95–125 syllables) | everyday life (`genre` `everyday`) in a `format`: story, dialogue, message, email, notice, diary, instructions, advert or description | 3 | by `step`, 1–40, easiest first |

The plan is 200 of each kind per language (Colombian Spanish, Brazilian Portuguese, Southern Vietnamese, Russian,
Ukrainian, Polish): 40 at each level from A1 to C1, written in batches of 20, one language, level and kind per batch.
Short batch S1 holds steps 1–20 of a level and S2 steps 21–40. Inside a paragraph of a short text, a single line break
separates lines (a dialogue's turns, a chat, a list) and the app keeps it.

In this version (1.8.5) there are 640 texts:

| Language | Longer passages | Everyday texts |
| --- | --- | --- |
| Colombian Spanish | 60 (A1, A2, B1) | 60 (A1, A2, B1) |
| Brazilian Portuguese | 60 (A1, A2, B1) | 60 (A1, A2, B1) |
| Southern Vietnamese | 60 (A1, A2, B1) | 40 (A1, A2) |
| Russian | 60 (A1, A2, B1) | 40 (A1, A2) |
| Ukrainian | 60 (A1, A2, B1) | 40 (A1, A2) |
| Polish | 60 (A1, A2, B1) | 40 (A1, A2) |

When a learner's level has no unread text of a kind, the practice serves one from the nearest higher level that has
one left, then the nearest lower one, of the same kind; a level with no texts never counts as read.

## How the texts are made

1. **Writing.** A Claude Opus model writes a batch to written rules:
   - the variety of each language (*ustedes* and Colombian words for Spanish, *você* and Brazilian spelling for
     Portuguese, Southern words for Vietnamese, no stress marks in Russian and Ukrainian, no Russianisms in Ukrainian);
   - the length and content of the kind (above); everyday texts are set in the language's own country (Bogotá, Brazil,
     Ho Chi Minh City, Moscow, Kyiv, Warsaw) or anywhere neutral, and mix the formats, about six stories, four
     dialogues, three messages, three emails, two notices or adverts and two of the rest per batch;
   - grammar, vocabulary and content for the CEFR level, from short present-tense sentences at A1 to literary and
     academic prose at C1;
   - facts that are correct and uncontroversial; real people only as historical figures who died before 1990; no
     living people, brands, current politics, war, crime or disasters; nothing about Africa, India, the Middle East,
     Islam, the Bible or religion; Ukrainian texts stay off Russian themes and Russian texts off Ukrainian ones;
   - the questions: the main idea or purpose first, then details; the last asks for an inference or the meaning of a
     word or phrase in context (in longer passages at A1–A2, another detail or a word's meaning). Four options each,
     exactly one right, with a
     one-sentence explanation in English pointing to the words that settle it. Questions are in English up to B1 and
     in the text's language at B2 and C1. The right answers are spread over the four positions; the app shuffles the
     options anyway, so the last answer can't be found by elimination;
   - a title in the language, its English title, a three-to-six-word English topic and a full English translation.
2. **Review.** A second Claude Opus model, which did not write the batch, checks every text and fixes it in place:
   language (grammar, spelling, naturalness for the variety), level, length, facts, the content rules, the
   translation, and the questions and their answers (each answerable from the text alone, exactly one right option,
   the explanation accurate). A text whose facts can't be fixed is rewritten on another topic.
3. **Checks by script.** Each batch passes the writers' checker (ids, fields, lengths, question language, banned
   topics) before review and again after it, and `scripts/reading/build.mjs` checks every text once more before the
   app gets it.

## Adding batches

Batches can be added at any time; the build is re-run each time and depends only on `src/`:

```bash
node scripts/reading/build.mjs --import <folder>   # copies <folder>/*.jsonl into src/ (same name: replaced), then builds
node scripts/reading/build.mjs                     # builds from src/ as it is
```

The build checks every text: the fields are there and not empty; the level is A1–C1; `lang`, the level and the kind
match the file name (`S` in the batch for short texts); a long passage has one of the four genres and four questions;
a short text has the genre `everyday`, one of the formats, a whole-number `step` from 1 to 40 and three questions;
every question has four different options and an `answer` from 0 to 3; ids are unique across all files. If anything
is wrong, it lists every problem and writes nothing. Two short texts on the same step of a level only get a warning
(they are served in id order). Otherwise it writes one `<lang>.json` per language that has texts and prints the
counts per kind and level. The same batches always give the same bytes, and `version` is a hash of the texts.

A running server picks up a new `<lang>.json` without a restart (it re-reads a file when it changes). The Docker image
ships `data/reading/*.json`, so rebuild the image after adding batches. A learner's history is kept by id: never reuse
an id for a different text, and keep the ids of texts that were already shipped.

## Formats

A line of a batch file (a short text adds `"format"` and `"step"` and has three questions):

```json
{"id":"es-B1-1-07","lang":"es","level":"B1","genre":"science","topic":"how bees make honey","title":"…","titleEn":"…",
 "text":"first paragraph\n\nsecond paragraph","translation":"…",
 "questions":[{"q":"…","options":["…","…","…","…"],"answer":2,"explain":"…"}, …]}
```

`<lang>.json`: `{format: "vocabbuilder-reading-v1", language, version, copyright, credit, passages}`, one text per line,
each as in the batch without `lang` and with `kind` (`long` or `short`) added, text in Unicode NFC. The texts are in
serving order: by level, then long before short, long ones by id and short ones by step.
