// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.ts';

type Div = HTMLAttributes<HTMLDivElement>;

function Empty({ className, ...props }: Div) {
  return <div data-slot="empty" className={cn('flex min-w-0 flex-1 flex-col items-center justify-center gap-5 rounded-xl border border-dashed p-6 text-center text-balance md:p-10', className)} {...props} />;
}

function EmptyHeader({ className, ...props }: Div) {
  return <div data-slot="empty-header" className={cn('flex max-w-sm flex-col items-center gap-2 text-center', className)} {...props} />;
}

const emptyMediaVariants = cva('mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0', {
  variants: {
    variant: {
      default: 'bg-transparent',
      icon: "flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground [&_svg:not([class*='size-'])]:size-6",
    },
  },
  defaultVariants: { variant: 'default' },
});

function EmptyMedia({ className, variant = 'default', ...props }: Div & VariantProps<typeof emptyMediaVariants>) {
  return <div data-slot="empty-icon" data-variant={variant} className={cn(emptyMediaVariants({ variant, className }))} {...props} />;
}

function EmptyTitle({ className, ...props }: Div) {
  return <div data-slot="empty-title" className={cn('text-lg font-semibold tracking-tight', className)} {...props} />;
}

function EmptyDescription({ className, ...props }: Div) {
  return <div data-slot="empty-description" className={cn('text-sm/relaxed text-muted-foreground [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-primary', className)} {...props} />;
}

function EmptyContent({ className, ...props }: Div) {
  return <div data-slot="empty-content" className={cn('flex w-full max-w-sm min-w-0 flex-col items-center gap-3 text-sm text-balance', className)} {...props} />;
}

export { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia };
