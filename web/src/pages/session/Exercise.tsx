// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * One session exercise on screen (2.0.0 layout): the prompt at the top with the word as the hero in the serif, the
 * answer area below, the action in the bottom bar, and feedback in a bottom panel that says the answer once, why, and
 * what the answer did to the word's memory, with Continue always in the same place.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LuBookOpenText, LuEye, LuLightbulb, LuMic, LuPlay, LuSquare } from 'react-icons/lu';
import { KINDS, STAGE_LABELS } from '../../../../shared/exercises.ts';
import type { Rating } from '../../../../shared/fsrs.ts';
import type { LanguageCode } from '../../../../shared/languages.ts';
import type { AttemptResponse, ItemResource, SessionExercise } from '../../../../shared/types.ts';
import type { Strictness } from '../../../../shared/answer.ts';
import type { ExactCell } from '../../../../shared/grammar.ts';
import { plain } from '../../lib/format.ts';
import { settings } from '../../lib/store.ts';
import { cn } from '../../lib/utils.ts';
import { AudioControls, type AudioHandle } from './AudioControls.tsx';
import { AiSentenceNote } from '../../components/ui.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../../components/ui/input-group.tsx';
import { Textarea } from '../../components/ui/input.tsx';
import { TypingHelper } from './TypingHelper.tsx';
import { gradeLocal, type AnswerInput, type LocalOutcome } from './runtime.ts';
import { answerInTable, GrammarNote, TableToggle } from '../../components/ParadigmTable.tsx';
import { ActionBar, AnswerLine, ContinueButton, FeedbackPanel, OptionButton, RatingButtons, ReviewBadge, useKeys, type ScheduleChange, type Verdict } from './parts.tsx';

export { useKeys } from './parts.tsx';

// ---------------------------------------------------------------- helpers

function useSwipe(onLeft?: () => void, onRight?: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: { clientX: number; clientY: number; pointerType: string }) => {
      if (e.pointerType === 'mouse') return;
      start.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: { clientX: number; clientY: number }) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      if (Math.abs(dx) > 70 && Math.abs(e.clientY - s.y) < 50) (dx < 0 ? onLeft : onRight)?.();
    },
  };
}

export function Word({ text, className = '' }: { text: string; className?: string }) {
  const shown = settings().showStressMarks ? text : plain(text);
  return <span className={`word ${className}`}>{shown}</span>;
}

function Highlighted({ text, display, range }: { text: string; display?: string | null; range: [number, number] }) {
  const t = settings().showStressMarks && display ? display : text;
  // Map the plain-text range onto the stress-marked string when needed.
  if (t !== text) {
    let pi = 0;
    let start = -1;
    let end = -1;
    for (let di = 0; di <= t.length; di++) {
      if (pi === range[0] && start < 0) start = di;
      if (pi === range[1] && end < 0) {
        end = di;
        while (t[end] === '́' || t[end] === '̀') end++;
        break;
      }
      if (di < t.length && t[di] !== '́' && t[di] !== '̀') pi++;
    }
    if (start >= 0 && end >= 0)
      return (
        <>
          {t.slice(0, start)}
          <span className="mark">{t.slice(start, end)}</span>
          {t.slice(end)}
        </>
      );
  }
  return (
    <>
      {text.slice(0, range[0])}
      <span className="mark">{text.slice(range[0], range[1])}</span>
      {text.slice(range[1])}
    </>
  );
}

function ClozeSentence({ p, filled }: { p: any; filled?: string | null }) {
  const stress = settings().showStressMarks;
  const before = stress && p.beforeDisplay != null ? p.beforeDisplay : p.before;
  const after = stress && p.afterDisplay != null ? p.afterDisplay : p.after;
  return (
    <p className="word text-[1.5rem] leading-[1.55] sm:text-[1.75rem]">
      {before}
      {filled ? <span className="mark">{filled}</span> : <span className="blank" aria-label="blank">&nbsp;</span>}
      {after}
    </p>
  );
}

const POS_LABEL: Record<string, string> = { noun: 'noun', verb: 'verb', adjective: 'adjective', adverb: 'adverb', pronoun: 'pronoun', preposition: 'preposition', conjunction: 'conjunction', numeral: 'number', particle: 'particle', interjection: 'interjection', phrase: 'phrase', determiner: 'determiner', classifier: 'classifier', contraction: 'contraction', other: '' };
const GENDER: Record<string, string> = { m: 'masculine', f: 'feminine', n: 'neuter' };

function grammarParts(item: ItemResource): string[] {
  return [POS_LABEL[item.pos] ?? item.pos, item.gender ? GENDER[item.gender] ?? item.gender : null, item.aspect, item.register && item.register !== 'neutral' ? item.register : null].filter(Boolean) as string[];
}

function Grammar({ item }: { item: ItemResource }) {
  const parts = grammarParts(item);
  return parts.length ? <span className="text-muted-foreground">{parts.join(', ')}</span> : null;
}

/** The part of speech (and gender, aspect) as small badges beside a prompt. */
function GrammarBadges({ item }: { item: ItemResource }) {
  const parts = grammarParts(item);
  if (!parts.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {parts.map((x) => (
        <Badge key={x} variant="secondary" className="font-normal">
          {x}
        </Badge>
      ))}
    </span>
  );
}

function languageName(code: LanguageCode) {
  return { es: 'Spanish', pt: 'Portuguese', vi: 'Vietnamese', ru: 'Russian', uk: 'Ukrainian', pl: 'Polish' }[code];
}

// ---------------------------------------------------------------- shared props

export interface ExerciseProps {
  ex: SessionExercise;
  item: ItemResource;
  language: LanguageCode;
  strictness: Strictness;
  server: AttemptResponse | null;
  commit: (input: AnswerInput, outcome: LocalOutcome) => void;
  next: () => void;
  skip: () => void;
  /** In place of the stage line: the question's type (a Comprehensive session names every question's type). */
  label?: ReactNode;
}

/** What the answer did to the word's memory, from the server's reply (null while it is on its way). */
function reviewChanges(server: AttemptResponse | null): ScheduleChange[] {
  if (!server) return [];
  return [...(server.review ? [server.review] : []), ...server.finalized.flatMap((f) => f.changes)];
}

function SessionReview({ server, ex, item }: { server: AttemptResponse | null; ex: SessionExercise; item: ItemResource }) {
  if (!server) return navigator.onLine ? null : <ReviewBadge changes={[]} offline />;
  return <ReviewBadge changes={reviewChanges(server)} isNew={item.isNew} counts={!KINDS[ex.kind].practiceOnly && !!ex.cardSkill} />;
}

/** Messages that only repeat the feedback title. */
const GENERIC_MESSAGES = new Set(['Correct.', 'Not quite.']);

/** The meaning (index into senses) a sentence shows: its linked meaning, or the only meaning of a one-meaning word. */
function meaningIndex(item: ItemResource, x: ItemResource['examples'][number]): number | null {
  if (x.sense != null) return item.senses[x.sense] ? x.sense : null;
  return item.senses.length === 1 ? 0 : null;
}

/** Up to two sentences for a new word's card: one for each of its first meanings, then any others. */
function introExamples(item: ItemResource) {
  const out: ItemResource['examples'] = [];
  for (let k = 0; k < item.senses.length && out.length < 2; k++) {
    const x = item.examples.find((e) => meaningIndex(item, e) === k);
    if (x) out.push(x);
  }
  for (const x of item.examples) if (out.length < 2 && !out.includes(x)) out.push(x);
  return out;
}

/** Answers in the language being learned (shown in the serif, with audio). */
function answerInLanguage(ex: SessionExercise): boolean {
  return KINDS[ex.kind].card === 'productive' || ex.kind === 'listen_choice' || ex.kind === 'cloze_choice';
}

const verdictOf = (g: LocalOutcome['grade']): Verdict => (g === 'correct' || g === 'close' || g === 'self' ? g : 'incorrect');

/**
 * The feedback panel of an exercise: the verdict, the answer once (with its audio when it is a word), why (the grammar
 * of a form), what it did to the memory, and an example and the table one tap away. `you`: what the learner wrote.
 */
function Feedback({ outcome, item, language, ex, server, you, actions }: { outcome: LocalOutcome; item: ItemResource; language: LanguageCode; ex: SessionExercise; server: AttemptResponse | null; you?: string | null; actions: ReactNode }) {
  const g = outcome.grade;
  const [showExample, setShowExample] = useState(g === 'incorrect');
  // The meaning this exercise was about: a sentence question's own meaning, otherwise the word's first meaning.
  const p = ex.payload as { meaning?: string; options?: Array<{ id: string; text: string }>; correctId?: string };
  const shownGloss = p.meaning ?? (ex.kind === 'context_meaning' ? p.options?.find((o) => o.id === p.correctId)?.text : undefined) ?? item.senses[0]?.gloss;
  const shownSense = Math.max(0, item.senses.findIndex((s) => s.gloss === shownGloss));
  const example = item.examples.find((x) => x.translation && meaningIndex(item, x) === shownSense) ?? item.examples.find((x) => x.translation && meaningIndex(item, x) == null);
  const typed = KINDS[ex.kind].response === 'typed';
  const expected = g === 'correct' || g === 'self' ? null : (typed ? outcome.check?.expected : null) ?? outcome.expectedText ?? null;
  const inLang = answerInLanguage(ex);
  const heard = ['listen_meaning', 'listen_choice', 'dictation'].includes(ex.kind);
  const message = outcome.check?.message && !GENERIC_MESSAGES.has(outcome.check.message) && !(expected && outcome.check.message.includes(expected)) ? outcome.check.message : null;
  return (
    <FeedbackPanel verdict={verdictOf(g)} actions={actions}>
      {message && <p>{message}</p>}
      {expected && (
        <div className="flex flex-wrap items-center gap-2">
          <AnswerLine serif={inLang} lang={inLang ? language : 'en'}>
            {inLang ? <Word text={expected} /> : expected}
          </AnswerLine>
          {inLang && <AudioControls entryId={item.entryId} language={language} showDetails={false} />}
        </div>
      )}
      {you != null && g !== 'correct' && (
        <p className="text-sm text-muted-foreground">
          You wrote <span className={cn('line-through decoration-destructive/60', inLang && 'word text-base')}>{you || '—'}</span>
        </p>
      )}
      {(heard || (!expected && g !== 'correct' && g !== 'self')) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Word text={item.display} className="text-2xl" />
          <span className="text-muted-foreground">{shownGloss}</span>
          {!inLang && <AudioControls entryId={item.entryId} language={language} showDetails={false} />}
        </div>
      )}
      {g !== 'self' && <GrammarNote text={answerGrammar(outcome, item, language, ex).note} />}
      <div className="flex flex-wrap items-center gap-2">
        <SessionReview server={server} ex={ex} item={item} />
      </div>
      {(example || (item.paradigm && !item.paradigm.indeclinable)) && (
        <div className="space-y-2 pt-0.5">
          {example && (
            <Button variant="ghost" size="sm" className="-ml-2.5 text-muted-foreground" aria-expanded={showExample} onClick={() => setShowExample(!showExample)}>
              <LuBookOpenText aria-hidden="true" /> {showExample ? 'Hide the example' : 'Example'}
            </Button>
          )}
          {example && showExample && (
            <div className="rounded-xl bg-card/80 px-3.5 py-2.5">
              <p className="word text-[1.125rem] leading-snug">{settings().showStressMarks && example.display ? example.display : example.text}</p>
              <p className="text-muted-foreground">{example.translation}</p>
              {example.ai && <AiSentenceNote className="mt-1" />}
            </div>
          )}
          <AnswerTable outcome={outcome} item={item} language={language} ex={ex} />
        </div>
      )}
    </FeedbackPanel>
  );
}

/** The form an answer needed, when it is not the dictionary form (a table cell to point at). */
function expectedForm(outcome: LocalOutcome, ex: SessionExercise): string | null {
  const p = ex.payload as { answer?: { accepted?: string[] } };
  if (KINDS[ex.kind].response === 'typed') return outcome.check?.expected ?? p.answer?.accepted?.[0] ?? null;
  if (KINDS[ex.kind].response === 'choice') return outcome.expectedText || null;
  return null;
}

/**
 * The form an answer needed, its cells and why (shared/grammar.ts): the sentence of a gap can settle the case or tense,
 * its annotated exact cell (`exact`) names the one it is, and a "Produce the form" question names its cell.
 */
function answerGrammar(outcome: LocalOutcome, item: ItemResource, language: LanguageCode, ex: SessionExercise) {
  const p = ex.payload as { cell?: string; before?: string; after?: string; exact?: ExactCell };
  const sentence = ex.kind === 'cloze_typed' || ex.kind === 'cloze_choice' ? { before: p.before, after: p.after, exact: p.exact } : null;
  return answerInTable(language, item.paradigm, item.lemma, item.display, expectedForm(outcome, ex), p.cell, sentence);
}

/**
 * The word's table under an answer. When the answer was an inflected form the learner missed, the table is offered as
 * the main way to check it, with the cell marked (the explanation stands above, in the feedback).
 */
export function AnswerTable({ outcome, item, language, ex }: { outcome: LocalOutcome; item: ItemResource; language: LanguageCode; ex: SessionExercise }) {
  if (!item.paradigm || item.paradigm.indeclinable) return null;
  const a = answerGrammar(outcome, item, language, ex);
  const missed = outcome.grade !== 'correct' && outcome.grade !== 'self' && a.inflected;
  return <TableToggle key={ex.id} language={language} paradigm={item.paradigm} highlight={a.cells} emphasis={missed} />;
}

// ---------------------------------------------------------------- intro

function Intro({ ex, item, language, commit, next, label }: ExerciseProps) {
  const [showForms, setShowForms] = useState(false);
  const proceed = () => {
    commit({}, { grade: 'self', check: null, suggested: null, final: null, expectedText: '' });
    next();
  };
  const known = () => {
    commit({ markKnown: true }, { grade: 'self', check: null, suggested: null, final: null, expectedText: '' });
    next();
  };
  const swipe = useSwipe(proceed);
  const audio = useRef<AudioHandle | null>(null);
  useKeys((e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      proceed();
      return true;
    }
    if (e.key === 'r' || e.key === 'R') {
      audio.current?.play();
      return true;
    }
  }, []);
  return (
    <article className="touch-pan-y" {...swipe}>
      {/* A Comprehensive session names the type above every question already. */}
      {!label && (
        <Badge variant="soft" className="mb-4 h-7 px-2.5 text-[0.8125rem] font-semibold">
          New word
        </Badge>
      )}
      <div className="flex flex-col items-center text-center">
        <h2 className="text-[clamp(2.75rem,11vw,4.5rem)] leading-none" lang={language}>
          <Word text={item.display} />
        </h2>
        <p className="mt-3 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-sm">
          <GrammarBadges item={item} />
          {item.aspectPair && (
            <span className="text-muted-foreground">
              pair: <span className="word text-base text-foreground">{item.aspectPair}</span>
            </span>
          )}
          {item.pronunciation && <span className="text-muted-foreground">{item.pronunciation}</span>}
        </p>
        <div className="mt-4">
          <AudioControls entryId={item.entryId} language={language} autoPlay handleRef={audio} />
        </div>
      </div>
      <ol className="mt-6 space-y-2">
        {item.senses.map((s, i) => (
          <li key={i} className="flex gap-3 text-[1.3rem] leading-snug">
            {item.senses.length > 1 && <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{i + 1}</span>}
            <span>
              {s.gloss}
              {s.note && <span className="ml-2 text-base text-muted-foreground">({s.note})</span>}
              {/* Usage examples ("на почте = at the post office"); a definition that only repeats the gloss is skipped. */}
              {s.definition && !s.definition.startsWith(s.gloss) && <span className="block text-base text-muted-foreground">{s.definition}</span>}
            </span>
          </li>
        ))}
      </ol>
      {item.examples.length > 0 && (
        <ul className="mt-6 space-y-3">
          {introExamples(item).map((x, i) => (
            <li key={i} className="rounded-xl border-l-[3px] border-lang/60 bg-muted/50 px-4 py-3">
              {item.senses.length > 1 && meaningIndex(item, x) != null && <p className="mb-0.5 text-xs text-muted-foreground">Meaning {meaningIndex(item, x)! + 1}</p>}
              <p className="word text-[1.25rem] leading-snug" lang={language}>
                {x.start != null && x.end != null ? <Highlighted text={x.text} display={x.display} range={[x.start, x.end]} /> : settings().showStressMarks && x.display ? x.display : x.text}
              </p>
              {x.translation && <p className="text-muted-foreground">{x.translation}</p>}
              {x.ai && <AiSentenceNote className="mt-1" />}
            </li>
          ))}
        </ul>
      )}
      {(item.grammarNotes || item.regionalNote) && (
        <div className="mt-5 space-y-1 text-[0.95rem]">
          {item.grammarNotes && <p>{item.grammarNotes}</p>}
          {item.regionalNote && <p className="text-muted-foreground">{item.regionalNote}</p>}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-x-2">
        {item.paradigm && !item.paradigm.indeclinable && <TableToggle language={language} paradigm={item.paradigm} focus={false} />}
        {((item.forms.length > 0 && !item.paradigm) || item.expressions.length > 0) && (
          <Button variant="ghost" size="sm" className="mt-1 -ml-2.5 text-muted-foreground" onClick={() => setShowForms(!showForms)} aria-expanded={showForms}>
            {item.paradigm || !item.forms.length ? (showForms ? 'Hide expressions' : 'Expressions') : showForms ? 'Hide forms and expressions' : 'Forms and expressions'}
          </Button>
        )}
      </div>
      {showForms && (
        <div className="mt-2 grid gap-4 rounded-xl border bg-card p-3.5 shadow-xs sm:grid-cols-2">
          {item.paradigm ? null : item.inflection ? (
            <div>
              <p className="mb-1 text-sm font-semibold">{item.inflection.title}</p>
              <table className="w-full text-[0.95rem]">
                <tbody>
                  {item.inflection.rows.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-3 text-muted-foreground">{r.label}</td>
                      <td className="py-1">
                        <Word text={r.forms.join(', ')} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="hint mt-1">The full table is on the word’s page.</p>
            </div>
          ) : (
            item.forms.length > 0 && (
              <table className="w-full text-[0.95rem]">
                <tbody>
                  {item.forms.map((f, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1 pr-3">
                        <Word text={f.display || f.form} />
                      </td>
                      <td className="py-1 text-muted-foreground">{f.tags.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
          {item.expressions.length > 0 && (
            <ul className="space-y-1 text-[0.95rem]">
              {item.expressions.map((x, i) => (
                <li key={i}>
                  <span className="word">{x.text}</span>
                  {x.translation && <span className="text-muted-foreground"> — {x.translation}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="hint mt-6 text-center">Say it aloud, then tap Got it.</p>
      <span className="sr-only">{ex.id}</span>
      <ActionBar>
        <Button variant="ghost" size="xl" className="px-3 text-muted-foreground" onClick={known}>
          I know it
        </Button>
        <ContinueButton onClick={proceed} label="Got it" />
      </ActionBar>
    </article>
  );
}

// ---------------------------------------------------------------- choice

function ChoicePrompt({ ex, item, language, revealed, audioRef, onAudio }: { ex: SessionExercise; item: ItemResource; language: LanguageCode; revealed: boolean; audioRef: { current: AudioHandle | null }; onAudio: (ok: boolean, loading: boolean) => void }) {
  const p = ex.payload as any;
  switch (ex.kind) {
    case 'meaning_choice':
      return (
        <div className="flex flex-wrap items-center gap-4">
          <h2 className="text-[clamp(2.5rem,9vw,3.75rem)] leading-tight" lang={language}>
            <Word text={p.word} />
          </h2>
          <AudioControls entryId={item.entryId} language={language} showDetails={false} handleRef={audioRef} />
        </div>
      );
    case 'word_choice':
      return (
        <div>
          <h2 className="text-[clamp(1.75rem,6.5vw,2.5rem)] leading-tight font-semibold tracking-tight">{p.gloss}</h2>
          <p className="mt-2 flex flex-wrap items-center gap-2">
            <GrammarBadges item={item} />
            {p.note && <span className="text-muted-foreground">({p.note})</span>}
          </p>
        </div>
      );
    case 'cloze_choice':
      return (
        <div lang={language}>
          <ClozeSentence p={p} filled={revealed ? (p.options.find((o: any) => o.id === p.correctId)?.text ?? null) : null} />
          <p className="mt-2 text-muted-foreground" lang="en">
            {p.translation}
          </p>
          {p.ai && <AiSentenceNote className="mt-1" />}
          {p.mode === 'form' && p.lemmaHint && (
            <p className="mt-1 text-sm text-muted-foreground" lang="en">
              Choose the right form of <Word text={p.lemmaHint} />
            </p>
          )}
        </div>
      );
    case 'context_meaning':
      return (
        <div>
          <p className="word text-[1.5rem] leading-[1.55] sm:text-[1.75rem]" lang={language}>
            <Highlighted text={p.sentence} display={p.sentenceDisplay} range={p.highlight} />
          </p>
          {revealed && <p className="mt-2 text-muted-foreground">{p.translation}</p>}
          {p.ai && <AiSentenceNote className="mt-1" />}
          <p className="mt-2 text-sm text-muted-foreground">What does the highlighted word mean here?</p>
        </div>
      );
    case 'listen_meaning':
    case 'listen_choice':
      return (
        <div className="py-2 text-center">
          <AudioControls entryId={item.entryId} language={language} variant="hero" autoPlay handleRef={audioRef} onAvailability={onAudio} />
          {revealed && (
            <p className="mt-3">
              <Word text={ex.kind === 'listen_meaning' ? p.word : item.display} className="text-3xl" />
            </p>
          )}
          <p className="mt-3 text-sm text-muted-foreground">{ex.kind === 'listen_meaning' ? 'What does the word you heard mean?' : 'Which word did you hear?'}</p>
        </div>
      );
    case 'picture_choice':
      return <img src={p.imageUrl} alt="What is this?" className="mx-auto max-h-60 rounded-xl object-contain" />;
    default:
      return null;
  }
}

function Choice(props: ExerciseProps) {
  const { ex, item, language, commit, next, server, strictness, skip } = props;
  const p = ex.payload as any;
  const [chosen, setChosen] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<LocalOutcome | null>(null);
  const [needsRating, setNeedsRating] = useState(false);
  const [audioMissing, setAudioMissing] = useState(false);
  const started = useRef(Date.now());
  const audio = useRef<AudioHandle | null>(null);
  const confirmMode = settings().ratingMode === 'confirm';
  const wordOptions = ['word_choice', 'cloze_choice', 'listen_choice', 'picture_choice'].includes(ex.kind);

  const choose = (id: string) => {
    if (outcome) return;
    setChosen(id);
    const input: AnswerInput = { choiceId: id, latencyMs: Date.now() - started.current };
    const o = gradeLocal(ex, input, strictness);
    setOutcome(o);
    if (confirmMode) setNeedsRating(true);
    else commit(input, o);
  };
  const rate = (r: Rating) => {
    if (!outcome) return;
    const input: AnswerInput = { choiceId: chosen, latencyMs: Date.now() - started.current, ratingOverride: r !== outcome.suggested ? r : null };
    commit(input, { ...outcome, final: r });
    setNeedsRating(false);
    next();
  };
  useKeys((e) => {
    if (outcome) {
      if ((e.key === 'r' || e.key === 'R') && audio.current) audio.current.play();
      return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= p.options.length) {
      choose(p.options[n - 1].id);
      return true;
    }
    if ((e.key === 'r' || e.key === 'R') && audio.current) {
      audio.current.play();
      return true;
    }
  }, [outcome, p]);

  const listening = ex.kind === 'listen_meaning' || ex.kind === 'listen_choice';
  return (
    <div>
      <ChoicePrompt ex={ex} item={item} language={language} revealed={!!outcome} audioRef={audio} onAudio={(ok, loading) => setAudioMissing(!ok && !loading)} />
      {listening && audioMissing && !outcome ? (
        <div className="mt-8 flex flex-col items-center gap-3 text-center">
          <p className="text-muted-foreground">This listening question needs a recording, and none is available right now. Skipping does not count against you.</p>
          <Button variant="outline" onClick={skip}>
            Skip this question
          </Button>
        </div>
      ) : (
        <div className="mt-8 grid gap-2.5 sm:grid-cols-2" role="group" aria-label="Answers">
          {p.options.map((o: any, i: number) => {
            const state = !outcome ? undefined : o.id === p.correctId ? 'correct' : o.id === chosen ? 'wrong' : 'dim';
            return (
              <OptionButton key={o.id} index={i + 1} state={state} disabled={!!outcome} onClick={() => choose(o.id)} lang={wordOptions ? language : undefined}>
                <span className={wordOptions ? 'word text-[1.3rem]' : ''}>{wordOptions && settings().showStressMarks ? o.text : wordOptions ? plain(o.text) : o.text}</span>
              </OptionButton>
            );
          })}
        </div>
      )}
      {outcome && <Feedback outcome={outcome} item={item} language={language} ex={ex} server={server} actions={needsRating ? <RatingButtons suggested={outcome.suggested} onRate={rate} /> : <ContinueButton onClick={next} />} />}
    </div>
  );
}

// ---------------------------------------------------------------- typed

function TypedPrompt({ ex, item, language, hintShown, audioRef, onAudio }: { ex: SessionExercise; item: ItemResource; language: LanguageCode; hintShown: number; audioRef: { current: AudioHandle | null }; onAudio: (ok: boolean, loading: boolean) => void }) {
  const p = ex.payload as any;
  switch (ex.kind) {
    case 'meaning_typed':
      return (
        <div>
          <h2 className="text-[clamp(2.5rem,9vw,3.75rem)] leading-tight" lang={language}>
            <Word text={p.word} />
          </h2>
          <p className="mt-2 text-muted-foreground">Type the English meaning.</p>
        </div>
      );
    case 'recall_typed':
      return (
        <div>
          <h2 className="text-[clamp(1.75rem,6.5vw,2.5rem)] leading-tight font-semibold tracking-tight">{p.gloss}</h2>
          <p className="mt-2 flex flex-wrap items-center gap-2">
            <GrammarBadges item={item} />
            {p.note && <span className="text-muted-foreground">({p.note})</span>}
          </p>
          <p className="mt-2 text-muted-foreground">Type it in {languageName(language)}.</p>
          {hintShown > 0 && (
            <p className="mt-2 text-sm">
              Hint: starts with <strong className="word text-lg">{p.hint.first}</strong>, {p.hint.length} letters
            </p>
          )}
        </div>
      );
    case 'cloze_typed':
      return (
        <div>
          <div lang={language}>
            <ClozeSentence p={p} />
          </div>
          <p className="mt-2 text-muted-foreground">{p.translation}</p>
          {p.ai && <AiSentenceNote className="mt-1" />}
          {hintShown > 0 && (
            <p className="mt-1 text-sm">
              Dictionary form: <Word text={p.lemmaHint} className="text-lg" />
              {p.tags?.length ? <span className="text-muted-foreground"> — needed form: {p.tags.join(', ')}</span> : null}
            </p>
          )}
        </div>
      );
    case 'form_typed':
      return (
        <div>
          <p className="text-muted-foreground">Give this form of</p>
          <h2 className="text-[clamp(2.25rem,8vw,3.4rem)] leading-tight" lang={language}>
            <Word text={p.display} />
          </h2>
          <p className="mt-2 flex flex-wrap gap-1.5">
            {(p.tags as string[]).map((t) => (
              <Badge key={t} variant="soft" className="h-7 px-2.5 text-sm font-semibold">
                {t}
              </Badge>
            ))}
          </p>
        </div>
      );
    case 'dictation':
      return (
        <div className="text-center">
          <AudioControls entryId={item.entryId} language={language} variant="hero" autoPlay handleRef={audioRef} onAvailability={onAudio} />
          <p className="mt-3 text-sm text-muted-foreground">Type the word you hear.</p>
        </div>
      );
    default:
      return null;
  }
}

function Typed(props: ExerciseProps) {
  const { ex, item, language, commit, next, server, strictness, skip } = props;
  const p = ex.payload as any;
  const answerLang = p.answer.lang as LanguageCode | 'en';
  const [value, setValue] = useState('');
  const [hints, setHints] = useState(0);
  const [outcome, setOutcome] = useState<LocalOutcome | null>(null);
  const [pending, setPending] = useState<AnswerInput | null>(null);
  const [audioMissing, setAudioMissing] = useState(false);
  const started = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const audio = useRef<AudioHandle | null>(null);
  const hintBehavior = settings().hintBehavior;
  const confirmMode = settings().ratingMode === 'confirm';
  const canHint = (ex.kind === 'recall_typed' || ex.kind === 'cloze_typed') && hintBehavior === 'on_request';

  useEffect(() => {
    if (ex.kind !== 'dictation') inputRef.current?.focus({ preventScroll: true });
  }, []);

  const submit = (revealed = false) => {
    if (outcome) return;
    const input: AnswerInput = { response: value, hintsUsed: hints, revealed, latencyMs: Date.now() - started.current };
    const o = gradeLocal(ex, input, strictness);
    setOutcome(o);
    inputRef.current?.blur();
    // Wrong typed answers wait for a decision ("I was right" / continue); others save immediately.
    if (o.grade === 'incorrect' && !revealed) setPending(input);
    else if (confirmMode) setPending(input);
    else commit(input, o);
  };
  const finish = (opts: { override?: boolean; rating?: Rating } = {}) => {
    if (!outcome || !pending) return;
    const input: AnswerInput = { ...pending, override: opts.override, ratingOverride: opts.rating && opts.rating !== outcome.suggested ? opts.rating : null };
    const o = opts.override ? gradeLocal(ex, input, strictness) : { ...outcome, final: opts.rating ?? outcome.final };
    commit(input, o);
    setPending(null);
    next();
  };
  // If the page is hidden while a decision is pending, save the answer as graded.
  useEffect(() => {
    if (!pending) return;
    const onHide = () => {
      if (document.visibilityState === 'hidden') finish();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [pending]);
  useKeys((e) => {
    if (!outcome && e.key === 'Enter') {
      submit();
      return true;
    }
    if ((e.key === 'r' || e.key === 'R') && audio.current) {
      audio.current.play();
      return true;
    }
    if (pending && !confirmMode && e.key === 'Enter') {
      finish();
      return true;
    }
  }, [outcome, value, hints, pending]);

  const missingAudio = ex.kind === 'dictation' && audioMissing && !outcome;
  const actions = pending ? (
    confirmMode ? (
      <RatingButtons suggested={outcome!.suggested} onRate={(r) => finish({ rating: r })} />
    ) : (
      <>
        {outcome!.grade === 'incorrect' && (
          <Button variant="outline" size="xl" className="bg-card/80 px-4" onClick={() => finish({ override: true })} title="If your answer is valid and the checker did not know it">
            I was right
          </Button>
        )}
        <ContinueButton onClick={() => finish()} />
      </>
    )
  ) : (
    <ContinueButton onClick={next} />
  );
  return (
    <div>
      <TypedPrompt ex={ex} item={item} language={language} hintShown={hints} audioRef={audio} onAudio={(ok, loading) => setAudioMissing(!ok && !loading)} />
      {missingAudio ? (
        <div className="mt-8 flex flex-col items-center gap-3 text-center">
          <p className="text-muted-foreground">No recording is available for this word right now.</p>
          <Button variant="outline" onClick={skip}>
            Skip this question
          </Button>
        </div>
      ) : (
        <form
          className="mt-8"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="sr-only" htmlFor={`answer-${ex.id}`}>
            Your answer
          </label>
          <InputGroup className="h-14 rounded-xl">
            <InputGroupInput
              id={`answer-${ex.id}`}
              ref={inputRef}
              className={cn('h-full text-[1.375rem]', answerLang !== 'en' && 'word')}
              lang={answerLang === 'en' ? 'en' : answerLang}
              value={value}
              readOnly={!!outcome}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="done"
              placeholder={answerLang === 'en' ? 'Type in English' : `Type in ${languageName(answerLang)}`}
              onChange={(e) => setValue((e.target as HTMLInputElement).value)}
            />
            {canHint && !outcome && hints < 1 && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setHints(hints + 1)}>
                  <LuLightbulb aria-hidden="true" /> Hint
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
          {!outcome && <TypingHelper language={answerLang} inputRef={inputRef} setValue={setValue} />}
        </form>
      )}
      {!outcome && !missingAudio && (
        <ActionBar>
          <Button variant="ghost" size="xl" className="px-3 text-muted-foreground" onClick={() => submit(true)}>
            <LuEye aria-hidden="true" /> I don’t know
          </Button>
          <Button size="xl" className="flex-1" disabled={!value.trim()} onClick={() => submit()} data-testid="check">
            Check
          </Button>
        </ActionBar>
      )}
      {outcome && <Feedback outcome={outcome} item={item} language={language} ex={ex} server={server} you={value} actions={actions} />}
    </div>
  );
}

// ---------------------------------------------------------------- self-rated

function SpeakCard({ ex, item, language, commit, next }: ExerciseProps) {
  const p = ex.payload as any;
  const [revealed, setRevealed] = useState(false);
  const audio = useRef<AudioHandle | null>(null);
  const rate = (r: Rating) => {
    commit({ selfRating: r }, { grade: 'self', check: null, suggested: r, final: r, expectedText: p.word });
    next();
  };
  const swipe = useSwipe(revealed ? () => rate(1) : undefined, revealed ? () => rate(3) : undefined);
  useKeys((e) => {
    if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
      setRevealed(true);
      return true;
    }
    if (revealed && (e.key === 'r' || e.key === 'R')) {
      audio.current?.play();
      return true;
    }
  }, [revealed]);
  return (
    <div className="touch-pan-y" {...swipe}>
      <p className="text-muted-foreground">Say it aloud in {languageName(language)}</p>
      <h2 className="mt-1 text-[clamp(1.75rem,6.5vw,2.5rem)] leading-tight font-semibold tracking-tight">{p.gloss}</h2>
      <p className="mt-2">
        <GrammarBadges item={item} />
      </p>
      {revealed && (
        <div className="mt-8 flex animate-in flex-wrap items-center gap-4 fade-in-0 slide-in-from-bottom-2">
          <Word text={p.word} className="text-[clamp(2.25rem,8vw,3.4rem)]" />
          <AudioControls entryId={item.entryId} language={language} autoPlay handleRef={audio} />
        </div>
      )}
      <ActionBar>
        {!revealed ? (
          <Button size="xl" className="flex-1" onClick={() => setRevealed(true)}>
            Show the answer
          </Button>
        ) : (
          <RatingButtons suggested={null} onRate={rate} label="Did you say it right before you looked?" />
        )}
      </ActionBar>
    </div>
  );
}

function SentenceCreate({ ex, item, language, commit, next }: ExerciseProps) {
  const p = ex.payload as any;
  const [text, setText] = useState('');
  const [compare, setCompare] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const rate = (r: Rating) => {
    commit({ selfRating: r, response: text }, { grade: 'self', check: null, suggested: r, final: r, expectedText: '' });
    next();
  };
  return (
    <div>
      <p className="text-muted-foreground">Write your own sentence using</p>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[clamp(2.25rem,8vw,3.25rem)] leading-tight" lang={language}>
          <Word text={p.word} />
        </h2>
        <AudioControls entryId={item.entryId} language={language} showDetails={false} />
      </div>
      <p className="text-muted-foreground">{p.gloss}</p>
      <Textarea ref={ref} className="word mt-5 min-h-28 text-[1.2rem]" lang={language} value={text} onChange={(e) => setText((e.target as HTMLTextAreaElement).value)} placeholder="Your sentence" />
      <TypingHelper language={language} inputRef={ref} setValue={setText} />
      {compare && (
        <div className="mt-5 animate-in space-y-3 fade-in-0">
          <p className="text-sm text-muted-foreground">Sentences are not checked automatically: compare yours with these examples.</p>
          <ul className="space-y-2">
            {p.examples.map((x: any, i: number) => (
              <li key={i} className="rounded-xl border-l-[3px] border-lang/60 bg-muted/50 px-4 py-2.5">
                <span className="word text-lg">{x.text}</span>
                <span className="block text-muted-foreground">{x.translation}</span>
                {x.ai && <AiSentenceNote />}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ActionBar>
        {!compare ? (
          <Button size="xl" className="flex-1" disabled={!text.trim()} onClick={() => setCompare(true)}>
            Compare with examples
          </Button>
        ) : (
          <RatingButtons suggested={null} onRate={rate} label="How sure are you that your sentence is right and natural?" />
        )}
      </ActionBar>
    </div>
  );
}

function Shadowing({ ex, item, language, commit, next }: ExerciseProps) {
  const p = ex.payload as any;
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const audio = useRef<AudioHandle | null>(null);
  const mine = useRef<HTMLAudioElement | null>(null);
  const allowed = settings().recordingEnabled && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  const record = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: r.mimeType || 'audio/webm' });
        setUrl(URL.createObjectURL(blob));
        setRec(null);
      };
      r.start();
      setRec(r);
      setTimeout(() => r.state === 'recording' && r.stop(), 8000);
    } catch {
      setErr('Microphone access was refused or is unavailable.');
    }
  };
  const done = (r: Rating) => {
    commit({ selfRating: r }, { grade: 'self', check: null, suggested: r, final: r, expectedText: '' });
    next();
  };
  useKeys((e) => {
    if (e.key === 'r' || e.key === 'R') {
      audio.current?.play();
      return true;
    }
  }, []);
  return (
    <div>
      <p className="text-muted-foreground">Listen, then repeat aloud: copy the rhythm and melody.</p>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <Word text={p.word} className="text-[clamp(2.25rem,8vw,3.25rem)]" />
        <span className="text-muted-foreground">{p.gloss}</span>
      </div>
      <div className="mt-5">
        <AudioControls entryId={item.entryId} language={language} autoPlay handleRef={audio} />
      </div>
      {allowed && (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {rec ? (
            <Button variant="destructive" onClick={() => rec.stop()}>
              <LuSquare aria-hidden="true" /> Stop recording
            </Button>
          ) : (
            <Button variant="outline" onClick={() => void record()}>
              <LuMic aria-hidden="true" /> {url ? 'Record again' : 'Record yourself'}
            </Button>
          )}
          {url && (
            <>
              <Button variant="outline" onClick={() => mine.current?.play()}>
                <LuPlay aria-hidden="true" /> Play my recording
              </Button>
              <audio ref={mine} src={url} preload="auto" />
            </>
          )}
        </div>
      )}
      {err && <p className="mt-2 text-sm text-destructive">{err}</p>}
      <p className="hint mt-4">Recordings stay on this device and are not scored: compare by ear.</p>
      <ActionBar>
        <Button variant="outline" size="xl" className="flex-1" onClick={() => done(2)}>
          Needs practice
        </Button>
        <Button size="xl" className="flex-1" onClick={() => done(3)}>
          Sounded close
        </Button>
      </ActionBar>
    </div>
  );
}

// ---------------------------------------------------------------- dispatcher

export function ExerciseView(props: ExerciseProps) {
  const info = KINDS[props.ex.kind];
  let body: ReactNode;
  if (props.ex.kind === 'intro') body = <Intro {...props} />;
  else if (props.ex.kind === 'speak_flashcard') body = <SpeakCard {...props} />;
  else if (props.ex.kind === 'sentence_create') body = <SentenceCreate {...props} />;
  else if (props.ex.kind === 'shadowing') body = <Shadowing {...props} />;
  else if (info.response === 'choice') body = <Choice {...props} />;
  else body = <Typed {...props} />;
  return (
    <div data-kind={props.ex.kind} data-exercise={props.ex.id}>
      {props.label ??
        (props.ex.kind !== 'intro' && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="h-7 px-2.5 text-[0.8125rem] font-medium">
              {STAGE_LABELS[props.ex.stage]}
            </Badge>
            {props.ex.origin === 'remediation' && <span className="text-sm text-muted-foreground">another try, a different question</span>}
          </div>
        ))}
      {body}
    </div>
  );
}

export { Grammar };
