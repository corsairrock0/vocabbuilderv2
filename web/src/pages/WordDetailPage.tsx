// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// A word's page (2.0.0): the word, its sound and how it stands, then three tabs: Overview (meanings with their
// examples, practice, notes), Forms (its table) and History (what the learner can do with it, the schedule in plain
// words, the reviews, a recording of their own and the sources). Actions on the word are in one menu.
import { useEffect, useRef, useState } from 'react';
import {
  LuArrowLeft,
  LuCircle,
  LuCircleCheck,
  LuCircleDashed,
  LuEllipsisVertical,
  LuFlag,
  LuImage,
  LuMic,
  LuNotebookPen,
  LuPause,
  LuPencil,
  LuPlus,
  LuRotateCcw,
  LuSquare,
  LuStar,
  LuTable2,
  LuTextCursorInput,
  LuThumbsUp,
  LuTrash2,
  LuUpload,
} from 'react-icons/lu';
import type { VocabDetail, VocabListItem } from '../../../shared/types.ts';
import { SKILL_LABELS } from '../../../shared/exercises.ts';
import { LANGUAGES, type LanguageCode } from '../../../shared/languages.ts';
import { ApiError, api, del, get, post } from '../lib/api.ts';
import { enqueue } from '../lib/outbox.ts';
import { navigate, Link } from '../lib/router.tsx';
import { toast } from '../lib/store.ts';
import { count, dateTime, dueText, intervalText, pct, relative } from '../lib/format.ts';
import { cn } from '../lib/utils.ts';
import { AiSentenceNote, ErrorNote, PageLoading } from '../components/ui.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent } from '../components/ui/card.tsx';
import { Toggle } from '../components/ui/controls.tsx';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/dialog.tsx';
import { Field, FieldLabel } from '../components/ui/field.tsx';
import { Textarea } from '../components/ui/input.tsx';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '../components/ui/item.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../components/ui/menu.tsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.tsx';
import { AudioControls } from './session/AudioControls.tsx';
import { Word } from './session/Exercise.tsx';
import { lookupAudio } from '../lib/audio.ts';
import { ParadigmTable } from '../components/ParadigmTable.tsx';
import { tableTitle } from '../../../shared/paradigms.ts';

const RATING = ['', 'Again', 'Hard', 'Good', 'Easy'];
const STATE_LABEL: Record<VocabListItem['learnState'], string> = {
  new: 'Not started',
  learning: 'Learning',
  learned: 'Learned',
  mature: 'Well known',
  mastered: 'Mastered',
  known: 'Marked as known',
  suspended: 'Suspended',
};
/** A length of time in days, said plainly: 1 day, 9 days, 3 weeks, 4 months, 1.5 years. */
function duration(days: number): string {
  const d = Math.max(1, Math.round(days));
  if (d === 1) return '1 day';
  if (d < 14) return `${d} days`;
  if (d < 60) return `${Math.round(d / 7)} weeks`;
  if (d < 548) return `${Math.round(d / 30)} months`;
  return `${(d / 365).toFixed(1)} years`;
}

/** Meanings shown before "N more meanings". */
const FIRST_MEANINGS = 2;

/** How the word stands, in a line: its state, when it comes back and how likely the learner is to remember it now. */
function statusLine(w: VocabDetail): string {
  if (w.learnState === 'known') return 'You marked it as known, so it is not studied.';
  if (w.learnState === 'suspended') return 'Suspended: it is not studied until you bring it back.';
  const started = w.cards.filter((c) => c.state);
  if (!started.length) return w.status === 'new' ? 'Not studied yet. It comes with a session’s new words, most frequent first.' : 'It comes first among your next session’s new words.';
  const due = Math.min(...started.map((c) => c.due ?? Infinity));
  const r = started.map((c) => c.retrievability).filter((x): x is number => x != null);
  const sure = r.length ? ` · ${pct(Math.min(...r))} likely to remember it now` : '';
  return `Review ${Number.isFinite(due) ? dueText(due) : 'not scheduled'}${sure}`;
}

export function WordDetailPage({ entryId }: { entryId: number }) {
  const [w, setW] = useState<VocabDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [editingNote, setEditingNote] = useState(false);
  const [audioKey, setAudioKey] = useState(0);
  const [tab, setTab] = useState('overview');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const load = () =>
    get<VocabDetail>(`/api/vocab/${entryId}`)
      .then((d) => {
        setW(d);
        setNote(d.note ?? '');
        setMnemonic(d.mnemonic ?? '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    setTab('overview');
    void load();
  }, [entryId]);
  if (error) return <ErrorNote error={error} onRetry={() => void load()} />;
  if (!w) return <PageLoading />;

  const flag = async (body: Record<string, unknown>, done?: string) => {
    try {
      setW(await post<VocabDetail>(`/api/vocab/${entryId}/flags`, body));
      if (done) toast(done, 'good');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update', 'bad');
    }
  };
  const saveNote = () => {
    void enqueue({ method: 'PUT', url: `/api/vocab/${entryId}/note?changedAt=${Date.now()}`, body: { note: note || null, mnemonic: mnemonic || null }, label: 'Word note' });
    setW({ ...w, note: note || null, mnemonic: mnemonic || null });
    setEditingNote(false);
    toast('Note saved.', 'good');
  };
  // Put a word not started yet at the front of the next session's new words.
  const learnNext = async () => {
    try {
      await post('/api/practice/read/learn-next', { entryId });
      await load();
      toast('It comes first in your next session.', 'good');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update', 'bad');
    }
  };
  const remove = async () => {
    try {
      await del(`/api/vocab/${entryId}`);
      toast('Word deleted.');
      navigate('/words');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete the word', 'bad');
    }
  };
  const language = w.language as LanguageCode;
  const name = LANGUAGES[language].name;
  const meta = [w.pos, w.gender && { m: 'masculine', f: 'feminine', n: 'neuter' }[w.gender], w.aspect, w.register].filter(Boolean) as string[];
  const rank = w.frequencyRank ?? null;
  const hasForms = !!w.paradigm || w.forms.length > 0;
  const stopped = w.status === 'known' || w.status === 'suspended';
  const practice = [
    (w.identifyCount ?? 0) > 0 && { to: `/practice/identify?entry=${entryId}`, icon: LuImage, label: 'Pictures', title: `Practice with ${w.identifyCount === 1 ? 'a picture' : 'pictures'}` },
    w.examples.some((x) => x.target) && { to: `/practice/cloze?entry=${entryId}`, icon: LuTextCursorInput, label: 'Sentences', title: 'Practice in sentences' },
    w.paradigm && !w.paradigm.indeclinable && { to: `/practice/forms?entry=${entryId}`, icon: LuTable2, label: 'Forms', title: 'Practice the forms' },
  ].filter(Boolean) as Array<{ to: string; icon: typeof LuImage; label: string; title: string }>;
  const firstSenses = w.senses.slice(0, FIRST_MEANINGS);
  const moreSenses = w.senses.slice(FIRST_MEANINGS);

  const sense = (s: VocabDetail['senses'][number], i: number) => {
    const mine = w.examples.filter((x) => x.senseId === s.id);
    const also = s.translations.filter((t) => t !== s.gloss);
    return (
      <li key={s.id} className="flex gap-3">
        {w.senses.length > 1 && <span className="w-5 shrink-0 pt-0.5 text-right text-muted-foreground tabular-nums">{i + 1}.</span>}
        <div className="min-w-0 flex-1">
          <p className="text-[1.1875rem] leading-snug">
            {s.gloss}
            {s.note && <span className="ml-2 text-base text-muted-foreground">({s.note})</span>}
          </p>
          <Definition gloss={s.gloss} text={s.definition} />
          {also.length > 0 && <p className="mt-0.5 text-sm text-muted-foreground">Also accepted: {also.join(', ')}</p>}
          {mine.length > 0 && <ExampleList examples={mine} className="mt-3" />}
        </div>
      </li>
    );
  };

  return (
    <div data-lang={language} className="max-w-3xl">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="-ml-2.5 text-muted-foreground" onClick={() => history.back()}>
          <LuArrowLeft aria-hidden="true" /> Back
        </Button>
        <div className="flex items-center gap-1">
          <Toggle size="lg" className="px-0" pressed={w.favorite} onPressedChange={(v) => void flag({ favorite: v })} aria-label="Favourite">
            <LuStar className={cn('size-5', w.favorite && 'fill-current text-warning')} aria-hidden="true" />
          </Toggle>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-lg" aria-label="Word actions">
                  <LuEllipsisVertical className="size-5" aria-hidden="true" />
                </Button>
              }
            />
            <DropdownMenuContent align="end" label="Word actions" minWidth={220}>
              <DropdownMenuItem onSelect={() => navigate(`/words/${entryId}/edit`)}>
                <LuPencil aria-hidden="true" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void flag({ difficult: !w.difficult }, w.difficult ? 'No longer marked as difficult.' : 'Marked as difficult.')}>
                <LuFlag aria-hidden="true" /> {w.difficult ? 'Unmark difficult' : 'Mark as difficult'}
              </DropdownMenuItem>
              {stopped ? (
                <DropdownMenuItem onSelect={() => void flag({ status: 'restore' }, 'It will be studied again.')}>
                  <LuRotateCcw aria-hidden="true" /> Study this word again
                </DropdownMenuItem>
              ) : (
                <>
                  <DropdownMenuItem onSelect={() => void flag({ status: 'known' }, 'Marked as known.')}>
                    <LuThumbsUp aria-hidden="true" /> I already know it
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void flag({ status: 'suspended' }, 'Suspended.')}>
                    <LuPause aria-hidden="true" /> Suspend
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                <LuTrash2 aria-hidden="true" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <header>
        <h1 className="text-[clamp(2.5rem,9vw,3.75rem)] leading-[1.05]">
          <Word text={w.display} />
        </h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
          <span>
            {meta.join(' · ')}
            {rank && (
              <span className="tabular-nums" title={`Number ${count(rank)} of the most frequent ${name} words`}>
                {meta.length > 0 && ' · '}#{count(rank)}
              </span>
            )}
          </span>
          {w.pronunciation && <span>{w.pronunciation}</span>}
          {w.aspectPair && (
            <span>
              pair: <span className="word text-foreground">{w.aspectPair}</span>
            </span>
          )}
        </p>
        <div className="mt-4" key={audioKey}>
          <AudioControls entryId={entryId} language={language} />
        </div>
      </header>

      <Item variant="muted" size="sm" className="mt-5">
        <ItemContent>
          <ItemTitle className="text-[0.9375rem]">
            {STATE_LABEL[w.learnState]}
            {w.difficult && w.learnState !== 'new' && (
              <Badge variant="destructive" className="ml-1">
                Difficult
              </Badge>
            )}
          </ItemTitle>
          <ItemDescription className="line-clamp-none">{statusLine(w)}</ItemDescription>
        </ItemContent>
        {stopped && (
          <ItemActions>
            <Button variant="outline" size="sm" onClick={() => void flag({ status: 'restore' }, 'It will be studied again.')}>
              Study again
            </Button>
          </ItemActions>
        )}
        {w.status === 'new' && (
          <ItemActions>
            <Button variant="outline" size="sm" onClick={() => void learnNext()}>
              <LuPlus aria-hidden="true" /> Learn it next
            </Button>
          </ItemActions>
        )}
      </Item>

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList variant="line" className="w-full justify-start gap-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {hasForms && <TabsTrigger value="forms">Forms</TabsTrigger>}
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-8 pt-6">
          <section aria-labelledby="meanings-title">
            <h2 id="meanings-title" className="sr-only">
              {w.senses.length > 1 ? 'Meanings' : 'Meaning'}
            </h2>
            <ol className="space-y-5">{firstSenses.map(sense)}</ol>
            {moreSenses.length > 0 && (
              <Collapsible className="mt-4">
                <CollapsibleTrigger render={<Button variant="outline" size="sm" />}>{`${moreSenses.length} more ${moreSenses.length === 1 ? 'meaning' : 'meanings'}`}</CollapsibleTrigger>
                <CollapsibleContent>
                  <ol className="mt-5 space-y-5">{moreSenses.map((s, i) => sense(s, i + FIRST_MEANINGS))}</ol>
                </CollapsibleContent>
              </Collapsible>
            )}
            {w.grammarNotes && <UsageNote text={w.grammarNotes} />}
            {w.regionalNote && <p className="mt-1 text-muted-foreground">{w.regionalNote}</p>}
          </section>

          {w.examples.some((x) => x.senseId == null) && (
            <section>
              <h2 className="mb-3 text-base font-semibold">{w.examples.some((x) => x.senseId != null) ? 'More examples' : 'Examples'}</h2>
              <ExampleList examples={w.examples.filter((x) => x.senseId == null)} />
            </section>
          )}

          {practice.length > 0 && (
            <section>
              <h2 className="mb-3 text-base font-semibold">Practice this word</h2>
              <div className="grid max-w-md gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(practice.length, 2)}, minmax(0, 1fr))` }}>
                {practice.map((x) => (
                  <Button key={x.to} variant="outline" size="lg" className="h-auto flex-col gap-1.5 py-3" render={<Link to={x.to} title={x.title} />}>
                    <x.icon className="size-5 text-lang" aria-hidden="true" />
                    {x.label}
                  </Button>
                ))}
              </div>
            </section>
          )}

          {w.expressions.some((x) => x.kind === 'combination') && (
            <section>
              <h2 className="text-base font-semibold">Combinations</h2>
              <p className="mt-0.5 mb-3 text-sm text-muted-foreground">With other words it means something else. These meanings are not quizzed as meanings of the word itself.</p>
              <Expressions items={w.expressions.filter((x) => x.kind === 'combination')} />
            </section>
          )}

          {w.expressions.some((x) => x.kind !== 'combination') && (
            <section>
              <h2 className="mb-3 text-base font-semibold">Related expressions</h2>
              <Expressions items={w.expressions.filter((x) => x.kind !== 'combination')} />
            </section>
          )}

          <section aria-labelledby="notes-title">
            <h2 id="notes-title" className="mb-3 text-base font-semibold">
              Your notes
            </h2>
            {editingNote ? (
              <Card size="sm">
                <CardContent className="space-y-4">
                  <Field>
                    <FieldLabel htmlFor="note">Note</FieldLabel>
                    <Textarea id="note" className="min-h-20" value={note} onChange={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="mnemonic">Memory aid</FieldLabel>
                    <Textarea id="mnemonic" className="min-h-16" placeholder="A picture or a sound-alike that helps you remember it" value={mnemonic} onChange={(e) => setMnemonic((e.target as HTMLTextAreaElement).value)} />
                  </Field>
                  <div className="flex gap-2">
                    <Button onClick={saveNote}>Save notes</Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setNote(w.note ?? '');
                        setMnemonic(w.mnemonic ?? '');
                        setEditingNote(false);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : w.note || w.mnemonic ? (
              <Card size="sm" className="bg-muted/40">
                <CardContent className="space-y-2">
                  {w.note && <p className="whitespace-pre-line">{w.note}</p>}
                  {w.mnemonic && (
                    <p className="whitespace-pre-line text-muted-foreground">
                      <span className="font-medium text-foreground">Memory aid: </span>
                      {w.mnemonic}
                    </p>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setEditingNote(true)}>
                    <LuPencil aria-hidden="true" /> Edit notes
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Button variant="outline" onClick={() => setEditingNote(true)}>
                <LuNotebookPen aria-hidden="true" /> Add a note
              </Button>
            )}
          </section>
        </TabsContent>

        {hasForms && (
          <TabsContent value="forms" className="pt-6">
            {w.paradigm ? (
              <section aria-labelledby="paradigm-title">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <h2 id="paradigm-title" className="text-base font-semibold">
                    {tableTitle(w.paradigm)}
                  </h2>
                  {!w.paradigm.indeclinable && (
                    <Button variant="outline" size="sm" render={<Link to={`/practice/forms?entry=${entryId}`} />}>
                      <LuTable2 aria-hidden="true" /> Practice these forms
                    </Button>
                  )}
                </div>
                {w.paradigm.notes?.length ? <p className="mb-3 text-sm text-muted-foreground">{w.paradigm.notes.join(', ')}</p> : null}
                <ParadigmTable language={language} paradigm={w.paradigm} />
                {w.paradigm.source && <p className="hint mt-3">Table: {w.paradigm.source}</p>}
              </section>
            ) : (
              <section>
                <h2 className="mb-3 text-base font-semibold">Forms</h2>
                <Card size="sm" className="py-0">
                  <Table>
                    <TableBody>
                      {w.forms.map((f) => (
                        <TableRow key={f.id}>
                          <TableCell className="px-4 py-2.5">
                            <Word text={f.display ?? f.form} className="text-[1.125rem]" />
                          </TableCell>
                          <TableCell className="px-4 py-2.5 text-muted-foreground">{f.tags.join(', ')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              </section>
            )}
          </TabsContent>
        )}

        <TabsContent value="history" className="space-y-8 pt-6">
          <section>
            <h2 className="mb-3 text-base font-semibold">What you can do with this word</h2>
            <ul className="space-y-2 text-[0.9375rem]">
              <Level ok={w.mastery.encountered} text="Met it" />
              <Level ok={w.mastery.recognizesWritten} text="Recognise it in writing, on a later day" />
              <Level ok={w.mastery.understandsListening} text="Understand it by ear" na="no recording yet" />
              <Level ok={w.mastery.retrievesFromEnglish} text={`Recall it from English`} />
              <Level ok={w.mastery.usesInSentence} text="Use it in a sentence" />
              <Level ok={w.mastery.productiveMastery} text="Recall it for the long term (21 days or more)" />
            </ul>
            <p className="hint mt-3">Each step needs a right answer on a later day than the first meeting. Picking from a list never counts as recalling.</p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold">Schedule</h2>
            {w.cards.filter((c) => c.state).length === 0 ? (
              <p className="text-muted-foreground">Not scheduled yet.</p>
            ) : (
              <div className="space-y-2">
                {w.cards
                  .filter((c) => c.state)
                  .map((c) => (
                    <Item key={c.skill} variant="outline" size="sm">
                      <ItemContent>
                        <ItemTitle>{c.skill === 'receptive' ? `Recognising it (${name} to English)` : `Recalling it (English to ${name})`}</ItemTitle>
                        <ItemDescription className="line-clamp-none">
                          {[
                            c.retrievability != null && `${pct(c.retrievability)} likely to remember it now`,
                            c.stability != null && <span title="How long the memory stays above 90% after a review">memory lasts about {duration(c.stability)}</span>,
                            `${count(c.reps)} ${c.reps === 1 ? 'review' : 'reviews'}, ${count(c.lapses)} ${c.lapses === 1 ? 'slip' : 'slips'}`,
                          ]
                            .filter(Boolean)
                            .map((x, i) => (
                              <span key={i}>
                                {i > 0 && ' · '}
                                {x}
                              </span>
                            ))}
                        </ItemDescription>
                      </ItemContent>
                      <ItemActions className="text-sm font-medium">{dueText(c.due)}</ItemActions>
                    </Item>
                  ))}
              </div>
            )}
          </section>

          {w.evidence.length > 0 && (
            <section>
              <h2 className="mb-3 text-base font-semibold">Answers by skill</h2>
              <Card size="sm" className="py-0">
                <Table>
                  <TableBody>
                    {w.evidence.map((e) => (
                      <TableRow key={e.skill}>
                        <TableCell className="px-4 py-2.5">{SKILL_LABELS[e.skill as keyof typeof SKILL_LABELS] ?? (String(e.skill).endsWith('_assisted') ? 'Choosing the word (assisted)' : e.skill)}</TableCell>
                        <TableCell className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">
                          {e.correct} of {e.attempts} right
                          {e.delayedCorrect ? `, ${e.delayedCorrect} on a later day` : ''}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </section>
          )}

          {w.reviews.length > 0 && (
            <section>
              <h2 className="mb-3 text-base font-semibold">Reviews</h2>
              <Card size="sm" className="max-h-80 overflow-y-auto py-0">
                <Table>
                  <TableHeader className="sticky top-0 bg-card">
                    <TableRow>
                      <TableHead className="px-4">Date</TableHead>
                      <TableHead className="px-4">Answer</TableHead>
                      <TableHead className="px-4 text-right">Next</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {w.reviews.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="px-4 py-2">
                          {dateTime(r.reviewedAt, { dateStyle: 'medium' })}
                          <span className="block text-xs text-muted-foreground">{r.skill === 'receptive' ? 'recognising' : 'recalling'}</span>
                        </TableCell>
                        <TableCell className="px-4 py-2">{RATING[r.rating]}</TableCell>
                        <TableCell className="px-4 py-2 text-right text-muted-foreground">{intervalText(r.scheduledDays)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </section>
          )}

          <PronunciationTools entryId={entryId} onChange={() => setAudioKey((k) => k + 1)} />

          <section className="space-y-1 text-sm text-muted-foreground">
            <h2 className="mb-2 text-base font-semibold text-foreground">Where it comes from</h2>
            {w.frequencies.length > 0 ? (
              <p>
                Frequency: {w.frequencies.map((f) => `rank ${f.rank ?? '—'} in ${f.source}`).join('; ')}. How common a word is in a corpus is evidence of how useful it is, not a perfect measure.
              </p>
            ) : (
              w.curatedOrder && <p>Teaching order {w.curatedOrder} in a curated list (not a corpus frequency rank).</p>
            )}
            {w.source && (
              <p>
                Source: {w.source.name}
                {w.source.license ? ` (${w.source.license})` : ''}.
              </p>
            )}
            {w.isCustom && <p>Added by you.</p>}
            {w.recentAttempts[0] && <p>Last practiced {relative(w.recentAttempts[0].answeredAt)}.</p>}
          </section>
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete <span className="word">{w.display}</span>?
            </AlertDialogTitle>
            <AlertDialogDescription>It will no longer be studied. Its learning history stays in your backups.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * A meaning's dictionary definition under its gloss. Dictionary text often repeats the gloss and then explains it in
 * brackets ("dog (Any member of the subspecies…)"): the repeat is dropped, and a long definition is cut to two lines
 * until asked for.
 */
function Definition({ gloss, text }: { gloss: string; text: string | null }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  let t = text.trim();
  if (t.toLowerCase() === gloss.trim().toLowerCase()) return null;
  const m = t.toLowerCase().startsWith(`${gloss.trim().toLowerCase()} (`) && t.endsWith(')') ? t.slice(gloss.trim().length + 2, -1) : null;
  if (m) t = m;
  const long = t.length > 110;
  return (
    <p className="mt-0.5 text-[0.9375rem] text-muted-foreground">
      <span className={long && !open ? 'line-clamp-2' : undefined}>{t}</span>
      {long && (
        <button type="button" className="rounded text-sm font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Less' : 'More'}
        </button>
      )}
    </p>
  );
}

/** A usage note from the dictionary: its sentences, then its starred examples ("* Tengo hambre — I'm hungry") as a list. */
function UsageNote({ text }: { text: string }) {
  const [lead, ...points] = text.split(/\s+\*\s+/).map((x) => x.trim()).filter(Boolean);
  return (
    <div className="mt-5 rounded-xl bg-muted/50 p-4 text-[0.9375rem]">
      <p>{lead}</p>
      {points.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 marker:text-muted-foreground">
          {points.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A word's combinations or related expressions: the expression in the language, its meaning beside it. */
function Expressions({ items }: { items: VocabDetail['expressions'] }) {
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {items.map((x) => (
        <li key={x.id} className="px-4 py-2.5">
          <span className="word text-[1.0625rem]">{x.text}</span>
          {x.translation && <span className="block text-sm text-muted-foreground">{x.translation}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Example sentences with their translation and source. */
function ExampleList({ examples, className = '' }: { examples: VocabDetail['examples']; className?: string }) {
  return (
    <ul className={cn('space-y-3 border-l-2 border-lang/40 pl-4', className)}>
      {examples.map((x) => (
        <li key={x.id}>
          <p className="word text-[1.125rem] leading-snug">{x.display ?? x.text}</p>
          {x.translation && <p className="mt-0.5 text-[0.9375rem] text-muted-foreground">{x.translation}</p>}
          {x.source?.ai && <AiSentenceNote long />}
          {x.source && !x.source.ai && (
            <p className="hint mt-0.5">
              {x.source.url ? (
                <a href={x.source.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2">
                  {x.source.name}
                </a>
              ) : (
                x.source.name
              )}
              {x.source.license && <span> · {x.source.license.replace(/-/g, ' ')}</span>}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function Level({ ok, text, na }: { ok: boolean | null; text: string; na?: string }) {
  const Icon = ok ? LuCircleCheck : ok === null ? LuCircleDashed : LuCircle;
  return (
    <li className="flex items-start gap-2.5">
      <Icon className={cn('mt-0.5 size-[1.125rem] shrink-0', ok ? 'text-success' : 'text-muted-foreground/60')} aria-hidden="true" />
      <span className={ok ? '' : 'text-muted-foreground'}>
        {text}
        {ok === null && na ? ` (${na})` : ''}
        <span className="sr-only">{ok ? ': yes' : ': not yet'}</span>
      </span>
    </li>
  );
}

function PronunciationTools({ entryId, onChange }: { entryId: number; onChange: () => void }) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = async (blob: Blob) => {
    setBusy(true);
    try {
      await api('POST', `/api/audio/${entryId}/recordings`, blob, { contentType: blob.type.split(';')[0] || 'audio/webm' });
      await lookupAudio(entryId, true);
      toast('Your recording was saved and labelled as user-uploaded.', 'good');
      onChange();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Upload failed', 'bad');
    } finally {
      setBusy(false);
    }
  };
  const record = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRec(null);
        void upload(new Blob(chunks, { type: r.mimeType || 'audio/webm' }));
      };
      r.start();
      setRec(r);
      setTimeout(() => r.state === 'recording' && r.stop(), 6000);
    } catch {
      toast('Microphone access was refused or is unavailable.', 'bad');
    }
  };
  return (
    <section>
      <h2 className="text-base font-semibold">Your own recording</h2>
      <p className="mt-0.5 mb-3 text-sm text-muted-foreground">Record yourself or a tutor, or upload a file, for when there is no native recording. It is always labelled as user-uploaded and plays offline.</p>
      <div className="flex flex-wrap gap-2">
        {rec ? (
          <Button variant="destructive" onClick={() => rec.stop()}>
            <LuSquare aria-hidden="true" /> Stop
          </Button>
        ) : (
          <Button variant="outline" disabled={busy} onClick={() => void record()}>
            <LuMic aria-hidden="true" /> Record
          </Button>
        )}
        <Button variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
          <LuUpload aria-hidden="true" /> Upload a file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) void upload(f);
          }}
        />
      </div>
    </section>
  );
}
