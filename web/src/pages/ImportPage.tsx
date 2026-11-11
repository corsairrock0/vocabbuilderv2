// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useEffect, useId, useState, type ReactNode } from 'react';
import { LuArrowLeft, LuCircleCheck, LuUpload, LuUndo2 } from 'react-icons/lu';
import { LANGUAGES, LANGUAGE_CODES, type LanguageCode } from '../../../shared/languages.ts';
import { ApiError, api, get, post } from '../lib/api.ts';
import { Link, useLocation } from '../lib/router.tsx';
import { loadBootstrap, toast, useApp } from '../lib/store.ts';
import { count, dateTime } from '../lib/format.ts';
import { PageHeader, Segmented } from '../components/ui.tsx';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Spinner } from '../components/ui/basics.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../components/ui/dialog.tsx';
import { Field, FieldDescription, FieldLabel } from '../components/ui/field.tsx';
import { Input } from '../components/ui/input.tsx';
import { NativeSelect, NativeSelectOption } from '../components/ui/input-group.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.tsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/tabs.tsx';

const FIELDS: Array<{ id: string; label: string; vocab: boolean; freq: boolean }> = [
  { id: 'lemma', label: 'Word (required)', vocab: true, freq: true },
  { id: 'gloss', label: 'English meaning (required)', vocab: true, freq: false },
  { id: 'translations', label: 'Other accepted meanings', vocab: true, freq: false },
  { id: 'pos', label: 'Part of speech', vocab: true, freq: true },
  { id: 'rank', label: 'Frequency rank', vocab: true, freq: true },
  { id: 'count', label: 'Frequency count', vocab: false, freq: true },
  { id: 'display', label: 'Stressed / display form', vocab: true, freq: false },
  { id: 'gender', label: 'Gender', vocab: true, freq: false },
  { id: 'aspect', label: 'Aspect', vocab: true, freq: false },
  { id: 'pronunciation', label: 'Pronunciation (IPA)', vocab: true, freq: false },
  { id: 'example', label: 'Example sentence', vocab: true, freq: false },
  { id: 'exampleTranslation', label: 'Example translation', vocab: true, freq: false },
  { id: 'exampleTarget', label: 'Word as it appears in the example', vocab: true, freq: false },
  { id: 'forms', label: 'Inflected forms (form:tags; …)', vocab: true, freq: false },
  { id: 'tags', label: 'Topics / tags', vocab: true, freq: false },
  { id: 'notes', label: 'Grammar notes', vocab: true, freq: false },
  { id: 'regionalNote', label: 'Regional note', vocab: true, freq: false },
];

const JOB_STATUS: Record<string, string> = { committed: 'imported', undone: 'undone', failed: 'failed', uploaded: 'not imported', validated: 'not imported' };

interface Preview {
  id: string;
  format: string;
  kind: 'vocabulary' | 'frequency';
  columns: string[];
  sample: Array<Record<string, string>>;
  rowCount: number;
  suggestedMapping: Record<string, string>;
  needsMapping: boolean;
}

export function ImportPage() {
  const { query } = useLocation();
  const active = useApp((s) => s.boot?.settings.activeLanguage ?? 'es') as LanguageCode;
  const [language, setLanguage] = useState<LanguageCode>((query.get('lang') as LanguageCode) || active);
  const [kind, setKind] = useState<'vocabulary' | 'frequency'>('vocabulary');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [options, setOptions] = useState({ duplicatePolicy: 'skip', homographPolicy: 'new', listSeparator: ';', sourceName: '', sourceLicense: '', sourceUrl: '', frequencyKind: 'frequency_subtitles' });
  const [report, setReport] = useState<any>(null);
  const [decisions, setDecisions] = useState<Record<string, 'skip' | 'merge' | 'new'>>({});
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const loadJobs = () => get<any[]>('/api/import/jobs').then(setJobs).catch(() => undefined);
  useEffect(() => {
    void loadJobs();
  }, []);

  const reset = () => {
    setPreview(null);
    setReport(null);
    setResult(null);
    setDecisions({});
  };

  const upload = async () => {
    if (!file) return;
    setBusy('upload');
    reset();
    try {
      const p = await api<Preview>('POST', `/api/import/upload?lang=${language}&kind=${kind}&filename=${encodeURIComponent(file.name)}`, file, { contentType: file.type || 'application/octet-stream' });
      setPreview(p);
      setMapping(p.suggestedMapping ?? {});
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'bad');
    } finally {
      setBusy(null);
    }
  };
  const opts = () => ({
    duplicatePolicy: options.duplicatePolicy,
    homographPolicy: options.homographPolicy,
    listSeparator: options.listSeparator,
    ...(options.sourceName ? { sourceName: options.sourceName } : {}),
    ...(options.sourceLicense ? { sourceLicense: options.sourceLicense } : {}),
    ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
    ...(kind === 'frequency' ? { frequencyKind: options.frequencyKind } : {}),
    decisions,
  });
  const validate = async () => {
    if (!preview) return;
    setBusy('validate');
    try {
      const r = await post<{ report: any }>(`/api/import/${preview.id}/validate`, { mapping, options: opts() });
      setReport(r.report);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'bad');
    } finally {
      setBusy(null);
    }
  };
  const commit = async () => {
    if (!preview) return;
    setBusy('commit');
    try {
      const r = await post<any>(`/api/import/${preview.id}/commit`, { mapping, options: opts() });
      setResult(r);
      toast('Import complete.', 'good');
      void loadJobs();
      void loadBootstrap();
    } catch (err) {
      toast(err instanceof ApiError ? `${err.message}` : String(err), 'bad');
    } finally {
      setBusy(null);
    }
  };
  const [undoing, setUndoing] = useState<string | null>(null);
  const undo = async (id: string) => {
    try {
      const r = await post<{ removed: number; keptWithProgress: number }>(`/api/import/${id}/undo`);
      toast(`Removed ${r.removed} words${r.keptWithProgress ? `; kept ${r.keptWithProgress} with learning progress` : ''}.`, 'good');
      void loadJobs();
      void loadBootstrap();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'bad');
    }
  };

  const stats = result?.stats ? Object.entries(result.stats as Record<string, unknown>).filter(([, v]) => typeof v === 'number' && v > 0) : [];
  return (
    <div className="flex max-w-2xl flex-col gap-5" data-lang={language}>
      <PageHeader
        title="Import words"
        back={
          <Button variant="ghost" size="sm" className="-ml-2.5 text-muted-foreground" render={<Link to="/words" />}>
            <LuArrowLeft aria-hidden="true" /> Words
          </Button>
        }
        description="Bring in word lists with English meanings (CSV, TSV, JSON, JSONL, Kaikki/Wiktextract dictionary lines, or VocabBuilder files), or a frequency list to rank words you already have. Check each source’s licence for personal use; docs/VOCABULARY_SOURCES.md lists verified ones."
      />

      <Step n={1} title="Choose a file">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Language"
            value={language}
            onChange={(v) => {
              setLanguage(v as LanguageCode);
              reset();
            }}
          >
            {LANGUAGE_CODES.map((c) => (
              <NativeSelectOption key={c} value={c}>
                {LANGUAGES[c].name}
              </NativeSelectOption>
            ))}
          </Select>
          <Field className="gap-1.5">
            <FieldLabel>This file holds</FieldLabel>
            <Segmented
              label="This file holds"
              value={kind}
              onChange={(k: 'vocabulary' | 'frequency') => {
                setKind(k);
                reset();
              }}
              options={[
                { value: 'vocabulary', label: 'Words with meanings' },
                { value: 'frequency', label: 'A frequency list' },
              ]}
            />
          </Field>
        </div>
        <Field className="gap-1.5">
          <FieldLabel htmlFor="ifile">File</FieldLabel>
          <Input
            id="ifile"
            type="file"
            className="h-auto py-2 file:mr-3 file:rounded-md file:bg-secondary file:px-2.5"
            accept=".csv,.tsv,.tab,.txt,.json,.jsonl,.ndjson"
            onChange={(e) => {
              setFile((e.target as HTMLInputElement).files?.[0] ?? null);
              reset();
            }}
          />
          <FieldDescription className="text-xs">UTF-8 text. For a large dictionary dump, filter it first with scripts/kaikki-filter.mjs or import it on the server with the CLI.</FieldDescription>
        </Field>
        <Button className="self-start" disabled={!file || !!busy} onClick={() => void upload()}>
          {busy === 'upload' ? <Spinner /> : <LuUpload aria-hidden="true" />} {busy === 'upload' ? 'Reading the file' : 'Upload and preview'}
        </Button>
      </Step>

      {preview && (
        <Step n={2} title="Check how it reads" description={`${preview.format.toUpperCase()}, ${count(preview.rowCount)} rows`}>
          {preview.sample.length > 0 && (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {Object.keys(preview.sample[0]).map((c) => (
                      <TableHead key={c} className="px-3">
                        {c}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.sample.slice(0, 6).map((r, i) => (
                    <TableRow key={i}>
                      {Object.keys(preview.sample[0]).map((c) => (
                        <TableCell key={c} className="max-w-[16rem] truncate px-3">
                          {r[c]}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {preview.needsMapping && (
            <div>
              <h3 className="mb-3 text-[0.9375rem] font-semibold">Match your columns</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {FIELDS.filter((f) => (kind === 'vocabulary' ? f.vocab : f.freq)).map((f) => (
                  <Select key={f.id} label={f.label} value={mapping[f.id] ?? ''} onChange={(v) => setMapping({ ...mapping, [f.id]: v })}>
                    <NativeSelectOption value="">Not in this file</NativeSelectOption>
                    {preview.columns.map((c) => (
                      <NativeSelectOption key={c} value={c}>
                        {c}
                      </NativeSelectOption>
                    ))}
                  </Select>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {kind === 'vocabulary' ? (
              <>
                <Select label="When a word with the same meaning exists" value={options.duplicatePolicy} onChange={(v) => setOptions({ ...options, duplicatePolicy: v })}>
                  <NativeSelectOption value="skip">Skip it</NativeSelectOption>
                  <NativeSelectOption value="merge">Add new details to the existing word</NativeSelectOption>
                  <NativeSelectOption value="new">Create a separate entry</NativeSelectOption>
                </Select>
                <Select label="Same spelling, different meaning" value={options.homographPolicy} onChange={(v) => setOptions({ ...options, homographPolicy: v })}>
                  <NativeSelectOption value="new">Keep as a separate word (recommended)</NativeSelectOption>
                  <NativeSelectOption value="merge">Add as another meaning</NativeSelectOption>
                  <NativeSelectOption value="skip">Skip</NativeSelectOption>
                </Select>
              </>
            ) : (
              <Select label="Where the list comes from" value={options.frequencyKind} onChange={(v) => setOptions({ ...options, frequencyKind: v })}>
                <NativeSelectOption value="frequency_subtitles">Film and TV subtitles (conversational)</NativeSelectOption>
                <NativeSelectOption value="frequency_spoken">Spoken corpus</NativeSelectOption>
                <NativeSelectOption value="frequency_written">Written corpus (news, books)</NativeSelectOption>
                <NativeSelectOption value="frequency_mixed">Mixed or unknown</NativeSelectOption>
              </Select>
            )}
            <Text label="Source name" value={options.sourceName} placeholder="e.g. FrequencyWords pt_br 2018" onChange={(v) => setOptions({ ...options, sourceName: v })} />
            <Text label="Licence" value={options.sourceLicense} placeholder="e.g. CC BY-SA 4.0" onChange={(v) => setOptions({ ...options, sourceLicense: v })} />
            <Text label="Source address" value={options.sourceUrl} placeholder="https://" onChange={(v) => setOptions({ ...options, sourceUrl: v })} />
          </div>
          <Button variant="outline" className="self-start" disabled={!!busy} onClick={() => void validate()}>
            {busy === 'validate' && <Spinner />} {busy === 'validate' ? 'Checking' : 'Check the file'}
          </Button>
        </Step>
      )}

      {report && (
        <Step n={3} title="Import">
          {kind === 'frequency' ? (
            <p>
              {count(report.total)} rows; {count(report.matchedRows)} match words you have, ranking {count(report.entriesRanked)} entries. {count(report.unmatched)} rows have no matching word. {report.note}
            </p>
          ) : (
            <>
              <p>
                {count(report.valid)} of {count(report.total)} rows are valid: {count(report.newEntries)} new words, {count(report.duplicates.length)} already present, {count(report.homographs.length)} with the same spelling but a different meaning,{' '}
                {count(report.inFileDuplicates.length)} repeated in the file, {count(report.errors.length)} with errors.
              </p>
              {report.errors.length > 0 && (
                <Collapsible>
                  <CollapsibleTrigger render={<Button variant="outline" size="sm" />}>{`Rows with errors (${count(report.errors.length)}, skipped)`}</CollapsibleTrigger>
                  <CollapsibleContent>
                    <ul className="mt-2 max-h-56 overflow-y-auto rounded-xl border p-3 text-sm">
                      {report.errors.map((e: any) => (
                        <li key={e.row}>
                          Row {e.row} {e.lemma && <span className="word">“{e.lemma}”</span>}: {e.errors.join('; ')}
                        </li>
                      ))}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              )}
              {report.homographs.length > 0 && (
                <div className="rounded-xl border p-4">
                  <p className="mb-2 font-medium">Same spelling, different meaning: decide for each word</p>
                  <ul className="max-h-72 divide-y overflow-y-auto text-sm">
                    {report.homographs.map((h: any) => (
                      <li key={h.row} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span className="min-w-0">
                          <span className="word text-base">{h.lemma}</span> “{h.gloss}” <span className="text-muted-foreground">beside the existing “{h.existing.map((x: any) => x.gloss).join('”, “')}”</span>
                        </span>
                        <NativeSelect size="sm" aria-label={`What to do with ${h.lemma}`} value={decisions[String(h.row)] ?? options.homographPolicy} onChange={(e) => setDecisions({ ...decisions, [String(h.row)]: (e.target as HTMLSelectElement).value as any })}>
                          <NativeSelectOption value="new">Separate word</NativeSelectOption>
                          <NativeSelectOption value="merge">Add as a meaning</NativeSelectOption>
                          <NativeSelectOption value="skip">Skip</NativeSelectOption>
                        </NativeSelect>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {result ? (
            <Alert variant="success">
              <LuCircleCheck aria-hidden="true" />
              <AlertTitle>Imported</AlertTitle>
              {stats.length > 0 && <AlertDescription>{stats.map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${count(v as number)}`).join(', ')}</AlertDescription>}
            </Alert>
          ) : (
            <>
              <Button size="lg" className="self-start px-8" disabled={!!busy} onClick={() => void commit()}>
                {busy === 'commit' && <Spinner />} {busy === 'commit' ? 'Importing' : 'Import'}
              </Button>
              <p className="hint">The import is all or nothing: if anything fails, nothing is changed.</p>
            </>
          )}
        </Step>
      )}

      {jobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Recent imports</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="-my-2 divide-y">
              {jobs.slice(0, 15).map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5 text-[0.9375rem]">
                  <span className="min-w-0">
                    <span className="break-all">
                      {LANGUAGES[j.language_code as LanguageCode]?.flag} {j.file_name}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      {dateTime(j.created_at)}
                      <Badge variant={j.status === 'committed' ? 'success' : j.status === 'failed' ? 'destructive' : 'secondary'} className="font-normal">
                        {JOB_STATUS[j.status] ?? j.status}
                      </Badge>
                    </span>
                  </span>
                  {j.status === 'committed' && !(j.stats?.refreshed > 0) && (
                    <Button variant="outline" size="sm" onClick={() => setUndoing(j.id)}>
                      <LuUndo2 aria-hidden="true" /> Undo
                    </Button>
                  )}
                  {j.status === 'committed' && j.stats?.refreshed > 0 && <span className="text-sm text-muted-foreground">An update: restore its backup to go back</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!undoing} onOpenChange={(v) => !v && setUndoing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo this import?</AlertDialogTitle>
            <AlertDialogDescription>Its words are removed. Words you have already started learning are kept.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => undoing && void undo(undoing)}>
              Undo the import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** One step of the import, as a card: its number and what it is for. */
function Step({ n, title, description, children }: { n: number; title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2.5">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-foreground text-xs font-semibold text-background tabular-nums" aria-hidden="true">
              {n}
            </span>
            <span className="sr-only">Step {n}: </span>
            {title}
          </h2>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">{children}</CardContent>
    </Card>
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  const id = useId();
  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect id={id} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
        {children}
      </NativeSelect>
    </Field>
  );
}

function Text({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const id = useId();
  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} value={value} placeholder={placeholder} autoComplete="off" onChange={(e) => onChange((e.target as HTMLInputElement).value)} />
    </Field>
  );
}
