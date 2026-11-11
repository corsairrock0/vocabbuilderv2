// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useEffect, useRef, useState } from 'react';
import { LuExternalLink, LuPlay, LuSparkles, LuZoomIn } from 'react-icons/lu';
import type { AnswerSpec } from '../../../../shared/answer.ts';
import { LANGUAGES, type LanguageCode } from '../../../../shared/languages.ts';
import { canonical, stripStress } from '../../../../shared/text.ts';
import type { VocabDetail } from '../../../../shared/types.ts';
import { ApiError, get, post } from '../../lib/api.ts';
import { navigate } from '../../lib/router.tsx';
import { useActiveClock } from '../../lib/activeTime.ts';
import { ErrorNote, PageHeader, PageLoading } from '../../components/ui.tsx';
import { Word, useKeys } from '../session/Exercise.tsx';
import { OptionButton } from '../session/parts.tsx';
import { Alert, AlertDescription } from '../../components/ui/alert.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Toggle, ToggleGroup, ToggleGroupItem } from '../../components/ui/controls.tsx';
import { FieldLegend, FieldSet } from '../../components/ui/field.tsx';
import { Empty } from '../../components/ui.tsx';
import { AnswerInput, ContinueButton, FeedbackPanel, gradeAndSave, Progress, remember, remembered, ScopePicker, SizePicker, Summary, usePracticeTarget, useReviewState, type Outcome, type Result, type Scope } from './common.tsx';

export interface IdentifyItem {
  id: string;
  scene: { id: string; w: number; h: number; src: { small: string; large: string } };
  n: number;
  label: string;
  point: [number, number];
  box: [number, number, number, number];
  entryId: number;
  lemma: string;
  display: string;
  pos: string;
  alsoRight: string[];
  answer: AnswerSpec;
  choices: string[] | null;
}

interface Counts {
  identify: { scenes: number; objects: number; words: number; learningWords: number } | null;
}

interface Choices {
  scope: Scope;
  size: number;
  choices: boolean;
}

/** Identify: an everyday photo with one thing marked by a dot; name it by choosing from four or by typing. */
export function IdentifyPractice() {
  const { language, entry } = usePracticeTarget();
  if (!language) return <PageLoading />;
  return <IdentifySetup key={`${language}.${entry?.entryId ?? ''}`} language={language} entry={entry} />;
}

function IdentifySetup({ language, entry }: { language: LanguageCode; entry: VocabDetail | null }) {
  const forEntry = (entry?.identifyCount ?? 0) > 0;
  const [counts, setCounts] = useState<Counts | null>(null);
  const [choices, setChoices] = useState<Choices>(() => {
    const c = remembered(`identify.${language}`, { scope: 'learning' as Scope, size: 20, choices: true });
    return forEntry ? { ...c, scope: 'entry' } : c.scope === 'entry' ? { ...c, scope: 'learning' } : c;
  });
  const [phase, setPhase] = useState<'setup' | 'loading' | 'run' | 'done'>('setup');
  const [items, setItems] = useState<IdentifyItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);

  useEffect(() => {
    get<Counts>(`/api/practice/summary/${language}`).then(setCounts).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => {
    if (counts?.identify && counts.identify.learningWords === 0 && choices.scope === 'learning') setChoices((c) => ({ ...c, scope: 'all' }));
  }, [counts]);

  if (error && !counts) return <ErrorNote error={error} />;
  if (!counts) return <PageLoading />;
  const save = (c: Choices) => {
    setChoices(c);
    remember(`identify.${language}`, { ...c, scope: c.scope === 'entry' ? 'learning' : c.scope });
  };

  const start = async () => {
    setPhase('loading');
    setError(null);
    try {
      const r = await post<{ items: IdentifyItem[]; available: number }>('/api/practice/identify/batch', {
        language,
        scope: choices.scope,
        entryId: choices.scope === 'entry' ? (entry?.entryId ?? null) : null,
        choices: choices.choices,
        size: choices.size,
      });
      if (!r.items.length) {
        setPhase('setup');
        setError(choices.scope === 'learning' ? 'None of the words you are learning is in a picture yet. Try all words.' : 'None of your words is in a picture yet.');
        return;
      }
      setItems(r.items);
      setResults([]);
      setPhase('run');
    } catch (err) {
      setPhase('setup');
      setError(err instanceof ApiError && err.isNetwork ? 'Practice needs a connection to your server to load the pictures.' : err instanceof Error ? err.message : String(err));
    }
  };

  if (phase === 'run') {
    return (
      <IdentifyRunner
        language={language}
        items={items}
        onDone={(r) => {
          setResults(r);
          setPhase('done');
        }}
      />
    );
  }
  if (phase === 'done') return <Summary title="Identify" results={results} onAgain={() => void start()} onSetup={() => setPhase('setup')} />;

  const info = counts.identify;
  return (
    <div className="max-w-3xl pb-28 md:pb-0" data-lang={language}>
      <PageHeader title="Identify" description={`An everyday photo with one thing marked by a dot: say what it is in ${LANGUAGES[language].name}, by choosing from four or by typing.`} />
      {!info ? (
        <Empty title="No pictures here">This installation has no pictures for this practice.</Empty>
      ) : info.words === 0 ? (
        <Empty title={`None of your ${LANGUAGES[language].name} words is in a picture yet`}>The pictures show several hundred of the most frequent nouns: load the 6,000 most frequent words from Today or Settings, then come back.</Empty>
      ) : (
        <>
          <div className="space-y-7">
            <ScopePicker scope={choices.scope} setScope={(s) => save({ ...choices, scope: s })} learningWords={info.learningWords} words={info.words} entryLabel={forEntry ? entry!.display : null} />
            <FieldSet className="gap-2.5">
              <FieldLegend variant="label" className="mb-0">
                Answer by
              </FieldLegend>
              <ToggleGroup type="single" variant="outline" spacing={2} value={choices.choices ? 'choose' : 'type'} onValueChange={(v) => v && save({ ...choices, choices: v === 'choose' })} aria-label="Answer by">
                <ToggleGroupItem value="choose" className="flex-1 sm:flex-none">
                  Choosing from four
                </ToggleGroupItem>
                <ToggleGroupItem value="type" className="flex-1 sm:flex-none">
                  Typing the word
                </ToggleGroupItem>
              </ToggleGroup>
            </FieldSet>
            <SizePicker size={choices.size} setSize={(n) => save({ ...choices, size: n })} />
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <p className="hint">The pictures were made by an AI. Every answer counts toward the word it tests.</p>
          </div>
          <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t bg-background/92 px-4 py-3 backdrop-blur-md md:static md:mt-6 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
            <div className="mx-auto max-w-3xl">
              <Button size="xl" className="w-full md:w-auto md:px-10" disabled={phase === 'loading'} onClick={() => void start()}>
                <LuPlay aria-hidden="true" /> {phase === 'loading' ? 'Loading' : 'Start'}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Small things get a magnified view of their surroundings, so the dot is never the only clue. */
export function needsZoom(box: [number, number, number, number]): boolean {
  return Math.max(box[2] - box[0], box[3] - box[1]) < 160;
}

// The picture is as wide as the column: 42rem from tablets up, the screen on phones.
const SIZES = '(min-width: 768px) 42rem, 100vw';
const srcSet = (item: IdentifyItem) => `${item.scene.src.small} 800w, ${item.scene.src.large} 1600w`;

export function IdentifyPicture({ item }: { item: IdentifyItem }) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoom, setZoom] = useState(() => needsZoom(item.box));
  useEffect(() => setZoom(needsZoom(item.box)), [item.id]);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const [y, x] = item.point;
  const [y0, x0, y1, x1] = item.box;
  const W = width;
  const H = (width * item.scene.h) / item.scene.w;
  // The loupe sits in the corner away from the dot and magnifies the marked thing to fill about half of it.
  const D = Math.round(Math.min(Math.max(W * 0.36, 112), 232));
  const bw = Math.max(((x1 - x0) / 1000) * W, ((y1 - y0) / 1000) * H, 1);
  const m = Math.min(Math.max((0.5 * D) / bw, 1.6), 4);
  const corner = { [x < 500 ? 'right' : 'left']: 10, [y < 500 ? 'bottom' : 'top']: 10 } as Record<string, number>;
  return (
    <figure className="m-0">
      <div ref={frame} className="identify-frame" style={{ aspectRatio: `${item.scene.w} / ${item.scene.h}` }}>
        <img
          src={item.scene.src.small}
          sizes={SIZES}
          srcSet={srcSet(item)}
          alt="A photo with one thing marked by a dot"
          draggable={false}
          decoding="async"
        />
        <span className="identify-dot" style={{ left: `${x / 10}%`, top: `${y / 10}%` }} data-testid="identify-dot" aria-hidden="true" />
        {zoom && W > 0 && (
          <span
            className="identify-loupe"
            data-testid="identify-loupe"
            aria-hidden="true"
            style={{
              ...corner,
              width: D,
              height: D,
              backgroundImage: `url("${item.scene.src.large}")`,
              backgroundSize: `${m * W}px ${m * H}px`,
              backgroundPosition: `${D / 2 - (x / 1000) * m * W}px ${D / 2 - (y / 1000) * m * H}px`,
            }}
          >
            <span className="identify-dot identify-dot-still" style={{ left: '50%', top: '50%' }} />
          </span>
        )}
      </div>
      {/* Under the picture, so neither covers the dot. */}
      <figcaption className="mt-1.5 flex items-center justify-between gap-2">
        <Badge variant="secondary" className="gap-1 font-normal text-muted-foreground">
          <LuSparkles aria-hidden="true" /> AI-generated picture
        </Badge>
        <Toggle size="sm" pressed={zoom} onPressedChange={setZoom} className="identify-zoom text-muted-foreground" aria-label="Magnify">
          <LuZoomIn aria-hidden="true" /> Magnify
        </Toggle>
      </figcaption>
    </figure>
  );
}

/** One round of Identify; `embedded` is the form used inside a Comprehensive study session, where `onAnswer` counts each answer as it is given. */
export function IdentifyRunner({ language, items, onAnswer, onDone, embedded = false }: { language: LanguageCode; items: IdentifyItem[]; onAnswer?: (grade: string) => void; onDone: (r: Result[]) => void; embedded?: boolean }) {
  const [i, setI] = useState(0);
  const [value, setValue] = useState('');
  const [hint, setHint] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const review = useReviewState();
  const results = useRef<Result[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Study time for the Practice page; inside a session the session counts it.
  const clock = useActiveClock(!embedded);
  const item = items[i];

  // Load the next picture while this one is being answered: the same size the page will pick, and the large one too
  // when the next thing is small enough to open magnified.
  useEffect(() => {
    const next = items[i + 1];
    if (!next) return;
    const img = new Image();
    img.decoding = 'async';
    img.sizes = SIZES;
    img.srcset = srcSet(next);
    img.src = next.scene.src.small;
    if (needsZoom(next.box)) new Image().src = next.scene.src.large;
  }, [i]);

  const finish = (o: Outcome) => {
    setOutcome(o);
    results.current.push({ key: item.id, entryId: item.entryId, word: item.display, prompt: item.label, expected: item.display, grade: o.grade });
    onAnswer?.(o.grade);
  };
  const save = (response: string, extra: { revealed?: boolean; choice?: boolean }) => {
    review.reset();
    finish(gradeAndSave({ language, mode: 'identify', entryId: item.entryId, cell: item.id, spec: item.answer, response, ...extra, activeMs: clock.take(), hintsUsed: hint ? 1 : 0, onReview: review.setReview }));
  };
  const answer = (revealed: boolean) => {
    if (!outcome) save(value, { revealed });
  };
  const choose = (opt: string) => {
    if (outcome) return;
    setPicked(opt);
    save(opt, { choice: true });
  };
  const next = () => {
    if (i + 1 >= items.length) return onDone(results.current);
    setI(i + 1);
    setValue('');
    setHint(false);
    setPicked(null);
    setOutcome(null);
  };
  useKeys((e) => {
    if (outcome || !item.choices) return;
    const n = Number(e.key);
    if (n >= 1 && n <= item.choices.length) {
      choose(item.choices[n - 1]);
      return true;
    }
  }, [outcome, item]);

  const letters = [...stripStress(item.display)].filter((ch) => ch !== ' ');
  const words = item.display.trim().split(/\s+/).length;
  return (
    <div className="max-w-2xl" data-lang={language}>
      {/* In a session the session's header counts the questions. */}
      {!embedded && <Progress done={i} total={items.length} />}
      <IdentifyPicture key={item.id} item={item} />
      <h2 className="mt-4 text-lg font-semibold tracking-tight">What is marked?</h2>
      {hint && !outcome && (
        <p className="mt-1 text-[0.95rem] text-muted-foreground">
          In English: <span className="font-semibold text-foreground">{item.label}</span>; it starts with “{letters[0]}” ({letters.length} letters{words > 1 ? `, ${words} words` : ''}).
        </p>
      )}
      {item.choices ? (
        <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Choose its name">
          {item.choices.map((c, k) => {
            const right = canonical(c, language) === canonical(item.display, language);
            const state = !outcome ? undefined : right ? 'correct' : c === picked ? 'wrong' : 'dim';
            return (
              <OptionButton key={c} index={k + 1} state={state} disabled={!!outcome} onClick={() => choose(c)} lang={language} className="px-3">
                <Word text={c} className="text-[1.2rem]" />
              </OptionButton>
            );
          })}
        </div>
      ) : (
        <AnswerInput
          language={language}
          value={value}
          setValue={setValue}
          onSubmit={() => answer(false)}
          onReveal={() => answer(true)}
          hint={{ label: 'Hint', shown: hint, show: () => setHint(true) }}
          locked={!!outcome}
          inputRef={inputRef}
        />
      )}
      {outcome && (
        <FeedbackPanel
          outcome={{ ...outcome, response: item.choices ? '' : outcome.response, expected: item.display }}
          review={review.review}
          actions={
            <>
              {!embedded && (
                <Button variant="outline" size="xl" className="bg-card/80 px-4" onClick={() => navigate(`/words/${item.entryId}`)} aria-label="Open the word">
                  <LuExternalLink aria-hidden="true" />
                </Button>
              )}
              <ContinueButton onClick={next} last={i + 1 >= items.length} embedded={embedded} />
            </>
          }
        >
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Word text={item.display} className="text-xl" />
            {/* What the picture shows; the word's first dictionary meaning may be another sense (banco: bank, bench). */}
            <span className="text-muted-foreground">{item.label}</span>
          </p>
          {item.alsoRight.length > 0 && (
            <p className="text-[0.95rem]">
              <span className="text-muted-foreground">Also right: </span>
              {item.alsoRight.map((w, k) => (
                <span key={w}>
                  {k > 0 && ', '}
                  <Word text={w} />
                </span>
              ))}
            </p>
          )}
        </FeedbackPanel>
      )}
    </div>
  );
}
