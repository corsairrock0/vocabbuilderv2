// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.ts';
import { Separator } from './basics.tsx';
import { renderWith, type RenderProp } from './slot.ts';

type Div = HTMLAttributes<HTMLDivElement>;

function ItemGroup({ className, ...props }: Div) {
  return <div data-slot="item-group" className={cn('group/item-group flex flex-col', className)} {...props} />;
}

function ItemSeparator({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <Separator data-slot="item-separator" orientation="horizontal" className={cn('my-0', className)} {...props} />;
}

const itemVariants = cva(
  'group/item flex flex-wrap items-center rounded-xl border border-transparent text-sm outline-none transition-colors duration-100 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [a&]:transition-colors [@media(hover:hover)]:[a&]:hover:bg-accent/60 [@media(hover:hover)]:[button&]:hover:bg-accent/60 [button&]:w-full [button&]:text-left',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border-border bg-card',
        muted: 'bg-muted/60',
      },
      size: {
        default: 'gap-4 p-4',
        sm: 'gap-3 px-4 py-3',
        xs: 'gap-2.5 px-3 py-2',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Item({ className, variant = 'default', size = 'default', render, ...props }: Div & VariantProps<typeof itemVariants> & { render?: RenderProp }) {
  return renderWith(render, { 'data-slot': 'item', 'data-variant': variant, 'data-size': size, className: cn(itemVariants({ variant, size, className })), ...props }, (p) => <div {...p} />);
}

const itemMediaVariants = cva('flex shrink-0 items-center justify-center gap-2 group-has-[[data-slot=item-description]]/item:self-start [&_svg]:pointer-events-none group-has-[[data-slot=item-description]]/item:translate-y-0.5', {
  variants: {
    variant: {
      default: 'bg-transparent',
      icon: "size-10 rounded-lg bg-lang-soft text-lang [&_svg:not([class*='size-'])]:size-5",
      muted: "size-10 rounded-lg bg-muted text-foreground [&_svg:not([class*='size-'])]:size-5",
      image: 'size-12 overflow-hidden rounded-lg [&_img]:size-full [&_img]:object-cover',
    },
  },
  defaultVariants: { variant: 'default' },
});

function ItemMedia({ className, variant = 'default', ...props }: Div & VariantProps<typeof itemMediaVariants>) {
  return <div data-slot="item-media" data-variant={variant} className={cn(itemMediaVariants({ variant, className }))} {...props} />;
}

function ItemContent({ className, ...props }: Div) {
  return <div data-slot="item-content" className={cn('flex min-w-0 flex-1 flex-col gap-0.5 [&+[data-slot=item-content]]:flex-none', className)} {...props} />;
}

function ItemTitle({ className, ...props }: Div) {
  return <div data-slot="item-title" className={cn('flex w-fit max-w-full items-center gap-2 text-[0.9375rem] leading-snug font-medium', className)} {...props} />;
}

function ItemDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p data-slot="item-description" className={cn('line-clamp-2 text-sm leading-normal font-normal text-balance text-muted-foreground [&>a]:underline [&>a]:underline-offset-4', className)} {...props} />;
}

function ItemActions({ className, ...props }: Div) {
  return <div data-slot="item-actions" className={cn('flex items-center gap-2', className)} {...props} />;
}

function ItemHeader({ className, ...props }: Div) {
  return <div data-slot="item-header" className={cn('flex basis-full items-center justify-between gap-2', className)} {...props} />;
}

function ItemFooter({ className, ...props }: Div) {
  return <div data-slot="item-footer" className={cn('flex basis-full items-center justify-between gap-2', className)} {...props} />;
}

export { Item, ItemMedia, ItemContent, ItemActions, ItemGroup, ItemSeparator, ItemTitle, ItemDescription, ItemHeader, ItemFooter };
