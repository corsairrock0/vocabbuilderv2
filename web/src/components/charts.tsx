// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * The small charts of Home and the Progress page, in the app's look: one series in the language's accent, thin marks,
 * bars with 4px rounded ends standing on a recessive baseline, values in text colours, and a summary for each (its
 * accessible name, and the sentence the page shows beside it).
 *
 * Every value can be read without a mouse. The words-known line and the minutes bars show one value in the line under
 * them, the latest at first: tapping or clicking a bar or a day of the line shows that one (hovering does too, with a
 * mouse), and with the chart focused the arrow keys, Home and End move through them, the line being announced as it
 * changes; a visually hidden table holds every value for screen readers. The reviews coming up print each count above
 * its bar, and all of them in the chart's accessible name. Bars are HTML (they size themselves at any width); the line
 * is an SVG stretched to its box with a stroke that keeps its width.
 */
import { useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { count } from '../lib/format.ts';

/** A round number at or above `v` for the top of a scale: 317 → 400, 120 → 150, 8 → 10. */
export function niceMax(v: number, floor = 10): number {
  const x = Math.max(v, floor);
  const p = 10 ** Math.floor(Math.log10(x));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => s * p >= x)!;
  return step * p;
}

/**
 * Which of a chart's `n` values the line under it reads out: the one picked (tapped, clicked, hovered, or reached with
 * the arrow keys), else `initial`. `picked` says whether one was, so the chart marks it only then.
 */
function useReadout(n: number, initial: number) {
  const [chosen, setChosen] = useState<number | null>(null);
  const picked = chosen != null && chosen >= 0 && chosen < n;
  const shown = picked ? chosen : initial;
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const next =
      e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? shown - 1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? shown + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (next == null || n === 0) return;
    e.preventDefault();
    setChosen(Math.max(0, Math.min(n - 1, next)));
  };
  return { shown, picked, pick: (i: number) => Number.isInteger(i) && i >= 0 && i < n && setChosen(i), onKeyDown };
}

/** Every value of a chart as a table only screen readers see, in a clipped box so its size never widens the page. */
function ValuesTable({ caption, columns, rows }: { caption: string; columns: [string, string]; rows: Array<[string, string]> }) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{columns[0]}</th>
            <th scope="col">{columns[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b], i) => (
            <tr key={i}>
              <th scope="row">{a}</th>
              <td>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The value under a chart ("Tue, Nov 4: 22 min"), announced when it changes. */
function Readout({ children }: { children: ReactNode }) {
  return (
    <p aria-live="polite" className="mt-1.5 min-h-5 text-sm" data-testid="chart-value">
      {children}
    </p>
  );
}

/** What the x axis shows under a chart: its first and last day, and what lies between. */
export interface Axis {
  start: string;
  middle?: string;
  end: string;
}

function AxisLine({ axis }: { axis: Axis }) {
  return (
    <div aria-hidden="true" className="mt-1.5 flex justify-between gap-2 text-xs text-muted-foreground">
      <span>{axis.start}</span>
      {axis.middle && <span>{axis.middle}</span>}
      <span>{axis.end}</span>
    </div>
  );
}

/**
 * Words known, one value a day (`days`: each day in words): a 2px line with a dot on the day read out (today at first),
 * a hairline at the top of the scale and the baseline.
 */
export function KnownLine({ values, days, label, axis }: { values: number[]; days: string[]; label: string; axis: Axis }) {
  const n = values.length;
  const { shown, picked, pick, onKeyDown } = useReadout(n, n - 1);
  const max = niceMax(Math.max(0, ...values));
  const x = (i: number) => (n <= 1 ? 100 : (i / (n - 1)) * 100);
  const y = (v: number) => 100 - (v / max) * 100;
  // The day under the pointer: the nearest one across the chart's width.
  const at = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.round(((e.clientX - r.left) / Math.max(1, r.width)) * (n - 1));
  };
  const words = (v: number) => `${count(v)} word${v === 1 ? '' : 's'}`;
  return (
    <div data-testid="known-chart">
      <div className="relative h-[124px] pt-[18px]">
        <span aria-hidden="true" className="absolute left-0 top-0 text-[11px] leading-none text-muted-foreground">
          {max.toLocaleString('en')}
        </span>
        <div
          role="group"
          aria-label={label}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => pick(at(e))}
          onPointerMove={(e) => e.pointerType === 'mouse' && pick(at(e))}
          className="relative mr-[6px] h-[100px] touch-pan-y"
        >
          <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            <line x1="0" y1="0" x2="100" y2="0" className="stroke-muted" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <line x1="0" y1="100" x2="100" y2="100" className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {picked && <line x1={x(shown)} y1="0" x2={x(shown)} y2="100" className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
            {n > 0 && (
              <polyline
                points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
                fill="none"
                className="stroke-lang"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {n > 0 && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-lang ring-2 ring-card"
              style={{ left: `${x(shown)}%`, top: `${y(values[shown])}%` }}
            />
          )}
        </div>
      </div>
      <AxisLine axis={axis} />
      <Readout>{n > 0 ? `${days[shown]}: ${words(values[shown])} known` : ''}</Readout>
      <ValuesTable caption={label} columns={['Day', 'Words known']} rows={values.map((v, i) => [days[i], count(v)])} />
    </div>
  );
}

export interface GoalBar {
  key: string;
  /** null: nothing to draw (a day still to come, or before the language was first studied). */
  minutes: number | null;
  /** The day (or week) in words, for the value line and the table: "Tue, Nov 4". */
  day: string;
  /** Its value in words: "22 min", "still to come". */
  value: string;
  /** Under the bar (Home's week: M, T, W…). */
  label?: string;
}

/**
 * Minutes per day (or per day of a week) against the daily goal, drawn as a dashed line. A bar reaching the goal is the
 * full accent, one below it a lighter accent, a day without study a short stub; the line, not the colour, shows which
 * bars reach it. Without a goal the bars are plain counts (answers or reviews per day), all in the accent. `columns`
 * heads the table of values.
 */
export function GoalBars({
  bars,
  goal = null,
  label,
  columns,
  height = 96,
  axis,
  testId,
}: {
  bars: GoalBar[];
  goal?: number | null;
  label: string;
  columns: [string, string];
  height?: number;
  axis?: Axis;
  testId?: string;
}) {
  const latest = bars.reduce((last, b, i) => (b.minutes != null ? i : last), bars.length - 1);
  const { shown, picked, pick, onKeyDown } = useReadout(bars.length, latest);
  const max = Math.max(goal != null ? goal * 1.5 : 0, ...bars.map((b) => b.minutes ?? 0), 1);
  const px = (m: number) => Math.round((m / max) * height);
  const gap = bars.length <= 40 ? 2 : bars.length <= 80 ? 1 : 0;
  const labels = bars.some((b) => b.label);
  const fill = (m: number) => (m <= 0 ? 'bg-border' : goal == null || m >= goal ? 'bg-lang' : 'bg-[color-mix(in_oklab,var(--lang)_45%,var(--card))]');
  // The bar under the pointer (each column carries its index).
  const at = (e: PointerEvent<HTMLElement>) => Number((e.target as Element).closest?.('[data-index]')?.getAttribute('data-index'));
  const bar = bars[shown];
  return (
    <div data-testid={testId}>
      <div
        role="group"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => pick(at(e))}
        onPointerMove={(e) => e.pointerType === 'mouse' && pick(at(e))}
        className="relative touch-pan-y border-b border-border"
        style={{ height }}
      >
        {goal != null && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-10 border-t-[1.5px] border-dashed border-muted-foreground/60" style={{ bottom: px(goal) }} />}
        <div aria-hidden="true" className="grid h-full items-end" style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))`, columnGap: gap }}>
          {bars.map((b, i) => (
            <div key={b.key} data-index={i} title={`${b.day}: ${b.value}`} className={`flex h-full items-end justify-center rounded-t-[5px] ${picked && i === shown ? 'bg-muted' : ''}`}>
              {b.minutes != null && <div className={`w-full max-w-6 rounded-t-[5px] ${fill(b.minutes)}`} style={{ height: b.minutes > 0 ? Math.max(3, px(b.minutes)) : 2 }} />}
            </div>
          ))}
        </div>
      </div>
      {labels && (
        <div aria-hidden="true" className="mt-1.5 grid text-center text-xs text-muted-foreground" style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))`, columnGap: gap }}>
          {bars.map((b) => (
            <span key={b.key}>{b.label}</span>
          ))}
        </div>
      )}
      {axis && <AxisLine axis={axis} />}
      <Readout>{bar ? `${bar.day}: ${bar.value}` : ''}</Readout>
      <ValuesTable caption={label} columns={columns} rows={bars.map((b) => [b.day, b.value])} />
    </div>
  );
}

/** The dashed line's key: "- - - Daily goal: 20 min". */
export function GoalKey({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="inline-block w-5 border-t-[1.5px] border-dashed border-muted-foreground/60" />
      {children}
    </span>
  );
}

/** A count per column with its value above it and its label below (reviews due on each of the next days). */
export function CountBars({ bars, label, height = 72 }: { bars: Array<{ key: string; value: number; label: string; title: string }>; label: string; height?: number }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div role="img" aria-label={label} className="grid items-end gap-2.5" style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}>
      {bars.map((b) => (
        <div key={b.key} title={b.title} className="flex flex-col items-center gap-1">
          <span aria-hidden="true" className="text-xs font-semibold">
            {b.value.toLocaleString('en')}
          </span>
          <div className="flex w-full justify-center border-b border-border" style={{ height }}>
            <div className={`mt-auto w-full max-w-6 rounded-t-[5px] ${b.value ? 'bg-lang' : 'bg-border'}`} style={{ height: b.value ? Math.max(3, Math.round((b.value / max) * height)) : 2 }} />
          </div>
          <span aria-hidden="true" className="text-xs text-muted-foreground">
            {b.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A share of a whole as a thin bar (the most frequent words known). */
export function ShareBar({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div role="img" aria-label={label} className="h-2 overflow-hidden rounded-full bg-lang/15">
      <div className="h-2 rounded-full bg-lang" style={{ width: `${v * 100}%` }} />
    </div>
  );
}
