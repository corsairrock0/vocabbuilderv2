# Sentences for words left without any (VocabBuilder)

VocabBuilder teaches the most frequent words of six languages. Each word should have up to three example sentences,
used for fill-in-the-blank practice. Some words were left with none: their sentences were dropped in passes that took
politics, war, violence, crude content and other left-out topics out of the app, or no source ever had one. The owner
asked: **"Create new AI-generated sentences for the words without sentences and keep the words."** You write them.

## What to write

For each listed word, write **two** sentences (one is acceptable when a second would have to repeat the first).
Each sentence:

- uses the word **once**, in one of its listed meanings (set `"sense"` to that meaning's number, from 0), written
  exactly as one of its listed forms (`"target"`), preferably a natural, common form;
- is short and everyday: 4–12 words (Vietnamese up to about 20 syllables), no digits (write numbers as words);
- is natural in the set's variety: Colombian Spanish (tú/usted and ustedes, never vosotros), Brazilian Portuguese
  (você, estar + gerund), Southern Vietnamese (Saigon usage), Moscow Russian, Kyiv Ukrainian (no Russianisms unless
  the word itself is one), Warsaw Polish;
- has a faithful, natural English `"translation"`.

## Content rules (they still apply)

- No politics, war or violence described: no real politician, party, government, country in conflict, war, battle,
  attack, victim or casualty, and nothing graphic. No living people; no brands. Never Africa, India, the Middle East
  (Turkey included), Islam, the Bible, God or religious holidays; nothing crude.
- Many of these words are themselves about terrorism, Nazism, fascism, occupation, genocide, conscription and the
  like. Give them **calm, general sentences** that use the word without telling of any real event, side or country:
  a definition-like statement ("Terrorism is a serious crime"), a history lesson, book or museum mentioned in general
  terms ("Our teacher explained the word «fascism»"), or another listed meaning where one exists (Polish *terror*
  for a strict regime at home, Ukrainian *окупація* for a cat taking over the sofa, Spanish *guerrillero* in a game).
  Never touch the war in Ukraine; never name a real regime, leader or conflict.
- A word whose listed meaning is wrong or that is not really a word of the language (a fragment of a name, a bound
  syllable): write the most natural sentence you can with one of its listed forms, and say so in `"note"`.

## Files and commands (from /home/claude/added, with `PATH=/opt/node24/bin:$PATH`)

- The words: `words/<lang>.jsonl`, one per line: lemma, pos, rank, glosses (the meanings, numbered from 0) and forms.
- Write your sentences to `out/<lang>.jsonl`, one JSON object per line, appending as you go:
  `{"lemma":"terrorismo","pos":"noun","rank":2731,"text":"…","translation":"…","target":"terrorismo","sense":0,"note":"optional"}`
  (copy lemma, pos and rank exactly from the word list).
- `node check.mjs <lang>` checks every line and lists the words still without a sentence. Fix every problem. Read the
  warnings: a politics keyword is fine only when the sentence is calm and general.

Do not edit any other file. Finish when the check shows 0 problems and no words without a sentence for each of your
languages, then report briefly: sentences written per language and anything the owner should know.
