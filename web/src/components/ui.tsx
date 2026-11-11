// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/** The app's shared building blocks, composed from the shadcn/ui kit in ./ui/. */
import { useEffect, useState, type ReactNode } from 'react';
import { LuCircleAlert, LuSparkles } from 'react-icons/lu';
import { cn } from '../lib/utils.ts';
import { Alert, AlertDescription } from './ui/alert.tsx';
import { Spinner as KitSpinner, Progress } from './ui/basics.tsx';
import { Button } from './ui/button.tsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog.tsx';
import { Empty as KitEmpty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from './ui/empty.tsx';
import { Field, FieldContent, FieldDescription, FieldLabel } from './ui/field.tsx';
import { Switch, ToggleGroup, ToggleGroupItem } from './ui/controls.tsx';

export function Spinner({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-muted-foreground', className)}>
      <KitSpinner label={label} className="size-[1.125rem]" />
      <span className="text-sm" aria-hidden="true">
        {label}
      </span>
    </span>
  );
}

export function PageLoading({ label }: { label?: string }) {
  return (
    <div className="grid min-h-[40vh] place-items-center">
      <Spinner label={label} />
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <Alert variant="destructive">
      <LuCircleAlert aria-hidden="true" />
      <AlertDescription>
        <p>{error}</p>
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-1" onClick={onRetry}>
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function Empty({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <KitEmpty className="bg-card">
      <EmptyHeader>
        {icon && <EmptyMedia variant="icon">{icon}</EmptyMedia>}
        <EmptyTitle>{title}</EmptyTitle>
        {children && <EmptyDescription>{children}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </KitEmpty>
  );
}

export function PageHeader({ title, children, back, description }: { title: ReactNode; children?: ReactNode; back?: ReactNode; description?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && <div className="mb-2">{back}</div>}
        <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em] sm:text-[2rem]">{title}</h1>
        {description && <p className="mt-1 text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

/** A setting that is on or off: label and hint on the left, a switch on the right (the whole row toggles it). */
export function Toggle({ checked, onChange, label, hint, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; id?: string }) {
  const sid = id ?? `t-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <Field orientation="horizontal" className="justify-between gap-4 py-1.5">
      <FieldContent>
        <FieldLabel htmlFor={sid} className="text-[0.9375rem]">
          {label}
        </FieldLabel>
        {hint && <FieldDescription>{hint}</FieldDescription>}
      </FieldContent>
      <Switch id={sid} checked={checked} onCheckedChange={onChange} aria-label={label} />
    </Field>
  );
}

/** One choice among a few, as a row of toggles (shadcn ToggleGroup, single). */
export function Segmented<T extends string | number>({ value, options, onChange, label, size = 'default', className }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string; size?: 'default' | 'sm' | 'lg'; className?: string }) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size={size}
      spacing={2}
      value={String(value)}
      onValueChange={(v) => {
        const o = options.find((x) => String(x.value) === v);
        if (o) onChange(o.value);
      }}
      aria-label={label}
      className={className}
    >
      {options.map((o) => (
        <ToggleGroupItem key={String(o.value)} value={String(o.value)} className="rounded-full px-3.5">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function Meter({ value, label, sub }: { value: number | null; label: string; sub?: string }) {
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  return (
    <div className="min-w-0">
      {/* On a narrow phone the figure moves under its label instead of cutting the label short ("Readi… 100%"). */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">{value == null ? '—' : `${Math.round(v * 100)}%`}</span>
      </div>
      <Progress value={value == null ? 0 : v * 100} aria-label={label} className="mt-1.5 h-1.5" />
      {sub && <div className="hint mt-1">{sub}</div>}
    </div>
  );
}

/** Study minutes per day; a day with answers but under a minute (a few practice questions) still shows a low bar. */
export function ActivityBars({ days, label }: { days: Array<{ day: string; minutes: number; answers?: number }>; label: string }) {
  const studied = (d: { minutes: number; answers?: number }) => d.minutes > 0 || (d.answers ?? 0) > 0;
  if (!days.some(studied)) return null;
  const max = Math.max(5, ...days.map((d) => d.minutes));
  return (
    <svg viewBox={`0 0 ${days.length * 8} 28`} className="h-7 w-full" role="img" aria-label={label} preserveAspectRatio="none">
      {days.map((d, i) => {
        const h = d.minutes ? Math.max(3, (d.minutes / max) * 26) : studied(d) ? 3 : 2;
        return <rect key={d.day} x={i * 8 + 1} y={28 - h} width={6} height={h} rx={1.5} className={studied(d) ? 'fill-primary' : 'fill-border'} />;
      })}
    </svg>
  );
}

/** A dialog with a title: a bottom sheet on phones, a centred panel on larger screens (shadcn Dialog). */
export function Sheet({ open, onClose, title, children, wide, description }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; description?: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className={wide ? 'sm:max-w-2xl' : undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </DialogHeader>
        <div>{children}</div>
      </DialogContent>
    </Dialog>
  );
}

/** Whether the screen is at least `px` wide, updated when it changes. */
export function useWide(px = 768) {
  const query = `(min-width: ${px}px)`;
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return wide;
}

export function Stat({ value, label, tone, className }: { value: ReactNode; label: string; tone?: 'accent' | 'mute'; className?: string }) {
  return (
    <div className={className}>
      <div className={cn('text-2xl leading-none font-semibold tracking-tight tabular-nums', tone === 'accent' && 'text-primary', tone === 'mute' && 'text-muted-foreground')}>{value}</div>
      <div className="mt-1.5 text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

/** Marks an example sentence that an AI wrote, rather than one taken from a collection of real sentences. */
export function AiSentenceNote({ long, className = '' }: { long?: boolean; className?: string }) {
  return (
    <p className={cn('hint flex items-center gap-1', className)}>
      <LuSparkles className="size-3.5 shrink-0" aria-hidden="true" />
      {long ? 'AI-written sentence (Claude), not checked by a native speaker' : 'AI-written sentence'}
    </p>
  );
}

/** Marks a reading comprehension passage: written by an AI and checked by a second one, not by a native speaker. */
export function AiPassageNote({ className = '' }: { className?: string }) {
  return (
    <p className={cn('hint flex items-center gap-1', className)}>
      <LuSparkles className="size-3.5 shrink-0" aria-hidden="true" />
      AI-written passage
    </p>
  );
}

/** A titled group of content on a page: heading row (with an optional action) above a card. */
export function Section({ title, description, action, children, className }: { title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-3', className)}>
      {(title || action) && (
        <div className="flex items-end justify-between gap-3 px-1">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold tracking-tight">{title}</h2>}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
