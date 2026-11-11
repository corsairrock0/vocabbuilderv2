// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// The Words page (2.0.0): search with the filters behind one button, quick filters with their counts, and every word
// as a row that says how it stands (a status badge and when it is due), in a list that loads as it scrolls.
import { useEffect, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { LuDownload, LuEllipsis, LuPlus, LuSearch, LuSearchX, LuSlidersHorizontal, LuStar, LuUpload, LuX } from 'react-icons/lu';
import { LANGUAGES, type LanguageCode } from '../../../shared/languages.ts';
import type { VocabListItem, VocabListResponse } from '../../../shared/types.ts';
import { get } from '../lib/api.ts';
import { Link, navigate, useLocation } from '../lib/router.tsx';
import { useApp } from '../lib/store.ts';
import { count, dueText } from '../lib/format.ts';
import { cn } from '../lib/utils.ts';
import { Empty, ErrorNote, PageHeader } from '../components/ui.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Skeleton, Spinner } from '../components/ui/basics.tsx';
import { Button } from '../components/ui/button.tsx';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/controls.tsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog.tsx';
import { Field, FieldGroup, FieldLabel } from '../components/ui/field.tsx';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, NativeSelect, NativeSelectOption } from '../components/ui/input-group.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/menu.tsx';
import { Word } from './session/Exercise.tsx';

const STATES: Array<{ value: string; label: string }> = [
  { value: 'new', label: 'New' },
  { value: 'learning', label: 'Learning' },
  { value: 'learned', label: 'Learned' },
  { value: 'mature', label: 'Well known (21+ days)' },
  { value: 'mastered', label: 'Mastered' },
  { value: 'known', label: 'Marked known' },
  { value: 'suspended', label: 'Suspended' },
];

const STATE_LABEL: Record<VocabListItem['learnState'], string> = {
  new: 'New',
  learning: 'Learning',
  learned: 'Learned',
  mature: 'Well known',
  mastered: 'Mastered',
  known: 'Marked known',
  suspended: 'Suspended',
};

const SORTS: Array<{ value: string; label: string }> = [
  { value: 'frequency', label: 'Most frequent first' },
  { value: 'alpha', label: 'Alphabetical' },
  { value: 'due', label: 'Due soonest' },
  { value: 'difficulty', label: 'Most difficult' },
  { value: 'recent', label: 'Recently studied' },
];

type Quick = 'all' | 'due' | 'difficult' | 'favorite';
const QUICK: Array<{ value: Quick; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'due', label: 'Due' },
  { value: 'difficult', label: 'Difficult' },
  { value: 'favorite', label: 'Favourites' },
];

interface Meta {
  tags: Array<{ name: string; n: number }>;
  pos: Array<{ pos: string; n: number }>;
  counts?: Record<Quick, number>;
}

const PAGE = 60;
const topicName = (t: string) => t.replace(/-/g, ' ');

/** How a word stands, as a badge: difficult words say so; the rest by their memory. */
function StateBadge({ w }: { w: VocabListItem }) {
  if (w.difficult && w.learnState !== 'new')
    return (
      <Badge variant="destructive" className="font-medium">
        Difficult
      </Badge>
    );
  const s = w.learnState;
  const variant = s === 'mature' || s === 'mastered' ? 'success' : s === 'learning' ? 'soft' : s === 'learned' || s === 'known' ? 'secondary' : 'outline';
  return (
    <Badge variant={variant} className={cn('font-medium', (s === 'new' || s === 'suspended') && 'font-normal text-muted-foreground')}>
      {STATE_LABEL[s]}
    </Badge>
  );
}

export function WordsPage() {
  const language = useApp((s) => s.boot?.settings.activeLanguage ?? 'es') as LanguageCode;
  const name = LANGUAGES[language].name;
  const { query } = useLocation();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [pos, setPos] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('frequency');
  const [quick, setQuick] = useState<Quick>(query.get('due') === '1' ? 'due' : 'all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [items, setItems] = useState<VocabListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta>({ tags: [], pos: [] });
  const listRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    get<Meta>(`/api/vocab/meta?lang=${language}`).then(setMeta).catch(() => undefined);
  }, [language]);

  const params = (offset: number) => {
    const p = new URLSearchParams({ lang: language, offset: String(offset), limit: String(PAGE), sort });
    if (debounced) p.set('q', debounced);
    if (status) p.set('status', status);
    if (pos) p.set('pos', pos);
    if (tag) p.set('tag', tag);
    if (quick === 'due') p.set('due', '1');
    if (quick === 'favorite') p.set('favorite', '1');
    if (quick === 'difficult') p.set('difficult', '1');
    return p.toString();
  };

  const load = async (offset: number) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const r = await get<VocabListResponse>(`/api/vocab?${params(offset)}`);
      if (id !== reqId.current) return;
      setTotal(r.total);
      setItems((prev) => (offset === 0 ? r.items : [...prev, ...r.items]));
    } catch (err) {
      if (id === reqId.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  };

  useEffect(() => {
    setItems([]);
    void load(0);
  }, [language, debounced, status, pos, tag, sort, quick]);

  const virtualizer = useWindowVirtualizer({ count: items.length, estimateSize: () => 72, overscan: 8, scrollMargin: listRef.current?.offsetTop ?? 0 });
  const virtualItems = virtualizer.getVirtualItems();
  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1];
    if (last && last.index >= items.length - 10 && items.length < total && !loading) void load(items.length);
  }, [virtualItems, items.length, total, loading]);

  // The filters chosen in the dialog, each removable from the row under the search.
  const chips = [
    status && { key: 'status', label: STATES.find((s) => s.value === status)?.label ?? status, clear: () => setStatus('') },
    pos && { key: 'pos', label: pos, clear: () => setPos('') },
    tag && { key: 'tag', label: topicName(tag), clear: () => setTag('') },
    sort !== 'frequency' && { key: 'sort', label: SORTS.find((s) => s.value === sort)?.label ?? sort, clear: () => setSort('frequency') },
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>;
  const clearAll = () => {
    setStatus('');
    setPos('');
    setTag('');
    setSort('frequency');
    setQuick('all');
    setQ('');
  };
  const narrowed = chips.length > 0 || quick !== 'all' || !!debounced;
  const firstLoad = loading && !items.length;

  return (
    <div data-lang={language}>
      <PageHeader title={`${name} words`}>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="icon-lg" aria-label="More">
                <LuEllipsis aria-hidden="true" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" label="More">
            <DropdownMenuItem onSelect={() => navigate('/import')}>
              <LuUpload aria-hidden="true" /> Import words
            </DropdownMenuItem>
            <DropdownMenuItem render={<a href={`/api/export/vocabulary?lang=${language}&format=csv`} download />}>
              <LuDownload aria-hidden="true" /> Export as CSV
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="lg" className="max-sm:size-12 max-sm:px-0" render={<Link to="/words/new" />}>
          <LuPlus className="max-sm:size-5" aria-hidden="true" />
          <span className="max-sm:sr-only">Add a word</span>
        </Button>
      </PageHeader>

      <div className="space-y-3">
        <InputGroup className="h-12 rounded-xl bg-card">
          <InputGroupAddon>
            <LuSearch className="size-[1.125rem]" aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search words or meanings"
            placeholder={`Search ${name} or English`}
            value={q}
            onChange={(e) => setQ((e.target as HTMLInputElement).value)}
            lang={language}
            className="text-base"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon" className="relative" aria-label={chips.length ? `Filter and sort, ${chips.length} on` : 'Filter and sort'} onClick={() => setFiltersOpen(true)}>
              <LuSlidersHorizontal className="size-[1.125rem]" aria-hidden="true" />
              {chips.length > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-lang ring-2 ring-card" aria-hidden="true" />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>

        <ToggleGroup
          type="single"
          variant="outline"
          spacing={2}
          value={quick}
          onValueChange={(v) => v && setQuick(v as Quick)}
          aria-label="Show"
          className="-mx-4 w-[calc(100%+2rem)] flex-nowrap overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:w-full sm:px-0"
        >
          {QUICK.map((f) => {
            const n = meta.counts?.[f.value];
            return (
              <ToggleGroupItem key={f.value} value={f.value} className="h-9 gap-1.5 rounded-full px-3.5">
                {f.label}
                {n != null && <span className="text-muted-foreground tabular-nums [[data-state=on]_&]:text-current">{count(n)}</span>}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {chips.map((c) => (
              <Badge key={c.key} variant="secondary" className="h-7 gap-1 pr-1 pl-2.5 text-[0.8125rem] font-medium">
                {c.label}
                <button type="button" className="grid size-5 place-items-center rounded-full outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring" onClick={c.clear} aria-label={`Remove ${c.label}`}>
                  <LuX className="size-3.5" aria-hidden="true" />
                </button>
              </Badge>
            ))}
            {chips.length > 1 && (
              <Button variant="link" size="sm" className="h-7 px-1.5 text-muted-foreground" onClick={() => (setStatus(''), setPos(''), setTag(''), setSort('frequency'))}>
                Clear all
              </Button>
            )}
          </div>
        )}

        {/* The count is on the quick filter; with a search or a filter it is said here too. */}
        <p className={cn('px-1 text-sm text-muted-foreground', !(debounced || chips.length) && 'sr-only')} aria-live="polite">
          {firstLoad ? 'Loading words…' : `${count(total)} ${total === 1 ? 'word' : 'words'}`}
        </p>
      </div>

      <div className="mt-2">
        {error && <ErrorNote error={error} onRetry={() => void load(0)} />}
        {firstLoad && (
          <div className="overflow-hidden rounded-xl border bg-card" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 border-b px-4 py-3.5 last:border-0">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-3.5 w-44" />
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        )}
        {!loading && !error && total === 0 && (
          <Empty
            icon={<LuSearchX />}
            title="No words match"
            action={
              narrowed ? (
                <Button variant="outline" onClick={clearAll}>
                  Clear the search and filters
                </Button>
              ) : (
                <Button render={<Link to="/import" />}>
                  <LuUpload aria-hidden="true" /> Import words
                </Button>
              )
            }
          >
            {narrowed ? 'Try another search or fewer filters.' : `Add ${name} words yourself, or import a frequency-ranked list.`}
          </Empty>
        )}
        <div ref={listRef} className={cn('relative overflow-hidden rounded-xl bg-card', items.length > 0 && 'border')} style={{ height: virtualizer.getTotalSize() + (items.length ? 2 : 0) }}>
          {virtualItems.map((v) => {
            const w = items[v.index];
            if (!w) return null;
            const due = w.receptiveDue ? Math.min(w.receptiveDue, w.productiveDue ?? w.receptiveDue) : null;
            return (
              <div key={w.entryId} data-index={v.index} ref={virtualizer.measureElement} className="absolute top-0 left-0 w-full" style={{ transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)` }}>
                <Link
                  to={`/words/${w.entryId}`}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 outline-none focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [@media(hover:hover)]:hover:bg-accent/60',
                    v.index < items.length - 1 && 'border-b',
                  )}
                >
                  <span className="hidden w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:block" title={w.frequencyRank ? 'Frequency rank' : 'Curated order'}>
                    {w.frequencyRank ?? w.curatedOrder ?? ''}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <Word text={w.display} className="truncate text-[1.25rem] leading-snug" />
                      {w.favorite && <LuStar className="size-3.5 shrink-0 fill-current text-warning" aria-label="Favourite" />}
                    </span>
                    <span className="block truncate text-[0.9375rem] text-muted-foreground">{w.gloss}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <StateBadge w={w} />
                    {due && w.learnState !== 'suspended' && w.learnState !== 'known' && <span className="text-xs text-muted-foreground">{dueText(due)}</span>}
                  </span>
                </Link>
              </div>
            );
          })}
        </div>
        {loading && items.length > 0 && (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        )}
      </div>

      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Filter and sort</DialogTitle>
            <DialogDescription>The list changes as you choose.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="words-status">Status</FieldLabel>
              <NativeSelect id="words-status" value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}>
                <NativeSelectOption value="">All statuses</NativeSelectOption>
                {STATES.map((s) => (
                  <NativeSelectOption key={s.value} value={s.value}>
                    {s.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="words-pos">Word class</FieldLabel>
              <NativeSelect id="words-pos" value={pos} onChange={(e) => setPos((e.target as HTMLSelectElement).value)}>
                <NativeSelectOption value="">All word classes</NativeSelectOption>
                {meta.pos.map((p) => (
                  <NativeSelectOption key={p.pos} value={p.pos}>
                    {p.pos} ({count(p.n)})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="words-topic">Topic</FieldLabel>
              <NativeSelect id="words-topic" value={tag} onChange={(e) => setTag((e.target as HTMLSelectElement).value)}>
                <NativeSelectOption value="">All topics</NativeSelectOption>
                {meta.tags.map((t) => (
                  <NativeSelectOption key={t.name} value={t.name}>
                    {topicName(t.name)} ({count(t.n)})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="words-sort">Sort</FieldLabel>
              <NativeSelect id="words-sort" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value)}>
                {SORTS.map((s) => (
                  <NativeSelectOption key={s.value} value={s.value}>
                    {s.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </FieldGroup>
          <DialogFooter>
            {chips.length > 0 && (
              <Button variant="ghost" size="lg" onClick={() => (setStatus(''), setPos(''), setTag(''), setSort('frequency'))}>
                Clear filters
              </Button>
            )}
            <Button size="lg" onClick={() => setFiltersOpen(false)}>
              {loading ? 'Show the words' : `Show ${count(total)} ${total === 1 ? 'word' : 'words'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
