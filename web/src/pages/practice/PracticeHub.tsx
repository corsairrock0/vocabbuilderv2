// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useEffect, useState } from 'react';
import { LuBookOpenCheck, LuBookOpenText, LuChevronRight, LuImage, LuPenLine, LuRepeat, LuTable2, LuTextCursorInput } from 'react-icons/lu';
import { readingLevel, type LevelProgress, type ReadingLevel } from '../../../../shared/comprehension.ts';
import { LANGUAGES, type LanguageCode } from '../../../../shared/languages.ts';
import { hasParadigms, paradigmTitle } from '../../../../shared/paradigms.ts';
import { ApiError, get } from '../../lib/api.ts';
import { Link, navigate } from '../../lib/router.tsx';
import { loadBootstrap, setActiveLanguage, toast, useApp } from '../../lib/store.ts';
import { count } from '../../lib/format.ts';
import { PageHeader, PageLoading } from '../../components/ui.tsx';
import { Progress } from '../../components/ui/basics.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/card.tsx';
import { startSession } from '../session/runtime.ts';
import { writingProgressText } from './WritingPractice.tsx';

interface ReadSummary {
  knownWords: number;
  readable: number;
  sayable: number;
  newWords: number;
}

interface PracticeSummary {
  forms: { words: number; learningWords: number; attempts7d: number; correct7d: number } | null;
  cloze: { words: number; learningWords: number; sentences: number; attempts7d: number; correct7d: number };
  identify: { scenes: number; objects: number; words: number; learningWords: number; attempts7d: number; correct7d: number } | null;
  comprehension: { level: ReadingLevel; progress?: LevelProgress; total: number; read: number; available: number };
  writing?: { level: ReadingLevel; progress: LevelProgress; total: number; done: number; available: number };
}

const EXAMPLE: Record<LanguageCode, string> = {
  es: 'tener, preterite, yo → tuve; bueno, feminine plural → buenas',
  pt: 'fazer, present, eu → faço; seu, feminine singular → sua',
  ru: 'книга, genitive plural → книг',
  uk: 'книга, locative singular → книзі',
  pl: 'książka, genitive plural → książek',
  vi: '',
};

/** "Your level: A2. 12 of 40 A2 texts read.": how far through their level the learner is (both kinds count). */
function readingLine(c: PracticeSummary['comprehension'], level: ReadingLevel, name: string): string {
  if (c.total === 0) return `No ${name} texts yet.`;
  // The progress is for the level stored on the server; a level just changed on this device shows the overall count.
  const p = c.progress?.level === level ? c.progress : null;
  if (!p) return `Your level: ${level}. ${count(c.read)} of ${count(c.total)} texts read.`;
  return p.total ? `Your level: ${level}. ${count(p.read)} of ${count(p.total)} ${level} texts read.` : `Your level: ${level}. No ${level} texts yet.`;
}

function weekNote(n: number, ok: number) {
  return n ? `${count(n)} answered this week, ${Math.round((100 * ok) / n)}% right` : 'Not practiced this week';
}

/** Practice: due reviews, the forms drill and sentence gaps for the active language; reviews due in others. */
export function PracticeHub() {
  const boot = useApp((s) => s.boot);
  const language = (boot?.settings.activeLanguage ?? 'es') as LanguageCode;
  const [summary, setSummary] = useState<PracticeSummary | null>(null);
  const [reading, setReading] = useState<ReadSummary | null>(null);
  const [busy, setBusy] = useState<LanguageCode | null>(null);
  useEffect(() => {
    void loadBootstrap();
  }, []);
  useEffect(() => {
    setSummary(null);
    get<PracticeSummary>(`/api/practice/summary/${language}`)
      .then(setSummary)
      .catch(() => setSummary(null));
    setReading(null);
    get<ReadSummary>(`/api/practice/read/summary/${language}`)
      .then(setReading)
      .catch(() => setReading(null));
  }, [language]);
  if (!boot) return <PageLoading />;
  const stats = boot.languages.find((l) => l.code === language)?.stats;
  const otherDue = boot.languages.filter((l) => l.code !== language && l.stats.due > 0);
  const review = async (code: LanguageCode) => {
    setBusy(code);
    setActiveLanguage(code);
    try {
      const id = await startSession({ language: code, mode: 'review', quick: true });
      navigate(`/study/${id}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'active_session_exists') navigate(`/study/${(err.details as any).sessionId}`);
      else toast(err instanceof Error ? err.message : 'Could not start the review', 'bad');
    } finally {
      setBusy(null);
    }
  };
  const tables = hasParadigms(language);
  const ls = boot.languageSettings[language];
  const readLevel = summary?.comprehension ? readingLevel(ls?.readingLevel ?? summary.comprehension.level) : null;
  const readP = summary?.comprehension?.progress?.level === readLevel ? summary?.comprehension?.progress : null;
  const writeLevel = summary?.writing ? readingLevel(ls?.writingLevel ?? summary.writing.level) : null;
  const tiles: Array<{ to: string; icon: typeof LuImage; title: string; text: string; progress?: { value: number; label: string } | null; hidden?: boolean }> = [
    {
      to: '/practice/forms',
      icon: LuTable2,
      title: tables ? paradigmTitle(language) : 'Grammar',
      text: summary?.forms ? `${count(summary.forms.learningWords)} learning words with tables · ${weekNote(summary.forms.attempts7d, summary.forms.correct7d)}` : EXAMPLE[language],
      hidden: !tables,
    },
    { to: '/practice/cloze', icon: LuTextCursorInput, title: 'Sentences', text: summary ? `Fill the gap · ${count(summary.cloze.sentences)} sentences for ${count(summary.cloze.words)} words` : 'Fill the gap in an everyday sentence' },
    {
      to: '/practice/identify',
      icon: LuImage,
      title: 'Pictures',
      text: summary?.identify ? (summary.identify.words > 0 ? `Name what you see · ${count(summary.identify.words)} of your words` : 'Load the most frequent words first') : 'Name the thing a dot marks',
      hidden: summary?.identify === null,
    },
    {
      to: '/practice/read',
      icon: LuBookOpenText,
      title: 'Read and say',
      text: reading ? (reading.knownWords >= 20 ? `${count(reading.readable)} sentences fit the words you know` : `Opens at about 20 known words (you know ${count(reading.knownWords)})`) : 'Real sentences from the words you know',
    },
    {
      to: '/practice/comprehension',
      icon: LuBookOpenCheck,
      title: 'Reading',
      text: summary?.comprehension ? (summary.comprehension.total ? `Level ${readLevel}${readP?.total ? ` · ${count(readP.read)} of ${count(readP.total)} texts` : ''}` : `No ${LANGUAGES[language].name} texts yet`) : 'Texts with questions, at your level',
      progress: readP?.total ? { value: (100 * readP.read) / readP.total, label: `Reading level ${readLevel}: ${readP.read} of ${readP.total} texts` } : null,
    },
    {
      to: '/practice/writing',
      icon: LuPenLine,
      title: 'Writing',
      text: summary?.writing ? (summary.writing.total ? `Level ${writeLevel}${summary.writing.progress?.total ? ` · ${count(summary.writing.progress.read)} of ${count(summary.writing.progress.total)} sentences` : ''}` : `No ${LANGUAGES[language].name} sentences yet`) : 'Translate sentences, every word right',
      progress: summary?.writing?.progress?.total ? { value: (100 * summary.writing.progress.read) / summary.writing.progress.total, label: `Writing level ${writeLevel}` } : null,
    },
  ];
  const due = stats?.due ?? 0;
  return (
    <div className="max-w-3xl" data-lang={language}>
      <PageHeader title="Practice" />
      <div className="grid gap-8">
        <Card className="relative overflow-hidden" role="region" aria-labelledby="due-title">
          <CardHeader>
            <CardTitle id="due-title" className="text-lg">
              {due > 0 ? `${count(due)} ${due === 1 ? 'word is' : 'words are'} due` : 'Nothing due right now'}
            </CardTitle>
            <CardDescription>
              {due > 0
                ? `${count(stats!.dueReceptive)} to recognise and ${count(stats!.dueProductive)} to recall. Any practice below counts as their review, due words first.`
                : `Every practice answer still counts toward the words it tests. Learn new words on Today, or practice a skill.`}
            </CardDescription>
          </CardHeader>
          {due > 0 && (
            <CardFooter>
              <Button variant="lang" size="lg" className="w-full sm:w-auto" disabled={busy === language} onClick={() => void review(language)}>
                <LuRepeat aria-hidden="true" /> Review {count(due)} due {due === 1 ? 'word' : 'words'}
              </Button>
            </CardFooter>
          )}
        </Card>

        <section aria-labelledby="skills-title" className="space-y-3">
          <h2 id="skills-title" className="px-1 text-base font-semibold tracking-tight">
            Practice one skill
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {tiles
              .filter((t) => !t.hidden)
              .map((t) => {
                const Icon = t.icon;
                return (
                  <li key={t.to}>
                    <Link to={t.to} className="group flex h-full flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 [@media(hover:hover)]:hover:bg-accent/50">
                      <span className="flex items-center gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-lang-soft text-lang">
                          <Icon className="size-5" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{t.title}</span>
                          <span className="line-clamp-2 block text-sm text-muted-foreground">{t.text}</span>
                        </span>
                        <LuChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                      </span>
                      {t.progress && <Progress value={t.progress.value} aria-label={t.progress.label} className="h-1.5" />}
                    </Link>
                  </li>
                );
              })}
          </ul>
        </section>

        {otherDue.length > 0 && (
          <section aria-labelledby="other-title" className="space-y-2">
            <h2 id="other-title" className="px-1 text-base font-semibold tracking-tight">
              Due in other languages
            </h2>
            <ul className="divide-y rounded-xl border bg-card shadow-xs">
              {otherDue.map((l) => (
                <li key={l.code} data-lang={l.code} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-lang-soft text-xl" aria-hidden="true">
                    {LANGUAGES[l.code].flag}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="word block text-lg">{LANGUAGES[l.code].nativeName}</span>
                    <span className="hint block">{count(l.stats.due)} due</span>
                  </span>
                  <Button variant="outline" size="sm" disabled={busy === l.code} onClick={() => void review(l.code)}>
                    Review
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
