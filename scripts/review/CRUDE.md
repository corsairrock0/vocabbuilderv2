# Crude-sentence review (VocabBuilder)

The app teaches the 6,000 most frequent words of six languages, each with up to three example sentences (mostly from
Tatoeba and treebanks). The owner asked: **"Replace all the crude sentences you find."** You review one language.

## What counts as crude

Use the textbook test: *would a mainstream adult language textbook print this sentence?* If not, it is crude:

- swearing and expletives, mild ones included when they are used as a curse (*damn it*, *what the hell*, *maldito*,
  *чёрт возьми*, *cholera jasna*);
- sex: sexual acts, innuendo, arousal, nudity in a sexual way, prostitution, pornography, sexual body parts in a
  sexual or vulgar context, and sexual violence (rape, molestation, paedophilia);
- slurs (ethnic, racial, homophobic, ableist) and vulgar insults (*bitch*, *bastard*, *asshole*, *son of a bitch*);
  ethnic stereotypes and insulting sayings (*Незваный гость хуже татарина*);
- crude toilet talk (*shit*, *piss*, *fart*, *crap* as vulgar words or jokes).

Not crude (keep): another word or meaning (*pochwalić* "praise", *gwałtowna burza* "violent storm", *бляха* "tin",
*culebra*, a female dog, a fox, a monkey, a cock as a rooster, *pelada* "football game"); kissing, love, dating,
marriage, pregnancy, breastfeeding; *sex* meaning male/female; neutral medical or health statements (*breast cancer*,
*a condom protects against infections*) phrased the way a health leaflet would; neutral mentions of Jewish or Roma
people; mild non-vulgar insults (*idiot*, *fool*, *stupid*, *jerk*). When in doubt, replace: a clean sentence costs
little.

## What to do with each candidate

1. `keep` — not crude. If the sentence is tagged with a crude meaning it does not show (a clean sentence linked to
   "to rape" instead of "to spoil"), add `"sense"` with the right meaning's number to the keep line.
2. `replace` — crude, and the word has a clean meaning among its listed meanings. Write a new sentence:
   - the same word, in a clean listed meaning; prefer the meaning the original showed, and set `"sense"` to the
     meaning's number when you use another one;
   - prefer the same form as the original target; it must be one of the word's forms (shown), written exactly as in
     the sentence, appearing **once**, with no other form of the word in the sentence;
   - short and everyday (4–12 words), natural, in the set's variety: Colombian Spanish (*ustedes*, never *vosotros*;
     Colombian vocabulary), Brazilian Portuguese (*você*; *estou fazendo*, never *estou a fazer*), Southern
     Vietnamese (Saigon usage), Moscow Russian, Kyiv Ukrainian (standard Ukrainian, no surzhyk or Russianisms),
     Warsaw Polish;
   - no digits (write numbers as words); no real living people or brands; no politics, war or violence;
   - never about Africa, India, the Middle East (Turkey included), Islam or Muslims, the Bible, God or religious
     holidays; Ukrainian sentences never touch Russia or Russian themes and Russian sentences never touch Ukraine;
     set them in the language's own country, elsewhere in Europe, the Americas or East Asia;
   - a natural, faithful English `translation`.
3. `drop` — crude, and no clean sentence can show the word: the word itself is vulgar or a slur in every listed
   meaning (*kurwa*, *mierda*, *хуй*, *жид*), or its only meanings are sexual acts. Do not invent a clean meaning the
   word does not list.

Candidates marked **WORD LOOKS CRUDE** are words whose dictionary form or main meaning is on the crude list; every
sentence of such a word is listed so you can decide the word as a whole, but judge each sentence (*сука* has the
clean meaning "female dog"; *голый* also means "bare").

## Reading through untranslated sentences

Treebank sentences have no English translation, so only target-language keywords were scanned. After the candidates,
read every line of the read-through list and add a `replace` or `drop` line for each crude one (same rules; ids look
like `ru-t0123`). Write nothing for clean ones, nor for a sentence that is already a candidate (same word and
sentence). Read quickly: you are only looking for crude content.

## Files and commands (run with `PATH=/opt/node24/bin:$PATH`, from /home/claude/crude)

- `node crude-show.mjs <lang> <from> <n>` — candidates, with the word's meanings, forms and other sentences.
- `node crude-show.mjs <lang>-t <from> <n>` — the read-through list, one sentence per line.
- Write decisions to `out/<lang>.jsonl`, one JSON object per line, appending as you go:
  - `{"id":"es-0001","d":"keep","why":"chicken breast, not crude"}`
  - `{"id":"es-0002","d":"drop","why":"mierda is vulgar in every meaning"}`
  - `{"id":"es-0003","d":"replace","why":"sexual innuendo","text":"…","translation":"…","target":"…","sense":0}`
- `node crude-check.mjs <lang>` — checks every line and lists candidates still without a decision. Fix every problem;
  read the warnings and fix what they point at, or make `why` explain it.
- Notes for the owner (a wrong or crude meaning in the word list, such as Polish *francuz* glossed "oral sex"):
  `out/<lang>-notes.md`, one line per word.

Do not edit any other file. When `check.mjs` shows no problems and no missing candidates and the read-through is
done, report: counts of keep/replace/drop, the words you dropped every sentence of, and anything the owner should
decide.
