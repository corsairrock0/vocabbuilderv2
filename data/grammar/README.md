# The exact cells of example sentences

Grammar explanations (since VocabBuilder 1.8.1, `shared/grammar.ts`) use the files in this folder to name the one case,
or the one tense, mood and person, that a word is in **in a given sentence**:

| File | What it is | Made by |
| --- | --- | --- |
| `src/<lang>.jsonl` | the annotations as delivered, one JSON object per line, for `uk`, `ru`, `pl`, `es` and `pt` | annotation, below |
| `<lang>.json` | what the server reads: the checked annotations of the language, keyed by sentence | `scripts/grammar/build.mjs` |

Many forms fill several cells of a word's table: Ukrainian *українське* is the nominative and the accusative neuter
of *український*, Spanish *hablamos* the present and the preterite. The explanation rules in `shared/grammar.ts`
narrow such a form by the sentence when they can (a preposition, a time word, a subject pronoun…); when they can't,
the explanation names every possibility. For the example sentences of the frequency sets where the form fills more
than one cell, the cell the sentence uses and the reason are annotated offline, so the feedback can say, for
"У нього українське громадянство.": “українське” is the nominative neuter of “український”: it describes
“громадянство” (citizenship), the thing he has in “у нього …” (he has); what someone has is the subject there, so
it is nominative.

The cells and reasons are **AI-annotated**: Claude agents choose each cell and write each reason for Lango. No native
speaker checks them. The cells and reasons are © 2026 Lango, all rights reserved (see
[LICENSE](../../LICENSE)); the sentences in the keys are the example sentences of `data/frequency/<lang>.json`, whose
sources and licences are listed in `data/frequency/<lang>-sentence-credits.tsv`.

Annotated sentences in this version (every example sentence of the frequency sets whose target fills more than one
cell, except those the rules settle reliably; "no note" = cell `-`, the word only looks like a form of this one):

| Language | Sentences | of which no note |
| --- | --- | --- |
| Ukrainian (`uk`) | 3,044 | 80 |
| Russian (`ru`) | 3,339 | 35 |
| Polish (`pl`) | 4,192 | 26 |
| Spanish (`es`) | 829 | 41 |
| Portuguese (`pt`) | 696 | 52 |

All were annotated by Claude Opus 5.5: the first 12,090 by agents in 43 batches (2026-11-08/09), and in 1.8.2 the 90
sentences that replaced crude ones and the 972 that replaced sentences on politics, war or violence (see
`docs/FREQUENCY_SETS.md#crude-sentences` and the section after it), while the 1,254 annotations of the sentences they
replaced, of sentences dropped and of words left out were removed. In 1.8.3 the 74 sentences written for words left
without any were annotated too (31 Ukrainian, 20 Russian, 23 Polish), and one more Ukrainian sentence that replaced
a sentence on politics, while the annotation of a sentence that replacement took out was removed. On the 1,199 sentences taken from local Universal
Dependencies treebanks (whose case and tense features the annotators never saw) the annotations agree with the
treebank on 1,192 (99.4 %); most of the 7 differences are treebank slips or forms with two accepted analyses.

In 2.0.0 the rest of the meaning review was applied to the sets (`docs/FREQUENCY_SETS.md#meaning-review`). The 90
annotations of sentences it dropped or replaced were removed, and 218 sentences that needed an annotation and had
none were annotated by Claude Fable 5.2 (20 Spanish, 21 Portuguese, 38 Ukrainian, 56 Russian, 83 Polish): the review's
new sentences, and 107 verb forms of Ukrainian (19), Russian (31) and Polish (57) that fill two cells of the verb
tables those languages got in 1.8.4. Such a form is the present of one verb and the future of its perfective
look-alike (Polish *wynosi*), or a command spelled like the future (Russian *договоритесь*). Since 2.0.0 an
annotation may name a verb's cell in these languages too, so the feedback says "“wynosi” is the present (on, ona,
ono) of “wynosić”" and why, instead of listing both.

## A record

```json
{"lemma": "український", "target": "українське", "sentence": "У нього українське громадянство.", "cell": "nom|n",
 "why": "it describes “громадянство” (citizenship), the thing he has in “у нього …” (he has); what someone has is the subject there, so it is nominative."}
```

- `lemma`, `target`, `sentence`: the word's dictionary form, the form in the sentence and the sentence, as in the
  frequency set (stress marks, capitals, spacing and punctuation don't matter).
- `cell`: a key of the word's table (`shared/paradigms.ts`): `nom|n`, `acc.anim|m`, `gen|pl.vir`, `ind.impf|1s`,
  `imp.neg|3s`… Negative imperatives are stored in the tables with their negation ("não obrigue", "no acabe"), so an
  `imp.neg|…` cell is right when it holds *no*/*não* + the target. Or `-` ("no note"): the sentence's word only looks
  like a form of this one (the noun *parte* filed under *partir*, a name, an imperative filed under a noun) or fills a
  cell the table lacks (a vocative, the Russian locative in *-у*); that sentence then gets no grammar note and nothing
  is marked in the table, rather than a list of what the form could be. `why` then says what is wrong (not shown).
- `why`: one sentence that continues "“<target>” is the <label> of “<lemma>”: …", starting in lower case and quoting
  the words that decide it.

## Building

The build can be re-run at any time and depends only on `src/` and `data/frequency/`:

```bash
node scripts/grammar/build.mjs --import <folder>   # copies <folder>/<lang>.jsonl into src/ (same name: replaced), then builds
node scripts/grammar/build.mjs                     # builds from src/ as it is
```

It checks every record against `data/frequency/<lang>.json`: the lemma has a table there (or a built-in one, as Ukrainian
*що* and Russian *что* have; `paradigmFor`), the table has the cell, the cell holds the target (*no*/*não* + the target
for a negative imperative), and `why` is not empty. These are the same checks the app makes before it uses a cell
(`exactCellOf`). A record that fails is printed with its line and reason and dropped; the others are written. Records
whose sentence and target are not one of the word's example sentences in the set are kept but counted as *unmatched*:
the app only meets a sentence written that way. When the same sentence and target come twice, the later line wins (a
warning names both lines when they differ). It prints, per language, the records read, kept, dropped, replaced and
unmatched. The same input always gives the same bytes.

A running server picks up a new `<lang>.json` without a restart (it re-reads a file when it changes); a missing file
only means there are no annotations for that language. The Docker image ships `data/grammar/*.json` and leaves `src/`
out, so rebuild the image after importing. `VB_GRAMMAR_DIR` points the server to another folder.

## How the app uses them

Sentences reach an exercise with their annotation as `exact: { cell, why }`: the context and production cloze
exercises of study sessions (choosing the form, typing it, and their follow-ups) and the sentence-gap practice, also in
the rounds of Comprehensive sessions. The server sends a cell only when the word's table in the database confirms it.
The feedback then names that cell alone with its reason, and the table shown with it marks only that cell; the hint's
"needed form" names it too. A sentence without an annotation is explained by the rules as before. See
[docs/LEARNING_ENGINE.md](../../docs/LEARNING_ENGINE.md#grammar-explanations-sharedgrammarts).

## Format

`<lang>.json`: `{format: "vocabbuilder-grammar-v1", language, version, credit, count, cells}`, where `cells` maps a key
to `[cell, why]`, one entry per line, keys sorted; `version` is a hash of the entries. A key is `exactKey(language,
lemma, target, sentence)` from `shared/grammar.ts`: the language and the three texts in comparison form (stress marks
removed, lower case, one apostrophe, no punctuation, single spaces; Russian ё as е), joined by `|`:

```json
{"format":"vocabbuilder-grammar-v1","language":"uk","version":"…","credit":"…","count":1,"cells":{
"uk|український|українське|у нього українське громадянство":["nom|n","it describes “громадянство” (citizenship), …"]
}}
```
