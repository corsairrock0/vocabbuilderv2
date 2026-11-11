# Reviewing meanings and sentences

VocabBuilder teaches the 6,000 most frequent words of six languages: Colombian Spanish (es), Brazilian Portuguese
(pt), Southern Vietnamese (vi), Moscow Russian (ru), Kyiv Ukrainian (uk) and Warsaw Polish (pl). Each word has
English meanings (copied from Wiktionary, often noisy) and up to three example sentences (from Tatoeba, treebanks, or
written by an AI). Learners see each meaning with its sentences, and **sentence questions blank the word out of a
sentence and quiz the meaning that sentence shows**. So every sentence must use the word in one of its listed
meanings, and every listed meaning needs at least one sentence.

You review one chunk of words. Your input file has one block per word:

```
@424 embargo · noun m
S1 embargo
S2 trade embargo
S3 distraint
S4 seizure, freezing (juridical detention of goods)
E1 Él prometió volver y sin embargo no lo hizo. | He promised to return and yet he didn't. [tatoeba] ⟨in "sin embargo" = however⟩
E2 Es sin embargo cierto. | It is none the less true. [tatoeba] ⟨in "sin embargo" = however⟩
C sin embargo = however, nevertheless (93% of uses)
```

- `S` lines: the current meanings, numbered. A `[note]` holds grammar or usage information.
- `E` lines: the current sentences: text | English translation [source]. A `⟨in "…"⟩` hint means the word sits
  inside a known fixed combination there. A sentence without a translation shows only the text.
- `C` lines: fixed combinations that account for a large share of the word's uses in a corpus.
- `O` lines: other entries in the full list (often in another reviewer's chunk) that share this word's spelling, that
  this word is a form of, or that are a form of this word (это next to этот, всё next to весь, его next to он).
- For Russian and Ukrainian, the head shows the stressed form; the lemma follows in parentheses when it differs.

## What to decide for each word

1. **Meanings: merge and trim.** Keep the meanings a learner needs, most common first: usually 1 to 4, never more
   than 5. Order them by how often the word is used in each meaning today in the variety above, not by the
   dictionary's order (often historical): the first meaning is the one the app teaches first and asks most.
   - Merge near-duplicates into one meaning ("embargo" + "trade embargo").
   - Drop meanings that are rare, archaic, obsolete, regional outside the variety above, highly technical, or that
     belong to a different word with the same spelling (a noun's meanings on a verb entry; a homograph with another
     stress than the head shows, such as му́ка "torment" on мука́ "flour").
   - **Add a common meaning that is missing** when you know the word is mostly used that way (Russian стать:
     "to become" is missing while the list has rare meanings). Fix a meaning that is plainly wrong.
   - Write each meaning as a short English gloss a learner understands (1 to 10 words), with a short `[note]` only
     when it helps: grammar (`[+ genitive]`, `[perfective]`), register (`[colloquial]`, `[formal]`) or region.
   - **Glosses and notes are shown in quizzes that ask for the word**, so they must not contain the word or its forms,
     and should contain no other target-language text. A short usage example may follow the gloss as
     `(<phrase> = <English>)`, for example `at, in (certain places: на почте = at the post office)`; the app shows
     these on the word page only, never in quizzes. Notes stay English (`[+ genitive]`, not `[plural: люди]`: the word
     page already shows the inflection table). The one exception is a `used in «…»` meaning (below).
   - **Related entries (`O` lines).** Each meaning belongs to one entry. When one of this word's forms has its own entry
     in the list, that form's own meanings belong there: этот keeps "this, these" (with a noun) and leaves standalone
     это "this, that, it" to the это entry; весь leaves "everything" (всё) to the всё entry. When this entry is such a
     form and lacks the meaning that makes it frequent (это listed only as "uh, er", всё listed only as "still"), add
     that meaning here. A form that is just an inflection of this word in its own meaning stays here (его "him" under
     он, while possessive его "his" belongs to its own entry).
   - Function words get their main grammatical uses as meanings (Spanish que: "that, which (relative pronoun)",
     "that (joins a clause)", "than (in comparisons)").
2. **Fixed combinations.** A combination of the word with another word that has its own meaning, different from the
   parts (Spanish sin embargo "however", Portuguese no entanto, Russian потому что, Polish mimo że), is not a meaning
   of the word. List up to 3 common ones in `C` lines so they appear under the word. Do not list ordinary word groups.
   - Paired forms (Russian и… и, ни… ни; Spanish ni… ni) are combinations: list them in `C` lines.
   - A phrase in which the word keeps its own meaning (Spanish tener cuidado "to be careful" under cuidado "care",
     tener sueño under sueño) is not a fixed combination either: keep its sentences under that meaning, and give the
     phrase as a usage example if it helps: `care, caution (tener cuidado = to be careful)`.
   - A combination that only strengthens or repeats the word's own meaning (Russian всё ещё "still" under ещё "still")
     is not a fixed combination for this rule: sentences with it stay under that meaning.
   - If the word is (almost) only ever used inside one combination, its meaning says so: `used in «sin embargo»
     (however)`. Then sentences with that combination fit that meaning.
3. **Sentences.** Give each existing sentence the number of the (new) meaning it shows. Drop it instead when:
   - the word is part of a fixed combination with a different meaning there (and its meaning is not the
     "used in «…»" kind);
   - the matched word is really a different word with the same spelling or form (Russian стали from сталь "steel"
     on стать "to become"; Spanish como "I eat" on como "like, as");
   - it shows a meaning you dropped;
   - it is unnatural, offensive, or wrong, or its translation is wrong in a way a corrected translation cannot fix;
     sentences that take sides on politics or religion, dwell on violence, or name real public figures also go
     (`bad`). A word whose meaning is about such things (comunista, asesinar, guerra) still keeps or gets plain,
     neutral sentences about it.
   - A personal name that only looks like the word (Том for тот, Sami for сам) is `other word`.
   - Topics: new sentences (`N` lines) must not mention Africa, India, the Middle East, Islam or Muslims, or the
     Bible and biblical figures; when a place or culture fits, use Europe, East or Southeast Asia, or North America.
     Existing sentences that mention these are replaced by a separate pass: judge them on meaning only here.
   - A sentence built on forms the variety does not use is `bad`: vosotros forms for Colombian Spanish, European
     Portuguese forms (estás a fazer, tu with a 2nd-person verb where Brazil uses você) for Brazilian Portuguese,
     Northern-only words for Southern Vietnamese. Colombian voseo (vos querés) is regional: keep it if otherwise good.
   You may correct a kept sentence's English translation when it is wrong or misleading.
4. **Every meaning gets a sentence.** For each kept meaning without a kept sentence, write one: natural and everyday,
   4 to 12 words, in the variety above, using the word once and clearly in that meaning, with an accurate English
   translation. Give the exact form of the word as it appears in the sentence. Russian and Ukrainian without stress
   marks. No real people, politics or violence.

## Checking against dictionaries

Judge every meaning against the standard dictionary of the language and against how the word is used today:
Spanish — the RAE's Diccionario de la lengua española, with the Diccionario de americanismos for Colombian use;
Brazilian Portuguese — Houaiss, Aurélio and Michaelis (Priberam covers both varieties; mind its Brazil labels);
Polish — Wielki słownik języka polskiego and the PWN Słownik języka polskiego; Russian — the Большой толковый
словарь and Ozhegov–Shvedova; Ukrainian — СУМ-20 and СУМ-11; Vietnamese — Hoàng Phê's Từ điển tiếng Việt, with
Southern use. Fix glosses that do not match the dictionary sense, and drop senses the dictionary marks obsolete,
dialectal (outside the variety) or narrowly technical.

When you are unsure — a meaning you don't recognise, a gloss that may be wrong, a rare or regional use, or which
meaning is the most common — look the word up, for at most 15 words per chunk:
- Russian: fetch `https://gramota.ru/poisk?query=<word>`.
- Ukrainian: fetch `https://goroh.pp.ua/Тлумачення/<word>` (СУМ-20 and СУМ-11).
- Portuguese: fetch `https://dicionario.priberam.org/<word>`.
- Spanish, Polish and Vietnamese: their dictionary sites refuse automated fetching (RAE, PWN, WSJP and the
  Vietnamese dictionaries). Use WebSearch with the word and the dictionary (`banco dle.rae.es`, `zamek sjp.pwn.pl`,
  `bàn từ điển tiếng Việt`) and read the result snippets.
Do not retry a site that refuses. Note each lookup in the word's block: `! looked up (<dictionary>): <what it
settled>`.

## Output format

Write the output file named in your task. One block per input word, in the same order, blocks separated by a blank
line. Every input word must have a block.

```
@424
S used in «sin embargo» (however, nevertheless) <- new
S embargo (ban on trade with a country) <- 1,2
S seizure of property by court order [law] <- 3,4
E1 1
E2 1
C sin embargo = however, nevertheless
N2 El país vive bajo un embargo comercial desde hace años. | The country has been under a trade embargo for years. {embargo}
N3 El juez ordenó el embargo de su casa. | The judge ordered the seizure of his house. {embargo}
```

(93% of embargo's uses are «sin embargo», so its first meaning is the "used in" kind and those sentences stay. For a
word whose combination is only a minority use, the combination goes in a `C` line and its sentences are dropped as
`combination`.)

- `@<id>` first, exactly as in the input.
- `S <gloss> [<note>] <- <old numbers>`: the kept meanings in order; they are numbered 1, 2, 3… by their order.
  `<- 1,2` names the input meanings it replaces; write `<- new` for an added meaning.
- `E<k> <n>`: input sentence k shows new meaning n. `E<k> x <reason>`: drop it, reason one of `combination`,
  `other word`, `dropped meaning`, `bad`. Every input sentence needs one `E` line.
- `T<k> <translation>`: optional corrected English translation of kept input sentence k.
- `C <combination> = <meaning>`: up to 3 fixed combinations (none is fine).
- `N<n> <sentence> | <translation> {<form>}`: a new sentence for meaning n; `<form>` must appear in the sentence
  exactly as written.
- `! <note>`: optional, a short note about anything unusual (a wrong word in the list, for example).

When a word needs no change, still write its `S` lines (copying the glosses) and an `E` line for each sentence.

Work through the file in parts and append to the output as you go. When finished, run the checker given in your task
and fix everything it reports.
