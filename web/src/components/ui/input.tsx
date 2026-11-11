// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.ts';

const inputClasses =
  'h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3.5 py-2 text-base shadow-xs transition-[color,box-shadow,border-color] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-invalid:border-destructive aria-invalid:ring-destructive/20';

function Input({ className, type, ...props }: HTMLAttributes<HTMLInputElement>) {
  return <input type={type} data-slot="input" className={cn(inputClasses, className)} {...props} />;
}

function Textarea({ className, ...props }: HTMLAttributes<HTMLTextAreaElement>) {
  return <textarea data-slot="textarea" className={cn(inputClasses, 'field-sizing-content h-auto min-h-20 py-2.5', className)} {...props} />;
}

export { Input, Textarea, inputClasses };
