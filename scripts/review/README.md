# Meaning review and topic tools (build-time only, not used by the app)

These scripts drive the review that checks every word's meanings against its example sentences, and the pass that
replaces sentences on left-out topics, the one that replaces crude sentences, the one on politics, war and living
people, and the one that writes sentences for the words those passes left without any. Their results are
`data/review/<lang>.jsonl`, `data/review/topics/<lang>.jsonl`, `data/review/crude/<lang>.jsonl`,
`data/review/politics/<lang>.jsonl` and `data/review/added/<lang>.jsonl`, which `scripts/freq/build.mjs` applies. See
`docs/FREQUENCY_SETS.md#meaning-review`.

They were run from a working folder, `/home/claude/review`, and the paths in them point there (the Wiktionary TSVs
and corpora for `export.mjs` were under `/tmp/fs-test`). Copy them into such a folder, or change the paths, to continue.

| File | What it does |
|---|---|
| `REVIEW.md` | The rules and output format a reviewer (an agent) follows for one chunk of words |
| `export.mjs` | Builds the review input from a set: each word with its meanings, sentences, corpus hints about fixed combinations (`C` lines) and related entries (`O` lines) |
| `slice.mjs` | Cuts the input into a chunk (`in/<lang>-FFFF-TTTT.txt`) |
| `check.mjs` | Checks a chunk's output: every sentence decided, every meaning with a sentence, forms present as whole words, no target-language text in Russian/Ukrainian glosses |
| `consolidate.mjs` | Turns checked outputs into `data/review/<lang>.jsonl`, moving usage examples out of glosses; words fixed one by one outside the chunks come from `extra/<lang>.jsonl` (es *excitar*, *ponerle*, pl *francuz*) |
| `plan.mjs`, `plan.json` | Which chunks are done (`node plan.mjs status`): 44 of 180 when the owner ended the review in November 2026. Ranks 1–100 by Opus, the other chunks shipped before 2.0.0 by Sonnet, the last 25 chunks (first shipped in 2.0.0) by Opus |
| `rebase/` | Applying the last 25 chunks (2.0.0), whose words already had crude, politics and added-sentence decisions made on their old meaning lists: `report.mjs` and `senses.mjs` show where those decisions meet the reviewed words, `apply.mjs --write` moves their meaning numbers to the reviewed lists (`hand.json`: the ones decided by hand; `new-decisions.json`: keep or drop for new sentences a detector matches), `meanings-apply.mjs` takes out crude-meaning decisions the review made unnecessary, `list-new.mjs` lists the new AI-written sentences for a read, `verify.mjs` runs the build's steps and lists what needs a look, `grammar-exclude.mjs` lists annotations whose sentence is gone |
| `TOPICS.md`, `topic-export.mjs` | The topic pass: export detected sentences, check decisions, save them to `data/review/topics/` |
| `CRUDE.md`, `crude-*.mjs` | The crude-sentence pass (1.8.2), run from `/home/claude/crude`: `crude-scan.mjs` and `crude-scan2.mjs` list the sentences the detector (`scripts/freq/crude.mjs`) matches, `crude-show.mjs` shows them and the untranslated sentences to read through, `crude-check.mjs` checks a reviewer's decisions, `crude-apply.mjs` saves them to `data/review/crude/` |
| `POLITICS.md`, `politics-*.mjs` | The pass on politics, war, violence and living people (1.8.2), run from `/home/claude/politics`: `politics-scan.mjs` lists the sentences the detector (`scripts/freq/politics.mjs`) matches and the untranslated ones to read through, `politics-scan-x.mjs` adds the matches of keywords added later, `politics-make-m.mjs` adds sentences reviewers noted outside the lists, `politics-show.mjs` shows them, `politics-check.mjs` checks a reviewer's decisions (`--read-through` for a read-through-only file), `politics-apply.mjs` saves them to `data/review/politics/` |
| `ADDED.md`, `added-*.mjs` | Sentences for words left without any (1.8.3), run from `/home/claude/added`: `added-words.mjs` lists the words that have no sentence once the other passes have run (the words that name a left-out subject were then moved by hand to a separate list for the owner's decision), `added-check.mjs` checks the written sentences (`--topics` for that list), `added-apply.mjs` saves them to `data/review/added/` |
| `nlines.mjs` | A second check of new sentences and corrected translations by a reviewer that did not write them |
