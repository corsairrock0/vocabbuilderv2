# Learning engine

This document covers how sessions are planned, how answers are graded, when an answer changes the schedule, and how
progress is measured. Code: `server/learning/planner.ts` (planning), `server/learning/sessions.ts` (answers and
sessions), `server/learning/scheduling.ts` (FSRS application), `shared/exercises.ts` (exercise catalogue and rating
rules), `shared/answer.ts` (grading) and `shared/fsrs.ts` (the scheduler).

## Words, memories and skills

- A **word** (learning item) has two FSRS cards: **receptive**, to recognise the meaning from the word, and
  **productive**, to produce the word from the meaning. They are scheduled independently, because recognising
  *говорить* is easier than producing it in conversation.
- Every answer also adds **evidence** to one of six skills:
  - written recognition
  - listening
  - recall from English
  - sentence completion (context)
  - production
  - pronunciation (self-assessed)

  Evidence notes whether the answer was correct **on a later day than the word was first seen** (*delayed-correct*).
  Mastery is judged from delayed-correct evidence, because answering right a minute after learning a word proves
  little.
- Exercise kinds and what they train:

| Kind | Memory | Skill | Notes |
|---|---|---|---|
| intro | — | — | New-word card: meanings with usage examples, stress, one example sentence per meaning, grammar, audio |
| meaning_choice, meaning_typed | receptive | recognition | Word → English |
| context_meaning, cloze_choice | receptive | comprehension | Meaning in a sentence. The right answer of *context_meaning* is the meaning that sentence is linked to; a word with several meanings uses only linked sentences |
| listen_meaning, listen_choice | receptive | listening | Only when audio exists. Without audio they are skipped and never count against you |
| dictation | productive | listening | Type what you hear |
| word_choice | productive (assisted) | recall | Pick the word for an English meaning. **Never a scheduling event**: choosing is not free recall |
| recall_typed, cloze_typed, form_typed | productive | recall / sentence / production | Free recall, including the correct inflected form |
| speak_flashcard | productive | production | Say it, reveal, rate yourself |
| sentence_create | — | production | Practice only, self-rated; optional. Shows only example sentences of the meaning it names |
| shadowing | — | pronunciation | Practice only; recordings stay on the device |

## Sessions

Pressing **Start** on Today (or on *Session options*, or the home-screen shortcut *Quick study*) asks the server to
plan a whole session. The plan fits the time budget using a per-exercise time estimate, and is stored with the session.
The plan and every answer live on the server, so any device can resume at the same exercise.

**Comprehensive is the default** (since 1.8.0; `DEFAULT_STUDY_MODE` in `shared/settings.ts`). Every one-tap start
plans a Comprehensive session: Today's *Start* (since 2.0.0 it starts the session at once, at the length chosen next to
it, with the plan Today shows), *Quick study* (the home-screen shortcut `/study?quick=1`), *Study more* after a
session, the Progress page's Words, Writing words and Listening cards (with their focus), and a request that names no
mode. *Session options* (`/study`) opens on Comprehensive and still offers *Reviews and new words* (`mixed`) and
*Reviews only*; the choice is not remembered, so the screen always opens on the default. The *Review* buttons start
*Reviews only*, as before. Today shows its plan from `GET /api/sessions/preview`. Sessions already planned keep their
mode. *Save for offline* with Comprehensive chosen
saves a *Reviews and new words* session for the whole time, because practice rounds need a connection; the message says
so.

**Stages** (shown above each exercise):

| Stage | Contents |
|---|---|
| A Review | Due cards. Each card gets one exercise chosen by its stability: weak memories get recognition-friendly kinds, strong ones get typed recall, typed cloze or dictation |
| B New words | Intro cards, in batches of 3–4 |
| C Recall | Meaning choice and word choice for the batch |
| D Context | Cloze with options. Becomes *core* when your inflection accuracy is weak or your focus is reading |
| E Listening | Listening exercises, when audio is available |
| F Production | Typed recall and typed cloze |
| G Pronunciation | Shadowing (optional; can be turned off per language) |
| H Reinforcement | A last retrieval of each new word, late in the session |

Reviews are interleaved between new-word batches rather than all done first. When new words are planned, about three
quarters of the time goes to reviews.

**Adaptive rules:**

- **Real time (pace, 1.8.4).** Each kind of question has a time in the model (`shared/exercises.ts`, or your own
  median answer time once you have five correct answers of that kind), plus a few seconds for the feedback. Real
  sessions took about twice that: reading feedback, explanations and tables, typing, the practice in between. So a
  session of *m* minutes is planned with *m / pace* minutes of the model, and takes about *m* minutes in real life.
  The pace comes from your last ten sessions finished in the past 30 days (at least two minutes and half their
  exercises done, and plans that filled their time): their active time against the model time their plans filled,
  weighted by the minutes done (`sessionPace` in `server/learning/sessions.ts`). Until there are such sessions it is
  2; it stays between 1 and 3, and each session records the pace it was planned with (`plan_meta.pace`). The
  pictures minimum of five and the reading text of a session of ten minutes or more do not shrink with it.
- **How many new words.** Your target (default 10 per day) is scaled down when the review load is high: ×0.3 when
  reviews would fill more than 60% of the session, ×0.6 above 40%. It is also scaled by recent first-try accuracy:
  ×0.4 below 70%, ×0.7 below 80%, ×1.2 above 92%. The time budget caps the result. The session start screen shows
  the reason.
- **Exercise mix.** Weights shift with your chosen focus (listening, speaking, reading, typing), with weak skills
  (low listening or inflection accuracy) and with the difficulty setting.
- **Review order.** Most at risk first (lowest predicted recall), oldest due first, or hardest first (per-language
  setting).
- **Over time.** At 110% of the planned time the app offers **Wrap up**. That drops optional work and words not yet
  introduced, but keeps due reviews and words you have started. **Keep going** continues with everything.

**Remediation.** A wrong answer, an "almost", or a self-rating of *Again* inserts a follow-up exercise for the same
word, of a **different kind**, about two exercises later. Each word gets at most two follow-ups per session. Browser
and server plan these identically (`planRemediation`), so studying offline produces the same session.

**Other session behaviour:**

- **"I already know this word"** on an intro card marks the word as known and removes its remaining exercises.
- **Pause and resume.** Leaving, closing the browser or switching devices simply pauses the session, and its active
  time is kept. A session idle for 12 hours is closed as *abandoned*: words you practiced are still scheduled from the
  answers you gave.

- **Comprehensive mode: one mixed session** (the default; `shared/mix.ts`, `web/src/pages/session/SessionPage.tsx`,
  `PracticeRounds.tsx`). Every kind of question in one session, a few at a time: reviews, new words (each met a few
  ways), listening, grammar (conjugation or declension, where words have tables), sentence gaps, pictures (Identify),
  speaking (Say it), one short everyday text to read and, in languages with Writing sentences left, sentences to write
  (Writing, below).
  - **Planned up front.** The reviews and new words are planned like *Reviews and new words* in about two thirds of
    the chosen time (`planner.ts`); the practice is planned at the same moment (`planPractice`) and stored with the
    session (`plan_meta.practice`), so every device shows the same mix and the counter a steady total. Both are
    measured in minutes of the time model, the chosen minutes divided by your pace (above). Per 20 model minutes the
    practice holds about six grammar and six sentence questions (sentences only, nine, where words have no tables),
    three to say, the Identify minimum of five (three more per 15 minutes past 20), and from 10 real minutes one short
    text (three questions); with sentences left to write, `writingCount` Writing questions (one per five model minutes
    plus one, two to eight: two in 10 real minutes, three in 20 and seven in 60 at pace 2), each a slot of its own,
    their time (30 model seconds each, `WRITING_SECONDS`) taken from the exercises' budget; in slots of three or fewer
    (the first pictures slot is the five), the kinds taking turns (grammar, sentences, pictures, speaking, writing),
    spread evenly between the exercises (a slot comes once that many exercises are done, answered or skipped), the
    text in the second half. At the starting pace of 2, ten minutes come to about 28 questions and twenty to about 40
    for a learner with ten new words a day and no reviews yet (40 and 71 at pace 1, as planned before 1.8.4). Each slot is filled when the session reaches it, from the
    words met so far (practice batches with `scope: 'entries'`), sized to what it has left; a slot with nothing to ask
    (no content for the words yet, or offline) is skipped and the total shrinks, and a speaking slot reads sentences
    instead (they count as reading) when none can be said yet. Exercises left over at the end bring the slots still
    open. *Wrap up* (out of time) drops the practice still planned: reviews come first. Practice answers go to
    practice or comprehension attempts, and since 2.0.0 an answer about a word being learned is also that word's
    review ([When an answer changes the schedule](#when-an-answer-changes-the-schedule)); a slot's active time belongs
    to the session
    (`heartbeat` events once it ends, at most five minutes each). A session planned by an earlier version gets its
    practice when it is opened, from where it is: what its length plans for the part still to come, spread over the
    exercises it has left (`planFromHere`), so nothing comes back to back. A slot reached before any answer still gets
    its pictures (filled up from the learner's other words), sentences to say or read, or its text; grammar and
    sentence gaps need the session's own words.
  - **Before it starts.** Today (`Dashboard.tsx`) says what the session holds in one sentence and one bar of its mix,
    with the length (10, 20 or 30 minutes) and Start. *Session options* (`/study`, `StudySetup.tsx`) shows the same
    mix in full (the total of questions, one line per type with its count and a bar) and holds every choice: the
    length (also 45 minutes or any number), the mode, new words, focus, difficulty, the reading and writing levels,
    and under *More* the topic, the frequency range, the language, *Quick study* and *Practice one skill*; *Save for
    offline study* sits next to Start. New words are by default what is left of today's target, as Today's plan and
    *Quick study* take them (`quick`), so Today, Session options and the session Start creates show one plan; a number
    chosen here is used as is. The mix comes from
    `GET /api/sessions/preview?lang=…&minutes=…` (also `mode`, `newWords`, `focus`, `difficulty`, `tag`,
    `frequencyMin`, `frequencyMax` (empty for no range, as Start sends it; left out for the range in the settings),
    `quick=1`, and `id`): the session Start would plan, planned by the same code in a
    transaction that is rolled back, so nothing is written. It answers `{ language, mode, minutes, total, parts: [{ type,
    count }], reviews, newWords, empty }` (types in the order review, new, listening, grammar, sentences, pictures,
    speaking, reading, writing; `empty` says why when nothing can be planned). With `id`, the id Start then uses, the plan shown
    is exactly the one the session gets (the planner's choices follow the session id); after a Start that failed,
    changing the choices takes a new id, so the old one stays tied to the old choices.
  - **Every question in one flow.** Each question shows its type with an icon (Review, New word, Listening, Grammar,
    Sentences, Pictures, Speaking, Reading, Writing: listening exercises are Listening, other exercises on a new word
    New word, the rest Review). Practice comes in the same chrome as the
    exercises (the practice pages' runners, `embedded`, without their own progress bars). The header is one row: the
    button that pauses, the bar and `done / total`; the pause sheet says how far the session is (questions done, the
    minutes used of the planned time, the right answers so far). Between an exercise and a practice slot, or between
    two slots, what was just answered stays on screen with Continue waiting until the next part has loaded, so nothing
    already answered flashes by. The counter counts the
    exercises answered or skipped and every practice answer, each as it is given (a Say it sentence once checked; a
    Writing sentence when the learner moves on from its answer, so an *I was right* counts; a
    text's questions together once all are answered, when the text is stored, so a text left half read comes back whole
    and is never counted twice); its total adds the exercises left and the questions the slots have left (the slot on
    screen as loaded, a longer passage's four questions too).
  - **Practice progress is saved with the session.** After each answer the device sends the slot's answers as a `round`
    session event (`POST /api/sessions/:id/events`, `type: 'round'`: `roundId` the slot's id, `skill`, `grades` at most
    ten, `from` the answers it had before, for a slot resumed after a reload, and `end` when the slot is over, then
    perhaps with no grades), through the offline queue like the other session events, and counts it on its own copy at
    once. The server keeps the tallies in the plan meta (`rounds`, `roundAnswers` per round, `roundsEnded`) and counts
    only answers beyond those it has for that round (`mergeRound` in `shared/activity.ts`), so a resent or late event
    never counts twice; it keeps them after the session is completed too (the slots at the end come after the last
    exercise). A reloaded or resumed session keeps its count, its summary and its Identify minimum, and goes on with a
    slot left in the middle.
  - **The summary** (`Summary.tsx`, `shared/summary.ts`, worked out from the session itself, so it works offline and
    after a reload): a ring with the share answered right, the questions answered (every answer: exercises, new word
    cards too, and practice; the counter's final count less the exercises skipped, which it names), the minutes, the new
    words, and the daily goal (the language's goal in Settings → Learning, as on Today and Progress) and streak; *Every
    skill today*, one row per type with "x of y right" and a bar, every answer in exactly one row (new word cards, words
    (reviews and new), listening,
    grammar, sentences, pictures, speaking, reading sentences (understood in full), reading texts (questions right),
    writing (sentences right)), so
    the rows add up to the questions answered; the share right covers all answers but the new word cards (session
    exercises at their first try, a rated one rated Hard or better, and practice answers right or read in full); the
    new words as chips; *Worth another look*, the words missed with what went wrong the last time ("means “to hurry”:
    you chose “to sleep”"), which come back early in the next session; *Next* (what is due by tomorrow, *Study again*,
    *Done*); and the review schedule in a closed *Review schedule details*.
  - **At least five Identify questions** (`IDENTIFY_MIN` and `identifyRoundPlan` in `shared/activity.ts`). The first
    pictures slot asks for five; while the session has shown fewer, a pictures slot asks for at least what is still
    owed, and the batch fills up past the session's own words: from the words being learned, then from all the
    learner's words (`fill: ['learning', 'all']` on `POST /api/practice/identify/batch`; each tier in the usual order,
    each word once and each picture at most twice, unless the learner's words have too few pictures for that). Once
    five have been shown, a pictures slot asks for its planned size on the session's own words. When the learner's
    words have fewer pictures, the session shows as many as there are (a filled-up batch that comes back short ends the
    minimum). A line says where the pictures come from when not only from the session's words ("With other words of
    yours.").
- **Word tables in sessions.** Session items carry the word's whole table (`ItemResource.paradigm`). The new-word card
  has a *Show the declension/conjugation table* button, and every answer screen for a word with a table offers it.
  When the expected answer is an inflected form (a cell of the table other than the dictionary form, or the cell a
  *give this form* question asked for, now named in its payload as `cell`), the feedback says which form it is and
  why (see [Grammar explanations](#grammar-explanations-sharedgrammarts)), after right answers too. When the answer was not right, the
  button is shown as the main way to check, with the cell marked and the tense card or declension section holding it
  shown first, the rest one click away. The sentence-gap practice does the same, fetching the table once per word.

## Practice (`server/learning/practice.ts`)

The **Practice** tab offers each practice on its own, next to the review queue: the four below,
[reading comprehension](#reading-comprehension-serverlearningcomprehensionts) and
[Writing](#writing-serverlearningwritingts-sharedwritingts). Answers go to `practice_attempts` (reading
comprehension: `comprehension_attempts`; Writing: `writing_attempts`) and count in the statistics: in the day's
activity and streak, and per skill on the Progress page; the time spent on the Practice pages counts as study time
([Statistics](#statistics-serverservicesstatsts-serverservicesskillsts-sharedstatsts)).

**Every answer counts (2.0.0).** A grammar form, a sentence gap, a picture or a written sentence tests a word's memory
as a session exercise does, so the answer is also that word's review when the rules of the review log allow it: one
review per memory a day, never both memories of a word on one day, and never a word's first review, which its first
session gives ([When an answer changes the schedule](#when-an-answer-changes-the-schedule)). The answer then says so
(*Review done · back in 9 days*). Extra drilling still cannot make a word look better remembered than it is: a second
answer the same day is practice only. Batches ask the words due today first, so practicing does the day's reviews.
Read and say and reading comprehension are about whole sentences and texts and leave the schedule alone.

- **Read and say** (`server/learning/reading.ts`, all six languages). Practice with whole sentences chosen from what
  the learner knows: words *introduced*, *active* or marked *known*. Every example sentence of the language is split
  into words, and each word is matched to the entries it can be (dictionary forms, table forms, and phrases of up to
  four words, so Vietnamese *sinh viên* is one word). Numbers and capitalised names need no learning; a word in no
  list makes the sentence unusable for now. A sentence is *readable* when at most one of its words is new to the
  learner, and *sayable* when none is and it has no names.
  - *Read*: about six in ten sentences bring one new word each, the most frequent words not met yet first (one
    sentence per word, real sentences before AI-written ones); the rest have only known words, with recently learned
    words first, so new words meet new contexts. Every word can be tapped for its meaning (a sentence's own word shows
    the meaning the sentence is linked to). The learner checks the translation and says how much they understood.
    *Learn it next* sets a new word to *introduced*, which puts it first among the new words of the next session.
  - *Say it*: the English translation of a sayable sentence; the learner says it aloud and reveals it, or types it and
    sees a word-by-word comparison (longest common subsequence over match keys, so stress marks and capitals do not
    count and one slip does not mark the rest wrong; added words lower the score).
  - Sentences read (or said) in the last 7 days are not offered again in that mode. With device speech turned on for
    the language (Settings → Audio), each sentence can be heard in the device's voice, labelled as such.

- **Identify** (`server/learning/identify.ts`, all six languages). An everyday photo with one object marked by a dot
  at the point Gemini gave for it; the learner names the object by choosing from four or by typing. The scenes,
  objects, points, boxes and the words that name each object per language come from `data/identify/identify.json`.
  - An object is offered when one of its words for the language is among the learner's words (matched on the
    lemma, ignoring case, stress marks and Russian ё; a noun wins when a lemma has several entries). The word asked
    for is the learner's own word in *words I'm learning*, the chosen word when practicing one word from its page,
    and otherwise the object's most natural word that the learner has.
  - Every word listed for the object counts as right ("Also right: colegio"), and so do the plurals of those that are
    nouns (*escuelas*, *szkoły*), since many pictures show several of a thing; a gendered plural counts only when the
    noun has no singular of that gender among its forms (*niños* for *niño*, not *niñas*). Other forms count as
    "right word, other form" with "Name it with the dictionary form, “…”."; the names of the other objects in the
    picture are never accepted as typos.
  - The three wrong options are the names of other objects in the same picture first, then common names from other
    pictures; no option is another right answer.
  - Order: objects missed in the last 14 days first, then objects never practiced, then the least recently
    practiced, frequent words first among equals. A batch asks each word once and shows each picture at most twice,
    except when practicing one word (its pictures in turn). For a Comprehensive session's minimum (`scope: 'entries'`
    with `fill`), the objects of the session's words come first, then those of each fill-up scope in turn, and when
    that leaves the batch short, the objects left over follow, so few words still give every picture they name.
    Attempts are stored with `mode = 'identify'` and the object in `cell` (`S012:3`).
  - Small objects (box under 16 % of the picture's side) open with a magnifier in the corner away from the dot; the
    Magnify button under the picture turns it on or off for any object. The hint gives the English name and the
    first letter.

- **Declension / conjugation** (Russian, Ukrainian, Polish; Spanish, Portuguese). The drill names one cell of a word's
  table — *genitive plural*, *preterite (yo)*, *imperative (usted)* — and you type the form. You choose the words
  (those you are learning, all words with a table, or one word from its page), the tenses or cases, and the persons
  or numbers. Defaults leave out what the taught variety does not use: *vosotros* and *vos* for Colombian Spanish
  (*vos* can be switched on; it is used in Antioquia and the Valle del Cauca), *tu* and *vós* for Brazilian
  Portuguese, and the rare future subjunctive and literary pluperfect. Before the first question, the words of the
  quiz are listed, each with its whole table and the forms that will be asked marked (the batch response carries the
  tables). A wrong answer shows the tense or the case table with the asked cell marked, and the whole table on request.
  Declension tables give each case's role and trigger words (`caseRole` in `shared/paradigms.ts`); conjugation tables
  dim the persons the variety hardly uses (`personNote`).
- **Sentence gaps** (all six languages). One word is taken out of an example sentence, and you type it in the form
  the sentence needs, or pick it from four options (for inflected words, the other options are other forms of the
  same word). The English meaning is always shown: the meaning that sentence is linked to, or all of the word's
  meanings when it is not linked to one (the word itself is hidden inside a meaning such as "used in «sin …»"); *Hint* gives the dictionary form, or the first letter when the gap
  holds the dictionary form itself, and the form the gap needs when the sentence's exact cell
  ([Grammar explanations](#grammar-explanations-sharedgrammarts)) or the table says so unambiguously. Sentences are
  chosen at build time ([FREQUENCY_SETS.md](FREQUENCY_SETS.md#cloze-sentences)). A sentence written by an AI, for a
  word no collection covers, carries an *AI-written sentence* note here, in study sessions and on the word page.
  Ukrainian *у* is accepted where the sentence has *в* (and *й* for *і*, *із* or *зі* for *з*), since they differ
  only in sound.

Opening a drill from a word's page (*Practice these forms*, *Practice in sentences*) practices that word in its own
language, whichever language is active.

**What comes next.** A batch puts first the words (or sentences) you missed in the last 14 days and have not answered
correctly since, then the ones never practiced, then the least recently practiced, frequent words first among
equals. A batch takes one cell or sentence per word, unless you practice a single word.

**Grading** is the same checker as in sessions. The device grades at once; the attempt is queued offline-safe and the
server grades it again from its own copy of the table or sentence. Another form of the right word is *Almost* and
names the form you typed ("Right word, different form: книги (genitive singular, nominative plural…)"); the line
after it says why the sentence needs its form ([Grammar explanations](#grammar-explanations-sharedgrammarts)). Spanish and
Portuguese negative imperatives are accepted with or without *no* / *não*. Any variant listed in a cell is right
(Russian *книгой* and *книгою*).

Inside sessions, the **Produce the form** exercise uses the same tables: it asks for one cell of a word's table by
name, chosen from the default drill groups.

## Grammar explanations (`shared/grammar.ts`)

Every answer whose expected form is not the dictionary form, right or wrong, gets a line in the feedback saying which
form it is and why: sentence gaps (practice and sessions, typed or chosen), *Produce the form*, and the declension /
conjugation drill. `explainForm` takes the word's table, the expected form and, for a gap, the text around it and the
sentence's exact cell when it has one, and returns the cells the form fills (the table marks only those the sentence
leaves), their name and the reason. It is shown as plain text above the table button, not inside the table.

- **The exact cell of an example sentence** (since 1.8.1). Many forms fill several cells (Ukrainian *українське* is
  the nominative and the accusative neuter of *український*; Spanish *hablamos* the present and the preterite), and the
  rules below settle only some sentences. The cells for example sentences come from `data/grammar/<lang>.json`, which
  holds, for example sentences of the frequency sets whose form fills more than one cell, the cell the sentence uses
  and the reason, annotated offline by AI ([data/grammar/README.md](../data/grammar/README.md) says how many; built by
  `scripts/grammar/build.mjs`, read by `server/learning/grammar.ts`, `VB_GRAMMAR_DIR` to use another folder). A
  sentence is found by `exactKey`: the language, lemma, form and sentence without stress marks, capitals, punctuation
  or extra spaces, Russian ё as е. A missing file means no annotations; a changed one is read again.
  - Session cloze exercises (choosing and typing the form, and their follow-ups) and the sentence-gap practice (also in
    Comprehensive rounds) carry the annotation as `exact: { cell, why }`, but only when the word's table confirms it:
    the cell holds the form, or *no*/*não* + the form for a negative imperative, which the tables store with its
    negation (`exactCellOf`; the device checks again before using it).
  - The explanation then names that cell alone, with the reason: “українське” is the nominative neuter of
    “український”: it describes “громадянство” (citizenship), the thing he has in “у нього …” (he has); what someone
    has is the subject there, so it is nominative. The table marks only that cell, and the hint's *needed form* names
    it. Nothing spelled the same is mentioned.
  - An annotation without a reason gets the rule below that this sentence gives for that cell, or else the cell's
    general use. An annotation whose cell does not hold the form is ignored. A sentence without an annotation is
    explained by the rules alone, as before.
  - Since 2.0.0 an annotation may also name a cell of a Russian, Ukrainian or Polish verb. Their tables (1.8.4) can
    hold one form twice: as the present of a verb and as the future of its perfective look-alike (Polish *wynosi*:
    *wynosić* "to amount to" and "to wear out"), or as a command and a statement about the future (Russian
    *договоритесь*). Without an annotation the explanation can only say the form "can be the present or future";
    with one it reads “wynosi” is the present (on, ona, ono) of “wynosić”, and the reason. 107 such sentences are
    annotated.

- **Cases (Russian, Ukrainian, Polish).** The word that calls for the case is looked for just before the gap: at
  most three words back, never past punctuation, and only through words that can agree with the gap (adjectives,
  possessives, demonstratives, numerals in their other cases, judged by their endings). A word that cannot agree
  (за допомогою **шахрайства**), a personal pronoun (без меня **книги**) or a verb ends the search. The triggers:
  - prepositions, with the meaning that picks the case for those with several: в/у/w and на with the locative for
    where something is and the accusative for where to (also a day, a game, what something is aimed at);
    з/с/z with the genitive for from or out of and the instrumental for with; за, под/під/pod, над/nad, przed, między;
    two-word prepositions ending in a noun (во время, під час, za pomocą) take the genitive;
  - negation: нет, немає/нема, nie ma, не было, nie będzie, also after the word (мене не буде), and Polish negated
    transitive verbs (nie piję kawy; a form that could also be the subject counts only after a known transitive verb);
  - quantity words (много, багато, dużo; несколько, кілька, kilka take the genitive plural);
  - numerals: Russian 2–4 (and оба, полтора) take the genitive singular, Ukrainian and Polish 2–4 the nominative
    plural, 5 and up the genitive plural; the 2–4 rules are applied to nouns only;
  - verbs with fixed government: helping, thanking (Ukrainian дякувати and Polish dziękować take the dative, Russian
    благодарить the accusative), phoning, answering, advising, believing, being afraid of, using, being interested
    in, doing (заниматься, займатися, zajmować się), the instrumental after быть/стать, бути/стати, być/zostać, and
    the vehicle after ехать/їхати/jechać;
  - the instrumental of a time of day or season (летом, wieczorem) says when.

  A trigger only counts when its case is one the form can be. Without one, a single case is explained by its general
  use, the same uses as the table captions (`caseRole`); a form that can be several cases (книги) is named by all of
  them, unless the sentence has an exact cell (above). Ukrainian у/в with the genitive means at someone's, so it is not chosen for a form that is also the locative
  or for a thing. Polish *za* before an adjective is "too", not the preposition. Ukrainian що and Russian что, filed
  as conjunctions without a table, have a built-in one for these explanations (`paradigmFor`), so "Для [чого] ти
  будеш це використовувати?" gives: “чого” is the genitive of “що”: it follows “для” (for), which always takes the
  genitive.
- **Verbs (Spanish, Portuguese).** The tense and mood, the person with its pronoun ("preterite, nosotros (we)";
  persons the variety hardly uses say so, as in the tables: vosotros *Spain only*, vos *parts of Colombia*, tu
  *regional in Brazil*, vós *not used in Brazil*), and a line on what the tense is used for. The sentence adds the
  reason when it shows one: a subjunctive trigger before the verb (quiero que, espero que, para que, antes de que,
  ojalá, es importante que, cuando about the future; quero que, para que, embora, talvez, se and quando with the
  future subjunctive), a negative command (no hables), estar + gerund, haber/ter + participle, ser/estar +
  participle, a time word anywhere in the sentence (ayer, mañana, ahora, todos los días; ontem, amanhã, agora), the
  subject pronoun (usted, você and *a gente* take the third person). Same spellings are settled only by the
  sentence: hablamos after *ayer* is the preterite ("the present indicative is spelled the same"), with no time word
  (and no exact cell) both are named. A command opens its clause, so with a subject or anything else before the verb, the imperative
  reading is dropped; a present subjunctive with no trigger at the start of a sentence is a command. Vos forms are
  named only when the form is vos's alone or the subject is vos. Spanish pronouns joined to an infinitive, a gerund
  or a command (ponerme, diciéndole, espérame, vámonos, sentaos) are traced to the bare form in the table, with a word
  on the join and on the written accent that keeps the stress.
- A drill that names the cell (*genitive plural*, *preterite (yo)*) gets the use of the case or tense. The dictionary
  form, Vietnamese, and forms not in the table get no line.

## Reading comprehension (`server/learning/comprehension.ts`)

Practice → Reading comprehension (all six languages): read a text in the language, then answer questions about it.
The texts are AI-written (Claude, checked by a second Claude review) and marked as such; they come from
`data/reading/<lang>.json`, built from the reviewed batches by `scripts/reading/build.mjs`
([data/reading/README.md](../data/reading/README.md)). There are two kinds, each planned at 40 texts per level from A1
to C1:

| Kind | Length and content | Questions | Order within a level |
| --- | --- | --- | --- |
| *Everyday texts* (short) | about 75 words of everyday life: dialogues, chat messages, emails, notices, short stories… (the format is shown) | 3 | by step, easiest first |
| *Longer passages* (long) | about 150 words on literature, history, the humanities or science | 4 | by id |

- **Reading level.** One level per language for both kinds: the language setting `readingLevel` (A1 to begin with).
  The learner can set it on the practice's first screen, which also shows how far through the level they are, both
  kinds together ("12 of 40 A2 texts read. Read them all to move up to B1.") and, per kind and level, how many texts
  there are and how many have been read, and in Study → Comprehensive. The Practice page's card says the same in short
  ("Your level: A2. 12 of 40 A2 texts read.").
- **What comes next** (`POST /api/practice/comprehension/next`, with the kind and optionally a level): the first text
  of that kind not read yet at the learner's level. When the level is used up, the nearest higher level with a text of
  that kind left, then the nearest lower one; the screen says so ("No B1 text is left to read, so this one is B2").
  A text that has been read once never comes back, whatever the result. The device also sends the texts it has just
  read, so one whose answer is still in the outbox is not served again. The response says how far the learner is
  through the requested level (`progress`: its texts of both kinds and those read, the ones the device asked to skip
  included), so the device can show at once whether this text moves the level up.
- **Questions** come one after another under the text: the main idea, details, then an inference or the meaning of a
  word in context. They are in English up to B1 and in the language at B2 and C1 (in the word font). Each question's
  options are shuffled when the text is shown: the writers spread the right answers over the four positions, so in
  their stored order the last answer could be found by elimination. The choice is mapped back to the stored index.
  Tapping an option locks the question and shows right and wrong with the explanation.
- **Passing.** A text is passed with all its questions but one right: 3 of 4, or 2 of 3. The result says so and the
  statistics count passes, but a pass or a fail does not change the level by itself.
- **Moving up a level** (`levelAfter` in `shared/comprehension.ts`). The level moves up one step, to C1 at most, only
  when every text of the learner's level in the language's data, everyday texts and longer passages together, has
  been read, whatever the results: a text read once never comes back, so reading the last unread one moves the learner
  on. The server works it out when it stores an attempt, from the texts read before and this one, against the texts of
  the learner's level. Texts read at other levels (served as a fallback, or read while another level was set) never
  count toward the learner's level; they count for their own, so a learner who reaches a level whose texts were all
  read already moves on through it at once. A level with no texts yet (B1 before its texts are written) never counts
  as read, so the learner stops there until its texts come. The level never goes down, and the learner can still set
  it. It is one setting per language, so the rule is the same on the Practice page and in Comprehensive rounds. The
  result card says how far through the level the learner is ("13 of 40 A1 texts read. Read them all to move up to
  A2.") or that the level moved up ("You have read every A1 text: your reading level is now A2."), and offers the next
  text at the learner's level. After the questions, the English title and translation can be shown.
- **Grading and storage.** The device grades at once with the shared rules (`shared/comprehension.ts`), shows the
  level from the progress sent with the text, and queues the attempt in the outbox
  (`POST /api/practice/comprehension/attempts`: the passage id and, per question in stored order, the chosen option's
  index or -1). The server grades it again, saves it in `comprehension_attempts` with the level before and after, and
  saves a new level as the language setting, so every device sees it; the result carries `progress`, how far through
  its level the learner now is. A repeated `opId` returns the stored result (its levels as stored, the progress as it
  is now) and never moves the level again. The result card then shows the server's result. Nothing here changes the
  review schedule.
- **In Comprehensive sessions** a reading round is one short text at the reading level, or a longer passage when no
  short one is left at that level (see [Comprehensive mode](#sessions)).

## Writing (`server/learning/writing.ts`, `shared/writing.ts`)

Practice → Writing, and Writing questions in Comprehensive sessions: an English sentence to write in the language,
with every word right. The sentences and their accepted translations are AI-written (Claude, checked by a second
Claude review); they come from `data/writing/<lang>.json`, built from the reviewed batches by
`scripts/writing/build.mjs` ([data/writing/README.md](../data/writing/README.md)): 200 per level from A1 to C1, in
steps 1–200, easiest first. A language without a file has no Writing yet: its page says so, and its sessions have no
Writing slots.

- **Accepted translations** are patterns (`{a|b}` one of the alternatives, `{a|}` optional, nested groups) that expand
  to every translation the sentence accepts, at most 120; the first is the usual translation, shown after a mistake.
  An optional `context` ("to a friend", "polite", "a woman speaking") under the English settles what the English
  leaves open.
- **Grading** (`gradeWriting`) is word by word: the answer is right when its words equal, in order, the words of an
  accepted translation or of a wording the learner accepted before. Words are compared by `wordKey`, which ignores
  capitals and punctuation, Russian and Ukrainian stress marks, ё against е, the shape of an apostrophe, where a
  Vietnamese tone mark sits on a vowel pair and a final i/y, the Ukrainian alternations у/в, і/й, з/із/зі, and a
  Ukrainian reflexive's -ся or -сь after a vowel. A
  wrong answer is aligned with the nearest accepted translation (the fewest words different), and the screen shows
  the learner's words with those not in it struck through and that translation with the missing or different words
  marked, then the usual translation when it is another one. *I don't know* sends an empty answer and shows the
  usual translation.
- **The writing level** is the language setting `writingLevel` (A1 to begin with), set on the Writing page and in
  Session options. **What comes next** (`POST /api/practice/writing/next`, with optionally a level, sentences to
  skip and a session's words): at the level, a sentence answered wrong whose wait is over first (the one waiting
  longest: five other answers since, `WRITING_AGAIN_AFTER`, or twelve hours, `WRITING_AGAIN_MS`), else the first one
  not answered yet in step order, else a wrong one still waiting. A level with nothing left falls back to the
  nearest higher level with a sentence left, then the nearest lower one (the reading rules, `levelSearchOrder`).
  The device sends the sentences it has just answered, so one whose answer is still in the outbox is not served again.
- **A study session's words come first.** A session's Writing slot sends the words met so far in the session
  (`sessionWords`, as the other slots). Among the sentences that could come now at the level (not answered yet, or
  wrong and their wait over), the server takes the one whose usual translation best fits those words: a word counts
  when one of its forms (headword, listed forms, the cells of its table) is among the sentence's words, a form of
  several words as a run of them, and each word counts log((n + 1) / (m + 1)), n being the sentences of the language
  and m those that use the word (`wordScores`), so a rare word counts for more and a word nearly every sentence has
  counts for almost nothing. As good a fit: a wrong one before a new one, then the easier. With no sentence using
  the words, the usual order holds. The response lists the session words the sentence uses (`uses`).
- **Done, and the level.** A sentence answered right is done and never comes back. The level moves up one step (past
  levels already done, C1 at most) when every sentence of it is done (`levelAfter` in `shared/comprehension.ts`,
  with "read" meaning done); a level without sentences never counts as done. The result says how far through the
  level the learner is ("12 of 200 A1 sentences done. Write them all right to move up to A2.") or that the level
  moved up.
- **I was right** (`POST /api/practice/writing/accept`, with the attempt's `opId`): an answer graded wrong
  (not an empty one) counts as right: the attempt is marked `correct` and `accepted`, the sentence is done and the
  level may move up, and the wording joins that sentence's accepted translations for this learner
  (`writing_accepted`), on every device. Accepting twice changes nothing more.
- **Storage.** The device grades at once and queues the attempt (`POST /api/practice/writing/attempts`: the sentence
  id, the answer, the time and the active time on the Practice page). The server grades it again against the
  sentence and the learner's accepted wordings, stores it in `writing_attempts` with the level before and after, and
  saves a new level as the language setting; a repeated `opId` returns the stored result. Writing answers count on
  the Progress page's Writing card (with typed recall), in the activity and study time like other practice, and in a
  session's summary; the export includes them. Nothing here changes the review schedule.

## Grading (`shared/answer.ts`)

Typed answers go through these steps in order. The first match decides the result:

1. Exact match after Unicode NFC normalisation, then after ignoring case, punctuation, Cyrillic stress marks and
   apostrophe variants (Ukrainian `'`, `’` and `ʼ` are equivalent).
2. Accepted variants and synonyms (all translations of the word). For English answers, other meanings of the same
   word: *correct, but in this context: …*. Vietnamese words have two accepted spellings, both right: the tone mark
   on either vowel (*hoá* / *hóa*) and final *i* or *y* after a consonant (*công ti* / *công ty*, *kĩ* / *kỹ*).
3. **Right word, wrong form.** Another inflection of the same word gets *Almost*, with an explanation of the
   expected form.
4. **Same English meaning, different word** (e.g. Vietnamese *anh*, *chị* and *em* are all "you"): *Almost*, with
   the usage note.
5. **A different known word** (confusables such as *кот* and *код*): *Incorrect, that's a different word*.
6. **Russian ё/е:** correct.
7. **Diacritics:**
   - **Vietnamese:** a wrong tone is a different word, so it is incorrect, except in lenient mode where it is
     *Almost*. Missing all tones is *Almost*.
   - **Spanish, Portuguese and Polish:** missing accents are *Almost*, or correct in lenient mode.
   - **Strict mode:** every accent is required.
8. Spacing differences.
9. **Typos:** the allowance grows with word length, and is stricter for English. A typo is *Almost*.

Any wrong typed answer offers **"I was right"**, so the checker's verdict never stands when it is mistaken. An answer
marked right counts as correct, but a hint used before it still makes it *Hard*, and a revealed answer stays *Again*. Speaking,
sentence writing and pronunciation are **self-rated**: the app does not pretend to grade speech.

## Ratings

| What happened | Suggested FSRS rating |
|---|---|
| Incorrect, revealed, or "I don't know" | Again (1) |
| *Almost*, or correct after a hint | Hard (2) |
| Correct, first try, no hint | Good (3) |
| Easy (4) | Only when **you** choose it: self-rated exercises, or *Confirm ratings* mode (Settings → General) |

In the default *automatic* mode the suggestion is used as is. In *confirm* mode you see the four rating buttons after
each answer (keys 1–4) and can change the suggestion. Overrides are stored as such.

## When an answer changes the schedule

Every answer is stored. Only some answers are **scheduling events** that update FSRS. The rest are **practice**,
which counts toward skill evidence and statistics but leaves the schedule alone. An answer is a scheduling event
only if all of these hold:

1. The exercise trains a memory (receptive or productive), is graded, and is not assisted (`word_choice`) or
   practice-only (`sentence_create`, `shadowing`).
2. The card is no longer new, and it was **due by the end of the local day** of the answer, in the owner's timezone.
3. The card has **no scheduling event yet on that local day**. The database enforces this with a unique index on
   (card, local day).
4. The word's **other memory** has had no scheduling event that day. A word's recognition and recall are never both
   rescheduled on the same day, within a session or across sessions. The only exception is a new word's first
   session, where each memory receives its initial rating. A recall memory that is introduced later (for example,
   because the first session ended before the production stage) is only started on a day when its recognition
   memory is neither due nor already reviewed.

So the first eligible retrieval of a due card each day counts. A missed card's follow-up questions in the same session
are practice: they help you learn, but cannot inflate the interval.

**Practice answers count too (2.0.0).** Grammar forms, sentence gaps, Identify and Writing, on the Practice pages and in
a session's practice rounds, test a word's memory, so each answer is a scheduling event under rules 3 and 4 above, and
never a word's first event (`scheduleFromPractice` in `server/learning/scheduling.ts`):

- **Which memory.** A typed form, a typed gap word, a typed picture name and each word of a Writing translation test
  recall (productive). A picked gap word and a picked picture name test recognition (receptive).
- **The rating** follows the session rules: wrong or *I don't know* is Again, close or hinted is Hard, otherwise Good.
- **Early answers count.** Unlike a session exercise, a practice answer also counts when its card is not due yet. FSRS
  weighs an early review by how likely recall still was, so an early right answer moves the date out a little and an
  early miss brings the word back soon. The exception: when the word's other memory is due that day, the answer stays
  practice, so practice never takes the place of a due review.
- **Due words first.** Practice batches ask the words whose memory is due by the end of the day first (after the ones
  missed lately), then words scheduled later, then words not scheduled yet.
- **Writing** rates each word being learned that appears in the translation the answer was compared with, matched by
  headword or listed form (a form two words share is skipped). *I was right* turns those Again ratings into
  Good and recomputes the cards from their history.
- Reading texts and *Read and say* stay practice.

**New words** follow different rules. During the first session, each of the word's two memories gets **one aggregated
initial rating**. It is applied after the last graded exercise on that memory in the session (optional ones included),
or when the session ends:

- **Again** if the last attempt failed, or if two or more attempts failed.
- **Hard** if one attempt failed, or any attempt was *Almost* or needed a hint.
- **Good** otherwise.

**Late and offline answers.** An answer that reaches the server after a later review of the same card (for example,
from a device that was offline) is judged against the card's state at the time of the answer. It is inserted in time
order, and the card's FSRS state is **replayed** from its full history. A late answer is never dropped, and it never
corrupts the interval.

## FSRS-6 (`shared/fsrs.ts`)

- A port of [py-fsrs](https://github.com/open-spaced-repetition/py-fsrs) 6.3.0 with its 21 default parameters. Its
  results match the reference implementation to within 1e-9 on recorded fixtures (`tests/unit/fsrs.test.ts`). The
  rounding matches too: Python banker's rounding, and whole-day elapsed time.
- **No short-term learning steps.** Intervals are in whole days, because in-session repetition is handled by
  the session engine rather than by sub-day FSRS steps.
- **Interval fuzz** is deterministic per card and review time. Replaying a card's history therefore reproduces the
  same due dates.
- **Desired retention** is set per language (80–97%, default 90%). Settings → Learning shows the trade-off: the
  simulated reviews per day for each target, for your card count. Changing it reschedules every future due date from
  the full review history.
- **Your memory model (2.0.0; `shared/fsrs-optimizer.ts`, `server/learning/memory-model.ts`).** The 21 parameters
  describe an average learner. Once a language has 1,000 reviews that test the model (each at least a day after the
  review before it; `FIT_MIN_REVIEWS`), Settings → Learning → Memory offers *Fit to my reviews*:
  - **The fit** follows the FSRS optimizer's method. The four initial stabilities come first, each from the second
    reviews of the words first rated that way; then all 21 parameters together by gradient descent (Adam, in batches
    of cards) on the log loss of the model's predictions, with a pull toward the starting values so that few reviews
    move the model little, and within the ranges FSRS-6 allows. The same reviews always give the same parameters.
  - **The test.** The reviews are split by time: the fit learns from the earlier four fifths and is judged on the
    latest fifth, which it has not seen. It is used only when its predictions there are better than the standard
    parameters' by at least 1% of the log loss (`FIT_MIN_GAIN`) and by more than chance explains (the saving per
    review at least 1.5 standard errors, `FIT_MIN_Z`). Then parameters fitted on all the reviews go into use.
  - **Using it.** The parameters are the language setting `fsrsParameters` (only the server writes it; `fsrsFit`
    keeps what the last fit found), so every device schedules alike. Every card of the language is recomputed from
    its whole review history at once, as after a change of the retention target, and the statistics and the
    retention table use the model in use. A later fit that is not better puts the standard parameters back, and so
    does *Use the standard model*; both restore every due date exactly, because the review log is the truth.
  - `GET /api/languages/:code/memory-model` gives the model in use, the reviews there are of the number needed and
    the last fit; `POST …/memory-model/fit` and `POST …/memory-model/reset` change it. Tests fit a synthetic
    learner whose memories grow more slowly than the standard model says (the fit is taken, and predicts unseen
    reviews better) and one the standard model fits (it is not).

## Mastery levels

Shown per word. Each level needs the previous one, plus delayed-correct evidence:

| Level | Requirement |
|---|---|
| 0 New | Not studied yet |
| 1 Encountered | Introduced |
| 2 Recognizes in writing | Recognition or context answered correctly on a later day |
| 3 Understands by ear | Listening correct on a later day. Skipped when no audio exists for the word |
| 4 Retrieves from English | Recall correct on a later day |
| 5 Uses in sentences | Sentence completion or production correct on a later day |
| 6 Productive mastery | All of the above, and the recall memory's stability is at least 21 days |

## Statistics (`server/services/stats.ts`, `server/services/skills.ts`, `shared/stats.ts`)

- **What counts as study.** Since 1.8.0 a day's study is made of three kinds of answers, each stored once in its own
  table, so adding them up never counts an answer twice:
  - **session answers** (`exercise_attempts`, totalled per day in `daily_stats`; new-word cards are not answers).
    Reviews are some of these answers, never added on top;
  - **practice answers** (`practice_attempts`: forms, sentence gaps, Identify, Read and Say it), from the Practice
    pages and from the rounds of Comprehensive sessions. A round's answer is stored there only;
  - **reading comprehension texts** (`comprehension_attempts`, one row per text with its questions).
- **Activity.** Today's figures, Today's week, the streak, the Progress page's study time, the 90-day history and the
  30-day efficiency figures count all three. A day with only practice rounds, or only a text read, is a study day and
  keeps the streak going. *Answers per day* (Progress → More detail → Study history) is session answers + practice
  answers + reading questions; each bar's value (see *Reading the charts* below) and the table under the charts (*Show
  the numbers per day*) split them into session answers (with the reviews among them), practice answers and texts. *Last studied* also counts
  practice and texts. The streak looks back 60 days, and up to 400 when it is that long.
- **Study time** is active time measured on the device (`shared/activity.ts`): it runs while the page is visible and
  the learner tapped, clicked or typed in the last 90 seconds. Sessions send it with every answer and event (at most
  five minutes each). A Comprehensive session's practice rounds are session time: it is sent when a round ends, in
  parts of at most five minutes, and their answers carry none. The Practice pages send it with each practice answer
  (`activeMs`, at most five minutes, ten for a reading text) and the server adds it to the day's `daily_stats.study_ms`
  only when the attempt is newly stored, so a retried upload counts once. Time on the Practice pages before 1.8.0 was
  not recorded. *Successful delayed recalls per study hour* divides by all study time, practice included.
- **Learned:** the recognition memory has at least two reviews and a stability of at least 3 days. **Mature:**
  stability of at least 21 days. These are vocabulary counts, not a proficiency measure. The app says so where it
  shows them. Deleted words are not counted (before 1.8.0, *learned*, *well known* and *mastered* still counted them).
- **Estimated retention:** the FSRS model's average predicted recall for your cards right now.
- **Observed retention:** the share of *delayed* reviews (at least one day after the previous one) that you answered
  correctly in the last 30 days. Comparing the two shows whether the model is optimistic or pessimistic for you.
### The Progress page (`server/services/progress.ts`, `shared/progress.ts`, `web/src/pages/ProgressPage.tsx`)

*Progress* (`/progress`; the old `/stats` and `/stats/<lang>` addresses lead there, a language in the address becoming
the active one) shows the active language. Its figures come from `GET /api/stats/progress/:code` (what does not depend
on the period) and `GET /api/stats/progress/:code/period?window=7|30|all` (30 days by default). Nothing there writes,
and none of it touches FSRS. In the page's order:

- **Your words.** Each word of the set is in at most one of three groups, from the Words page's statuses: *known* is
  learned (well known and mastered words included) or marked as known; *being learned* is introduced and not yet
  learned (*Learning*); *not started* is new. Suspended and deleted words are in none. Today's row to Progress shows the
  same counts (`LanguageStats.known` and `learning` in the bootstrap).
- **Words known, 90 days.** A line with one value a day, rebuilt from what the app already stores:
  - learned words from the recognition memory's review log, replayed: at the end of a day a word is learned when it has
    had at least two reviews and the stability after the latest is at least 3 days, the rule the counts use now. Every
    review is logged with the stability after it, and recomputing a card (a late offline answer, a new retention
    target) rewrites its log too, so this part is exact, words forgotten and learned again included;
  - words marked known on a session's new-word card count from that answer's day (exact, also when the answer arrives
    later from a device that was offline);
  - words marked known on their page count from `learning_items.updated_at`, the moment of the change. Starring a word
    or flagging it difficult no longer moves `updated_at`, so this stays exact; a word starred after it was marked known
    before this change counts from the day it was starred;
  - suspended words count until the day they were suspended (`updated_at`, likewise), deleted words until the day they
    were deleted (`deleted_at`). A word suspended or marked known and later restored counts as its reviews say.

  No migration was needed. Today's value is always the known count.
- **The most common words.** The 1,000 words of the set with the lowest frequency ranks (all ranked words when fewer)
  and the share known, rounded down so it never shows 100% too early. Hidden when no word has a frequency rank (a
  curated order is not a frequency).
- **Next milestone** (100, 250, 500, 1,000, 2,000, 3,000, 4,000 and 5,000 words known) and *about N weeks at this
  pace*, from the words known today and 30 days ago (net of words forgotten). Without growth there is no estimate, and
  past 5,000 no milestone.
- **The period:** 7 days, 30 days or all time, the last 7 or 30 local days with today. It sets the skills and study time;
  the trend compares with the period of the same length before it.
- **Your skills.** Every answer counts in exactly one card:

  | Card | Answers | Right |
  |---|---|---|
  | Words | Every session exercise not in the cards below: choosing a meaning, a word or a picture, the meaning in context, typing a meaning, and the self-rated ones (say it aloud, shadowing, a sentence of your own) | Correct; self-rated: Hard or better |
  | Writing words | Typed recall in sessions (`recall_typed`) | Correct |
  | Listening | Session exercises by ear: listen for the meaning, which word, dictation | Correct |
  | Grammar | Forms: `form_typed` in sessions and the forms practice (Practice page and session practice). Left out for Vietnamese | Correct |
  | Sentences | Sentence gaps everywhere: `cloze_choice` and `cloze_typed` in sessions and the sentence-gap practice | Correct |
  | Pictures | Identify | Correct |
  | Speaking | Say it: whole sentences from English | Correct |
  | Reading | The questions of the texts read, and the sentences read (Read) | A question right; a sentence understood in full |

  *Almost* is never right. A card shows the share right in the period, the trend against the period before (*up 3
  points*, *down 2 points*, *about the same* within one point; nothing for all time, or when either period has fewer
  than 10 answers) with an arrow and the good or warning colour, and the number of answers. Reading leads with the
  reading level and how many of that level's texts have been read. A card leads to its practice: Words, Writing words
  and Listening start a session (balanced, with more typing, with more listening), the others open their Practice
  page (which has left the navigation bar; the Study screen also links to it). *Weakest this month* (*this week*, *so
  far*) names the skill with the lowest share right among those with at least 20 answers, when at least two have that
  many.
- **Study time.** Minutes per day (rounded) over 7 or 30 days, or for all time minutes a day averaged per week (Monday
  to Sunday, over the week's days since the first day studied), against the **daily goal** drawn as a dashed line. A
  period counts from the first day the language was studied (`firstStudyDay`: the first day with session time, session
  answers or new words, practice answers, or a text read) when that is later than the period's first day: the days
  before it were not missed, so they are left out of the bars, the average and the goal days, and the page says so
  (*in the 3 days since you started on Nov 6*, *today, the first day you studied*). Before any study there is no chart.
  The goal is a setting per language (`dailyGoalMinutes`, Settings → Learning, 20 minutes by default); Today's week and
  the session summary use it too. *Goal met on N of M days* counts every counted day of the period but today, and today
  once its goal is met. The streak is the language's.
- **Coming up.** Reviews due on each of the next 7 days, today with the overdue ones; a word counts once a day (its two
  memories never both get a review on the same day). *About M minutes a day keeps you up to date* is the week's reviews
  at the learner's own median answer time for the reviews of the last 30 days (plus 3 seconds of feedback each; 15
  seconds a review with fewer than 10 timed reviews), spread over 7 days.
- **Words that need work.** The five words missed most in the last 30 days: session answers wrong (or revealed) or
  self-rated Again, and forms, sentence-gap and Identify answers wrong or revealed (*almost* is not a miss); most misses
  first, then the highest share missed. Read and Say it are about sentences, not one word, so they are left out.
  *Practice these N* opens sentence gaps for exactly those words (`/practice/cloze?entries=…`, the practice scope
  `entries`); a word without an example sentence has nothing to ask there.
- **More detail**, closed until opened, from `GET /api/stats/language/:code`: memory strength (estimated recall now for
  recognition and for recall, observed delayed recall, words met, learned, well known and mastered), accuracy by
  question type (sessions, 90 days) and by ability, words by frequency band (known and being learned per band), and the
  90-day study history (minutes against the goal, answers and reviews per day, the numbers per day, study efficiency).
- **Reading the charts** (`web/src/components/charts.tsx`). Every value can be read without a mouse. The words-known
  line and the bars of minutes, answers and reviews show one value in the line under them, the
  latest at first: tapping or clicking a day shows that day's (hovering does too, with a mouse), and with the chart
  focused the arrow keys, Home and End move through the days, the line being announced as it changes. A table only
  screen readers see holds every value, and the chart's accessible name sums it up. *Coming up* prints each day's count
  above its bar and all of them in its accessible name.

`GET /api/stats/skills/:code?window=7|30|all` (`server/services/skills.ts`) still answers with the earlier breakdown
per practice (retention by memory, the weakest cases or tenses, the different things named in Identify, Read and Say
it apart); the app no longer shows it.

Today (`web/src/pages/Dashboard.tsx`) shows the active language: today's session in one sentence and one bar of its
mix (reviews due, new words, the practice mixed in, as `GET /api/sessions/preview?quick=1` plans it; worked out on the
device from the bootstrap and `planPractice` when offline) with its length and Start, the last seven days as rings
filling toward the daily goal with the streak, and the words known toward the next round number, leading to Progress;
below them the other languages, to switch to.
