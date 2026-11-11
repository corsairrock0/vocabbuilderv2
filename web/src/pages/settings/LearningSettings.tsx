// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useEffect, useId, useState, type ReactNode } from 'react';
import { LANGUAGES, type LanguageCode } from '../../../../shared/languages.ts';
import { DAILY_GOAL_OPTIONS, NEW_WORD_OPTIONS, RETENTION_OPTIONS, SESSION_MINUTE_OPTIONS, type LanguageSettings } from '../../../../shared/settings.ts';
import { get } from '../../lib/api.ts';
import { count, pct } from '../../lib/format.ts';
import { langSettings, updateLanguageSettings, useApp } from '../../lib/store.ts';
import { Segmented, Toggle } from '../../components/ui.tsx';
import { Button } from '../../components/ui/button.tsx';
import { RadioGroup, RadioGroupItem } from '../../components/ui/controls.tsx';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { NativeSelect, NativeSelectOption } from '../../components/ui/input-group.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table.tsx';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/tabs.tsx';
import { MemoryModel } from './MemoryModel.tsx';
import { Group, LanguageSelect, Setting } from './parts.tsx';

interface Tradeoff {
  cardsInReview: number;
  options: Array<{ retention: number; reviewsPerDayPer100: number; reviewsPerDayForYou: number | null; reviewsPerWordPerYear: number }>;
  note: string;
}

const STRICTNESS: Array<{ value: LanguageSettings['spellingStrictness']; title: string; about: string }> = [
  { value: 'strict', title: 'Strict', about: 'A typo or a missing accent counts as wrong.' },
  { value: 'normal', title: 'Normal', about: 'A small typo or a missing accent counts as “almost” (rated Hard).' },
  { value: 'lenient', title: 'Lenient', about: 'A missing accent counts as right; a small typo still counts as “almost”.' },
];

export function LearningSettings() {
  const code = useApp((s) => s.boot?.settings.activeLanguage ?? 'es') as LanguageCode;
  useApp((s) => s.boot?.languageSettings[code]);
  const ls = langSettings(code)!;
  const [tradeoff, setTradeoff] = useState<Tradeoff | null>(null);
  const [sources, setSources] = useState<Array<{ id: number; name: string; kind: string }>>([]);
  // What each target costs is worked out with the memory model in use: asked again when that changes.
  const model = ls?.fsrsParameters ? ls.fsrsParameters.join(',') : '';
  useEffect(() => {
    setTradeoff(null);
    get<Tradeoff>(`/api/stats/retention/${code}`).then(setTradeoff).catch(() => undefined);
  }, [code, model]);
  useEffect(() => {
    get<{ sources: Array<{ id: number; name: string; kind: string }> }>(`/api/vocab/meta?lang=${code}`)
      .then((m) => setSources(m.sources.filter((s) => s.kind.startsWith('frequency'))))
      .catch(() => undefined);
  }, [code]);
  if (!ls) return null;
  const set = (patch: Partial<LanguageSettings>) => void updateLanguageSettings(code, patch);
  const name = LANGUAGES[code].name;
  const otherNew = !NEW_WORD_OPTIONS.includes(ls.dailyNewTarget);

  return (
    <div data-lang={code} className="flex flex-col gap-5">
      <LanguageSelect value={code} />

      <Group title="Each day">
        <Setting label="New words a day" hint="A ceiling, not a quota: fewer new words come when reviews pile up or your answers get less sure.">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="New words a day" value={otherNew ? -1 : ls.dailyNewTarget} onChange={(v) => v >= 0 && set({ dailyNewTarget: v })} options={NEW_WORD_OPTIONS.map((n) => ({ value: n, label: String(n) }))} />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Other
              <Input
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                className="h-10 w-20"
                aria-label="Another number of new words a day"
                value={ls.dailyNewTarget}
                onChange={(e) => set({ dailyNewTarget: Math.max(0, Math.min(100, Number((e.target as HTMLInputElement).value) || 0)) })}
              />
            </label>
          </div>
        </Setting>
        <Setting label="Session length">
          <Segmented label="Session length" value={ls.sessionMinutes} onChange={(sessionMinutes) => set({ sessionMinutes })} options={SESSION_MINUTE_OPTIONS.map((m) => ({ value: m, label: `${m} min` }))} />
        </Setting>
        <Setting label="Daily goal" hint={`Minutes of study a day in ${name}. Today and Progress show the days you reach it.`}>
          <Segmented label="Daily goal" value={ls.dailyGoalMinutes ?? 20} onChange={(dailyGoalMinutes) => set({ dailyGoalMinutes })} options={DAILY_GOAL_OPTIONS.map((m) => ({ value: m, label: `${m} min` }))} />
        </Setting>
      </Group>

      <Group title="Memory">
        <Setting
          label="How sure you want to be at each review"
          hint="Reviews are timed so that you still remember a word this often when it comes back. Higher means more reviews. Changing it re-times future reviews from your whole history."
        >
          <Segmented label="Desired retention" value={ls.desiredRetention} onChange={(desiredRetention) => set({ desiredRetention })} options={RETENTION_OPTIONS.map((r) => ({ value: r, label: pct(r) }))} />
        </Setting>
        {tradeoff && (
          <Collapsible>
            <CollapsibleTrigger render={<Button variant="outline" size="sm" />}>What each choice costs</CollapsibleTrigger>
            <CollapsibleContent className="mt-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-0">Target</TableHead>
                    <TableHead className="text-right whitespace-normal">Reviews a day per 100 words</TableHead>
                    {tradeoff.cardsInReview > 0 && <TableHead className="pr-0 text-right whitespace-normal">For your {count(tradeoff.cardsInReview)} word memories</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tradeoff.options.map((o) => (
                    <TableRow key={o.retention} className={o.retention === ls.desiredRetention ? 'bg-lang-soft/60 font-semibold' : undefined}>
                      <TableCell className="pl-2 tabular-nums">{pct(o.retention)}</TableCell>
                      <TableCell className="text-right tabular-nums">{o.reviewsPerDayPer100.toFixed(1)}</TableCell>
                      {tradeoff.cardsInReview > 0 && <TableCell className="pr-2 text-right tabular-nums">{o.reviewsPerDayForYou?.toFixed(1)}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-2 text-sm text-muted-foreground">{tradeoff.note}</p>
            </CollapsibleContent>
          </Collapsible>
        )}
        <MemoryModel code={code} />
      </Group>

      <Group title="Answer checking">
        <RadioGroup value={ls.spellingStrictness} onValueChange={(v) => set({ spellingStrictness: v as LanguageSettings['spellingStrictness'] })} aria-label="Spelling strictness" className="gap-2">
          {STRICTNESS.map((o) => (
            <FieldLabel key={o.value} htmlFor={`strict-${o.value}`}>
              <Field orientation="horizontal" data-state={ls.spellingStrictness === o.value ? 'checked' : 'unchecked'}>
                <FieldContent>
                  <FieldTitle>{o.title}</FieldTitle>
                  <FieldDescription>{o.about}</FieldDescription>
                </FieldContent>
                <RadioGroupItem value={o.value} id={`strict-${o.value}`} />
              </Field>
            </FieldLabel>
          ))}
        </RadioGroup>
        {(code === 'vi' || code === 'ru') && (
          <p className="text-sm text-muted-foreground">
            {code === 'vi' ? 'A wrong Vietnamese tone counts as a different word, so as wrong; in lenient mode it is “almost”.' : 'Writing е for ё is always accepted.'}
          </p>
        )}
      </Group>

      <Group title="Session mix">
        <div className="grid gap-4 sm:grid-cols-2">
          <Choice label="Focus" value={ls.focus} onChange={(focus) => set({ focus: focus as LanguageSettings['focus'] })} options={[['balanced', 'Balanced'], ['listening', 'Listening'], ['speaking', 'Speaking'], ['reading', 'Reading'], ['writing', 'Typing']]} />
          <Choice label="Difficulty" value={ls.difficulty} onChange={(difficulty) => set({ difficulty: difficulty as LanguageSettings['difficulty'] })} options={[['easy', 'Gentle'], ['normal', 'Normal'], ['challenging', 'Challenging']]} />
          <Choice
            label="Review order"
            value={ls.reviewPriority}
            onChange={(reviewPriority) => set({ reviewPriority: reviewPriority as LanguageSettings['reviewPriority'] })}
            options={[['balanced', 'Most at risk first'], ['due_first', 'Oldest due first'], ['difficult_first', 'Hardest first']]}
          />
          <Choice label="Repetitions for new words" value={ls.repetitions} onChange={(repetitions) => set({ repetitions: repetitions as LanguageSettings['repetitions'] })} options={[['fewer', 'Fewer'], ['normal', 'Normal'], ['more', 'More']]} />
        </div>
      </Group>

      <Group title="Advanced" className="gap-0">
        <Accordion type="multiple" className="-my-2">
          <AccordionItem value="ranks">
            <AccordionTrigger className="text-[0.9375rem]">Which words come as new words</AccordionTrigger>
            <AccordionContent className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <Setting label="From rank" htmlFor="fmin">
                  <Input id="fmin" inputMode="numeric" value={ls.frequencyMin ?? ''} placeholder="1" onChange={(e) => set({ frequencyMin: Number((e.target as HTMLInputElement).value) || null })} />
                </Setting>
                <Setting label="Up to rank" htmlFor="fmax">
                  <Input id="fmax" inputMode="numeric" value={ls.frequencyMax ?? ''} placeholder="any" onChange={(e) => set({ frequencyMax: Number((e.target as HTMLInputElement).value) || null })} />
                </Setting>
              </div>
              {sources.length > 0 && (
                <Setting label="Frequency list used for ranking" htmlFor="fsrc">
                  <NativeSelect id="fsrc" value={ls.frequencySourceId ?? ''} onChange={(e) => set({ frequencySourceId: Number((e.target as HTMLSelectElement).value) || null })}>
                    <NativeSelectOption value="">Best rank from any list</NativeSelectOption>
                    {sources.map((s) => (
                      <NativeSelectOption key={s.id} value={s.id}>
                        {s.name} ({s.kind.replace('frequency_', '')})
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Setting>
              )}
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="extras">
            <AccordionTrigger className="text-[0.9375rem]">Extra exercises</AccordionTrigger>
            <AccordionContent className="divide-y">
              <Toggle label="Pronunciation shadowing" hint="Listen, then say the word with the recording." checked={ls.includeShadowing} onChange={(includeShadowing) => set({ includeShadowing })} />
              <Toggle label="Writing your own sentence" hint="You rate it yourself; the app does not grade it." checked={ls.includeSentenceCreation} onChange={(includeSentenceCreation) => set({ includeSentenceCreation })} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Group>
    </div>
  );
}

/** One choice among a few, as a select with its label. */
function Choice({ label, value, onChange, options, hint }: { label: string; value: string; onChange: (v: string) => void; options: Array<[string, string]>; hint?: ReactNode }) {
  const id = useId();
  return (
    <Setting label={label} htmlFor={id} hint={hint}>
      <NativeSelect id={id} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
        {options.map(([v, text]) => (
          <NativeSelectOption key={v} value={v}>
            {text}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Setting>
  );
}
