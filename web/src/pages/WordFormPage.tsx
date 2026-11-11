// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { LuArrowLeft, LuPlus, LuTrash2 } from 'react-icons/lu';
import { LANGUAGES, PARTS_OF_SPEECH, type LanguageCode } from '../../../shared/languages.ts';
import type { VocabDetail } from '../../../shared/types.ts';
import { ApiError, get, post, put } from '../lib/api.ts';
import { navigate } from '../lib/router.tsx';
import { toast, useApp } from '../lib/store.ts';
import { ErrorNote, PageHeader, PageLoading } from '../components/ui.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { Field, FieldDescription, FieldLabel } from '../components/ui/field.tsx';
import { Input as KitInput } from '../components/ui/input.tsx';
import { NativeSelect, NativeSelectOption } from '../components/ui/input-group.tsx';
import { stripStress } from '../../../shared/text.ts';

interface Sense {
  gloss: string;
  translations: string;
  note: string;
  /** Usage examples or a longer definition: kept as they are (not edited here). */
  definition?: string | null;
}
interface Example {
  text: string;
  translation: string;
  target: string;
  /** Index of the meaning (in senses) the sentence shows; '' when not linked to one. */
  sense: number | '';
}
interface Form {
  form: string;
  tags: string;
}

export function WordFormPage({ entryId }: { entryId?: number }) {
  const activeLang = useApp((s) => s.boot?.settings.activeLanguage ?? 'es') as LanguageCode;
  const [language, setLanguage] = useState<LanguageCode>(activeLang);
  const [loaded, setLoaded] = useState(!entryId);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [lemma, setLemma] = useState('');
  const [display, setDisplay] = useState('');
  const [pos, setPos] = useState('noun');
  const [gender, setGender] = useState('');
  const [aspect, setAspect] = useState('');
  const [aspectPair, setAspectPair] = useState('');
  const [pronunciation, setPronunciation] = useState('');
  const [grammarNotes, setGrammarNotes] = useState('');
  const [regionalNote, setRegionalNote] = useState('');
  const [tags, setTags] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [senses, setSenses] = useState<Sense[]>([{ gloss: '', translations: '', note: '' }]);
  const [examples, setExamples] = useState<Example[]>([{ text: '', translation: '', target: '', sense: '' }]);
  const [forms, setForms] = useState<Form[]>([]);
  const [tableForms, setTableForms] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!entryId) return;
    get<VocabDetail>(`/api/vocab/${entryId}`)
      .then((w) => {
        setLanguage(w.language);
        setVersion(w.version);
        setLemma(w.lemma);
        setDisplay(w.display !== w.lemma ? w.display : '');
        setPos(w.pos);
        setGender(w.gender ?? '');
        setAspect(w.aspect ?? '');
        setAspectPair(w.aspectPair ?? '');
        setPronunciation(w.pronunciation ?? '');
        setGrammarNotes(w.grammarNotes ?? '');
        setRegionalNote(w.regionalNote ?? '');
        setTags(w.tags.join(', '));
        setImageUrl(w.imageUrl ?? '');
        setSenses(w.senses.map((s) => ({ gloss: s.gloss, translations: s.translations.filter((t) => t !== s.gloss).join('; '), note: s.note ?? '', definition: s.definition })));
        setExamples(
          w.examples.length
            ? w.examples.map((x) => {
                const k = w.senses.findIndex((s) => s.id === x.senseId);
                return { text: x.display ?? x.text, translation: x.translation ?? '', target: x.target ?? '', sense: k >= 0 ? k : '' };
              })
            : [{ text: '', translation: '', target: '', sense: '' }],
        );
        // Forms that come from the word's table are kept by the server; only other forms are edited here.
        const fromTable = new Set(w.paradigm ? Object.values(w.paradigm.cells).flat().map((f) => stripStress(f).toLowerCase()) : []);
        setTableForms(fromTable.size);
        setForms(w.forms.filter((f) => !fromTable.has(f.form.toLowerCase())).map((f) => ({ form: f.display ?? f.form, tags: f.tags.join(', ') })));
        setLoaded(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [entryId]);

  if (error) return <ErrorNote error={error} />;
  if (!loaded) return <PageLoading />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    // Meanings left blank are not saved, so sentence links are renumbered among the saved ones.
    const keptSenses = senses.filter((s) => s.gloss.trim());
    const senseIndex = new Map<number, number>();
    senses.forEach((s, i) => s.gloss.trim() && senseIndex.set(i, senseIndex.size));
    const body = {
      lemma,
      display: display || null,
      pos,
      gender: gender || null,
      aspect: aspect || null,
      aspectPair: aspectPair || null,
      pronunciation: pronunciation || null,
      grammarNotes: grammarNotes || null,
      regionalNote: regionalNote || null,
      imageUrl: imageUrl || null,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      senses: keptSenses.map((s) => ({ gloss: s.gloss.trim(), translations: s.translations.split(';').map((t) => t.trim()).filter(Boolean), note: s.note || null, definition: s.definition ?? null })),
      // Each sentence names the meaning it shows (by its position among the meanings that are saved).
      examples: examples
        .filter((x) => x.text.trim())
        .map((x) => ({ text: x.text.trim(), translation: x.translation || null, target: x.target || null, sense: keptSenses.length === 1 ? 0 : x.sense === '' ? null : (senseIndex.get(x.sense) ?? null) })),
      forms: forms.filter((f) => f.form.trim()).map((f) => ({ form: f.form.trim(), tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean) })),
    };
    try {
      if (entryId) {
        await put(`/api/vocab/${entryId}`, { ...body, baseVersion: version });
        toast('Changes saved.', 'good');
        navigate(`/words/${entryId}`, { replace: true });
      } else {
        const r = await post<{ entryId: number }>('/api/vocab', { ...body, language });
        toast('Word added.', 'good');
        navigate(`/words/${r.entryId}`, { replace: true });
      }
    } catch (err) {
      toast(err instanceof ApiError ? (err.isNetwork ? 'Editing vocabulary needs a connection to your server.' : err.message) : 'Could not save', 'bad');
    } finally {
      setBusy(false);
    }
  };

  const slavic = language === 'ru' || language === 'uk' || language === 'pl';
  const saveLabel = busy ? 'Saving' : entryId ? 'Save changes' : 'Add word';
  return (
    <form onSubmit={submit} className="max-w-2xl space-y-5" data-lang={language}>
      <PageHeader
        title={entryId ? 'Edit word' : 'Add a word'}
        back={
          <Button variant="ghost" size="sm" className="-ml-2.5 text-muted-foreground" onClick={() => history.back()}>
            <LuArrowLeft aria-hidden="true" /> Back
          </Button>
        }
      >
        <Button type="submit" size="lg" disabled={busy}>
          {saveLabel}
        </Button>
      </PageHeader>

      <Group title="The word">
        <div className="grid gap-4 sm:grid-cols-2">
          {!entryId && (
            <Select label="Language" value={language} onChange={(v) => setLanguage(v as LanguageCode)} className="sm:col-span-2">
              {Object.values(LANGUAGES).map((l) => (
                <NativeSelectOption key={l.code} value={l.code}>
                  {l.name}: {l.variety}
                </NativeSelectOption>
              ))}
            </Select>
          )}
          <Input label="Word (dictionary form)" value={lemma} onChange={setLemma} required lang={language} serif />
          {(language === 'ru' || language === 'uk') && <Input label="With stress mark (optional)" value={display} onChange={setDisplay} lang={language} serif hint="Add U+0301 after the stressed vowel, e.g. вода́" />}
          <Select label="Word class" value={pos} onChange={setPos}>
            {PARTS_OF_SPEECH.map((p) => (
              <NativeSelectOption key={p} value={p}>
                {p}
              </NativeSelectOption>
            ))}
          </Select>
          {pos === 'noun' && (
            <Select label="Gender" value={gender} onChange={setGender}>
              <NativeSelectOption value="">Not set</NativeSelectOption>
              <NativeSelectOption value="m">masculine</NativeSelectOption>
              <NativeSelectOption value="f">feminine</NativeSelectOption>
              {slavic && <NativeSelectOption value="n">neuter</NativeSelectOption>}
            </Select>
          )}
          {pos === 'verb' && slavic && (
            <>
              <Select label="Aspect" value={aspect} onChange={setAspect}>
                <NativeSelectOption value="">Not set</NativeSelectOption>
                <NativeSelectOption value="imperfective">imperfective</NativeSelectOption>
                <NativeSelectOption value="perfective">perfective</NativeSelectOption>
                <NativeSelectOption value="biaspectual">biaspectual</NativeSelectOption>
              </Select>
              <Input label="Aspect partner" value={aspectPair} onChange={setAspectPair} lang={language} serif />
            </>
          )}
          <Input label="Pronunciation (IPA, optional)" value={pronunciation} onChange={setPronunciation} />
        </div>
      </Group>

      <Group title="English meanings" description="The first meaning is the one quizzed first. Answers you list as also accepted count as right.">
        <div className="space-y-3">
          {senses.map((s, i) => (
            <Block
              key={i}
              title={`Meaning ${i + 1}`}
              onRemove={
                senses.length === 1
                  ? undefined
                  : () => {
                      setSenses(senses.filter((_, j) => j !== i));
                      setExamples(examples.map((x) => (x.sense === '' || x.sense < i ? x : { ...x, sense: x.sense === i ? '' : x.sense - 1 })));
                    }
              }
              removeLabel="Remove meaning"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Meaning" value={s.gloss} onChange={(v) => setSenses(senses.map((x, j) => (j === i ? { ...x, gloss: v } : x)))} required={i === 0} />
                <Input label="Other accepted answers (separate with ;)" value={s.translations} onChange={(v) => setSenses(senses.map((x, j) => (j === i ? { ...x, translations: v } : x)))} />
                <Input label="Usage note" value={s.note} onChange={(v) => setSenses(senses.map((x, j) => (j === i ? { ...x, note: v } : x)))} className="sm:col-span-2" />
              </div>
            </Block>
          ))}
        </div>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setSenses([...senses, { gloss: '', translations: '', note: '', definition: null }])}>
          <LuPlus aria-hidden="true" /> Add another meaning
        </Button>
      </Group>

      <Group title="Example sentences" description="Sentences are used for the sentence-gap questions.">
        <div className="space-y-3">
          {examples.map((x, i) => (
            <Block key={i} title={`Sentence ${i + 1}`} onRemove={examples.length === 1 ? undefined : () => setExamples(examples.filter((_, j) => j !== i))} removeLabel="Remove sentence">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Sentence" value={x.text} onChange={(v) => setExamples(examples.map((y, j) => (j === i ? { ...y, text: v } : y)))} lang={language} serif className="sm:col-span-2" />
                <Input label="English translation" value={x.translation} onChange={(v) => setExamples(examples.map((y, j) => (j === i ? { ...y, translation: v } : y)))} />
                <Input label="The word as it appears in the sentence" value={x.target} onChange={(v) => setExamples(examples.map((y, j) => (j === i ? { ...y, target: v } : y)))} lang={language} serif hint="The gap in a sentence-gap question" />
                {senses.filter((s) => s.gloss.trim()).length > 1 && (
                  <Select
                    label="Meaning shown in this sentence"
                    id={`sense-${i}`}
                    className="sm:col-span-2"
                    value={x.sense === '' ? '' : String(x.sense)}
                    onChange={(v) => setExamples(examples.map((y, j) => (j === i ? { ...y, sense: v === '' ? '' : Number(v) } : y)))}
                    hint="Sentence questions quiz this meaning."
                  >
                    <NativeSelectOption value="">Not linked to a meaning</NativeSelectOption>
                    {senses.map((s, k) =>
                      s.gloss.trim() ? (
                        <NativeSelectOption key={k} value={k}>
                          {k + 1}. {s.gloss}
                        </NativeSelectOption>
                      ) : null,
                    )}
                  </Select>
                )}
              </div>
            </Block>
          ))}
        </div>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => setExamples([...examples, { text: '', translation: '', target: '', sense: '' }])}>
          <LuPlus aria-hidden="true" /> Add an example
        </Button>
      </Group>

      <Group
        title={tableForms ? 'Other forms' : 'Inflected forms'}
        description={tableForms > 0 ? `The ${tableForms} forms of this word’s table are kept as they are. Add here only forms the table does not have.` : 'Forms of the word that count as right answers, such as a plural or a past tense.'}
      >
        <div className="space-y-3">
          {forms.map((f, i) => (
            <Block key={i} title={`Form ${i + 1}`} onRemove={() => setForms(forms.filter((_, j) => j !== i))} removeLabel="Remove form">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Form" value={f.form} onChange={(v) => setForms(forms.map((y, j) => (j === i ? { ...y, form: v } : y)))} lang={language} serif />
                <Input label="Grammar tags (comma separated)" value={f.tags} onChange={(v) => setForms(forms.map((y, j) => (j === i ? { ...y, tags: v } : y)))} hint="e.g. accusative, singular" />
              </div>
            </Block>
          ))}
        </div>
        <Button variant="outline" size="sm" className={forms.length ? 'mt-3' : ''} onClick={() => setForms([...forms, { form: '', tags: '' }])}>
          <LuPlus aria-hidden="true" /> Add a form
        </Button>
      </Group>

      <Group title="Notes and topics">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Grammar note" value={grammarNotes} onChange={setGrammarNotes} />
          <Input label="Regional note" value={regionalNote} onChange={setRegionalNote} />
          <Input label="Topics (comma separated)" value={tags} onChange={setTags} />
          <Input label="Image address (optional)" value={imageUrl} onChange={setImageUrl} type="url" hint="Only a picture that shows the word accurately." />
        </div>
      </Group>

      <div className="flex gap-2 pt-1">
        <Button type="submit" size="xl" className="flex-1 sm:flex-none sm:px-10" disabled={busy}>
          {saveLabel}
        </Button>
        <Button variant="ghost" size="xl" className="px-4 text-muted-foreground" onClick={() => history.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** A titled card of fields. */
function Group({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** One of several repeated entries (a meaning, a sentence, a form), with its remove button. */
function Block({ title, onRemove, removeLabel, children }: { title: string; onRemove?: () => void; removeLabel: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title} className="rounded-xl border bg-muted/30 p-4">
      <div className="mb-2 flex min-h-8 items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        {onRemove && (
          <Button variant="ghost" size="icon-sm" className="-mr-1.5 text-muted-foreground" aria-label={removeLabel} onClick={onRemove}>
            <LuTrash2 aria-hidden="true" />
          </Button>
        )}
      </div>
      {children}
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  required,
  lang,
  hint,
  type = 'text',
  serif,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  lang?: string;
  hint?: string;
  type?: string;
  serif?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <Field className={`gap-1.5 ${className ?? ''}`}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <KitInput id={id} type={type} value={value} onChange={(e) => onChange((e.target as HTMLInputElement).value)} required={required} lang={lang} className={serif ? 'word text-[1.0625rem]' : undefined} autoComplete="off" />
      {hint && <FieldDescription className="text-xs">{hint}</FieldDescription>}
    </Field>
  );
}

function Select({ label, value, onChange, hint, id, className, children }: { label: string; value: string; onChange: (v: string) => void; hint?: string; id?: string; className?: string; children: ReactNode }) {
  const auto = useId();
  return (
    <Field className={`gap-1.5 ${className ?? ''}`}>
      <FieldLabel htmlFor={id ?? auto}>{label}</FieldLabel>
      <NativeSelect id={id ?? auto} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
        {children}
      </NativeSelect>
      {hint && <FieldDescription className="text-xs">{hint}</FieldDescription>}
    </Field>
  );
}
