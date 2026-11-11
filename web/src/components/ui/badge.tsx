// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.ts';
import { renderWith, type RenderProp } from './slot.ts';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        soft: 'border-transparent bg-lang-soft text-lang',
        destructive: 'border-transparent bg-destructive-soft text-destructive',
        success: 'border-transparent bg-success-soft text-success',
        warning: 'border-transparent bg-warning-soft text-warning',
        outline: 'text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Badge({ className, variant, render, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants> & { render?: RenderProp }) {
  return renderWith(render, { 'data-slot': 'badge', className: cn(badgeVariants({ variant }), className), ...props }, (p) => <span {...p} />);
}

export { Badge, badgeVariants };
