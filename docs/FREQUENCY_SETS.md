# The 6,000 most frequent words per language

VocabBuilder ships one set per language with that language's 6,000 most frequent words, less a few dozen crude
words left out at the owner's request (see [Crude sentences](#crude-sentences)). The words come in frequency order. Each word has its definitions and part of speech from **English Wiktionary**. Words that inflect have their
**declension or conjugation table**, and every word has up to three **example sentences** for fill-in-the-blank
practice. The sets live in `data/frequency/` and are built by `scripts/freq/build.mjs` from the open sources listed
below. The ranks come from the frequency lists, the definitions from Wiktionary, the tables from morphological
dictionaries, and the sentences from Tatoeba and annotated text collections. Six parts involve an AI, and the app
labels every AI-written sentence as such: sentences for the words that no collection has a sentence for (see
[Cloze sentences](#cloze-sentences)), the [meaning review](#meaning-review) that checks each word's meanings against
its sentences, the replacement of [sentences on left-out topics](#sentences-on-left-out-topics),
[crude sentences](#crude-sentences) and [sentences on politics, war or living people](#sentences-on-politics-war-or-living-people),
and [sentences for the words those passes left without any](#sentences-for-words-left-without-any).
The build applies the same documented rules to every word, and two full builds give byte-identical files.

## Loading a set

- **Today:** when a language has no words yet, the *Add words to start* card offers *Load the 5,971 most frequent
  words* (the number is that set's size).
- **Settings → Data and backups → Most frequent words:** choose *Load* next to any language. *Sources and skipped words*
  opens that set's build report.

**Updating a set.** A new version of the app can bring a corrected set. Settings → Data then shows *Update* next to the
language, and Today says so. Updating makes a backup first, then gives every word that came from the earlier
set the new set's meanings, sentences, combinations and forms, and a table to a word that had none (in 1.8.4, the
Russian, Ukrainian and Polish verbs; in 1.8.5, Spanish and Portuguese nouns, adjectives, determiners and pronouns).
Since 1.8.5 the set's forms are replaced, so a form a new version drops (a misspelling) leaves the word; forms you
added stay. Your progress stays, sentences that are still there keep their
practice history, and words you edited stay exactly as you made them. Words the new set adds are added. Words the new
set leaves out (since 1.8.2, [crude words](#crude-sentences)) are removed, unless you've started learning them or added
to them (a note, a meaning or sentence of your own): those stay with your progress and their meanings, but lose the
set's sentences, combinations and rank. A word that a starter set or your own import brought in loses only what the set
added. An update cannot be undone from the imports list; restore the backup it made instead.

Loading is one transaction, and you can undo it from the list of recent imports. Words you already have, for example
from a starter set, are **merged, not duplicated**. They gain the set's senses and forms, and they take its frequency
rank. The set becomes the language's frequency source, unless you already chose one in Settings → Learning. New words
are then introduced in frequency order, at your daily new-word pace. Starter words that are not in the set (mostly set
phrases such as *buenos días*) have no frequency rank, so they come after the ranked words. To study them early, use
*Customise a session* and pick one of their topics, such as greetings.

Proper nouns, letters, affixes, abbreviations and symbols are never included. Every set also has a report in
`data/frequency/reports/<lang>.md`. It lists the sources, the coverage, and every frequent lemma that was skipped
because no dictionary defined it.

## What each set is built from

| Language | Frequency list (and why) | Lemmatization | Definitions and parts of speech |
|---|---|---|---|
| Colombian Spanish | OpenSubtitles 2018 counts merged with the RAE **CREA** frequency list ([doozan/spanish_data](https://github.com/doozan/spanish_data) `es_merged_50k.txt`). CREA is the Spanish Royal Academy's reference corpus of written and spoken Spanish from Spain and Latin America, and subtitles add conversational language. No Colombia-only list is openly available. | Wiktionary inflection data (doozan `es_allforms.csv`); UD Spanish AnCora treebank for ambiguous forms such as *la* | English Wiktionary extracted by doozan/spanish_data (`es-en.data`, November 2026). The 2022–23 extraction fills the 8 words it lacks, such as the preposition *a*. |
| Brazilian Portuguese | OpenSubtitles 2018 **Brazilian** Portuguese ([FrequencyWords](https://github.com/hermitdave/FrequencyWords) `pt_br`): the largest open list that is specifically Brazilian | [michmech lemmatization list](https://github.com/michmech/lemmatization-lists) (Portuguese); UD Portuguese **Porttinari** (Brazilian news) | English Wiktionary, 2022–23 Wiktextract extraction ([Vuizur](https://github.com/Vuizur/Wiktionary-Dictionaries)) |
| Polish | [wordfreq](https://github.com/rspeer/wordfreq) "large" list, which combines Wikipedia, subtitles, news, web text, Twitter and Reddit (six sources) | PoliMorf/SGJP, the standard Polish morphological dictionary (via spaCy's lookup tables); UD Polish **PDB** | English Wiktionary, 2022–23 extraction |
| Russian | wordfreq "large" list, which combines Wikipedia, subtitles, news, Google Books and Twitter | [OpenRussian](https://github.com/Badestrand/russian-dictionary) inflection tables; UD Russian **SynTagRus** | English Wiktionary, 2022–23 extraction. Stress marks, gender, aspect and tagged forms come from OpenRussian. |
| Ukrainian | wordfreq "large" list, which combines Wikipedia, subtitles, web text, Twitter and Reddit | michmech list (Ukrainian) plus the dmklinger inflection tables; UD Ukrainian **IU** | English Wiktionary, 2022–23 extraction. Where it has no entry: [dmklinger/ukrainian](https://github.com/dmklinger/ukrainian), compiled from English Wiktionary and DBnary (June 2026). Those words are tagged `fallback-dictionary`. |
| Southern Vietnamese | [tabidots/vn-freqs](https://github.com/tabidots/vn-freqs): Leipzig news and web sentences plus OpenSubtitles, **segmented into words** (not syllables). It is the only open list that counts *thời gian* as one word. | none needed. UD Vietnamese **VTB** picks each word's main part of speech (*là* is the copula, not "fine silk"). | English Wiktionary, 2022–23 extraction |

**Why not the Russian National Corpus list?** Serge Sharoff's robust RNC lemma list was the first choice for Russian.
It undercounts several of the commonest words, though: *теперь* appears about 1,000 times and *можно* about 600, while
*потом* appears 56,000 times. *Уже* ("already") is mostly filed under *узко*. The tagging behind it is the likely
cause. For that reason wordfreq, lemmatized as described below, ranks Russian like the other inflected languages.

## How the ranks are computed

1. **Frequency lists count word forms**, but you study lemmas: Polish *roku*, *lat* and *lata* all belong to *rok*. Each
   form's count is shared among the lemmas it can belong to. The candidates come from the morphological lexicon, from
   Wiktionary itself (the form is a headword, or an entry such as "plural of …" points to the lemma), and from
   Wiktionary's inflection lists as a last resort.
2. **Ambiguous forms** are split by a hand-annotated Universal Dependencies treebank whenever the treebank has seen the
   form at least 3 times. Polish *nie* is mostly the particle, not the pronoun *on*, and Portuguese *para* is mostly the
   preposition, not *parar*. Other forms are split by each lemma's overall evidence, iterated to a fixed point. That
   split slightly favours the form's own headword and lemmas whose dictionary form actually occurs.
3. **Proper nouns:** the share of a form that the treebank marks as a name (*Україна*, *Polska*) is not counted. In the
   subtitle lists, character names shared with another language's subtitles (*jack*, *frank*) are subtracted in
   proportion to corpus size. Four names that are also rare dictionary words are left out explicitly: *bob* in
   Spanish and Portuguese, *henry* and *jack* in Portuguese, and *daniel* in Polish.
4. **Pointers are followed:** when Wiktionary's entry for a word only points to another word ("alternative form of
   проєкт", "plural of casa"), the count moves to that word. This is checked per part of speech, so Russian *это*
   used as a pronoun counts for *этот*, while Spanish *mi* keeps its own entry because Wiktionary gives it a meaning
   ("apocopic form of mío, my").
5. **Unaccented spellings** in Polish, Portuguese and Spanish (*moze*, *policia*) are counted with their accented form
   when the list contains it.

The top 15,000 lemmas per language are kept in `data/frequency/ranks/<lang>.json.gz`, with their attested forms and
part-of-speech evidence, so the sets can be rebuilt with newer dictionary data without the frequency sources.

## How definitions are attached

- The **main part of speech** is the Wiktionary section that matches the treebank's most common tag for the word. If
  no treebank evidence exists, it is Wiktionary's first section. Up to 6 senses of that part of speech come first,
  then up to 2 senses each from up to 3 other parts of speech. Those are noted, for example "As a conjunction". When
  the treebank tags a word as a preposition but Wiktionary has no preposition section for it, the adverb or
  conjunction section comes first (Vietnamese *của* "of", Spanish *salvo* "except").
- **Regional senses:** senses Wiktionary labels for the target region come first (*Colombia*, *Latin America*;
  *Brazil*; *Southern Vietnam*). Senses labelled only for other regions (*Spain*, *Portugal*, *Northern Vietnam*) go
  after them and keep their label in the note. Obsolete and archaic senses are dropped unless nothing else exists.
- **Glosses** on the flashcard are short. The words before a long explanation in parentheses are the gloss (*perro*:
  "dog", not "dog (any member of the subspecies …)"); shorter explanations stay, so Spanish *ser* and *estar* keep
  their "to be (…)" distinctions. Grammar notes in square brackets move out of the gloss (*зависеть*: "to depend (on),
  to rely (on)", without "[+ от (genitive)]"). Other glosses longer than about 90 characters are cut at a separator.
  In every case the full Wiktionary text is kept as the sense's definition.
- **Contractions** show their meaning (*ao*: "to the"), with "Contraction of a o" as the note.
- **Not meanings:** letter names ("X, x"), musical notes, chess symbols, Wiktionary's "used other than
  figuratively or idiomatically" notes, and single letters used as abbreviations or symbols are dropped. A word left
  with no meaning is skipped and listed in the report.
- **Forms** are the inflections the frequency list actually attested, up to 24 per word. Russian uses OpenRussian's
  tagged tables instead. A word with an inflection table (below) shows the table instead of this list.
- **Examples** are the cloze sentences described below.

## Inflection tables

Every Russian, Ukrainian and Polish noun, adjective, pronoun and numeral, every Spanish and Portuguese verb, since
1.8.4 every Russian, Ukrainian and Polish verb, and since 1.8.5 Spanish and Portuguese nouns, adjectives,
determiners and pronouns (their gender and number), gets its table where an open source has one. The word page shows
it, *Forms* practice drills it, and the session's *Produce the form* exercise asks for one of its cells.

| Language | Source of the tables |
|---|---|
| Colombian Spanish | [UniMorph Spanish](https://github.com/unimorph/spa), generated from English Wiktionary. Its file stops after 2^20 verb rows, which cuts off *tener*, *querer*, *venir*, *poner* and others, so verbs it lacks come from the [verbecc](https://github.com/bretttolbert/verbecc) templates (derived from Verbiste), read by our own parser. |
| Brazilian Portuguese | UniMorph Portuguese and verbecc, compared cell by cell |
| Polish | PoliMorf 2.1, the standard Polish morphological dictionary, in the [Morfologik](https://github.com/morfologik/morfologik-stemming) Polish dictionary, read by our own decoder; verbs too |
| Russian | [OpenRussian](https://github.com/Badestrand/russian-dictionary) tables, with stress, for nouns, adjectives and verbs. Pronouns and numerals, which OpenRussian lacks, are assembled from the forms annotated in the SynTagRus treebank (no stress marks). |
| Ukrainian | [dmklinger/ukrainian](https://github.com/dmklinger/ukrainian) tables, with stress, taken from the ULIF grammatical dictionary, for nouns, adjectives and verbs; UniMorph Ukrainian or the IU treebank's annotations for the few nouns and adjectives it lacks |

**What a table holds.**

- **Verbs:** the infinitive, gerund and participles, every simple tense of the indicative and subjunctive, the
  conditional, affirmative and negative imperatives, and the compound tenses (*haber* or *ter* + participle).
  Portuguese also has the personal infinitive. Spanish has *vos* forms, used in Antioquia and the Valle del Cauca;
  where a source lacks them, they are derived from the *vosotros* forms (*habláis* → *hablás*). Portuguese forms
  follow Brazilian spelling under the 1990 Orthographic Agreement.
- **Russian, Ukrainian and Polish verbs** (1.8.4): the infinitive; the present (imperfective verbs) or the simple
  future (perfective verbs, whose present forms mean the future), and the one-word future of Ukrainian imperfectives
  (*писатиму*); the past, by gender and number in Russian and Ukrainian (*писав, писала, писало, писали*) and by
  person and gender in Polish (*miałem, miałam, mieliśmy, miałyśmy*); the Polish conditional the same way
  (*miałbym*); the imperative; and the adverbial participles, the impersonal form and the participles where the
  source has them. The table notes the verb's aspect and the compound future (*буду* or *będę* + infinitive).
  Ukrainian short colloquial forms (*пишем*, *писать*) and Polish emphatic imperatives (*bądźże*) are left out.
  Ukrainian *мати* "to have", which the dictionary files only as the noun "mother", has a table written for the app.
- **Spanish and Portuguese nouns, adjectives, determiners and pronouns** (1.8.5): singular and plural, and masculine
  and feminine where the word has both (*seu, sua, seus, suas*; *alemão, alemã, alemães, alemãs*; *niño, niña*); the
  Spanish short form before a noun (*buen*, *algún*, *primer*, *gran*); the neuter of the articles and demonstratives
  (*lo*, *esto*, *isso*); and for Spanish *yo* and *tú* their forms by use (*me*, *mí*, *conmigo*). The forms are those
  English Wiktionary lists for the word, which say nothing about which is which: each one is placed by the spelling
  rules (the feminine of the dictionary form, the plural of either, accents that move: *inglés, ingleses*;
  *canción, canciones*; *animal, animais*; *homem, homens*) and left out when no rule places it, which drops
  diminutives (*coisinha*), other words (*bienes* under *bien*) and misspellings. A feminine that is also crude slang
  is left out. Articles, demonstratives, *uno*, *cualquiera*, *qualquer*, *bom*, *mau* and the possessives with
  irregular feminines (*meu, minha*) have tables written for the app. Words filed under another part of speech get a
  table only when their forms have a feminine: the interjection *bueno* and the prepositions *bajo*, *segundo* and
  *quanto* (also adjectives) have one, *contra* and *sobre* (whose "forms" are the nouns *contras*, *sobres*) don't.
  Spanish 3,817 and Portuguese 3,499 words have one.
- **Nouns:** every case, singular and plural. **Adjectives, pronouns and numerals** are also split by gender:
  masculine, neuter, feminine and plural in Russian and Ukrainian; masculine, neuter, feminine, and virile and
  non-virile plural in Polish. The accusative shows its animate and inanimate forms where they differ. Russian
  adjectives also have their short forms and comparatives.

**Rules the build applies.**

- **Spanish:** a verb's UniMorph table is used when it is complete; otherwise verbecc's, with known slips corrected
  (irregular participles such as *concluido* rather than *concluso*, and accents such as *obtén*). The two sources
  agree on 99–100% of the finite forms of the verbs both have.
- **Portuguese:** UniMorph has stray cells (forms run together, shifted cells) and verbecc has broken ones and
  pre-reform spellings, so every cell is compared. Of 65,191 cells both have, 65,059 agree. The other 132 are decided
  by the ending every verb has there, then by accents; otherwise UniMorph's form is kept. Imperatives are derived
  from the present tenses.
- **Polish:** when the dictionary has homonyms of different genders under one lemma, the gender whose forms are
  most frequent wins. Spelling variants under 1% of the main form's frequency are left out.
- **Russian and Ukrainian:** stress marks are kept, except on one-syllable forms. Russian forms taken from treebank
  annotations, which write *е* for *ё*, get their *ё* back where the set's own words spell it (*её*, *всё*).
- **Verb tables in Russian, Ukrainian and Polish** are attached after the example sentences are chosen, so they never
  widen the search for sentences and a rebuilt set keeps the sentences that were reviewed;
  `scripts/freq/add-verb-tables.mjs` gave the sets built before 1.8.4 the same tables. A Polish verb's dictionary
  forms that are copies of a table form without its Polish letters (*miec*, *mial*: typed so in the texts behind the
  frequency lists) are dropped: 1,101 of them.
- **Forms lists** (1.8.5), the forms a word shows when it has no table, are cleaned in every language after the
  tables are attached: a form that only lacks the accents or letters of another form or of the word is a misspelling
  and goes (*dia* beside *día*, *juz* beside *już*: 312 in Spanish, 204 in Portuguese, 2,280 in Polish), except
  pairs that are both words (Spanish *esta* and *está*, Portuguese *tem* and *têm*) and, in Polish, forms PoliMorf
  gives the word (*największa* and *największą*); a function word keeps only its real variants (Russian *во*, *со*,
  Polish *we*, *ze*, Russian *ж* and *б*, and the case forms of *что* and *що*), which also takes out crude slang the
  dictionary data had under Russian *на* and *по* and the noun forms under Ukrainian *ніж* "than"; an adverb keeps
  its comparatives (*лучше*, *lepiej*) and a quantity word its case forms (*нескольких*). Each report's *Forms lists*
  section gives the counts. `scripts/freq/add-nominal-tables.mjs` gave the sets built before 1.8.5 the same tables
  and lists.
- A word whose forms are all the same is marked *indeclinable* (Polish *menu*, Russian *метро*), and it is left out
  of the drills. A few are marked so by mistake, because their source had only one form: Russian *сколько* does
  decline (*скольких*).

Each report lists the words left without a table. Most are words that Wiktionary files as pronouns or adjectives
but that do not decline (Polish *kiedy*, *tam*; Russian *можно*), inflected forms that have their own entry
(Spanish *eres*, *había*; Portuguese *vamos*), and a few loanwords. Among the verbs: Polish words filed as verbs that
do not conjugate (*można*, *trzeba*, *warto*, *powinien*), four Russian verbs whose OpenRussian rows are empty
(*формировать*, *функционировать*), and Ukrainian *нема* and *катер*, which are not verbs.

## Cloze sentences

Each word gets up to three sentences, chosen to be the everyday sentences a learner is most likely to meet. The word
page lists them with their source, and *Sentence* practice blanks the word out of them.

**Sources**, in order of preference:

1. **Tatoeba** sentence pairs (CC BY 2.0 FR): short, conversational sentences, each with an English translation and
   its Tatoeba sentence number. They come from the per-language decks of
   [Vuizur/tatoeba-to-anki](https://github.com/Vuizur/tatoeba-to-anki). For Spanish, doozan/spanish_data's Tatoeba file
   adds its lemma and part-of-speech tags, and sentences by native speakers rank first.
2. More Tatoeba pairs from the development and test sets of the
   [Tatoeba Translation Challenge](https://github.com/Helsinki-NLP/Tatoeba-Challenge) (CC BY 2.0 FR; its training
   data, which has a non-commercial licence, is not used).
3. **Universal Dependencies treebanks:** hand-annotated news, fiction, web and social-media text, without
   translations. These are AnCora (Spanish), Porttinari (Brazilian Portuguese), VTB (Vietnamese), Taiga and GSD
   (Russian), and LFG and PUD (Polish). The non-commercial SynTagRus, PDB and IU (Ukrainian) treebanks come last, only
   for words that nothing else covers.
4. **AI-written sentences**, only for words that none of the above covers: two per word, written by Claude for this
   app (see below).

**How sentences are chosen.**

- A sentence counts for a word when one of its words is a form of it. Forms in the word's table count too, so
  *kobietami* finds *kobieta*. A form that two words share counts for the word whose dictionary form it is, or else
  for a word that the frequency data gives at least three quarters of its uses. Treebank sentences are matched by
  their annotated lemma and part of speech instead.
- The word must appear exactly once, so the blank is never ambiguous.
- Sentences are ranked by their rarest other word, then by length (4–10 words is best), so short sentences of
  common words come first.
- The three sentences prefer different forms of the word, and a sentence that shares half its words with one already
  chosen is skipped (*Você tem um calendário?* and *Vocês têm um calendário?*). Tatoeba sentences still come before
  treebank text, even when that means a near-copy.
- Treebank sentences of more than 22 words (33 Vietnamese syllables), or with numbers in them, are used only for a
  word that has no other sentence at all.
- Sentences that read as another variety rank lower: European Portuguese (*estou a fazer*, *comboio*) for Brazilian
  Portuguese, and Spain's *vosotros* for Colombian Spanish.
- Sentences with vulgar or offensive words, or about suicide or sexual violence, are left out, except as sentences for
  that word itself; since 1.8.2 those, and every other crude sentence, are replaced or dropped too (see
  [Crude sentences](#crude-sentences)).

**Coverage** (from the reports):

| Language | Inflection tables | Words with sentences from open collections | Words with AI-written sentences only | Words without | Sentences |
|---|---|---|---|---|---|
| Colombian Spanish | 1,100 of 1,109 verbs | 5,949 | 50 | 1 | 17,488 (96% Tatoeba, under 1% AI-written) |
| Brazilian Portuguese | 1,220 of 1,224 verbs | 5,768 | 232 | 0 | 16,939 (94% Tatoeba, 3% AI-written) |
| Polish | 4,008 of 4,041 nouns, adjectives, pronouns, numerals; 1,475 of 1,485 verbs | 5,894 | 106 | 0 | 17,221 (75% Tatoeba, 1% AI-written) |
| Russian | 4,271 of 4,299 nouns, adjectives, pronouns, numerals; 1,224 of 1,229 verbs | 5,994 | 6 | 0 | 17,949 (92% Tatoeba, under 1% AI-written) |
| Ukrainian | 4,345 of 4,362 nouns, adjectives, pronouns, numerals; 1,141 of 1,143 verbs | 5,563 | 436 | 1 | 15,911 (83% Tatoeba, 5% AI-written) |
| Southern Vietnamese | — (words do not inflect) | 4,531 | 1,466 | 3 | 13,632 (60% Tatoeba, 22% AI-written) |

**AI-written sentences.** Some words appear in none of the open collections: mostly news and technical vocabulary,
rare or regional words, and Vietnamese words in general (the Tatoeba deck has about 9,000 Vietnamese sentences and the
VTB treebank about 3,300). For those 2,296 words, Claude wrote two sentences each, 4,592 in all, kept in
`data/ai-sentences/`.

- They follow the rules above where they apply: short and everyday, the word used once in the meaning the app shows,
  in a form from its table, and in the set's regional variety.
- A script checked every row. A second AI pass, separate from the writing, then reviewed each language for grammar,
  naturalness, meaning and translation; it corrected 84 sentences and dropped 2.
- No native speaker has checked them. The app marks each one as an *AI-written sentence* on the word page, in
  sentence practice and in study sessions.
- `--no-ai-sentences` leaves them out of a build.

Five words had no sentence at all after this step (the table's last column but one). Three are Vietnamese syllables
that only occur inside compounds (*sản*, *nghị*, *thự*), one is Spanish *na*, listed as an obsolete contraction but
frequent as colloquial *nada*, and one is Ukrainian *укладення*, whose meaning in the set ("attachment") was wrong.
Since 1.8.3 they have AI-written sentences, with those two meanings corrected, like every other word left without any
(see [Sentences for words left without any](#sentences-for-words-left-without-any)). A word without sentences, such
as one you add yourself, has no *Examples* section, and sentence practice skips it; you can add sentences on its edit
page.

**Credits.** `data/frequency/<lang>-sentence-credits.tsv` gives the source of every sentence: its Tatoeba sentence
number, its treebank and sentence id, or that an AI wrote it. The word page shows each sentence's source and licence,
and links Tatoeba sentences to tatoeba.org.

## Meaning review

Wiktionary lists every sense a word has, in no particular order, and a sentence was matched to a word by its form
alone. So a word could show a rare meaning first (Russian *стать* had no "to become"), lack its main one (Spanish
*cuarto* had no "room"), carry meanings of a different word that is spelled the same, or have sentences where it is
part of a fixed combination that means something else (93% of Spanish *embargo*'s uses are *sin embargo*,
"however"). The meaning review fixes this word by word. A reviewer (Claude) reads each word with its sentences and:

- merges and trims its meanings to the one to five a learner needs, most common first, adding a missing common
  meaning and dropping meanings that belong to another word with the same spelling;
- links each sentence to the meaning it shows, or drops it: the word is inside a fixed combination there, it is
  another word (the name Том is not тот), it shows a meaning that was dropped, or the sentence is unnatural, wrong
  for the variety (Spain's *vosotros*, European Portuguese) or takes sides on politics or religion;
- lists fixed combinations with their own meaning under the word, where they are shown but never quizzed as the
  word's meaning;
- writes a new sentence for every meaning left without one. These are labelled AI-written.

Glosses stay free of the word itself, so a question that shows a meaning never gives the answer away; usage examples
such as *на почте = at the post office* are kept for the word page. A script checks every reviewed word (every
sentence decided, every meaning with a sentence, forms present as whole words) before the build applies it.

The review is in `data/review/<lang>.jsonl` and the build applies it (`--no-review` leaves it out;
`scripts/freq/apply-review.mjs` applies it to sets built without it). It went through the most frequent words first
and **ended with the words below**: the owner stopped it in November 2026 and had everything reviewed by then
applied. In this version (2.0.0):

| Language | Words reviewed | Meanings before → after | Sentences kept | Dropped | New (AI-written) | Combinations listed |
|---|---|---|---|---|---|---|
| Colombian Spanish | 1,202 (ranks 1–700, 1001–1250, 2001–2250, and *excitar*, *ponerle*) | 3,877 → 2,146 | 3,107 | 495 | 674 | 277 |
| Brazilian Portuguese | 950 (ranks 1–700, 1001–1250) | 2,916 → 1,646 | 2,545 | 301 | 517 | 255 |
| Russian | 700 (ranks 1–700) | 1,870 → 1,206 | 1,900 | 200 | 348 | 201 |
| Southern Vietnamese | 700 (ranks 1–700) | 1,932 → 1,285 | 1,864 | 234 | 444 | 384 |
| Ukrainian | 700 (ranks 1–700) | 1,324 → 1,074 | 1,863 | 224 | 264 | 111 |
| Polish | 601 (ranks 1–600, and *francuz*) | 1,418 → 1,019 | 1,612 | 191 | 287 | 151 |

Until 1.9.1 the sets had the first 2,353 of these words (Spanish 902, Portuguese 550, Russian 300, Vietnamese 200,
Ukrainian 200, Polish 201). 2.0.0 adds the other 2,500, from the last 25 chunks (Spanish ranks 301–400 and 501–700,
Portuguese 301–700, Russian 301–700, Vietnamese and Ukrainian 201–700, Polish 201–600):

- Each chunk passed the script's checks (every sentence decided, every meaning with a sentence, forms as whole words).
- These words already had decisions from the later passes (crude sentences and meanings, politics, sentences added
  for words left without any), made on their old meaning lists. Those decisions were moved to the reviewed lists
  (`scripts/review/rebase/`), and the passes below run after the review as before. Eleven meanings on left-out
  subjects (such as Portuguese *atirar* "to shoot" and Vietnamese *súng* "gun") end up without a sentence: the
  meaning stays in the word's list, and no sentence question asks for it.
- The English of every new AI-written sentence of these words was read for the content rules (1,277 reach the sets),
  and those touching a left-out subject (religion, protest, government, war) were rewritten or left out. Unlike the
  earlier chunks, their target-language text had no second read by a reviewer that did not write them.
- The rebuilt sets differ from the ones before only in the 2,494 of these words that changed, and only in their
  meanings, sentences and combinations; with the earlier review data the same scripts rebuild the earlier sets byte
  for byte.

Words not reviewed keep their Wiktionary meanings and sentences as before. For those, a word with several meanings
shows all of them in sentence practice rather than guessing which one a sentence shows. The scripts and the format
stay in place, so more words can be reviewed later; a set rebuilt with more of them reaches your words with *Update*.

## Sentences on left-out topics

At the owner's request, example sentences about Africa, India, the Middle East (Turkey included), Islam or Muslims,
or the Bible (with God as a biblical word, exclamations included) are left out. A detector looks for these topics in
each sentence and in its English translation; each sentence it finds was then checked, and either replaced by an
AI-written sentence set in Europe, Asia or North America that uses the word in the same meaning and form, kept as a
false match (*biblioteca*, the name Adam, Polish *gaza* "gauze"), or dropped when the word itself is on these topics
(*Biblia*, *musulmán*, *árabe*). Sentences the detector finds without a decision are dropped by the build, so none
reaches the app. Decisions are in `data/review/topics/<lang>.jsonl`; the detector is `scripts/freq/topics.mjs`. Since
1.8.3 it also finds the plural of the Bible word in Spanish and Portuguese and the Mother of God in Polish (*Matka
Boska*), which it missed before: Spanish *biblias* handed out for free is dropped, a Polish sentence on a church feast
under *zaobserwować* is replaced, and one under *nadmierny* that the politics pass had replaced is now replaced here,
by the same sentence.

| Language | Replaced | Dropped |
|---|---|---|
| Colombian Spanish | 182 | 41 |
| Brazilian Portuguese | 111 | 43 |
| Southern Vietnamese | 80 | 2 |
| Russian | 146 | 68 |
| Ukrainian | 90 | 47 |
| Polish | 164 | 50 |

Words such as *biblia*, *árabe* or *musulmán* stay in the lists. Left without sentences by this pass, they have had
neutral, plain-fact ones since 1.8.3 (see [Sentences for words left without any](#sentences-for-words-left-without-any)).

## Crude sentences

At the owner's request (1.8.2), crude example sentences are left out too: swearing (mild curses such as *damn* or
*what the hell* included), sex (sexual acts, innuendo, prostitution, pornography, sexual violence), slurs, vulgar
insults and ethnic stereotypes, and crude toilet talk. A detector (`scripts/freq/crude.mjs`) looks for vulgar, sexual
and offensive words in each sentence and in its English translation, and the treebank sentences, which have no
translation, were also read through in full. A reviewer (Claude) checked every sentence found with a textbook test
(would a mainstream adult language textbook print it?) and:

- replaced it with an AI-written sentence that uses the word once, in a clean meaning from its list and where possible
  in the same form (*сука* as a female dog, *голый* as "bare", *pelota* as a ball);
- kept it when the match was false or the sentence is not crude (*pochwalić* "to praise", a rooster, a neutral health
  statement), moving it to the right meaning when it was linked to a crude meaning it does not show; or
- dropped it when the word is vulgar or a slur in every meaning it lists (*mierda*, *porra*, *хуй*, *kurwa*, *đéo*),
  or its only meanings are sexual acts.

Sentences the detector finds without a decision are dropped by the build, so a rebuild never lets an unreviewed crude
sentence into the app. Decisions are in `data/review/crude/<lang>.jsonl`; the replacements are labelled AI-written,
and their grammar notes were annotated like the rest ([data/grammar](../data/grammar/README.md)).

| Language | Replaced | Dropped | Words left out | Meanings dropped | Glosses reworded |
|---|---|---|---|---|---|
| Colombian Spanish | 125 | 72 | 28 | 87 | 24 |
| Brazilian Portuguese | 110 | 79 | 37 | 69 | 34 |
| Southern Vietnamese | 67 | 48 | 23 | 20 | 12 |
| Russian | 75 | 27 | 9 | 37 | 13 |
| Ukrainian | 96 | 56 | 29 | 10 | 10 |
| Polish | 109 | 74 | 35 | 37 | 17 |

**Words left out.** The 161 words that are vulgar, slurs, curses or words for sex in every meaning they list (*mierda*,
*porra*, *хуй*, *kurwa*, *đéo*, and ethnic slurs such as *москаль*) are left out of the sets, so each set now has a
little under 6,000 words; the ranks of the other words do not change. Each word and the reason is listed in
`data/review/crude/<lang>-words.jsonl`, and the build report names them. *Update* in Settings removes them from a
loaded set unless you have started learning them (see [Updating a set](#loading-a-set)). Polish *francuz*,
which the dictionary data glossed "oral sex" first, now means "Frenchman", as all its sentences do.

**Crude meanings.** Meanings that exist only as crude slang or insults are dropped from words that keep other
meanings (*pájaro* keeps "bird" but not its slang for a penis; *сука* keeps "female dog"), and glosses worded with
crude or offensive English are reworded (Polish *wkurzać* "to annoy, to enrage" instead of "to piss off"). Sentences
linked to a dropped meaning lose that link. The same file drops one meaning for the politics pass: Russian *шахтёр*
"someone from the Donbass region" (the word keeps "miner"). Since 1.8.3 it also corrects two kinds of place-name gloss:
Ukrainian *москва*, which the dictionary data matched to a lowercase collective word for Russians used as an insult,
is the city its frequency and sentences come from (*Москва́*, "Moscow"), and four glosses (Ukrainian *київський* and
*киянин*, Russian *киевский*, Polish *kijowski*) spell Kyiv as the sentence translations do. *Update* gives a word the
set created its new written form too. It also corrects meanings that did not fit the sentences written for words left
without any (see below): Spanish *na* is colloquial for *nada*, Portuguese *nazista* gains its main meaning, Ukrainian
*укладення* is the concluding of a contract (an attached file is *вкладення*), and Russian *фашист* loses a garbled
political-slang meaning. Decisions are in `data/review/crude/<lang>-meanings.jsonl`.

## Sentences on politics, war or living people

At the owner's request (1.8.2), example sentences on politics, war or violence, or that name living people, are left
out too, and the Ukrainian set keeps off Russia and Russian themes and the Russian set off Ukraine. Politics means real
politicians, parties, governments and their actions, elections, protests and strikes, disputes between countries,
ideologies and political opinions; war and violence mean wars and battles, armies at war, weapons used on people,
terrorism, murders, shootings, beatings, abuse, kidnappings and suicide. A detector (`scripts/freq/politics.mjs`)
looks for these subjects in each sentence and its English translation, and the untranslated treebank sentences were
read through in full. The keyword list grew in three rounds, as the reviewers' notes showed what the earlier rounds
missed, and sentences they noticed outside the lists were decided too. A reviewer (Claude) checked every sentence
found and:

- replaced it with an AI-written sentence that uses the word once, in the same form where possible, and in another of
  its meanings where that avoids the subject (Portuguese *atacar* for children digging into a cake and *granada*
  "garnet", Russian *бить* for a clock striking);
- kept it when the match was false (a football *partido*, a heart attack, Polish *rząd* "row", a blood test); or
- dropped it when no meaning of the word can be shown without these subjects (*terrorista*, *nazi*, Ukrainian
  *окупант*, Russian *украинский*), or when the word keeps enough other sentences. Words left with no sentence this
  way have had new ones since 1.8.3 (see the next section).

Words whose meaning is political or military themselves (president, election, army, soldier) have calm, general
sentences that name no real country, war, side or politician; a few violent words have clearly fictional ones (a
detective novel, a western). People who died after 1990 were treated as living. Sentences the detector finds without
a decision are dropped by the build. Decisions are in `data/review/politics/<lang>.jsonl`; the replacements are
labelled AI-written, and their grammar notes were annotated like the rest.

| Language | Replaced | Dropped | Kept (false matches) |
|---|---|---|---|
| Colombian Spanish | 893 | 42 | 287 |
| Brazilian Portuguese | 693 | 52 | 264 |
| Southern Vietnamese | 947 | 64 | 177 |
| Russian | 852 | 76 | 257 |
| Ukrainian | 946 | 111 | 288 |
| Polish | 1,573 | 55 | 240 |

A keyword search cannot promise to find every such sentence: a translated sentence on these subjects that uses none of
the keywords can remain. Two such Ukrainian sentences under *східний* were found in 1.8.3 and replaced (nostalgia for
East Germany, and a misspelt question about East Turkestan). You can edit or delete any sentence on the word's page in
the app.

## Sentences for words left without any

At the owner's request (1.8.3), the words that the passes above left without an example sentence, and the five that no
source had one for, keep their place in the lists and have new AI-written sentences, so every word in the six sets now
has at least one. Claude wrote two short sentences for each of these 180 words (one for Ukrainian *ле*), using the
word once, in one of its listed meanings and forms:

- words about subjects the app otherwise leaves out (*terrorismo*, *nazista*, Ukrainian *окупація*, Russian *теракт*,
  Polish *ludobójstwo*) have calm, general sentences that tell of no real event, side or country: a definition-like
  statement, a history lesson or a museum in general terms, or another of the word's meanings (Ukrainian *окупація*
  for a cat that has taken over the sofa);
- words that themselves name a left-out subject (*árabe*, *musulmán*, *biblia*, Ukrainian *російський* and *москва*,
  Russian *украинский* and *киевский*) have neutral, plain-fact sentences, as the owner chose: studying Arabic at
  university, an old Soviet camera, Kyiv's chestnut trees in bloom.

Otherwise the content rules hold: nothing on politics, war or violence is told, no living person or brand is named,
and nothing is crude. Decisions are in `data/review/added/<lang>.jsonl`. The build applies them last, and only to a
word that has no sentence at that point, so a rebuild that gives a word sentences of its own never adds these on top.
They are labelled AI-written, and the Ukrainian, Russian and Polish ones have grammar notes like the rest.

| Language | Words | Sentences |
|---|---|---|
| Colombian Spanish | 20 | 40 |
| Brazilian Portuguese | 20 | 40 |
| Southern Vietnamese | 12 | 24 |
| Russian | 41 | 82 |
| Ukrainian | 62 | 123 |
| Polish | 25 | 50 |

Vietnamese *sản*, *nghị* and *thự* are syllables that occur only inside longer words, so their sentences show them there
(*sản xuất* "to produce", *hội nghị* "conference", *biệt thự* "villa"). Ukrainian *ле*, which is dialectal in every
meaning listed, has a single sentence that says so.

## Known limitations

- **The Wiktionary data for Portuguese, Polish, Russian, Ukrainian and Vietnamese is a 2022–23 extraction.** In that
  extraction, when a Wiktionary sense has sub-senses, only the sub-senses survived. For example, Portuguese *casa*
  starts with "structure serving as an abode of human beings" instead of "house". This mainly affects the most
  elaborate entries, which tend to be the most frequent words. Two of the commonest are affected: Portuguese *não*
  (rank 4) opens with a usage note instead of "not", and Russian *от* (rank 28) with "To denote the starting point of
  the movement of something" instead of "from". Edit those in the app if they bother you. Entries that Wiktionary
  marks only as forms of other words are also missing: some Brazilian spellings (*câmera*, *registro*), comparatives
  such as *melhor*, and many diminutives and feminine forms (*dziewczynka*, *актриса*). Those words appear in the
  reports' skipped lists. Rebuilding with a current Kaikki.org file fixes both problems (see below).
- **Ukrainian:** the 2022–23 extraction has no entry for many common words (*за*, *по*, *вже*, *через*). The
  dmklinger/ukrainian dictionary supplies 1,434 of the 6,000 definitions. Its glosses come partly from Wiktionary
  translation tables, so a few read oddly; *в*, for example, opens with "contained by".
- **Skipped words** are frequent lemmas that no dictionary used here defines. Most are names and abbreviations. Some
  are real words, such as Ukrainian *аж* and *таки*; a newer dictionary may define them.
- **Regional fit:** no open frequency list is Colombian, Southern Vietnamese, Warsaw or Kyiv specific. Brazilian
  Portuguese is the only variety with its own list.
- **Age and register:** wordfreq is frozen at about 2021. Subtitle lists over-represent dialogue, including swearing.
  Beyond the first few thousand words, rank differences between neighbouring words are small and noisy.
- **Rare mismatches remain.** The main sense follows the most frequent part of speech in news-heavy treebanks, which
  is not always the most useful one for conversation. Portuguese *como*, for example, opens with "as" rather than
  "how". Spanish *al* (rank 34) reads 'contraction of "el"', as in the Spanish extraction. A few single Vietnamese
  letters show rare senses, such as *a* "a cutting tool" and *o* "paternal aunt" (a central dialect word), because
  those are the only meanings Wiktionary gives them. Edit any word in the app. Loading a set never overwrites a word
  you already have, edited or not; it only adds the senses and forms the word lacks.

## Licences

| Data | Licence | Notes |
|---|---|---|
| English Wiktionary (all definitions), Wiktextract extractions | CC BY-SA 4.0 / GFDL | Share-alike if you redistribute the sets |
| dmklinger/ukrainian | CC BY-SA 3.0 | Ukrainian fallback definitions |
| wordfreq data, FrequencyWords | CC BY-SA 4.0 | wordfreq asks that SUBTLEX and OpenSubtitles be credited |
| doozan/spanish_data | CC BY-SA (frequency and Wiktionary data); CC BY 2.0 FR (Tatoeba sentences) | |
| Tatoeba sentences (Vuizur/tatoeba-to-anki decks; Tatoeba Translation Challenge development and test sets) | CC BY 2.0 FR | Every sentence's source is in `<lang>-sentence-credits.tsv` |
| OpenRussian (Badestrand/russian-dictionary) | CC BY-SA 4.0 | Russian tables |
| UniMorph Spanish, Portuguese and Ukrainian | CC BY-SA 3.0 | Tables |
| verbecc (from Verbiste) | **GPL-2.0-or-later** | Spanish and Portuguese tables are partly derived from its data files |
| PoliMorf in the Morfologik Polish dictionary | BSD 2-Clause | Polish tables |
| michmech lemmatization lists | ODbL 1.0 | |
| PoliMorf/SGJP (spaCy lookups) | BSD 2-Clause | |
| UD treebanks | AnCora CC BY 4.0; Porttinari, VTB, Taiga, GSD and PUD CC BY-SA 4.0; **LFG GPL-3.0**; **PDB, SynTagRus and IU CC BY-NC-SA 4.0** | Used to split ambiguous forms, and their sentences are included as cloze sentences |
| tabidots/vn-freqs | **no licence stated** | Fine for this private app; do not redistribute the Vietnamese set |
| AI-written sentences (`data/ai-sentences/`) | Written by Claude (Anthropic) for this project, not taken from any source | Used only for words that no collection covers, and labelled as AI-written in the app |

The sets are fine for a private, single-user app. Before you publish them or use them in a commercial product, check
these points:

- The Vietnamese ranks rest on an unlicensed list.
- The Polish, Russian and Ukrainian ranks, and the Russian pronoun and numeral tables, were influenced by
  non-commercial treebanks. Rebuild without them by removing `treebank` from those languages in
  `scripts/freq/languages.mjs`.
- Sentences from SynTagRus, PDB and IU are for non-commercial use only. `--commercial-safe` leaves them out.
- Polish sentences from LFG are GPL-3.0, and the Spanish and Portuguese tables draw on GPL data (verbecc). Most of
  the rest is share-alike.

## Rebuilding

```bash
scripts/freq/fetch-sources.sh ~/vb-sources        # about 2 GB, pinned to the commits and files used here
node --max-old-space-size=6000 scripts/freq/build.mjs --sources ~/vb-sources            # all six: about 7 minutes, up to 3.5 GB of memory
node --max-old-space-size=6000 scripts/freq/build.mjs --sources ~/vb-sources --lang uk  # one language
node --max-old-space-size=6000 scripts/freq/build.mjs --sources ~/vb-sources --commercial-safe  # no non-commercial sentences
node --max-old-space-size=6000 scripts/freq/build.mjs --sources ~/vb-sources --no-ai-sentences  # no AI-written sentences
```

**With current Wiktionary data.** Download a language's JSONL file from [Kaikki.org](https://kaikki.org/dictionary/).
For example, the Ukrainian dictionary page links `kaikki.org-dictionary-Ukrainian.jsonl`; the per-language files are
marked deprecated, so `raw-wiktextract-data.jsonl.gz` filtered on `lang_code` is the long-term option. Then attach it
to the shipped ranks:

```bash
node --max-old-space-size=6000 scripts/freq/build.mjs --from-ranks --sources ~/vb-sources \
  --kaikki uk=kaikki.org-dictionary-Ukrainian.jsonl --lang uk
```

Kaikki data keeps sub-senses with their parent gloss ("house (structure serving as an abode …)"). It also follows
form-of entries and adds IPA (preferring Brazilian or Saigon pronunciations). `--sources` is still needed for the
fallback dictionary, the inflection tables and the sentences. The Kaikki reader is tested against a small
sample in Kaikki's format (`tests/fixtures/freq/kaikki-pt.jsonl`). It has not been run on a full Kaikki download here,
because this build environment cannot reach kaikki.org.

**Using a rebuilt set.** With Docker, the sets are part of the image, so run `docker compose build app && docker compose
up -d` after a rebuild. A set you have not loaded yet then loads the new version. A set you already loaded shows as
*Loaded* and cannot be loaded over itself. To switch it to the new version:

1. Open *Import vocabulary*, find `frequency-<lang>.json` under *Recent imports*, and choose *Undo*. Words the set
   added are removed unless you have started them; started words are kept, with their progress and current
   definitions. Words you had before, such as starter words, stay and lose only what the set added to them.
2. Load the set again from Settings. The removed words come back in their rebuilt form. The kept words gain any new
   senses next to their old ones, and they keep their old rank, so tidy their senses by hand if you want.
