// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/** shadcn/ui's Tabs, Accordion and Collapsible (WAI-ARIA tabs with arrow keys; disclosure buttons for the others). */
import { cva, type VariantProps } from 'class-variance-authority';
import { createContext, useContext, useId, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { LuChevronDown } from 'react-icons/lu';
import { cn } from '../../lib/utils.ts';
import { renderWith, type RenderProp } from './slot.ts';

interface TabsCtx {
  value: string;
  set: (v: string) => void;
  base: string;
  variant: 'default' | 'line';
}
const TabsContext = createContext<TabsCtx | null>(null);

function Tabs({ className, value, defaultValue = '', onValueChange, children, ...props }: Omit<HTMLAttributes<HTMLDivElement>, 'defaultValue'> & { value?: string; defaultValue?: string; onValueChange?: (v: string) => void; children?: ReactNode }) {
  const [inner, setInner] = useState(defaultValue);
  const base = useId();
  const v = value ?? inner;
  const set = (x: string) => {
    if (value === undefined) setInner(x);
    onValueChange?.(x);
  };
  return (
    <TabsContext.Provider value={{ value: v, set, base, variant: 'default' }}>
      <div data-slot="tabs" className={cn('flex flex-col gap-3', className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

const tabsListVariants = cva('inline-flex w-fit items-center justify-center text-muted-foreground', {
  variants: {
    variant: {
      default: 'h-10 rounded-xl bg-muted p-1',
      line: 'h-10 gap-1 rounded-none border-b bg-transparent p-0',
    },
  },
  defaultVariants: { variant: 'default' },
});

function TabsList({ className, variant = 'default', children, ...props }: HTMLAttributes<HTMLDivElement> & VariantProps<typeof tabsListVariants>) {
  const ctx = useContext(TabsContext)!;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]:not(:disabled)')];
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
  };
  return (
    <TabsContext.Provider value={{ ...ctx, variant: variant ?? 'default' }}>
      <div role="tablist" data-slot="tabs-list" data-variant={variant} onKeyDown={onKeyDown} className={cn(tabsListVariants({ variant }), className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

function TabsTrigger({ className, value, ...props }: Omit<HTMLAttributes<HTMLButtonElement>, 'value'> & { value: string; disabled?: boolean }) {
  const ctx = useContext(TabsContext)!;
  const active = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${ctx.base}-tab-${value}`}
      aria-selected={active}
      aria-controls={`${ctx.base}-panel-${value}`}
      tabIndex={active ? 0 : -1}
      data-slot="tabs-trigger"
      data-state={active ? 'active' : 'inactive'}
      onClick={() => ctx.set(value)}
      className={cn(
        "inline-flex h-full flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent px-3 py-1 text-sm font-medium text-foreground/70 transition-[color,box-shadow,background-color] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        ctx.variant === 'line'
          ? 'relative rounded-none px-2 data-[state=active]:text-foreground after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent data-[state=active]:after:bg-lang'
          : 'data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, value, ...props }: Omit<HTMLAttributes<HTMLDivElement>, 'value'> & { value: string }) {
  const ctx = useContext(TabsContext)!;
  if (ctx.value !== value) return null;
  return <div role="tabpanel" id={`${ctx.base}-panel-${value}`} aria-labelledby={`${ctx.base}-tab-${value}`} data-slot="tabs-content" className={cn('flex-1 outline-none', className)} {...props} />;
}

interface CollapsibleCtx {
  open: boolean;
  set: (v: boolean) => void;
  id: string;
}
const CollapsibleContext = createContext<CollapsibleCtx | null>(null);

function Collapsible({ open, defaultOpen = false, onOpenChange, className, children, ...props }: HTMLAttributes<HTMLDivElement> & { open?: boolean; defaultOpen?: boolean; onOpenChange?: (v: boolean) => void; children?: ReactNode }) {
  const [inner, setInner] = useState(defaultOpen);
  const id = useId();
  const o = open ?? inner;
  const set = (v: boolean) => {
    if (open === undefined) setInner(v);
    onOpenChange?.(v);
  };
  return (
    <CollapsibleContext.Provider value={{ open: o, set, id }}>
      <div data-slot="collapsible" data-state={o ? 'open' : 'closed'} className={className} {...props}>
        {children}
      </div>
    </CollapsibleContext.Provider>
  );
}

function CollapsibleTrigger({ render, ...props }: HTMLAttributes<HTMLButtonElement> & { render?: RenderProp }) {
  const ctx = useContext(CollapsibleContext)!;
  return renderWith(render, { 'data-slot': 'collapsible-trigger', 'data-state': ctx.open ? 'open' : 'closed', 'aria-expanded': ctx.open, 'aria-controls': ctx.id, onClick: () => ctx.set(!ctx.open), ...props }, (p) => <button type="button" {...p} />);
}

function CollapsibleContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const ctx = useContext(CollapsibleContext)!;
  if (!ctx.open) return null;
  return <div id={ctx.id} data-slot="collapsible-content" data-state="open" className={cn('animate-in fade-in-0 slide-in-from-top-2', className)} {...props} />;
}

/** Accordion items as disclosure buttons; `type="multiple"` lets several stay open. */
const AccordionContext = createContext<{ open: string[]; toggle: (v: string) => void } | null>(null);
const AccordionItemContext = createContext<{ value: string; id: string } | null>(null);

function Accordion({
  type = 'single',
  defaultValue,
  onValueChange,
  className,
  children,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, 'defaultValue' | 'onChange'> & { type?: 'single' | 'multiple'; defaultValue?: string | string[]; onValueChange?: (open: string[]) => void; children?: ReactNode }) {
  const [open, setOpen] = useState<string[]>(defaultValue === undefined ? [] : Array.isArray(defaultValue) ? defaultValue : [defaultValue]);
  const toggle = (v: string) => {
    const next = open.includes(v) ? open.filter((x) => x !== v) : type === 'single' ? [v] : [...open, v];
    setOpen(next);
    onValueChange?.(next);
  };
  return (
    <AccordionContext.Provider value={{ open, toggle }}>
      <div data-slot="accordion" className={className} {...props}>
        {children}
      </div>
    </AccordionContext.Provider>
  );
}

function AccordionItem({ value, className, ...props }: HTMLAttributes<HTMLDivElement> & { value: string }) {
  const ctx = useContext(AccordionContext)!;
  const id = useId();
  return (
    <AccordionItemContext.Provider value={{ value, id }}>
      <div data-slot="accordion-item" data-state={ctx.open.includes(value) ? 'open' : 'closed'} className={cn('border-b last:border-b-0', className)} {...props} />
    </AccordionItemContext.Provider>
  );
}

function AccordionTrigger({ className, children, ...props }: HTMLAttributes<HTMLButtonElement>) {
  const ctx = useContext(AccordionContext)!;
  const item = useContext(AccordionItemContext)!;
  const open = ctx.open.includes(item.value);
  return (
    <h3 className="flex">
      <button
        type="button"
        data-slot="accordion-trigger"
        data-state={open ? 'open' : 'closed'}
        aria-expanded={open}
        aria-controls={item.id}
        onClick={() => ctx.toggle(item.value)}
        className={cn(
          'flex flex-1 items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [@media(hover:hover)]:hover:underline [&[data-state=open]>svg]:rotate-180',
          className,
        )}
        {...props}
      >
        {children}
        <LuChevronDown className="pointer-events-none size-4 shrink-0 translate-y-0.5 text-muted-foreground transition-transform duration-200" aria-hidden="true" />
      </button>
    </h3>
  );
}

function AccordionContent({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const ctx = useContext(AccordionContext)!;
  const item = useContext(AccordionItemContext)!;
  if (!ctx.open.includes(item.value)) return null;
  return (
    <div id={item.id} role="region" data-slot="accordion-content" data-state="open" className="animate-in fade-in-0 overflow-hidden text-sm" {...props}>
      <div className={cn('pt-0 pb-4', className)}>{children}</div>
    </div>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, Collapsible, CollapsibleTrigger, CollapsibleContent, Accordion, AccordionItem, AccordionTrigger, AccordionContent };
