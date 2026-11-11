# Politics, war and living people review (VocabBuilder)

The app teaches the most frequent words of six languages, each with up to three example sentences (mostly from
Tatoeba and from news and fiction treebanks). The owner asked for a pass that replaces example sentences about
**politics or war, or that name living people**, and that **keeps Russia out of the Ukrainian sentences and Ukraine
out of the Russian ones**. You review one language. (Crude sentences were already replaced in an earlier pass.)

## What to replace

1. **Politics:** real politicians, parties, governments and their actions, elections, parliaments, political
   movements and ideologies (communism, fascism…), protests, sanctions, revolutions, coups, propaganda, disputes
   between countries, and any sentence that states a political opinion. A neutral sentence with no real politics can
   stay: a club or company president, a school election, a fictional mayor opening a park.
2. **War and violence:** wars past or present, battles, armies at war, soldiers fighting or dying, weapons used on
   people, bombing, terrorism, killings, massacres, occupation, people fleeing war, violent crime. A neutral mention
   with no fighting can stay (someone's job in the navy, a water pistol, a medieval castle).
3. **Living people:** any named real person who is alive — politicians, celebrities, athletes, business people.
   Invented names (Tom, Mary, Ana) are fine; historical figures who died before 1990, mentioned neutrally and not about
   politics or war, are fine (Chopin, Pushkin, Frida Kahlo). Companies and brands are fine.
4. **Russia and Ukraine:** in the **Ukrainian** set nothing about Russia or Russian themes (Russian places, Russians,
   Moscow, the Kremlin, Soviet or Russian rule, Russian culture as a theme); in the **Russian** set nothing about
   Ukraine (Ukrainian places, Kyiv, Crimea, Donbas, Ukrainians, Ukrainian culture as a theme). In the other four sets
   Russia and Ukraine are ordinary places, unless the sentence is political or about the war.

Not these subjects (keep): false matches (Spanish *partido* "match", *gun* in "glue gun", Polish *rząd* "row",
Russian *мир* "world"), history or culture with no politics or war (a king who built a palace, a medieval treaty is
borderline — keep it only if it is plainly neutral), and fiction with no real people. When in doubt, replace: a
neutral sentence costs little.

## What to do with each candidate

1. `keep` — not on these subjects.
2. `replace` — on these subjects, and the word has a meaning that can be shown without them. Write a new sentence:
   the same word, in a listed meaning (set `"sense"` when you use another one), preferably in the same form (it must
   be one of the word's forms shown, written exactly as in the sentence, appearing **once**); short and everyday (4–12
   words); natural in the set's variety (Colombian Spanish, Brazilian Portuguese, Southern Vietnamese, Moscow Russian,
   Kyiv Ukrainian, Warsaw Polish); no digits; a natural, faithful English `translation`. For a word whose meaning is
   political or military itself (president, minister, election, party, army, soldier, war, weapon), write a calm,
   general sentence with no real country, war, side, politician or casualty: "Our class elected a new president",
   "Peace is always better than war", "My grandfather served in the navy as a cook". Never touch the war in Ukraine.
3. `drop` — no meaning of the word can be shown without these subjects (a living politician's name, *terrorist*,
   *Nazi*, a Ukrainian-set word that means "Russian" or "Moscow", a Russian-set word that means "Ukrainian" or "Kyiv").

Also follow the content rules that apply to all sentences: never Africa, India, the Middle East (Turkey included),
Islam or Muslims, the Bible, God or religious holidays; nothing crude. Set new sentences in the language's own country,
elsewhere in Europe, the Americas or East Asia.

## Reading through untranslated sentences

The treebank sentences have no English translation, so only target-language keywords were scanned, and news text is
full of politics. After the candidates, read every line of the read-through list and add a `replace` or `drop` line
for each sentence on these subjects (ids look like `pl-t0123`). Write nothing for the others. Read steadily; you are
looking only for politics, war, violence, living people and (in the uk and ru sets) the other country.

## Files and commands (run with `PATH=/opt/node24/bin:$PATH`, from /home/claude/politics)

- `node show.mjs <lang> <from> <n>` — candidates, with the word's meanings, forms and other sentences.
- `node show.mjs <lang>-t <from> <n>` — the read-through list, one sentence per line.
- Write decisions to `out/<lang>.jsonl`, one JSON object per line, appending as you go:
  - `{"id":"es-0001","d":"keep","why":"partido is a football match here"}`
  - `{"id":"es-0002","d":"drop","why":"the word is the name of a living politician"}`
  - `{"id":"es-0003","d":"replace","why":"about an election in Colombia","text":"…","translation":"…","target":"…","sense":0}`
- `node check.mjs <lang>` — checks every line and lists candidates still without a decision. Fix every problem;
  read the warnings (a replacement that still matches a politics keyword is fine when it is neutral: say so in why).
- Notes for the owner (a word in the list that cannot be shown without these subjects, a wrong meaning):
  `out/<lang>-notes.md`, one line per word.

Do not edit any other file. When `check.mjs` shows no problems and no missing candidates and the read-through is
done, report: keep/replace/drop counts, the words left without sentences, and anything the owner should decide.
