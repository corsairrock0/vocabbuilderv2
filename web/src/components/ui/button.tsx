// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.ts';
import { renderWith, type RenderProp } from './slot.ts';

// Hover styles only where a pointer hovers: on touch screens :hover sticks to whatever lands under the finger after
// a tap (a new question's choice looked selected).
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[color,background-color,border-color,box-shadow,opacity,transform] outline-none select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs [@media(hover:hover)]:hover:bg-primary/90',
        destructive: 'bg-destructive text-white shadow-xs focus-visible:ring-destructive/30 dark:bg-destructive/70 [@media(hover:hover)]:hover:bg-destructive/90',
        outline: 'border border-input bg-card shadow-xs dark:bg-input/30 [@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:hover:text-accent-foreground dark:[@media(hover:hover)]:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground [@media(hover:hover)]:hover:bg-secondary/80',
        ghost: '[@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:hover:text-accent-foreground dark:[@media(hover:hover)]:hover:bg-accent/60',
        link: 'text-primary underline-offset-4 [@media(hover:hover)]:hover:underline active:scale-100',
        soft: 'bg-lang-soft text-lang [@media(hover:hover)]:hover:bg-lang-soft/70',
        lang: 'bg-lang text-lang-foreground shadow-xs focus-visible:ring-lang/40 [@media(hover:hover)]:hover:bg-lang/90',
      },
      size: {
        default: 'h-10 px-4 py-2 has-[>svg]:px-3.5',
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-12 rounded-lg px-6 text-base has-[>svg]:px-5',
        xl: 'h-14 rounded-xl px-7 text-[1.0625rem] font-semibold has-[>svg]:px-6 [&_svg:not([class*=size-])]:size-5',
        icon: 'size-10',
        'icon-sm': 'size-8 rounded-md',
        'icon-lg': 'size-12 rounded-lg [&_svg:not([class*=size-])]:size-5',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

type ButtonProps = HTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** Render as another element, e.g. a Link, with the button's look. */
    render?: RenderProp;
  };

function Button({ className, variant, size, render, type, ...props }: ButtonProps) {
  return renderWith(render, { 'data-slot': 'button', 'data-variant': variant ?? 'default', className: cn(buttonVariants({ variant, size, className })), ...props }, (p) => (
    <button type={type ?? 'button'} {...p} />
  ));
}

export { Button, buttonVariants, type ButtonProps };
