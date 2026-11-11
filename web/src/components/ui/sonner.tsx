// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/** shadcn/ui's Sonner toasts, fed by the app store's toast() (lib/store.ts): stacked at the bottom, above the tab bar. */
import { LuCircleCheck, LuCircleX, LuInfo, LuX } from 'react-icons/lu';
import { useApp } from '../../lib/store.ts';
import { cn } from '../../lib/utils.ts';

function Toaster({ className }: { className?: string }) {
  const toasts = useApp((s) => s.toasts);
  return (
    <section aria-label="Notifications" aria-live="polite" className={cn('pointer-events-none fixed inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6', className)}>
      {toasts.map((t) => {
        const Icon = t.kind === 'bad' ? LuCircleX : t.kind === 'good' ? LuCircleCheck : LuInfo;
        return (
          <div
            key={t.id}
            data-slot="toast"
            data-kind={t.kind}
            className="pointer-events-auto flex w-full max-w-md animate-in items-center gap-3 rounded-xl border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg fade-in-0 slide-in-from-bottom-4 duration-200"
          >
            <Icon className={cn('size-[1.125rem] shrink-0', t.kind === 'bad' ? 'text-destructive' : t.kind === 'good' ? 'text-success' : 'text-primary')} aria-hidden="true" />
            <span className="min-w-0 flex-1">{t.text}</span>
            {t.action && (
              <button className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground" onClick={t.action.run}>
                {t.action.label}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

export { Toaster, LuX as ToastCloseIcon };
