// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.ts';

type Div = HTMLAttributes<HTMLDivElement>;

function Card({ className, size = 'default', ...props }: Div & { size?: 'default' | 'sm' }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn('group/card flex flex-col gap-5 rounded-xl border bg-card py-5 text-card-foreground shadow-xs data-[size=sm]:gap-3 data-[size=sm]:py-4', className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: Div) {
  return (
    <div
      data-slot="card-header"
      className={cn('@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-5 has-data-[slot=card-action]:grid-cols-[1fr_auto] group-data-[size=sm]/card:px-4 [.border-b]:pb-5', className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: Div) {
  return <div data-slot="card-title" className={cn('text-base leading-snug font-semibold', className)} {...props} />;
}

function CardDescription({ className, ...props }: Div) {
  return <div data-slot="card-description" className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

function CardAction({ className, ...props }: Div) {
  return <div data-slot="card-action" className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)} {...props} />;
}

function CardContent({ className, ...props }: Div) {
  return <div data-slot="card-content" className={cn('px-5 group-data-[size=sm]/card:px-4', className)} {...props} />;
}

function CardFooter({ className, ...props }: Div) {
  return <div data-slot="card-footer" className={cn('flex items-center px-5 group-data-[size=sm]/card:px-4 [.border-t]:pt-5', className)} {...props} />;
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
