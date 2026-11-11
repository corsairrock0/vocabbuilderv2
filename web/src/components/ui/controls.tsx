// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * shadcn/ui's form controls — Switch, Checkbox, RadioGroup, Toggle, ToggleGroup and Slider — with the WAI-ARIA
 * patterns their primitive libraries implement: buttons with role switch/checkbox/radio and aria-checked, arrow keys
 * moving through a radio group (roving tab stop), and a native range input for the slider.
 */
import { cva, type VariantProps } from 'class-variance-authority';
import { createContext, useContext, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { LuCheck, LuMinus } from 'react-icons/lu';
import { cn } from '../../lib/utils.ts';

function useControllable<T>(value: T | undefined, fallback: T, onChange?: (v: T) => void): [T, (v: T) => void] {
  const [inner, setInner] = useState<T>(fallback);
  const controlled = value !== undefined;
  return [controlled ? value : inner, (v: T) => {
    if (!controlled) setInner(v);
    onChange?.(v);
  }];
}

type ButtonAttrs = Omit<HTMLAttributes<HTMLButtonElement>, 'onChange' | 'defaultValue'>;

function Switch({ className, checked, defaultChecked = false, onCheckedChange, disabled, size = 'default', ...props }: ButtonAttrs & { checked?: boolean; defaultChecked?: boolean; onCheckedChange?: (v: boolean) => void; disabled?: boolean; size?: 'default' | 'sm' }) {
  const [on, setOn] = useControllable(checked, defaultChecked, onCheckedChange);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-slot="switch"
      data-size={size}
      data-state={on ? 'checked' : 'unchecked'}
      disabled={disabled}
      onClick={() => setOn(!on)}
      className={cn(
        'peer group/switch inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[size=sm]:h-5 data-[size=sm]:w-9 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80',
        className,
      )}
      {...props}
    >
      <span
        data-slot="switch-thumb"
        data-state={on ? 'checked' : 'unchecked'}
        className="pointer-events-none block size-6 rounded-full bg-background shadow-sm ring-0 transition-transform group-data-[size=sm]/switch:size-4 data-[state=checked]:translate-x-[calc(100%-4px)] data-[state=unchecked]:translate-x-0.5 dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-foreground"
      />
    </button>
  );
}

function Checkbox({ className, checked, defaultChecked = false, onCheckedChange, disabled, indeterminate, ...props }: ButtonAttrs & { checked?: boolean; defaultChecked?: boolean; onCheckedChange?: (v: boolean) => void; disabled?: boolean; indeterminate?: boolean }) {
  const [on, setOn] = useControllable(checked, defaultChecked, onCheckedChange);
  const state = indeterminate ? 'indeterminate' : on ? 'checked' : 'unchecked';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : on}
      data-slot="checkbox"
      data-state={state}
      disabled={disabled}
      onClick={() => setOn(!on)}
      className={cn(
        'peer grid size-5 shrink-0 place-items-center rounded-[6px] border border-input bg-card shadow-xs transition-shadow outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground dark:bg-input/30',
        className,
      )}
      {...props}
    >
      {state === 'checked' && <LuCheck className="size-3.5" strokeWidth={3} aria-hidden="true" />}
      {state === 'indeterminate' && <LuMinus className="size-3.5" strokeWidth={3} aria-hidden="true" />}
    </button>
  );
}

/** Arrow keys move focus (and, for single choice, the selection) between a group's enabled items. */
function rovingKeys(e: KeyboardEvent<HTMLElement>, selector: string, select: boolean) {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(selector)].filter((el) => !(el as HTMLButtonElement).disabled);
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[next].focus();
  if (select) items[next].click();
}

interface RadioCtx {
  value: string | undefined;
  set: (v: string) => void;
  disabled?: boolean;
}
const RadioContext = createContext<RadioCtx | null>(null);

function RadioGroup({ className, value, defaultValue, onValueChange, disabled, children, ...props }: Omit<HTMLAttributes<HTMLDivElement>, 'defaultValue' | 'onChange'> & { value?: string; defaultValue?: string; onValueChange?: (v: string) => void; disabled?: boolean; children?: ReactNode }) {
  const [v, setV] = useControllable<string | undefined>(value, defaultValue, onValueChange as (v: string | undefined) => void);
  return (
    <RadioContext.Provider value={{ value: v, set: (x) => setV(x), disabled }}>
      <div role="radiogroup" data-slot="radio-group" aria-disabled={disabled || undefined} className={cn('grid gap-3', className)} onKeyDown={(e) => rovingKeys(e, '[role=radio]', true)} {...props}>
        {children}
      </div>
    </RadioContext.Provider>
  );
}

function RadioGroupItem({ className, value, disabled, id, ...props }: ButtonAttrs & { value: string; disabled?: boolean }) {
  const ctx = useContext(RadioContext)!;
  const checked = ctx.value === value;
  return (
    <button
      type="button"
      role="radio"
      id={id}
      value={value}
      aria-checked={checked}
      data-slot="radio-group-item"
      data-state={checked ? 'checked' : 'unchecked'}
      disabled={disabled || ctx.disabled}
      tabIndex={checked || !ctx.value ? 0 : -1}
      onClick={() => ctx.set(value)}
      className={cn(
        'peer grid aspect-square size-5 shrink-0 place-items-center rounded-full border border-input bg-card text-lang shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-lang dark:bg-input/30',
        className,
      )}
      {...props}
    >
      {checked && <span data-slot="radio-group-indicator" className="size-2.5 rounded-full bg-lang" />}
    </button>
  );
}

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[color,box-shadow,background-color] outline-none disabled:pointer-events-none disabled:opacity-50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=on]:bg-lang-soft data-[state=on]:text-foreground [@media(hover:hover)]:hover:bg-muted [@media(hover:hover)]:hover:text-foreground [@media(hover:hover)]:data-[state=on]:hover:bg-lang-soft [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border border-input bg-card shadow-xs data-[state=on]:border-lang data-[state=on]:shadow-[inset_0_0_0_1px_var(--lang)] dark:bg-input/30',
        solid: 'bg-muted data-[state=on]:bg-foreground! data-[state=on]:text-background! dark:data-[state=on]:bg-primary! dark:data-[state=on]:text-primary-foreground!',
      },
      size: {
        default: 'h-10 min-w-10 px-3',
        sm: 'h-8 min-w-8 px-2.5',
        lg: 'h-11 min-w-11 px-4',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Toggle({ className, variant, size, pressed, defaultPressed = false, onPressedChange, ...props }: ButtonAttrs & VariantProps<typeof toggleVariants> & { pressed?: boolean; defaultPressed?: boolean; onPressedChange?: (v: boolean) => void }) {
  const [on, setOn] = useControllable(pressed, defaultPressed, onPressedChange);
  return <button type="button" aria-pressed={on} data-slot="toggle" data-state={on ? 'on' : 'off'} onClick={() => setOn(!on)} className={cn(toggleVariants({ variant, size, className }))} {...props} />;
}

interface ToggleGroupCtx extends VariantProps<typeof toggleVariants> {
  type: 'single' | 'multiple';
  values: string[];
  toggle: (v: string) => void;
  spacing: number;
}
const ToggleGroupContext = createContext<ToggleGroupCtx | null>(null);

type ToggleGroupProps = Omit<HTMLAttributes<HTMLDivElement>, 'defaultValue' | 'onChange'> &
  VariantProps<typeof toggleVariants> & { spacing?: number; disabled?: boolean } & (
    | { type: 'single'; value?: string; defaultValue?: string; onValueChange?: (v: string) => void; allowEmpty?: boolean }
    | { type: 'multiple'; value?: string[]; defaultValue?: string[]; onValueChange?: (v: string[]) => void; allowEmpty?: boolean }
  );

/**
 * A row of toggles: one choice (`single`, a radio group: arrow keys move and select) or several (`multiple`). A single
 * group keeps its choice when the chosen item is pressed again unless `allowEmpty`.
 */
function ToggleGroup(props: ToggleGroupProps) {
  const { className, variant, size, spacing = 0, type, value, defaultValue, onValueChange, allowEmpty, children, ...rest } = props as ToggleGroupProps & { children?: ReactNode };
  const asList = (v: string | string[] | undefined) => (v === undefined ? undefined : Array.isArray(v) ? v : v === '' ? [] : [v]);
  const [inner, setInner] = useState<string[]>(asList(defaultValue) ?? []);
  const values = asList(value) ?? inner;
  const toggle = (v: string) => {
    let next: string[];
    if (type === 'single') next = values.includes(v) ? (allowEmpty ? [] : values) : [v];
    else next = values.includes(v) ? (allowEmpty === false && values.length === 1 ? values : values.filter((x) => x !== v)) : [...values, v];
    if (value === undefined) setInner(next);
    if (type === 'single') (onValueChange as ((v: string) => void) | undefined)?.(next[0] ?? '');
    else (onValueChange as ((v: string[]) => void) | undefined)?.(next);
  };
  return (
    <ToggleGroupContext.Provider value={{ type, values, toggle, variant, size, spacing }}>
      <div
        role={type === 'single' ? 'radiogroup' : 'group'}
        data-slot="toggle-group"
        data-variant={variant}
        data-spacing={spacing}
        style={{ '--gap': spacing } as any}
        onKeyDown={(e) => rovingKeys(e, '[data-slot=toggle-group-item]', type === 'single')}
        className={cn('group/toggle-group flex w-fit flex-wrap items-center gap-[calc(var(--spacing)*var(--gap))] rounded-lg data-[spacing=0]:data-[variant=outline]:shadow-xs', className)}
        {...rest}
      >
        {children}
      </div>
    </ToggleGroupContext.Provider>
  );
}

function ToggleGroupItem({ className, value, variant, size, ...props }: ButtonAttrs & VariantProps<typeof toggleVariants> & { value: string }) {
  const ctx = useContext(ToggleGroupContext)!;
  const on = ctx.values.includes(value);
  const single = ctx.type === 'single';
  const tabStop = !single || on || (ctx.values.length === 0);
  return (
    <button
      type="button"
      role={single ? 'radio' : undefined}
      aria-checked={single ? on : undefined}
      aria-pressed={single ? undefined : on}
      data-slot="toggle-group-item"
      data-state={on ? 'on' : 'off'}
      data-spacing={ctx.spacing}
      tabIndex={tabStop ? 0 : -1}
      onClick={() => ctx.toggle(value)}
      className={cn(
        toggleVariants({ variant: ctx.variant || variant, size: ctx.size || size }),
        'w-auto min-w-0 shrink-0 px-3 focus:z-10 focus-visible:z-10',
        'data-[spacing=0]:rounded-none data-[spacing=0]:shadow-none data-[spacing=0]:first:rounded-l-lg data-[spacing=0]:last:rounded-r-lg data-[spacing=0]:data-[variant=outline]:border-l-0 data-[spacing=0]:data-[variant=outline]:first:border-l',
        className,
      )}
      data-variant={ctx.variant || variant}
      {...props}
    />
  );
}

function Slider({ className, value, defaultValue, min = 0, max = 100, step = 1, onValueChange, disabled, ...props }: Omit<HTMLAttributes<HTMLInputElement>, 'defaultValue' | 'onChange'> & { value?: number; defaultValue?: number; min?: number; max?: number; step?: number; onValueChange?: (v: number) => void; disabled?: boolean }) {
  const [v, setV] = useControllable(value, defaultValue ?? min, onValueChange);
  const pct = ((v - min) / (max - min || 1)) * 100;
  return (
    <input
      type="range"
      data-slot="slider"
      min={min}
      max={max}
      step={step}
      value={v}
      disabled={disabled}
      onChange={(e) => setV(Number((e.target as HTMLInputElement).value))}
      style={{ '--pct': `${pct}%` } as any}
      className={cn(
        'h-6 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed disabled:opacity-50',
        '[&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[linear-gradient(to_right,var(--primary)_var(--pct),color-mix(in_oklab,var(--primary)_15%,transparent)_var(--pct))]',
        '[&::-webkit-slider-thumb]:-mt-2 [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow-sm',
        '[&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-primary/15 [&::-moz-range-progress]:h-2 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-primary [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary [&::-moz-range-thumb]:bg-background',
        'focus-visible:outline-none [&:focus-visible::-webkit-slider-thumb]:ring-[4px] [&:focus-visible::-webkit-slider-thumb]:ring-ring/40',
        className,
      )}
      {...props}
    />
  );
}

export { Switch, Checkbox, RadioGroup, RadioGroupItem, Toggle, toggleVariants, ToggleGroup, ToggleGroupItem, Slider };
