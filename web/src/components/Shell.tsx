// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { LuBookOpen, LuChartColumn, LuCheck, LuChevronsUpDown, LuCircleAlert, LuCloud, LuCloudOff, LuDumbbell, LuHouse, LuLoaderCircle, LuSettings } from 'react-icons/lu';
import { LANGUAGES, LANGUAGE_CODES, type LanguageCode } from '../../../shared/languages.ts';
import { COPYRIGHT } from '../lib/brand.ts';
import { getSyncStatus, subscribeSync } from '../lib/outbox.ts';
import { Link, navigate, useLocation } from '../lib/router.tsx';
import { useIsFocusMode } from '../lib/focus.ts';
import { setActiveLanguage, useApp } from '../lib/store.ts';
import { cn } from '../lib/utils.ts';
import { useWide } from './ui.tsx';
import { Badge } from './ui/badge.tsx';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from './ui/dialog.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from './ui/menu.tsx';
import { Toaster } from './ui/sonner.tsx';

// Four places (2.0.0): Today starts the session in one tap, so there is no Study tab; Practice has its own, since every
// practice answer now counts toward the schedule. Settings sits behind the gear in the top bar (sidebar footer on wider
// screens).
const NAV = [
  { to: '/', label: 'Today', icon: LuHouse, match: (p: string) => p === '/' || p.startsWith('/study') || p.startsWith('/review') },
  { to: '/practice', label: 'Practice', icon: LuDumbbell, match: (p: string) => p.startsWith('/practice') },
  { to: '/words', label: 'Words', icon: LuBookOpen, match: (p: string) => p.startsWith('/words') },
  { to: '/progress', label: 'Progress', icon: LuChartColumn, match: (p: string) => p.startsWith('/progress') || p.startsWith('/stats') },
];
const isSettings = (p: string) => p.startsWith('/settings') || p.startsWith('/import');

function SettingsLink({ path, wide }: { path: string; wide?: boolean }) {
  const active = isSettings(path);
  return (
    <Link
      to="/settings"
      aria-current={active ? 'page' : undefined}
      aria-label="Settings"
      title="Settings"
      className={cn(
        'inline-flex min-h-10 items-center gap-3 rounded-lg text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
        wide ? 'w-full flex-col justify-center px-2 py-2 text-xs lg:flex-row lg:justify-start lg:px-3 lg:text-[0.9375rem]' : 'size-10 justify-center',
        active ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <LuSettings className={cn('size-5', active && 'text-lang')} aria-hidden="true" />
      {wide && <span>Settings</span>}
    </Link>
  );
}

export function useSync() {
  return useSyncExternalStore(subscribeSync, getSyncStatus);
}

export function SyncIndicator({ compact }: { compact?: boolean }) {
  const s = useSync();
  const offlineData = useApp((a) => a.offlineData);
  let icon = <LuCloud className="size-4" aria-hidden="true" />;
  let text = 'All changes saved';
  let tone = 'text-muted-foreground';
  if (s.state === 'saving') {
    icon = <LuLoaderCircle className="size-4 animate-spin" aria-hidden="true" />;
    text = s.pending ? `Saving ${s.pending} change${s.pending === 1 ? '' : 's'}` : 'Saving';
  } else if (s.state === 'offline' || (offlineData && s.state === 'saved')) {
    icon = <LuCloudOff className="size-4" aria-hidden="true" />;
    text = s.pending ? `Offline, ${s.pending} change${s.pending === 1 ? '' : 's'} waiting` : 'Offline';
    tone = 'text-warning';
  } else if (s.state === 'error') {
    icon = <LuCircleAlert className="size-4" aria-hidden="true" />;
    text = `${s.failed} change${s.failed === 1 ? '' : 's'} could not sync`;
    tone = 'text-destructive';
  }
  return (
    <Link to="/settings/data" className={cn('inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm transition-colors hover:bg-accent', compact && 'min-w-9 justify-center', tone)} title={s.message ?? text}>
      {icon}
      <span className={compact ? 'sr-only' : ''} aria-live="polite">
        {text}
      </span>
    </Link>
  );
}

function useLanguageRows() {
  const boot = useApp((s) => s.boot);
  const active = (boot?.settings.activeLanguage ?? 'es') as LanguageCode;
  const rows = LANGUAGE_CODES.map((code) => {
    const stats = boot?.languages.find((l) => l.code === code)?.stats;
    return { code, lang: LANGUAGES[code], words: stats?.total ?? 0, due: stats?.due ?? 0 };
  });
  return { active, rows };
}

/** The six languages as a list in a bottom drawer (phones). */
export function LanguagePicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { active, rows } = useLanguageRows();
  return (
    <Drawer open={open} onOpenChange={(v) => !v && onClose()}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Choose a language</DrawerTitle>
          <DrawerDescription>Your words and progress are kept separately for each language.</DrawerDescription>
        </DrawerHeader>
        <ul className="grid gap-1 px-3 pb-5">
          {rows.map(({ code, lang, words, due }) => (
            <li key={code}>
              <button
                data-lang={code}
                aria-current={code === active ? 'true' : undefined}
                className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', code === active ? 'bg-lang-soft' : 'hover:bg-accent')}
                onClick={() => {
                  setActiveLanguage(code);
                  onClose();
                }}
              >
                <span className="text-[1.75rem] leading-none" aria-hidden="true">
                  {lang.flag}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="word text-lg">{lang.nativeName}</span>
                    <span className="text-sm text-muted-foreground">{lang.name}</span>
                  </span>
                  <span className="hint block truncate">{words ? `${words.toLocaleString('en')} words` : 'No words yet'}</span>
                </span>
                {due > 0 && <Badge variant="soft">{due} due</Badge>}
                {code === active && <LuCheck className="size-5 shrink-0 text-lang" aria-label="Active" />}
              </button>
            </li>
          ))}
        </ul>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * The language switcher: a drop-down menu on tablets and computers, a bottom drawer on phones. Both are drawn outside
 * the header, so its sticky bar never clips the list.
 */
export function LanguageButton({ className = '', full }: { className?: string; full?: boolean }) {
  const [open, setOpen] = useState(false);
  const wide = useWide(768);
  const { active, rows } = useLanguageRows();
  const lang = LANGUAGES[active];
  const button = (
    <button
      className={cn(
        'inline-flex h-10 items-center gap-2 rounded-full border bg-card py-1 pr-3 pl-2 text-sm font-semibold shadow-xs outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:border-primary/50',
        full && 'w-full justify-between rounded-xl px-3',
        className,
      )}
      aria-label={`Active language: ${lang.name}. Change language`}
      onClick={wide ? undefined : () => setOpen(true)}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="text-lg leading-none" aria-hidden="true">
          {lang.flag}
        </span>
        <span className="truncate">{lang.name}</span>
      </span>
      <LuChevronsUpDown className="size-4 text-muted-foreground" aria-hidden="true" />
    </button>
  );
  if (!wide)
    return (
      <>
        {button}
        <LanguagePicker open={open} onClose={() => setOpen(false)} />
      </>
    );
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger render={button} />
      <DropdownMenuContent label="Choose a language" minWidth={300} className="p-1.5">
        <DropdownMenuLabel>Languages</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={active} onValueChange={(v) => setActiveLanguage(v as LanguageCode)}>
          {rows.map(({ code, lang: l, words, due }) => (
            <DropdownMenuRadioItem key={code} value={code} data-lang={code} className="gap-3 py-2.5">
              <span className="text-2xl leading-none" aria-hidden="true">
                {l.flag}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="word text-base text-foreground">{l.nativeName}</span>
                  <span className="text-xs text-muted-foreground">{l.name}</span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {words ? `${words.toLocaleString('en')} words${due ? ` · ${due} due` : ''}` : 'No words yet'}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Responsive shell: a sidebar on tablets and computers; a top bar and bottom tabs on phones. */
export function Shell({ children }: { children: ReactNode }) {
  const { path } = useLocation();
  const practiceRun = useIsFocusMode();
  const session = path.startsWith('/study/') && path.split('/').length > 2;
  // Focus mode keeps the same element tree (the page keeps its state); only the bars are hidden.
  const focus = session || practiceRun;
  return (
    <div className={cn('min-h-dvh', !focus && 'md:grid md:grid-cols-[auto_1fr]')}>
      <aside className={cn('sticky top-0 hidden h-dvh flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:w-[84px] lg:w-[248px]', !focus && 'md:flex')}>
        <div className="px-3 pt-5 pb-3 lg:px-4">
          <Link to="/" className="flex items-center justify-center gap-2.5 rounded-xl p-1.5 lg:justify-start" title="VocabBuilder by Lango — home">
            <img src="/icons/icon.svg" alt="" width={34} height={34} className="rounded-[10px]" />
            <span className="hidden leading-tight lg:block">
              <span className="block text-[1.05rem] font-semibold tracking-[-0.01em]">VocabBuilder</span>
              <span className="block text-xs font-medium text-muted-foreground">by Lango</span>
            </span>
          </Link>
        </div>
        <div className="hidden px-4 pb-3 lg:block">
          <LanguageButton full />
        </div>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-1 px-2.5 pt-1 lg:px-3">
          {NAV.map((n) => {
            const active = n.match(path);
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50 lg:flex-row lg:gap-3 lg:px-3 lg:py-2 lg:text-[0.9375rem]',
                  active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon className={cn('size-[1.375rem] lg:size-5', active && 'text-lang')} aria-hidden="true" />
                <span>{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="flex flex-col items-center gap-2 border-t border-sidebar-border p-3 lg:items-stretch">
          <SettingsLink path={path} wide />
          <span className="lg:hidden">
            <SyncIndicator compact />
          </span>
          <span className="hidden lg:block">
            <SyncIndicator />
          </span>
          <div className="hidden px-2 text-[0.7rem] leading-snug text-muted-foreground lg:block">
            <p>{COPYRIGHT}</p>
            <p className="mt-0.5 flex gap-3">
              <Link to="/terms" className="underline decoration-dotted underline-offset-2 hover:text-foreground">
                Terms of Service
              </Link>
              <Link to="/notices" className="underline decoration-dotted underline-offset-2 hover:text-foreground">
                Notices
              </Link>
            </p>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className={cn('safe-top sticky top-0 z-30 flex items-center justify-between gap-2 border-b bg-background/85 px-4 py-2 backdrop-blur-md md:hidden', focus && 'hidden')}>
          <LanguageButton />
          <div className="flex items-center gap-0.5">
            <SyncIndicator compact />
            <SettingsLink path={path} />
          </div>
        </header>
        <header className={cn('hidden items-center justify-end gap-3 px-8 pt-4 lg:hidden', !focus && 'md:flex')}>
          <LanguageButton />
        </header>
        <main
          className={cn(session ? 'w-full' : practiceRun ? 'mx-auto w-full max-w-3xl flex-1 px-4 sm:px-6' : 'mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:px-6 md:pb-12 lg:px-10 lg:pt-8')}
          style={practiceRun ? { paddingBottom: 'calc(var(--dock-h, 0px) + 2rem)' } : undefined}
        >
          {children}
        </main>
      </div>
      <nav aria-label="Main" className={cn('safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t bg-background/92 px-1 backdrop-blur-md md:hidden', focus && 'hidden')}>
        {NAV.map((n) => {
          const active = n.match(path);
          const Icon = n.icon;
          return (
            <button
              key={n.to}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(n.to)}
              className={cn('group flex min-h-16 flex-col items-center justify-center gap-1 text-xs outline-none', active ? 'font-semibold text-foreground' : 'font-medium text-muted-foreground')}
            >
              <span className={cn('flex h-8 w-16 items-center justify-center rounded-full transition-colors group-focus-visible:ring-[3px] group-focus-visible:ring-ring/50', active ? 'bg-lang-soft text-lang' : 'group-active:bg-accent')}>
                <Icon className="size-[1.375rem]" aria-hidden="true" strokeWidth={active ? 2.4 : 2} />
              </span>
              {n.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export function Toasts() {
  return <Toaster />;
}
