# AI-written example sentences

These sentences were written by an AI (Claude, by Anthropic) in November 2026, for the words in the most frequent
words sets that have no sentence in any open collection (Tatoeba, Universal Dependencies treebanks). They were not
taken from any source, and no native speaker has checked them.

- One file per language: `<lang>.tsv` with the columns `lemma`, `pos`, `sentence`, `target` (the word exactly as it
  appears in the sentence) and `translation` (English).
- They were written to the rules in `docs/FREQUENCY_SETS.md#cloze-sentences`: short, everyday, the word used once in
  the meaning the app shows, in the regional variety of each set. A script then checked every row (the word appears
  exactly once, in a form from its table where it has one; no digits; length), and a second AI pass, separate from
  the writing, reviewed each language for grammar, naturalness and meaning.
- `scripts/freq/build.mjs` adds them only to words that have no other sentence, and skips any row whose blank would
  be ambiguous or whose form is not in the word's table. The app labels them as AI-written. Build with
  `--no-ai-sentences` to leave them out.

To correct a sentence, edit its row and rebuild the set, or edit the sentence on the word's edit page in the app.

Five later passes also write sentences, kept elsewhere because they are decisions about existing words rather than
sentences for uncovered ones: the meaning review (`data/review/<lang>.jsonl`, one new sentence for every meaning left
without one), the replacement of sentences on left-out topics (`data/review/topics/<lang>.jsonl`), of crude sentences
(`data/review/crude/<lang>.jsonl`) and of sentences on politics, war or violence or that name living people
(`data/review/politics/<lang>.jsonl`), and the sentences for the words those passes left without any
(`data/review/added/<lang>.jsonl`, 1.8.3). All are labelled AI-written in the app and in the sentence credits. See
`docs/FREQUENCY_SETS.md#meaning-review` and the sections after it.
