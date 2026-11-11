# Import formats

Vocabulary can be imported in two places:

- **In the app:** Settings → Data and backups → *Import vocabulary*, or `/import`. You upload a file, preview it,
  match the columns, check it, and then import it.
- **On the server:** `npm run cli -- import <file> --lang <code>` handles files too large to upload.

Every import is **one transaction**: if anything fails, nothing changes. Every import can be **undone** from the
list of recent imports. Undo removes the words and details that import added. Words you have already started
learning are kept, together with their progress.

Supported inputs:

| Format | Detected by | Use it for |
|---|---|---|
| `vocabbuilder-v1` JSON | `"format": "vocabbuilder-v1"` | Full-fidelity entries: the starter sets, exports, hand-made lists |
| CSV / TSV | Delimiter sniffing (RFC 4180 quoting) | Spreadsheets, Anki exports, word lists |
| JSON array / JSONL | `[ {…}, … ]` or one object per line | Lists from scripts |
| Kaikki / Wiktextract JSONL | Lines with `word`, `pos`, `senses` | Dictionary data with glosses, forms, examples and IPA |
| Frequency list | Chosen as *A frequency list* | Ranks for words you already have, from corpora or subtitles |

Files must be UTF-8. A byte-order mark is fine.

## `vocabbuilder-v1` JSON

This is the format of `data/starter/*.json` and of the bundled most-frequent-words sets in `data/frequency/*.json`
([FREQUENCY_SETS.md](FREQUENCY_SETS.md)). When a file's words already exist, a merge also gives them the file's
`frequencyRank`.

```json
{
  "format": "vocabbuilder-v1",
  "language": "ru",
  "source": { "name": "My list", "kind": "curated", "license": "CC0-1.0", "url": null, "notes": "…" },
  "entries": [
    {
      "lemma": "здравствуйте",
      "display": "здра́вствуйте",
      "pos": "interjection",
      "gender": null,
      "aspect": null,
      "aspectPair": null,
      "pronunciation": "ˈzdrastvujtʲe",
      "register": "formal",
      "regionalNote": null,
      "senses": [
        { "gloss": "hello", "translations": ["hello", "good day"], "definition": null,
          "note": "Polite greeting for someone you address as вы, or for a group." }
      ],
      "forms": [ { "form": "здравствуй", "display": "здра́вствуй", "tags": ["informal", "singular"] } ],
      "examples": [
        { "text": "Здравствуйте, я ваш новый сосед.", "display": "Здра́вствуйте, я ваш но́вый сосе́д.",
          "translation": "Hello, I'm your new neighbor.", "target": "Здравствуйте", "sense": 0 }
      ],
      "expressions": [ { "text": "здравствуйте, друзья", "translation": "hello, friends", "kind": "expression" } ],
      "grammar": { "notes": "The first в is silent." },
      "tags": ["greetings"],
      "frequencyRank": null,
      "curatedOrder": 1,
      "imageUrl": null
    }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `lemma` | yes | Dictionary form, without stress marks |
| `display` | — | Form shown to the learner, e.g. with Russian or Ukrainian stress marks. Stress marks are ignored when checking answers |
| `pos` | — | `noun`, `verb`, `adjective`, `adverb`, `pronoun`, `preposition`, `conjunction`, `interjection`, `numeral`, `particle`, `phrase`, `determiner`, `classifier`, `contraction` or `other`. Common synonyms are normalised |
| `senses[].gloss` | yes (first sense) | The main English meaning, used as the answer for recall |
| `senses[].translations` | — | Other accepted English answers |
| `senses[].note` | — | Usage note, shown with the word and in feedback |
| `senses[].definition` | — | A longer explanation or usage examples (`на почте = at the post office`), shown on the word page and the new-word card but never in quizzes |
| `forms[]` | — | Inflected forms with tags such as `genitive`, `plural`, `past`, `1sg`. They let the checker say "right word, wrong form" |
| `examples[].target` | — | The exact word as it appears in the sentence. Context and cloze exercises need it; when it is missing, the importer looks for the word or one of its forms |
| `examples[].sense` | — | The meaning the sentence shows, as an index into `senses` (0 is the first). The word page lists the sentence under that meaning, and sentence questions quiz that meaning. Without it, a word with one meaning still works; a word with several shows all its meanings in sentence practice and skips "what does it mean here?" questions for that sentence |
| `examples[].source`, `examples[].ref` | — | Where the sentence comes from: a key of the file's `sentenceSources`, and the sentence's id there (`tatoeba:1234567` links to the sentence on Tatoeba) |
| `expressions[]` | — | Phrases with the word: `text`, `translation`, and `kind`. `"combination"` is a fixed combination with a meaning of its own (Spanish *sin embargo* "however" under *embargo*): it is listed under the word and never quizzed as the word's meaning. Anything else is a related expression |
| `paradigm` | — | The word's declension or conjugation table (below) |
| `curatedOrder` | — | Teaching order, used when no frequency rank exists |
| `frequencyRank` | — | Rank in a frequency list (1 = most common) |

### Sentence sources

Example sentences can name their own source, separate from the file's `source`. The file lists them once:

```json
"sentenceSources": {
  "tatoeba": { "name": "Tatoeba", "license": "CC-BY-2.0-FR", "url": "https://tatoeba.org" },
  "ru-taiga": { "name": "UD Russian Taiga", "license": "CC-BY-SA-4.0", "url": "https://github.com/UniversalDependencies/UD_Russian-Taiga" }
}
```

and each example refers to one: `{ "text": "…", "target": "…", "source": "tatoeba", "ref": "tatoeba:1234567" }`. The word
page shows the source under each sentence, linked to the sentence itself where the source has a page for it.

A source with `"ai": true` holds sentences written by an AI, such as
`"ai-claude": { "name": "AI-written (Claude)", "license": "AI-generated, not checked by a native speaker", "url": null, "ai": true }`.
The app marks each of its sentences as AI-written: on the word page, in sentence practice and in study sessions.
Exports keep the flag.

### Inflection tables (`paradigm`)

A table is a set of cells. Each cell key is `"<row>|<column>"` and holds the forms for that cell, most common first.
Russian and Ukrainian forms may carry stress marks.

```json
"paradigm": {
  "kind": "noun",
  "source": "OpenRussian",
  "cells": { "nom|sg": ["кни́га"], "gen|sg": ["кни́ги"], "gen|pl": ["книг"], "ins|sg": ["кни́гой", "кни́гою"] }
}
```

| Kind | Rows | Columns |
|---|---|---|
| `noun` | `nom gen dat acc ins loc voc` (Russian `loc` is the prepositional case) | `sg pl` |
| `adjective`, `pronoun`, `numeral` | the cases, with `acc.anim` / `acc.inan` where animacy decides the accusative; `short` (Russian short forms); `comp`, `sup` (column `-`) | `m n f pl` (Russian, Ukrainian), `m n f pl.vir pl.nvir` (Polish), or `-` for case-only words such as personal pronouns |
| `verb` | tenses: `ind.pres ind.pret ind.impf ind.fut cond sbjv.pres sbjv.impf sbjv.fut imp.aff imp.neg`, Portuguese also `ind.plup inf.pers`; compound tenses `c.ind.perf c.ind.plup c.ind.fut c.cond c.sbjv.perf c.sbjv.plup` (Portuguese also `c.sbjv.fut`); `nfin` (`inf`, `ger`) and `part` (`m.sg f.sg m.pl f.pl`) | persons `1s 2s 3s 1p 2p 3p`, Spanish also `2s.vos` |

`"indeclinable": true` with empty `cells` marks a word that never changes (Russian *кофе*). Optional `notes` (such as
`"animate"`) and, for Polish nouns, `gender` (`m1 m2 m3 f n1 n2 p1 p2 p3`) are shown with the table. On import, every
form of the table is also stored as one of the word's forms, tagged with the cells it fills, so answer checking can
say "right word, other form: genitive singular". A merge adds a table only to a word that has none. Editing a word
in the app keeps its table.

## CSV and TSV

The first row must be a header. Common column names are matched automatically, case-insensitively:

| Field | Header names recognised |
|---|---|
| Word (required) | `lemma`, `word`, `term`, `headword`, `vocabulary`, `front`, `target`, `spanish`, `russian`, … |
| English meaning (required) | `english`, `meaning`, `translation`, `gloss`, `en`, `back` |
| Other accepted meanings | `alternatives`, `synonyms`, `other_translations`, `accepted` |
| Part of speech | `pos`, `part_of_speech`, `word_class`, `type` |
| Display form | `stressed`, `accented`, `display` |
| Gender, aspect, aspect pair | `gender`; `aspect`; `aspect_pair`, `partner` |
| Pronunciation | `ipa`, `pronunciation`, `transcription` |
| Frequency rank | `rank`, `frequency_rank`, `#` |
| Example and its translation | `example`, `sentence`; `example_translation`, `sentence_en` |
| Word as it appears in the example | `example_target`, `cloze`, `surface_form` |
| Second example | `example2`, `example2_translation` |
| Forms | `forms`, `inflections` |
| Topics | `tags`, `topic`, `category`, `deck` |
| Notes, register, regional note | `notes`, `grammar`; `register`; `region`, `dialect` |

Anything not matched can be mapped by hand in the preview. If nothing matches, the first column is used as the word
and the second as the meaning.

List-valued cells use the separator chosen in the import options (default `;`):

- **meanings:** `hello; hi` — the first is the main gloss, the rest are accepted answers
- **tags:** `food, travel`
- **forms:** compact syntax `form:tag,tag; form:tag`, e.g. `воду:accusative,singular; воды:genitive,singular`, or
  a JSON array of `{ "form", "display", "tags" }`

Minimal example:

```csv
word,english,pos,example,example_translation
спасибо,thank you;thanks,interjection,"Спасибо, всё очень вкусно.","Thank you, everything is delicious."
```

## Kaikki / Wiktextract

The importer reads the per-language JSONL from [kaikki.org](https://kaikki.org/dictionary/) (English Wiktionary
data, CC BY-SA and GFDL; see [VOCABULARY_SOURCES.md](VOCABULARY_SOURCES.md)).

- One entry per line, with `word`, `pos` and `senses[].glosses`.
- **Form-of entries** (inflected forms that point to a lemma) are skipped as entries. Forms come from the lemma's
  `forms[]` instead. Metadata pseudo-forms (`canonical`, `romanization`) are not treated as inflections, but the
  `canonical` form (e.g. stressed Russian) becomes the display form.
- Examples use `translation`, falling back to the older `english` field.
- The first `sounds[].ipa` becomes the pronunciation. Kaikki lists several IPA variants for some languages, for
  example Hà Nội and Saigon for Vietnamese; edit the word if you want a specific one.

The full per-language files are hundreds of megabytes. Filter them on the server first:

```bash
node scripts/kaikki-filter.mjs kaikki.org-dictionary-Russian.jsonl.gz --lang ru \
  --freq ru_50k.txt --top 5000 --pos noun,verb,adj,adv --out ru-top5000.jsonl
npm run cli -- import ru-top5000.jsonl --lang ru --format kaikki
```

`kaikki-filter.mjs` keeps entries with real senses (not form-of entries). With `--freq`, it keeps only words
within the top N of a frequency list (`--top`, default 20,000), also matching the entry's inflected forms, because
frequency lists count surface forms. It streams plain or `.gz` input of any size, or stdin (`-`). In Docker, put
the result in `/data/imports` and run `docker compose exec app node server/cli.ts import /data/imports/… --lang ru`.

## Frequency lists

A frequency list does not create words. It **ranks the words you already have**, so new words are introduced in
order of usefulness.

- **Columns:** a word and a rank (`rank`), or a count (`count`, `frequency`, `ipm`). Two-column `word count` files,
  such as FrequencyWords, are detected automatically. Without a rank column, rows are ranked in file order.
- **Matching:** words are matched to entries by lemma **and by inflected form**. Each entry takes the best rank among
  its forms: Russian *воду*, *воды* and *вода* all rank the entry *вода*.
- **Source type:** spoken corpus, subtitles, written corpus or mixed. Choose it on import. Subtitles are the closest
  free approximation of conversational frequency.
- **Several lists:** if you import more than one list for a language, choose which one drives the order in
  Settings → Learning → *Frequency source*. Otherwise the best rank across lists is used.

The check before importing reports how many rows matched your words and how many entries will get a rank.

## Checks before import

| Check | Result |
|---|---|
| Missing word or meaning, or a word with no letters or digits | Row reported as an error and skipped |
| Same word, same meaning already present | **Duplicate:** skip (default), merge new details into the existing word, or create a separate entry |
| Same spelling, different meaning (e.g. ru *замок*, "castle" and "lock") | **Homograph:** a separate word (recommended), added as another meaning, or skipped. You can decide per row |
| Repeated in the file | The first occurrence wins; later ones are reported |
| Unknown part of speech | Stored as `other`; matches existing words of any part of speech when checking for duplicates |

Normalisation: text is NFC-normalised. Stress marks are stripped from `lemma`, but other accents are kept: *más* and
*mas* are different words.

## Exports

- **Vocabulary**, per language, as CSV (for spreadsheets) or `vocabbuilder-v1` JSON. Use Settings → Data and
  backups → Export, or `GET /api/export/vocabulary?lang=ru&format=csv|json`. The JSON export contains every sense,
  form, example (with its source), expression, tag and inflection table, and imports again unchanged, on this server
  or another.
- **All learning progress** as JSON: every review log, attempt, card state, session and setting
  (Settings → Data and backups → Export, or `npm run cli -- export-progress out.json`).
