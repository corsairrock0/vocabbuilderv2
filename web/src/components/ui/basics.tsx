// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/** shadcn/ui's small display components: Label, Separator, Skeleton, Kbd, Spinner and Progress. */
import type { HTMLAttributes } from 'react';
import { LuLoaderCircle } from 'react-icons/lu';
import { cn } from '../../lib/utils.ts';

function Label({ className, ...props }: HTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      data-slot="label"
      className={cn('flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50', className)}
      {...props}
    />
  );
}

function Separator({ className, orientation = 'horizontal', decorative = true, ...props }: HTMLAttributes<HTMLDivElement> & { orientation?: 'horizontal' | 'vertical'; decorative?: boolean }) {
  return (
    <div
      data-slot="separator"
      data-orientation={orientation}
      role={decorative ? 'none' : 'separator'}
      aria-orientation={decorative ? undefined : orientation}
      className={cn('shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px', className)}
      {...props}
    />
  );
}

function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="skeleton" aria-hidden="true" className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm border border-border/60 bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none [&_svg:not([class*='size-'])]:size-3 [[data-slot=button][data-variant=default]_&]:border-transparent [[data-slot=button][data-variant=default]_&]:bg-white/20 [[data-slot=button][data-variant=default]_&]:text-current",
        className,
      )}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <kbd data-slot="kbd-group" className={cn('inline-flex items-center gap-1', className)} {...props} />;
}

function Spinner({ className, label = 'Loading', ...props }: HTMLAttributes<SVGSVGElement> & { label?: string }) {
  return <LuLoaderCircle role="status" aria-label={label} className={cn('size-4 animate-spin', className)} {...props} />;
}

function Progress({ className, value, indicatorClassName, ...props }: HTMLAttributes<HTMLDivElement> & { value?: number | null; indicatorClassName?: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value == null ? undefined : Math.round(v)}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-lang/15', className)}
      {...props}
    >
      <div data-slot="progress-indicator" className={cn('h-full w-full flex-1 rounded-full bg-lang transition-transform duration-500 ease-out', indicatorClassName)} style={{ transform: `translateX(-${100 - v}%)` }} />
    </div>
  );
}

export { Label, Separator, Skeleton, Kbd, KbdGroup, Spinner, Progress };
