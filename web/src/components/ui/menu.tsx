// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * shadcn/ui's DropdownMenu and Popover: a panel anchored to its trigger, drawn at the end of the page (no container
 * clips it), placed below the trigger or above when there is no room, closed by Escape, a click outside, Tab, or the
 * page scrolling. Menus follow the WAI-ARIA menu pattern: arrow keys, Home and End move between items.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { LuCheck } from 'react-icons/lu';
import { cn } from '../../lib/utils.ts';
import { renderWith, type RenderProp } from './slot.ts';

interface AnchorCtx {
  open: boolean;
  setOpen: (v: boolean) => void;
  anchor: RefObject<HTMLElement | null>;
}
const AnchorContext = createContext<AnchorCtx | null>(null);

function AnchorRoot({ open, defaultOpen = false, onOpenChange, children }: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (v: boolean) => void; children?: ReactNode }) {
  const [inner, setInner] = useState(defaultOpen);
  const anchor = useRef<HTMLElement>(null);
  const o = open ?? inner;
  const setOpen = (v: boolean) => {
    if (open === undefined) setInner(v);
    onOpenChange?.(v);
  };
  return <AnchorContext.Provider value={{ open: o, setOpen, anchor }}>{children}</AnchorContext.Provider>;
}

function AnchorTrigger({ render, popup, slot, ...props }: HTMLAttributes<HTMLButtonElement> & { render?: RenderProp; popup: 'menu' | 'dialog'; slot: string }) {
  const ctx = useContext(AnchorContext)!;
  return renderWith(
    render,
    {
      ref: ctx.anchor,
      'data-slot': slot,
      'data-state': ctx.open ? 'open' : 'closed',
      'aria-haspopup': popup,
      'aria-expanded': ctx.open,
      onClick: () => ctx.setOpen(!ctx.open),
      ...props,
    },
    (p) => <button type="button" {...p} />,
  );
}

type Placement = { top: number; left: number; width?: number; maxHeight: number; above: boolean };

function usePlacement(open: boolean, anchor: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>, align: 'start' | 'center' | 'end', sideOffset: number, matchWidth: boolean, minWidth: number) {
  const [pos, setPos] = useState<Placement | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor.current) return setPos(null);
    const place = () => {
      const r = anchor.current!.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(Math.max(matchWidth ? r.width : 0, minWidth, panel.current?.offsetWidth ?? 0), vw - 16);
      let left = align === 'start' ? r.left : align === 'end' ? r.right - width : r.left + r.width / 2 - width / 2;
      left = Math.min(Math.max(8, left), vw - width - 8);
      const below = vh - r.bottom - sideOffset - 12;
      const aboveRoom = r.top - sideOffset - 12;
      const h = panel.current?.scrollHeight ?? 0;
      const above = h > below && aboveRoom > below;
      setPos({ left, width: matchWidth || minWidth ? width : undefined, above, top: above ? r.top - sideOffset : r.bottom + sideOffset, maxHeight: Math.max(160, above ? aboveRoom : below) });
    };
    place();
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open, anchor, align, sideOffset, matchWidth, minWidth]);
  return pos;
}

function useDismiss(open: boolean, setOpen: (v: boolean) => void, anchor: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>) {
  const set = useRef(setOpen);
  set.current = setOpen;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        set.current(false);
        anchor.current?.focus();
      } else if (e.key === 'Tab' && panel.current?.contains(document.activeElement)) set.current(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) set.current(false);
    };
    const onScroll = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) set.current(false);
    };
    const onResize = () => set.current(false);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
      if (panel.current?.contains(document.activeElement)) prev?.focus?.();
    };
  }, [open]);
}

// duration-150 times the entrance animation; transition-none keeps it from also turning every style change (the
// panel is hidden until it is placed) into a 150 ms transition, during which the panel could not take focus.
const panelClasses =
  'fixed z-50 overflow-x-hidden overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg outline-none animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 duration-150 transition-none';

function AnchoredPanel({ className, children, align = 'start', sideOffset = 6, matchWidth = false, minWidth = 0, role, label, focusFirst, style, ...props }: HTMLAttributes<HTMLDivElement> & { align?: 'start' | 'center' | 'end'; sideOffset?: number; matchWidth?: boolean; minWidth?: number; role: string; label?: string; focusFirst?: boolean }) {
  const ctx = useContext(AnchorContext)!;
  const panel = useRef<HTMLDivElement>(null);
  const pos = usePlacement(ctx.open, ctx.anchor, panel, align, sideOffset, matchWidth, minWidth);
  useDismiss(ctx.open, ctx.setOpen, ctx.anchor, panel);
  useEffect(() => {
    if (!ctx.open || !pos || !focusFirst) return;
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role^=menuitem]:not([aria-disabled=true])') ?? [])];
    const first = items.find((el) => el.getAttribute('aria-checked') === 'true') ?? items[0];
    first?.focus();
    // A panel that is not shown yet cannot take focus: try once more on the next frame.
    if (!first || document.activeElement === first) return;
    const raf = requestAnimationFrame(() => first.focus());
    return () => cancelAnimationFrame(raf);
  }, [ctx.open, !!pos]);
  if (!ctx.open) return null;
  return createPortal(
    <div
      ref={panel}
      role={role}
      aria-label={label}
      data-side={pos?.above ? 'top' : 'bottom'}
      className={cn(panelClasses, className)}
      style={{
        ...(style as object),
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        width: pos?.width,
        maxHeight: pos?.maxHeight,
        transform: pos?.above ? 'translateY(-100%)' : undefined,
        visibility: pos ? undefined : 'hidden',
      }}
      {...props}
    >
      {children}
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ DropdownMenu

const DropdownMenu = AnchorRoot;
const DropdownMenuTrigger = (p: HTMLAttributes<HTMLButtonElement> & { render?: RenderProp }) => <AnchorTrigger popup="menu" slot="dropdown-menu-trigger" {...p} />;

function DropdownMenuContent({ className, label, minWidth = 192, ...props }: HTMLAttributes<HTMLDivElement> & { align?: 'start' | 'center' | 'end'; sideOffset?: number; minWidth?: number; matchWidth?: boolean; label?: string }) {
  return (
    <AnchoredPanel
      role="menu"
      label={label}
      focusFirst
      data-slot="dropdown-menu-content"
      minWidth={minWidth}
      onKeyDown={(e) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^=menuitem]:not([aria-disabled=true])')];
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}
      className={className}
      {...props}
    />
  );
}

const itemClasses =
  "relative flex w-full cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive-soft [@media(hover:hover)]:hover:bg-accent [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground";

function DropdownMenuItem({ className, inset, variant = 'default', onSelect, disabled, render, ...props }: HTMLAttributes<HTMLElement> & { inset?: boolean; variant?: 'default' | 'destructive'; onSelect?: () => void; disabled?: boolean; render?: RenderProp }) {
  const ctx = useContext(AnchorContext)!;
  return renderWith(
    render,
    {
      role: 'menuitem',
      tabIndex: -1,
      'data-slot': 'dropdown-menu-item',
      'data-variant': variant,
      'data-inset': inset,
      'aria-disabled': disabled || undefined,
      className: cn(itemClasses, inset && 'pl-8', className),
      onClick: () => {
        if (disabled) return;
        onSelect?.();
        ctx.setOpen(false);
      },
      onKeyDown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          (e.currentTarget as HTMLElement).click();
        }
      },
      ...props,
    },
    (p) => <div {...p} />,
  );
}

function DropdownMenuCheckboxItem({ className, checked, onCheckedChange, children, ...props }: HTMLAttributes<HTMLDivElement> & { checked?: boolean; onCheckedChange?: (v: boolean) => void }) {
  return (
    <div
      role="menuitemcheckbox"
      aria-checked={!!checked}
      tabIndex={-1}
      data-slot="dropdown-menu-checkbox-item"
      className={cn(itemClasses, 'pl-8', className)}
      onClick={() => onCheckedChange?.(!checked)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onCheckedChange?.(!checked);
        }
      }}
      {...props}
    >
      <span className="pointer-events-none absolute left-2.5 flex size-4 items-center justify-center">{checked && <LuCheck className="size-4 text-foreground!" aria-hidden="true" />}</span>
      {children}
    </div>
  );
}

const RadioCtx = createContext<{ value?: string; onValueChange?: (v: string) => void } | null>(null);

function DropdownMenuRadioGroup({ value, onValueChange, ...props }: Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> & { value?: string; onValueChange?: (v: string) => void }) {
  return (
    <RadioCtx.Provider value={{ value, onValueChange }}>
      <div role="group" data-slot="dropdown-menu-radio-group" {...props} />
    </RadioCtx.Provider>
  );
}

function DropdownMenuRadioItem({ className, value, children, ...props }: Omit<HTMLAttributes<HTMLDivElement>, 'value'> & { value: string }) {
  const radio = useContext(RadioCtx)!;
  const anchor = useContext(AnchorContext)!;
  const checked = radio.value === value;
  const pick = () => {
    radio.onValueChange?.(value);
    anchor.setOpen(false);
  };
  return (
    <div
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={-1}
      data-slot="dropdown-menu-radio-item"
      className={cn(itemClasses, 'pr-8', className)}
      onClick={pick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      }}
      {...props}
    >
      {children}
      <span className="pointer-events-none absolute right-2.5 flex size-4 items-center justify-center">{checked && <LuCheck className="size-4 text-primary!" aria-hidden="true" />}</span>
    </div>
  );
}

function DropdownMenuLabel({ className, inset, ...props }: HTMLAttributes<HTMLDivElement> & { inset?: boolean }) {
  return <div data-slot="dropdown-menu-label" className={cn('px-2.5 py-1.5 text-xs font-medium text-muted-foreground', inset && 'pl-8', className)} {...props} />;
}

function DropdownMenuSeparator({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div role="separator" data-slot="dropdown-menu-separator" className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

function DropdownMenuShortcut({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span data-slot="dropdown-menu-shortcut" className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)} {...props} />;
}

// ------------------------------------------------------------------ Popover

const Popover = AnchorRoot;
const PopoverTrigger = (p: HTMLAttributes<HTMLButtonElement> & { render?: RenderProp }) => <AnchorTrigger popup="dialog" slot="popover-trigger" {...p} />;

function PopoverContent({ className, label, minWidth = 288, ...props }: HTMLAttributes<HTMLDivElement> & { align?: 'start' | 'center' | 'end'; sideOffset?: number; minWidth?: number; matchWidth?: boolean; label?: string }) {
  return <AnchoredPanel role="dialog" label={label} data-slot="popover-content" minWidth={minWidth} className={cn('p-4', className)} {...props} />;
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  Popover,
  PopoverTrigger,
  PopoverContent,
};
