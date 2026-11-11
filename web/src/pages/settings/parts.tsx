// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/** The pieces the settings pages share: a titled card of settings, a labelled setting, and the language they apply to. */
import type { ReactNode } from 'react';
import { LANGUAGES, LANGUAGE_CODES, type LanguageCode } from '../../../../shared/languages.ts';
import { setActiveLanguage } from '../../lib/store.ts';
import { cn } from '../../lib/utils.ts';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.tsx';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/dialog.tsx';
import { NativeSelect, NativeSelectOption } from '../../components/ui/input-group.tsx';

/** A titled card of settings. */
export function Group({ title, description, action, children, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card role="group" aria-label={typeof title === 'string' ? title : undefined}>
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className={cn('flex flex-col gap-5', className)}>{children}</CardContent>
    </Card>
  );
}

/** One setting: its name, the control under it, and a line on what it does. */
export function Setting({ label, hint, htmlFor, children, className }: { label: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  const Label = htmlFor ? 'label' : 'div';
  return (
    <div className={cn('flex flex-col gap-2 [&>[data-slot=native-select-wrapper]]:w-full', className)}>
      <Label {...(htmlFor ? { htmlFor } : {})} className="text-[0.9375rem] leading-snug font-medium">
        {label}
      </Label>
      {children}
      {hint && <p className="text-sm leading-normal text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Which language the settings below are for: the active one. Choosing another makes it the active language, so the
 * language button at the top of the screen always names the language being changed.
 */
export function LanguageSelect({ value }: { value: LanguageCode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-lang-soft/60 px-4 py-3">
      <label htmlFor="settings-language" className="text-[0.9375rem] font-medium">
        These settings are for
      </label>
      <NativeSelect id="settings-language" size="sm" aria-label="Language" value={value} onChange={(e) => setActiveLanguage((e.target as HTMLSelectElement).value as LanguageCode)} className="bg-card font-medium">
        {LANGUAGE_CODES.map((c) => (
          <NativeSelectOption key={c} value={c}>
            {LANGUAGES[c].flag} {LANGUAGES[c].name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

export interface Ask {
  title: string;
  text: ReactNode;
  /** The button that goes ahead ("Delete", "Discard"). */
  action: string;
  destructive?: boolean;
  run: () => void;
}

/** A yes-or-no question before something that cannot be undone from this screen. */
export function Confirm({ ask, onClose }: { ask: Ask | null; onClose: () => void }) {
  return (
    <AlertDialog open={!!ask} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{ask?.title}</AlertDialogTitle>
          <AlertDialogDescription>{ask?.text}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={ask?.destructive ? 'destructive' : 'default'} onClick={() => ask?.run()}>
            {ask?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
