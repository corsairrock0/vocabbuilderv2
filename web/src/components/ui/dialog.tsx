// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * shadcn/ui's Dialog, AlertDialog, Sheet and Drawer on the browser's own modal <dialog>: it sits in the top layer
 * (nothing clips it or paints over it), makes the rest of the page inert, traps focus, closes on Escape and gives focus
 * back to the opener. Each part keeps shadcn's names and props. Dialogs are bottom sheets on phones and centred panels
 * from 640px; Drawer is always a bottom sheet with a drag handle; Sheet slides in from a side.
 */
import { createContext, useContext, useEffect, useId, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { LuX } from 'react-icons/lu';
import { cn } from '../../lib/utils.ts';
import { Button, type ButtonProps } from './button.tsx';
import { renderWith, type RenderProp } from './slot.ts';

interface ModalCtx {
  open: boolean;
  setOpen: (v: boolean) => void;
  titleId: string;
  descriptionId: string;
  alert: boolean;
}
const ModalContext = createContext<ModalCtx | null>(null);
const useModal = () => useContext(ModalContext)!;

function Root({ open, defaultOpen = false, onOpenChange, children, alert = false }: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (v: boolean) => void; children?: ReactNode; alert?: boolean }) {
  const [inner, setInner] = useState(defaultOpen);
  const o = open ?? inner;
  const titleId = useId();
  const descriptionId = useId();
  const setOpen = (v: boolean) => {
    if (open === undefined) setInner(v);
    onOpenChange?.(v);
  };
  return <ModalContext.Provider value={{ open: o, setOpen, titleId, descriptionId, alert }}>{children}</ModalContext.Provider>;
}

let locks = 0;
function lockScroll() {
  if (locks++ === 0) document.documentElement.style.overflow = 'hidden';
  return () => {
    if (--locks === 0) document.documentElement.style.overflow = '';
  };
}

/** The <dialog> element: shown modally while open, animated out before it closes. */
function ModalElement({ className, children, dismissible = true, onDragClose, ...props }: HTMLAttributes<HTMLDialogElement> & { dismissible?: boolean; onDragClose?: boolean }) {
  const ctx = useModal();
  const ref = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(ctx.open);
  const [state, setState] = useState<'open' | 'closed'>('open');
  useEffect(() => {
    if (ctx.open) {
      setMounted(true);
      setState('open');
    } else if (mounted) {
      setState('closed');
      const el = ref.current;
      const done = () => setMounted(false);
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('reduce-motion');
      if (!el || reduce) return done();
      const t = window.setTimeout(done, 220);
      el.addEventListener('animationend', done, { once: true });
      return () => {
        window.clearTimeout(t);
        el.removeEventListener('animationend', done);
      };
    }
  }, [ctx.open]);
  useEffect(() => {
    const el = ref.current;
    if (!mounted || !el) return;
    if (!el.open) el.showModal();
    const unlock = lockScroll();
    return () => {
      unlock();
      if (el.open) el.close();
    };
  }, [mounted]);
  if (!mounted) return null;
  return (
    <dialog
      ref={ref}
      role={ctx.alert ? 'alertdialog' : undefined}
      aria-labelledby={ctx.titleId}
      aria-describedby={ctx.descriptionId}
      data-state={state}
      onCancel={(e: Event) => {
        e.preventDefault();
        ctx.setOpen(false);
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> itself.
        if (dismissible && e.target === e.currentTarget) ctx.setOpen(false);
      }}
      className={cn('m-0 max-h-none max-w-none border-0 bg-transparent p-0 text-foreground outline-none', className)}
      {...props}
    >
      {children}
    </dialog>
  );
}

function CloseX({ className }: { className?: string }) {
  const ctx = useModal();
  return (
    <Button variant="ghost" size="icon-sm" className={cn('absolute top-3.5 right-3.5 text-muted-foreground', className)} onClick={() => ctx.setOpen(false)} aria-label="Close" data-slot="dialog-close">
      <LuX className="size-5" aria-hidden="true" />
    </Button>
  );
}

function Trigger({ render, slot, ...props }: HTMLAttributes<HTMLButtonElement> & { render?: RenderProp; slot: string }) {
  const ctx = useModal();
  return renderWith(render, { 'data-slot': slot, 'aria-haspopup': 'dialog', 'aria-expanded': ctx.open, onClick: () => ctx.setOpen(true), ...props }, (p) => <button type="button" {...p} />);
}

function Close({ render, slot, ...props }: HTMLAttributes<HTMLButtonElement> & { render?: RenderProp; slot: string }) {
  const ctx = useModal();
  return renderWith(render, { 'data-slot': slot, onClick: () => ctx.setOpen(false), ...props }, (p) => <button type="button" {...p} />);
}

// ------------------------------------------------------------------ Dialog

const Dialog = (p: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (v: boolean) => void; children?: ReactNode }) => <Root {...p} />;
const DialogTrigger = (p: HTMLAttributes<HTMLButtonElement> & { render?: RenderProp }) => <Trigger slot="dialog-trigger" {...p} />;
const DialogClose = (p: HTMLAttributes<HTMLButtonElement> & { render?: RenderProp }) => <Close slot="dialog-close" {...p} />;

const panel =
  'fixed inset-x-0 bottom-0 top-auto mx-auto flex max-h-[92dvh] w-full flex-col gap-4 overflow-y-auto rounded-t-3xl border bg-popover p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-popover-foreground shadow-2xl ' +
  'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom duration-200 ' +
  'sm:inset-0 sm:m-auto sm:h-fit sm:max-h-[min(88dvh,48rem)] sm:max-w-lg sm:rounded-2xl sm:p-6 sm:data-[state=open]:slide-in-from-bottom-4 sm:data-[state=open]:fade-in-0 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:slide-out-to-bottom-2 sm:data-[state=closed]:fade-out-0 sm:data-[state=closed]:zoom-out-95';

function DialogContent({ className, children, showCloseButton = true, ...props }: HTMLAttributes<HTMLDialogElement> & { showCloseButton?: boolean }) {
  return (
    <ModalElement data-slot="dialog-content" className={cn(panel, className)} {...props}>
      <div aria-hidden="true" className="mx-auto -mt-2 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-muted sm:hidden" />
      {children}
      {showCloseButton && <CloseX />}
    </ModalElement>
  );
}

function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-1.5 pr-8 text-left', className)} {...props} />;
}

function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="dialog-footer" className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}

function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  const ctx = useModal();
  return <h2 id={ctx.titleId} data-slot="dialog-title" className={cn('text-lg leading-snug font-semibold', className)} {...props} />;
}

function DialogDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  const ctx = useModal();
  return <p id={ctx.descriptionId} data-slot="dialog-description" className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

// ------------------------------------------------------------------ AlertDialog (no closing by tapping outside)

const AlertDialog = (p: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (v: boolean) => void; children?: ReactNode }) => <Root alert {...p} />;
const AlertDialogTrigger = (p: HTMLAttributes<HTMLButtonElement> & { render?: RenderProp }) => <Trigger slot="alert-dialog-trigger" {...p} />;

function AlertDialogContent({ className, children, ...props }: HTMLAttributes<HTMLDialogElement>) {
  return (
    <ModalElement data-slot="alert-dialog-content" dismissible={false} className={cn(panel, 'sm:max-w-md', className)} {...props}>
      {children}
    </ModalElement>
  );
}
const AlertDialogHeader = DialogHeader;
const AlertDialogFooter = DialogFooter;
const AlertDialogTitle = DialogTitle;
const AlertDialogDescription = DialogDescription;

function AlertDialogAction({ onClick, ...props }: ButtonProps) {
  const ctx = useModal();
  return (
    <Button
      data-slot="alert-dialog-action"
      onClick={(e) => {
        onClick?.(e);
        ctx.setOpen(false);
      }}
      {...props}
    />
  );
}

function AlertDialogCancel({ onClick, variant = 'outline', ...props }: ButtonProps) {
  const ctx = useModal();
  return (
    <Button
      data-slot="alert-dialog-cancel"
      variant={variant}
      onClick={(e) => {
        onClick?.(e);
        ctx.setOpen(false);
      }}
      {...props}
    />
  );
}

// ------------------------------------------------------------------ Sheet (from a side)

const Sheet = (p: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (v: boolean) => void; children?: ReactNode }) => <Root {...p} />;
const SheetTrigger = (p: HTMLAttributes<HTMLButtonElement> & { render?: RenderProp }) => <Trigger slot="sheet-trigger" {...p} />;
const SheetClose = (p: HTMLAttributes<HTMLButtonElement> & { render?: RenderProp }) => <Close slot="sheet-close" {...p} />;

const sides = {
  right: 'inset-y-0 right-0 left-auto h-dvh w-[min(24rem,88vw)] border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
  left: 'inset-y-0 left-0 right-auto h-dvh w-[min(24rem,88vw)] border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
  top: 'inset-x-0 top-0 bottom-auto h-auto w-full border-b data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top',
  bottom: 'inset-x-0 bottom-0 top-auto h-auto w-full border-t data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
};

function SheetContent({ className, children, side = 'right', showCloseButton = true, ...props }: HTMLAttributes<HTMLDialogElement> & { side?: keyof typeof sides; showCloseButton?: boolean }) {
  return (
    <ModalElement data-slot="sheet-content" className={cn('fixed flex flex-col gap-4 overflow-y-auto bg-popover text-popover-foreground shadow-2xl duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in', sides[side], className)} {...props}>
      {children}
      {showCloseButton && <CloseX />}
    </ModalElement>
  );
}
const SheetHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div data-slot="sheet-header" className={cn('flex flex-col gap-1.5 p-5 pr-12', className)} {...props} />;
const SheetFooter = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div data-slot="sheet-footer" className={cn('mt-auto flex flex-col gap-2 p-5', className)} {...props} />;
const SheetTitle = DialogTitle;
const SheetDescription = DialogDescription;

// ------------------------------------------------------------------ Drawer (bottom sheet you can drag down)

const Drawer = (p: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (v: boolean) => void; children?: ReactNode }) => <Root {...p} />;
const DrawerTrigger = (p: HTMLAttributes<HTMLButtonElement> & { render?: RenderProp }) => <Trigger slot="drawer-trigger" {...p} />;
const DrawerClose = (p: HTMLAttributes<HTMLButtonElement> & { render?: RenderProp }) => <Close slot="drawer-close" {...p} />;

function DrawerContent({ className, children, ...props }: HTMLAttributes<HTMLDialogElement>) {
  const ctx = useModal();
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const move = (dy: number) => {
    if (sheet.current) sheet.current.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
  };
  return (
    <ModalElement
      data-slot="drawer-content"
      className={cn('fixed inset-x-0 bottom-0 top-auto mx-auto w-full max-w-xl duration-200 data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom', className)}
      {...props}
    >
      <div ref={sheet} className="flex max-h-[90dvh] flex-col rounded-t-3xl border border-b-0 bg-popover pb-[env(safe-area-inset-bottom)] text-popover-foreground shadow-2xl transition-transform duration-150">
        <div
          className="flex shrink-0 touch-none justify-center pt-3 pb-2"
          aria-hidden="true"
          onPointerDown={(e) => {
            drag.current = { y: e.clientY, dy: 0 };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            if (sheet.current) sheet.current.style.transitionDuration = '0ms';
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            drag.current.dy = e.clientY - drag.current.y;
            move(drag.current.dy);
          }}
          onPointerUp={() => {
            const d = drag.current;
            drag.current = null;
            if (sheet.current) sheet.current.style.transitionDuration = '';
            if (d && d.dy > 90) ctx.setOpen(false);
            else move(0);
          }}
          onPointerCancel={() => {
            drag.current = null;
            move(0);
          }}
        >
          <div className="h-1.5 w-12 rounded-full bg-muted-foreground/25" />
        </div>
        <div className="flex min-h-0 flex-col overflow-y-auto">{children}</div>
      </div>
    </ModalElement>
  );
}
const DrawerHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div data-slot="drawer-header" className={cn('flex flex-col gap-1 px-5 pt-1 pb-3 text-left', className)} {...props} />;
const DrawerFooter = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => <div data-slot="drawer-footer" className={cn('mt-auto flex flex-col gap-2 p-5', className)} {...props} />;
const DrawerTitle = DialogTitle;
const DrawerDescription = DialogDescription;

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  Drawer,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
