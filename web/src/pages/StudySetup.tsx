// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LuChevronLeft, LuDownload, LuDumbbell, LuPlay, LuZap } from 'react-icons/lu';
import { LANGUAGES, LANGUAGE_CODES, type LanguageCode } from '../../../shared/languages.ts';
import { DEFAULT_STUDY_MODE, type StudyMode } from '../../../shared/settings.ts';
import { hasParadigms, paradigmTitle } from '../../../shared/paradigms.ts';
import { READING_LEVELS, readingLevel } from '../../../shared/comprehension.ts';
import { TYPE_INFO } from '../../../shared/mix.ts';
import type { StudyPreview } from '../../../shared/types.ts';
import { ApiError, get, uuid } from '../lib/api.ts';
import { Link, navigate, useLocation } from '../lib/router.tsx';
import { langSettings, setActiveLanguage, toast, updateLanguageSettings, useApp } from '../lib/store.ts';
import { count, plural } from '../lib/format.ts';
import { cn } from '../lib/utils.ts';
import { PageHeader } from '../components/ui.tsx';
import { SetUpdateNote } from '../components/SetUpdateNote.tsx';
import { Skeleton, Spinner } from '../components/ui/basics.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent } from '../components/ui/card.tsx';
import { RadioGroup, RadioGroupItem, Slider, ToggleGroup, ToggleGroupItem } from '../components/ui/controls.tsx';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/dialog.tsx';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from '../components/ui/field.tsx';
import { InputGroup, InputGroupAddon, InputGroupInput, NativeSelect, NativeSelectOption } from '../components/ui/input-group.tsx';
import { Input } from '../components/ui/input.tsx';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../components/ui/tabs.tsx';
import { prepareOfflineSession, startSession, type StartOptions } from './session/runtime.ts';
import { TYPE_ICONS } from './session/QuestionType.tsx';

/** The lengths offered as buttons (any other number of minutes can be typed). */
const LENGTHS = [10, 20, 30, 45];

const MODES: Array<{ value: Exclude<StudyMode, 'new'>; title: string; description: string }> = [
  { value: 'comprehensive', title: 'Comprehensive', description: 'Reviews, new words and practice of every skill, mixed together.' },
  { value: 'mixed', title: 'Reviews and new words', description: 'Words only, without the practice.' },
  { value: 'review', title: 'Reviews only', description: 'Just the words due for review.' },
];

export function StudySetup() {
  const boot = useApp((s) => s.boot);
  const language = (boot?.settings.activeLanguage ?? 'es') as LanguageCode;
  const ls = langSettings(language);
  const [minutes, setMinutes] = useState<number>(ls?.sessionMinutes ?? 30);
  // New words: by default what is left of today's target, as Home's plan and Quick study take it (the server works it
  // out: `quick`), so Home, this screen and the session Start creates show one plan; a number chosen here is sent as is.
  const [newWords, setNewWords] = useState<number | null>(null);
  // Comprehensive is the default: every kind of question mixed together. The choice is not remembered, so the
  // screen always opens on it; the other modes stay one tap away.
  const [mode, setMode] = useState<Exclude<StudyMode, 'new'>>(DEFAULT_STUDY_MODE as Exclude<StudyMode, 'new'>);
  const [focus, setFocus] = useState<StartOptions['focus']>(ls?.focus ?? 'balanced');
  const [difficulty, setDifficulty] = useState<StartOptions['difficulty']>(ls?.difficulty ?? 'normal');
  const [tag, setTag] = useState<string>('');
  const [fMin, setFMin] = useState<string>(ls?.frequencyMin ? String(ls.frequencyMin) : '');
  const [fMax, setFMax] = useState<string>(ls?.frequencyMax ? String(ls.frequencyMax) : '');
  const [tags, setTags] = useState<Array<{ name: string; n: number }>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ sessionId: string; opts: StartOptions; kind: string } | null>(null);
  const stats = boot?.languages.find((l) => l.code === language);
  /** What is left of today's new-word target (the server works out the same when it plans). */
  const leftToday = Math.max(0, (ls?.dailyNewTarget ?? 10) - (stats?.stats.introducedToday ?? 0));
  const { query } = useLocation();
  const autoStarted = useRef(false);

  useEffect(() => {
    setMinutes(ls?.sessionMinutes ?? 30);
    setNewWords(null);
    setTag('');
    get<{ tags: Array<{ name: string; n: number }> }>(`/api/vocab/meta?lang=${language}`)
      .then((m) => setTags(m.tags))
      .catch(() => setTags([]));
  }, [language]);

  // Today's mix: the session Start would plan now, per type of question (planned on the server, then discarded).
  const [preview, setPreview] = useState<StudyPreview | null>(null);
  // The id Start uses, so the mix shown is the plan it gets. After a Start that failed (its answer may have been lost
  // after the server made the session), new choices get a new id: the old one stays tied to the old choices.
  const [plannedId, setPlannedId] = useState(() => uuid());
  const failedId = useRef<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  useEffect(() => {
    if (failedId.current === plannedId) {
      failedId.current = null;
      setPlannedId(uuid());
      return;
    }
    const q = new URLSearchParams({ id: plannedId, lang: language, minutes: String(minutes), mode, focus: focus ?? 'balanced', difficulty: difficulty ?? 'normal' });
    if (mode === 'review') q.set('newWords', '0');
    else if (newWords == null) q.set('quick', '1');
    else q.set('newWords', String(newWords));
    if (tag) q.set('tag', tag);
    // Both always, empty for none: Start sends no range then, rather than the one in the settings.
    q.set('frequencyMin', fMin);
    q.set('frequencyMax', fMax);
    let live = true;
    const t = setTimeout(() => {
      get<StudyPreview>(`/api/sessions/preview?${q}`)
        .then((p) => live && (setPreview(p), setPreviewError(null)))
        .catch((e) => live && (setPreview(null), setPreviewError(e instanceof ApiError && e.isNetwork ? 'Connect to your server to see today’s mix.' : e instanceof Error ? e.message : String(e))));
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [plannedId, language, minutes, mode, newWords, focus, difficulty, tag, fMin, fMax]);

  const options = (): StartOptions => ({
    id: plannedId,
    language,
    minutes,
    ...(mode === 'review' ? { newWords: 0 } : newWords == null ? { quick: true } : { newWords }),
    mode,
    focus,
    difficulty,
    tag: tag || null,
    frequencyMin: fMin ? Number(fMin) : null,
    frequencyMax: fMax ? Number(fMax) : null,
  });

  const start = async (opts: StartOptions, kind: string) => {
    setBusy(kind);
    try {
      const id = await startSession(opts);
      navigate(`/study/${id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'active_session_exists') {
        setConflict({ sessionId: (err.details as { sessionId: string }).sessionId, opts, kind });
      } else {
        failedId.current = opts.id ?? null;
        toast(err instanceof Error ? err.message : 'Could not start a session', 'bad');
      }
    } finally {
      setBusy(null);
    }
  };

  // Home-screen shortcut "Quick study" opens /study?quick=1.
  useEffect(() => {
    if (query.get('quick') === '1' && boot && !autoStarted.current) {
      autoStarted.current = true;
      void start({ language, quick: true, mode: DEFAULT_STUDY_MODE }, 'quick');
    }
  }, [boot]);

  const offline = async () => {
    setBusy('offline');
    try {
      // Practice rounds need a connection: a session saved for offline study gets the whole time for reviews and new
      // words instead of leaving a third of it to rounds that could not run.
      const withoutRounds = mode === 'comprehensive';
      const s = await prepareOfflineSession(withoutRounds ? { ...options(), mode: 'mixed' } : options());
      toast(
        `Saved a ${minutes}-minute ${LANGUAGES[language].name} session (${s.exercises.length} exercises) for offline study.${withoutRounds ? ' It has reviews and new words only: the practice needs a connection.' : ''}`,
        'good',
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not prepare the session', 'bad');
    } finally {
      setBusy(null);
    }
  };

  const parts = preview?.parts ?? [];
  const modeLine = mode === 'comprehensive' ? 'mixed together, a few of each at a time' : mode === 'mixed' ? 'reviews and new words' : 'the words due for review';
  const shownNew = newWords ?? leftToday;
  return (
    <div className="max-w-2xl pb-28 md:pb-0" data-lang={language}>
      <PageHeader
        title="Session options"
        back={
          <Button variant="ghost" size="sm" className="-ml-2.5 text-muted-foreground" render={<Link to="/" />}>
            <LuChevronLeft aria-hidden="true" /> Today
          </Button>
        }
      />
      <div className="grid gap-6">
        <Card className="gap-4" aria-live="polite">
          <CardContent className="space-y-1">
            <p className="text-[1.75rem] leading-tight font-semibold tracking-tight" data-testid="mix-total">
              {preview && !preview.empty ? plural(preview.total, 'question') : preview?.empty ? 'Nothing to study' : <Skeleton className="h-8 w-44" />}
            </p>
            <p className="text-muted-foreground">{preview?.empty ?? previewError ?? `About ${minutes} minutes · ${modeLine}`}</p>
          </CardContent>
          {parts.length > 0 && (
            <CardContent>
              <h2 id="mix-title" className="sr-only">
                What’s in it
              </h2>
              <ul data-testid="mix" aria-labelledby="mix-title" className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                {parts.map((p) => {
                  const Icon = TYPE_ICONS[p.type];
                  return (
                    <li key={p.type} data-type={p.type} className="flex min-w-0 items-center gap-2.5" title={TYPE_INFO[p.type].what}>
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-lang-soft text-lang">
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[0.9375rem]">{TYPE_INFO[p.type].plural}</span>
                      <span className="font-semibold tabular-nums">{p.count}</span>
                    </li>
                  );
                })}
              </ul>
              {preview?.newWords ? (
                <p className="hint mt-3">
                  {plural(preview.newWords, 'new word')}, each asked a few ways.
                </p>
              ) : null}
            </CardContent>
          )}
        </Card>
        <SetUpdateNote language={language} />

        <Option label="Length">
          <ToggleGroup type="single" variant="outline" spacing={2} value={LENGTHS.includes(minutes) ? String(minutes) : 'other'} onValueChange={(v) => v && v !== 'other' && setMinutes(Number(v))} aria-label="Length" className="w-full">
            {LENGTHS.map((m) => (
              <ToggleGroupItem key={m} value={String(m)} className="flex-1">
                {m} min
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <InputGroup className="w-44">
            <InputGroupAddon>Other</InputGroupAddon>
            <InputGroupInput type="number" min={3} max={180} aria-label="Length in minutes" value={minutes} onChange={(e) => setMinutes(Math.max(3, Math.min(180, Number((e.target as HTMLInputElement).value) || 30)))} />
            <InputGroupAddon align="inline-end">min</InputGroupAddon>
          </InputGroup>
        </Option>

        <FieldSet className="gap-2.5">
          <FieldLegend variant="label" className="mb-0">
            What to practice
          </FieldLegend>
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as typeof mode)} aria-label="Mode" className="gap-2">
            {MODES.map((m) => (
              <FieldLabel key={m.value} htmlFor={`mode-${m.value}`}>
                <Field orientation="horizontal" data-state={mode === m.value ? 'checked' : 'unchecked'}>
                  <FieldContent>
                    <FieldTitle>{m.title}</FieldTitle>
                    <FieldDescription>{m.description}</FieldDescription>
                  </FieldContent>
                  <RadioGroupItem value={m.value} id={`mode-${m.value}`} />
                </Field>
              </FieldLabel>
            ))}
          </RadioGroup>
          {mode === 'comprehensive' && (
            <FieldDescription>
              Listening, {hasParadigms(language) ? `${paradigmTitle(language).toLowerCase()}, ` : ''}sentence gaps, at least five pictures, speaking, one short text and sentences to write. Every answer counts toward the words it tests; practice needs a connection.
            </FieldDescription>
          )}
        </FieldSet>

        {mode !== 'review' && (
          <Option label="New words, at most" hint="Fewer are introduced automatically when many reviews are due or recall slips.">
            <div className="flex items-center gap-4">
              <Slider min={0} max={20} step={1} value={Math.min(20, shownNew)} onValueChange={(v) => setNewWords(v)} aria-label="New words at most" className="flex-1" />
              <span className="w-8 text-right font-semibold tabular-nums">{shownNew}</span>
            </div>
            <FieldDescription>{newWords == null ? `What is left of today’s ${ls?.dailyNewTarget ?? 10}.` : `Today’s target leaves ${leftToday}.`}</FieldDescription>
          </Option>
        )}

        <div className="grid gap-6 sm:grid-cols-2">
          <Option label="Focus">
            <NativeSelect className="w-full" value={focus ?? 'balanced'} onChange={(e) => setFocus((e.target as HTMLSelectElement).value as StartOptions['focus'])} aria-label="Focus">
              <NativeSelectOption value="balanced">Balanced</NativeSelectOption>
              <NativeSelectOption value="listening">Listening</NativeSelectOption>
              <NativeSelectOption value="speaking">Speaking</NativeSelectOption>
              <NativeSelectOption value="reading">Reading in context</NativeSelectOption>
              <NativeSelectOption value="writing">Typing and spelling</NativeSelectOption>
            </NativeSelect>
          </Option>
          <Option label="Exercise difficulty">
            <NativeSelect className="w-full" value={difficulty ?? 'normal'} onChange={(e) => setDifficulty((e.target as HTMLSelectElement).value as StartOptions['difficulty'])} aria-label="Difficulty">
              <NativeSelectOption value="easy">Gentle</NativeSelectOption>
              <NativeSelectOption value="normal">Normal</NativeSelectOption>
              <NativeSelectOption value="challenging">Challenging</NativeSelectOption>
            </NativeSelect>
          </Option>
          {mode === 'comprehensive' && (
            <Option label="Reading level" hint="Up a level once you have read every text at yours.">
              <NativeSelect className="w-full" value={readingLevel(ls?.readingLevel)} onChange={(e) => void updateLanguageSettings(language, { readingLevel: readingLevel((e.target as HTMLSelectElement).value) })} aria-label="Reading level">
                {READING_LEVELS.map((l) => (
                  <NativeSelectOption key={l} value={l}>
                    {l}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Option>
          )}
          {mode === 'comprehensive' && (
            <Option label="Writing level" hint="Up a level once every sentence at yours is written right.">
              <NativeSelect className="w-full" value={readingLevel(ls?.writingLevel)} onChange={(e) => void updateLanguageSettings(language, { writingLevel: readingLevel((e.target as HTMLSelectElement).value) })} aria-label="Writing level">
                {READING_LEVELS.map((l) => (
                  <NativeSelectOption key={l} value={l}>
                    {l}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Option>
          )}
        </div>

        <Accordion type="single" className="rounded-xl border bg-card px-4 shadow-xs" data-testid="more-options">
          <AccordionItem value="more">
            <AccordionTrigger className="text-[0.9375rem]">More: topic, word range, language</AccordionTrigger>
            <AccordionContent className="grid gap-6 pt-1">
              {mode !== 'review' && (
                <div className="grid gap-6 sm:grid-cols-2">
                  <Option label="Topic">
                    <NativeSelect className="w-full" value={tag} onChange={(e) => setTag((e.target as HTMLSelectElement).value)} aria-label="Topic">
                      <NativeSelectOption value="">Any topic</NativeSelectOption>
                      {tags.map((t) => (
                        <NativeSelectOption key={t.name} value={t.name}>
                          {t.name.replace(/-/g, ' ')} ({t.n})
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Option>
                  <Option label="Frequency range" hint="Rank in your frequency list (or curated order).">
                    <div className="flex items-center gap-2">
                      <Input inputMode="numeric" placeholder="from 1" value={fMin} onChange={(e) => setFMin((e.target as HTMLInputElement).value.replace(/\D/g, ''))} aria-label="Lowest rank" />
                      <span className="text-muted-foreground">to</span>
                      <Input inputMode="numeric" placeholder="any" value={fMax} onChange={(e) => setFMax((e.target as HTMLInputElement).value.replace(/\D/g, ''))} aria-label="Highest rank" />
                    </div>
                  </Option>
                </div>
              )}
              <Option label="Language">
                <ToggleGroup type="single" variant="outline" spacing={2} value={language} onValueChange={(v) => v && setActiveLanguage(v as LanguageCode)} aria-label="Language">
                  {LANGUAGE_CODES.map((c) => (
                    <ToggleGroupItem key={c} value={c} data-lang={c} className="rounded-full px-3.5">
                      <span aria-hidden="true">{LANGUAGES[c].flag}</span>
                      <span className="word text-[0.9375rem]">{LANGUAGES[c].nativeName}</span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                {stats && (
                  <FieldDescription>
                    {count(stats.stats.due)} due for review, {count(stats.stats.newAvailable)} new words available.
                  </FieldDescription>
                )}
              </Option>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={!!busy} onClick={() => void start({ language, quick: true, mode: DEFAULT_STUDY_MODE }, 'quick')} title="Start a Comprehensive session with your usual settings">
                  <LuZap aria-hidden="true" /> Quick study
                </Button>
                <Button variant="outline" render={<Link to="/practice" />}>
                  <LuDumbbell aria-hidden="true" /> Practice one skill
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t bg-background/92 px-4 py-3 backdrop-blur-md md:static md:mt-6 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <div className="mx-auto flex max-w-2xl gap-2">
          <Button variant="lang" size="xl" className="flex-1" disabled={!!busy} onClick={() => void start(options(), 'custom')}>
            <LuPlay aria-hidden="true" /> {busy === 'custom' ? 'Planning your session' : 'Start'}
          </Button>
          <Button variant="outline" size="icon-lg" className="size-14 rounded-xl" disabled={!!busy} onClick={() => void offline()} aria-label="Save for offline study" title="Save for offline study">
            {busy === 'offline' ? <Spinner /> : <LuDownload aria-hidden="true" />}
          </Button>
        </div>
      </div>

      <AlertDialog open={!!conflict} onOpenChange={(v) => !v && setConflict(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You have an unfinished session</AlertDialogTitle>
            <AlertDialogDescription>Resume it where you left off, or end it and start this new one.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                const c = conflict!;
                void start({ ...c.opts, replaceActive: true }, c.kind);
              }}
            >
              End it and start new
            </AlertDialogCancel>
            <Button
              onClick={() => {
                const sid = conflict!.sessionId;
                setConflict(null);
                navigate(`/study/${sid}`);
              }}
            >
              Resume it
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** A labelled group of controls with an optional hint below. */
function Option({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <FieldSet className={cn('gap-2.5', className)}>
      <FieldLegend variant="label" className="mb-0">
        {label}
      </FieldLegend>
      {children}
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </FieldSet>
  );
}
