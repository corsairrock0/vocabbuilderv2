// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/** shadcn/ui's class helper: conditional classes (clsx) with later Tailwind classes winning conflicts (tailwind-merge). */
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// The app's own colour tokens (success, warning and the soft tints), so text-success and text-sm stay separate groups.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: ['success', 'success-soft', 'warning', 'warning-soft', 'destructive-soft', 'lang', 'lang-soft', 'lang-foreground', 'mark'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
