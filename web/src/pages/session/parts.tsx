// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * The pieces every question screen shares (sessions and the Practice pages alike), after the 2.0.0 redesign: one
 * decision per screen with its action in the thumb zone. The action bar sits at the bottom (above the phone keyboard
 * when it is open); feedback rises from the bottom as a panel tinted by the verdict, says the answer once and what the
 * answer did to the word's memory, and keeps Continue in the same place.
 */
import { createContext, useContext, useEffect, useId, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { LuCalendarCheck, LuCheck, LuCircleAlert, LuCloudOff, LuSprout, LuX } from 'react-icons/lu';
import type { Rating } from '../../../../shared/fsrs.ts';
import { Badge } from '../../components/ui/badge.tsx';
import { Kbd, Spinner } from '../../components/ui/basics.tsx';
import { Button } from '../../components/ui/button.tsx';
import { intervalText } from '../../lib/format.ts';
import { cn } from '../../lib/utils.ts';
import { settings } from '../../lib/store.ts';

/**
 * A page-wide key handler that stays out of the way while typing (only Enter and Escape reach it from a field) and of a
 * focused button's own Enter or Space. Return true to mark the key handled.
 */
export function useKeys(handler: (e: KeyboardEvent) => boolean | void, deps: unknown[]) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (typing && e.key !== 'Enter' && e.key !== 'Escape') return;
      // Enter or Space on a focused button or link (a table toggle, say) is that control's own click.
      if (t && (t.tagName === 'BUTTON' || t.tagName === 'A' || t.tagName === 'SUMMARY') && (e.key === 'Enter' || e.key === ' ')) return;
      if (!settings().keyboardShortcuts && e.key !== 'Enter') return;
      if (handler(e) === true) e.preventDefault();
    };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, deps);
}

/** How far the on-screen keyboard covers the bottom of the layout viewport (iOS keeps fixed bars under it otherwise). */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    on();
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    return () => {
      vv.removeEventListener('resize', on);
      vv.removeEventListener('scroll', on);
    };
  }, []);
  return inset;
}

/** The docked bar or panel at the bottom publishes its height (--dock-h), so the page leaves room for it. */
let dockOwner: string | null = null;
function useDockHeight(ref: { current: HTMLElement | null }, extra = 0) {
  const id = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const set = () => {
      dockOwner = id;
      root.style.setProperty('--dock-h', `${Math.round(el.getBoundingClientRect().height + extra)}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (dockOwner === id) {
        dockOwner = null;
        root.style.setProperty('--dock-h', '0px');
      }
    };
  }, [extra]);
}

/** The bottom action bar: Check, Continue, Got it… full width; secondary actions beside or above. */
export function ActionBar({ children, className, above }: { children: ReactNode; className?: string; above?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const inset = useKeyboardInset();
  useDockHeight(ref);
  return (
    <div ref={ref} data-slot="action-bar" className="fixed inset-x-0 z-30 border-t bg-background/95 backdrop-blur-md" style={{ bottom: inset }}>
      <div className={cn('mx-auto max-w-3xl px-4 pt-3 sm:px-6', inset ? 'pb-3' : 'pb-[max(0.75rem,env(safe-area-inset-bottom))]', className)}>
        {above && <div className="mb-2 flex flex-wrap items-center justify-center gap-1">{above}</div>}
        <div className="flex items-center gap-2">{children}</div>
      </div>
    </div>
  );
}

export type Verdict = 'correct' | 'close' | 'incorrect' | 'revealed' | 'self';

const VERDICT = {
  correct: { title: 'Right', icon: LuCheck, panel: 'border-t-success/60 bg-success-soft', dot: 'bg-success text-white dark:text-background', text: 'text-success' },
  close: { title: 'Almost', icon: LuCircleAlert, panel: 'border-t-warning/60 bg-warning-soft', dot: 'bg-warning text-white dark:text-background', text: 'text-warning' },
  incorrect: { title: 'Not this time', icon: LuX, panel: 'border-t-destructive/50 bg-destructive-soft', dot: 'bg-destructive text-white dark:text-background', text: 'text-destructive' },
  revealed: { title: 'Here it is', icon: LuX, panel: 'border-t-destructive/50 bg-destructive-soft', dot: 'bg-destructive text-white dark:text-background', text: 'text-destructive' },
  self: { title: 'Saved', icon: LuCheck, panel: 'border-t-border bg-muted', dot: 'bg-foreground text-background', text: 'text-foreground' },
} as const;

/**
 * Feedback as a bottom panel tinted by the verdict: the verdict with its icon (never colour alone), then the content
 * (the answer once, why, what it did to the word's memory), then the actions, always at the bottom.
 */
export function FeedbackPanel({ verdict, title, children, actions, className, ...props }: Omit<HTMLAttributes<HTMLElement>, 'title'> & { verdict: Verdict; title?: ReactNode; actions: ReactNode }) {
  const v = VERDICT[verdict];
  const Icon = v.icon;
  const ref = useRef<HTMLElement>(null);
  const inset = useKeyboardInset();
  useDockHeight(ref);
  // Show the answered question above the panel.
  useEffect(() => {
    requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }));
  }, []);
  return (
    <section
      ref={ref}
      role="status"
      aria-live="assertive"
      data-slot="feedback-panel"
      data-verdict={verdict}
      className={cn('fixed inset-x-0 z-30 animate-in rounded-t-3xl border-t-2 shadow-[0_-8px_30px_-12px_rgb(0_0_0/0.25)] slide-in-from-bottom duration-200', v.panel, className)}
      style={{ bottom: inset }}
      {...props}
    >
      <div className="mx-auto flex max-h-[min(72dvh,40rem)] max-w-3xl flex-col">
        <div className="min-h-0 overflow-y-auto px-5 pt-4 pb-2 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className={cn('grid size-7 shrink-0 animate-pop place-items-center rounded-full', v.dot)} aria-hidden="true">
              <Icon className="size-4" strokeWidth={3} />
            </span>
            <h3 className={cn('text-lg font-semibold', v.text)}>{title ?? v.title}</h3>
          </div>
          <div className="mt-2 space-y-2.5 text-[0.9375rem] text-foreground">{children}</div>
        </div>
        <div className={cn('flex shrink-0 flex-wrap items-center gap-2 px-5 pt-2 sm:px-6', inset ? 'pb-3' : 'pb-[max(1rem,env(safe-area-inset-bottom))]')}>{actions}</div>
      </div>
    </section>
  );
}

/**
 * A neutral panel docked at the bottom, for a question that stays in view while the page above it scrolls (a reading
 * text's questions). The page leaves room for it (--dock-h); `footer` holds its action, always at the bottom.
 */
export function BottomPanel({ children, footer, className, ...props }: HTMLAttributes<HTMLElement> & { footer?: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const inset = useKeyboardInset();
  useDockHeight(ref);
  return (
    <section
      ref={ref}
      data-slot="bottom-panel"
      className={cn('fixed inset-x-0 z-30 animate-in rounded-t-3xl border-t bg-card shadow-[0_-8px_30px_-12px_rgb(0_0_0/0.25)] slide-in-from-bottom duration-200', className)}
      style={{ bottom: inset }}
      {...props}
    >
      <div className="mx-auto flex max-h-[min(66dvh,38rem)] max-w-3xl flex-col">
        <div className="min-h-0 overflow-y-auto px-5 pt-3 pb-3 sm:px-6">{children}</div>
        {footer && <div className={cn('flex shrink-0 flex-wrap items-center gap-2 px-5 pt-1 sm:px-6', inset ? 'pb-3' : 'pb-[max(1rem,env(safe-area-inset-bottom))]')}>{footer}</div>}
      </div>
    </section>
  );
}

/** The answer said once, in the language's serif when it is in the language. */
export function AnswerLine({ label = 'Answer', children, serif = true, lang }: { label?: string; children: ReactNode; serif?: boolean; lang?: string }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={serif ? 'word text-[1.375rem]' : 'text-base font-semibold'} lang={lang}>
        {children}
      </span>
    </p>
  );
}

export interface ScheduleChange {
  cardSkill?: string;
  scheduledDays: number;
}

/**
 * What the answer did to the word's memory (2.0.0: every kind of question can be its review): "Review done · back in
 * 9 days", "Learning · first review after this session", or that today's review was already done.
 */
export function ReviewBadge({ changes, isNew, counts = true, offline }: { changes: ScheduleChange[]; isNew?: boolean; counts?: boolean; offline?: boolean }) {
  if (offline)
    return (
      <Badge variant="outline" className="h-7 gap-1.5 bg-card/70 px-2.5 text-[0.8125rem] font-normal" data-testid="review-badge">
        <LuCloudOff aria-hidden="true" /> Saved on this device · syncs when you are online
      </Badge>
    );
  if (changes.length) {
    const days = Math.max(...changes.map((c) => c.scheduledDays));
    return (
      <Badge variant="outline" className="h-7 gap-1.5 bg-card/70 px-2.5 text-[0.8125rem] font-medium" data-testid="review-badge">
        <LuCalendarCheck className="text-lang" aria-hidden="true" /> Review done · back {intervalText(days)}
      </Badge>
    );
  }
  if (isNew)
    return (
      <Badge variant="outline" className="h-7 gap-1.5 bg-card/70 px-2.5 text-[0.8125rem] font-normal" data-testid="review-badge">
        <LuSprout className="text-lang" aria-hidden="true" /> Learning · first review after this session
      </Badge>
    );
  if (!counts) return null;
  return (
    <Badge variant="outline" className="h-7 gap-1.5 bg-card/70 px-2.5 text-[0.8125rem] font-normal text-muted-foreground" data-testid="review-badge">
      <LuCalendarCheck aria-hidden="true" /> Reviewed today · this answer is practice
    </Badge>
  );
}

/**
 * True while a study session fetches what comes next (a practice slot): what was answered stays on screen and its
 * Continue waits, showing a spinner when that takes more than a moment.
 */
export const SessionBusy = createContext(false);

/** Continue: focused on arrival, Enter or Space presses it. */
export function ContinueButton({ onClick, label = 'Continue', className }: { onClick: () => void; label?: string; className?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const busy = useContext(SessionBusy);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  const press = () => {
    if (!busy) onClick();
  };
  useKeys((e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      press();
      return true;
    }
  }, [onClick, busy]);
  return (
    // aria-disabled, not disabled: the button keeps the focus (and the keyboard) while it waits.
    <Button ref={ref} size="xl" className={cn('min-w-0 flex-1 aria-disabled:opacity-80', className)} onClick={press} aria-disabled={busy || undefined} aria-busy={busy || undefined} data-testid="continue">
      {busy && (
        <span className="animate-in fade-in-0 [animation-delay:200ms]" aria-hidden="true">
          <Spinner />
        </span>
      )}
      {label}
      <Kbd className="ml-1 hidden [@media(hover:hover)]:inline-flex" aria-hidden="true">
        Enter
      </Kbd>
    </Button>
  );
}

/** An answer option: full width, 56 px tall; after the answer it shows right (check) or wrong (cross), the others dimmed. */
export function OptionButton({ index, state, children, className, ...props }: HTMLAttributes<HTMLButtonElement> & { index?: number; state?: 'correct' | 'wrong' | 'dim' | 'picked'; disabled?: boolean }) {
  return (
    <button
      type="button"
      data-slot="option"
      data-state={state}
      className={cn(
        'flex min-h-14 w-full items-center gap-3 rounded-xl border bg-card px-4 py-2.5 text-left text-[1.0625rem] shadow-xs outline-none transition-[background-color,border-color,opacity,transform] active:scale-[0.99] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default',
        '[@media(hover:hover)]:enabled:hover:border-foreground/25 [@media(hover:hover)]:enabled:hover:bg-accent/50',
        'data-[state=correct]:border-success data-[state=correct]:bg-success-soft data-[state=wrong]:animate-shake data-[state=wrong]:border-destructive data-[state=wrong]:bg-destructive-soft data-[state=dim]:opacity-45 data-[state=picked]:border-foreground',
        className,
      )}
      {...props}
    >
      {index != null && (
        <Kbd className="hidden shrink-0 [@media(hover:hover)]:inline-flex" aria-hidden="true">
          {index}
        </Kbd>
      )}
      <span className="min-w-0 flex-1">{children}</span>
      {/* The option keeps its name; the feedback says which answer was right. */}
      {state === 'correct' && <LuCheck className="size-5 shrink-0 text-success" strokeWidth={2.75} aria-hidden="true" />}
      {state === 'wrong' && <LuX className="size-5 shrink-0 text-destructive" strokeWidth={2.75} aria-hidden="true" />}
    </button>
  );
}

const RATING_LABEL: Record<Rating, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

/** Self-rating: Again, Hard, Good, Easy (keys 1–4). */
export function RatingButtons({ suggested, onRate, label = 'How well did you remember?' }: { suggested: Rating | null; onRate: (r: Rating) => void; label?: string }) {
  useKeys((e) => {
    if (['1', '2', '3', '4'].includes(e.key)) {
      onRate(Number(e.key) as Rating);
      return true;
    }
  }, [onRate]);
  return (
    <div className="w-full">
      <p className="mb-2 text-sm text-muted-foreground">{label}</p>
      <div className="grid grid-cols-4 gap-2">
        {([1, 2, 3, 4] as Rating[]).map((r) => (
          <Button key={r} variant={r === suggested ? 'default' : 'outline'} className="h-14 flex-col gap-0.5" onClick={() => onRate(r)}>
            <span>{RATING_LABEL[r]}</span>
            <Kbd className="hidden h-4 min-w-4 [@media(hover:hover)]:inline-flex" aria-hidden="true">
              {r}
            </Kbd>
          </Button>
        ))}
      </div>
    </div>
  );
}
