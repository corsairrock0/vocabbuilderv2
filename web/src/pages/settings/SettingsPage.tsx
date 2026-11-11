// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useEffect, useState, type FormEvent } from 'react';
import type { IconType } from 'react-icons';
import { LuArrowLeft, LuChevronRight, LuDatabase, LuGraduationCap, LuSlidersHorizontal, LuUser, LuVolume2 } from 'react-icons/lu';
import { Link, useLocation } from '../../lib/router.tsx';
import { clearDeviceData, setState, settings as currentSettings, toast, updateSettings, useApp } from '../../lib/store.ts';
import { listQueue } from '../../lib/outbox.ts';
import { ApiError, del, get, post, setCsrf } from '../../lib/api.ts';
import { relative } from '../../lib/format.ts';
import { COPYRIGHT } from '../../lib/brand.ts';
import { PageHeader, Segmented, Toggle, useWide } from '../../components/ui.tsx';
import { Button } from '../../components/ui/button.tsx';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../../components/ui/dialog.tsx';
import { Field, FieldLabel } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { NativeSelect, NativeSelectOption } from '../../components/ui/input-group.tsx';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '../../components/ui/item.tsx';
import { cn } from '../../lib/utils.ts';
import { Group, Setting } from './parts.tsx';
import { LearningSettings } from './LearningSettings.tsx';
import { AudioSettings } from './AudioSettings.tsx';
import { DataSettings } from './DataSettings.tsx';

const SECTIONS: Array<{ id: string; label: string; about: string; icon: IconType }> = [
  { id: 'general', label: 'General', about: 'Appearance, studying, time', icon: LuSlidersHorizontal },
  { id: 'learning', label: 'Learning', about: 'New words, goals, memory, answer checking', icon: LuGraduationCap },
  { id: 'audio', label: 'Audio', about: 'Accent, speed, recordings', icon: LuVolume2 },
  { id: 'data', label: 'Data and backups', about: 'Word sets, export, backups', icon: LuDatabase },
  { id: 'account', label: 'Account', about: 'Password, signed-in devices', icon: LuUser },
];

/**
 * Settings (from the gear). On a phone /settings is the list of sections and each section is its own page; on a wider
 * screen the list stays beside the section, and /settings shows General.
 */
export function SettingsPage() {
  const { path } = useLocation();
  const wide = useWide(768);
  const named = path.split('/')[2] ?? '';
  const section = named || (wide ? 'general' : '');
  const current = SECTIONS.find((s) => s.id === section);
  const list = (
    <nav aria-label="Settings sections" className={cn('flex flex-col', wide ? 'gap-0.5' : 'divide-y overflow-hidden rounded-xl border bg-card')}>
      {SECTIONS.map((s) => {
        const active = wide && section === s.id;
        return (
          <Item
            key={s.id}
            size={wide ? 'xs' : 'sm'}
            className={cn(wide ? 'rounded-lg' : 'rounded-none', active && 'bg-accent font-semibold')}
            render={<Link to={`/settings/${s.id}`} aria-current={active ? 'page' : undefined} />}
          >
            <ItemMedia variant={wide ? 'default' : 'icon'}>
              <s.icon className={cn(wide && 'size-[1.125rem]', active ? 'text-lang' : wide && 'text-muted-foreground')} aria-hidden="true" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle className={cn(wide ? 'text-[0.9375rem]' : 'text-base', active && 'font-semibold')}>{s.label}</ItemTitle>
              {!wide && <ItemDescription>{s.about}</ItemDescription>}
            </ItemContent>
            {!wide && (
              <ItemActions>
                <LuChevronRight className="size-5 text-muted-foreground/60" aria-hidden="true" />
              </ItemActions>
            )}
          </Item>
        );
      })}
    </nav>
  );
  const content = (
    <>
      {section === 'general' && <General />}
      {section === 'learning' && <LearningSettings />}
      {section === 'audio' && <AudioSettings />}
      {section === 'data' && <DataSettings />}
      {section === 'account' && <Account />}
    </>
  );
  if (wide) {
    return (
      <div className="max-w-5xl">
        <PageHeader title="Settings" />
        <div className="grid grid-cols-[13rem_minmax(0,1fr)] items-start gap-8">
          <div className="sticky top-6">{list}</div>
          <div className="min-w-0 max-w-2xl">
            <h2 className="sr-only">{current?.label}</h2>
            {content}
          </div>
        </div>
      </div>
    );
  }
  if (!current) {
    return (
      <div>
        <PageHeader title="Settings" />
        {list}
        <About className="mt-8 px-1" />
      </div>
    );
  }
  return (
    <div>
      <PageHeader
        title={current.label}
        back={
          <Button variant="ghost" size="sm" className="-ml-2.5 text-muted-foreground" render={<Link to="/settings" />}>
            <LuArrowLeft aria-hidden="true" /> Settings
          </Button>
        }
      />
      {content}
    </div>
  );
}

function About({ className }: { className?: string }) {
  const terms = useApp((st) => st.boot?.terms ?? null);
  return (
    <div className={cn('text-sm text-muted-foreground', className)}>
      <p className="text-foreground">
        VocabBuilder {__APP_VERSION__} by Lango. {COPYRIGHT}
      </p>
      <p className="mt-1">Content from other projects (dictionary definitions, example sentences, word tables, Forvo pronunciations) keeps its own licence.</p>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <Link to="/terms" className="rounded underline decoration-dotted underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          Terms of Service
        </Link>
        <Link to="/notices" className="rounded underline decoration-dotted underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          Third-party notices
        </Link>
      </p>
      {terms?.acceptedAt ? (
        <p className="mt-1">
          You accepted version {terms.acceptedVersion} on {new Date(terms.acceptedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.
        </p>
      ) : null}
    </div>
  );
}

function General() {
  const s = useApp((st) => st.boot?.settings) ?? currentSettings();
  const zones: string[] = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [s.timezone];
  return (
    <div className="flex flex-col gap-5">
      <Group title="Appearance">
        <Setting label="Theme">
          <Segmented label="Theme" value={s.theme} onChange={(theme) => void updateSettings({ theme })} options={[{ value: 'system', label: 'Match device' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        </Setting>
        <Setting label="Text size">
          <Segmented label="Text size" value={s.fontScale} onChange={(fontScale) => void updateSettings({ fontScale })} options={[{ value: 1, label: '100%' }, { value: 1.15, label: '115%' }, { value: 1.3, label: '130%' }]} />
        </Setting>
        <div className="divide-y border-t">
          <Toggle label="Higher contrast" checked={s.highContrast} onChange={(highContrast) => void updateSettings({ highContrast })} />
          <Toggle label="Reduce motion" checked={s.reducedMotion} onChange={(reducedMotion) => void updateSettings({ reducedMotion })} />
          <Toggle label="Show stress marks" hint="Russian and Ukrainian learner stress marks (вода́). Answers never require them." checked={s.showStressMarks} onChange={(showStressMarks) => void updateSettings({ showStressMarks })} />
        </div>
      </Group>
      <Group title="Studying">
        <Setting label="After a question the app can grade" hint="Automatic: wrong is Again; a typo, a missing accent or a hint is Hard; right is Good. Easy is only ever chosen by you.">
          <Segmented label="Rating" value={s.ratingMode} onChange={(ratingMode) => void updateSettings({ ratingMode })} options={[{ value: 'auto', label: 'Rate automatically' }, { value: 'confirm', label: 'Let me confirm the rating' }]} />
        </Setting>
        <Setting label="Hints">
          <Segmented label="Hints" value={s.hintBehavior} onChange={(hintBehavior) => void updateSettings({ hintBehavior })} options={[{ value: 'on_request', label: 'When I ask' }, { value: 'never', label: 'Never' }]} />
        </Setting>
        <div className="divide-y border-t">
          <Toggle label="Keyboard shortcuts" hint="Enter, Space, 1–4 and R during study (never while typing)." checked={s.keyboardShortcuts} onChange={(keyboardShortcuts) => void updateSettings({ keyboardShortcuts })} />
          <Toggle label="Play audio automatically" hint="Each Forvo play counts toward your API quota. Browsers may block autoplay until you tap once." checked={s.audioAutoplay} onChange={(audioAutoplay) => void updateSettings({ audioAutoplay })} />
          <Toggle label="Allow voice recording" hint="For shadowing practice. Recordings stay on your device unless you save one to a word." checked={s.recordingEnabled} onChange={(recordingEnabled) => void updateSettings({ recordingEnabled })} />
          <Toggle label="Show the on-screen Cyrillic keyboard" checked={s.onScreenKeyboard} onChange={(onScreenKeyboard) => void updateSettings({ onScreenKeyboard })} />
        </div>
      </Group>
      <Group title="Time">
        <Setting label="Timezone" htmlFor="tz" hint="Days, streaks and due dates use this timezone. Times are stored in UTC.">
          <NativeSelect id="tz" value={s.timezone} onChange={(e) => void updateSettings({ timezone: (e.target as HTMLSelectElement).value })}>
            {zones.map((z) => (
              <NativeSelectOption key={z} value={z}>
                {z}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Setting>
        <p className="text-sm text-muted-foreground">Interface language: English.</p>
      </Group>
      <Group title="About">
        <About />
      </Group>
    </div>
  );
}

function Account() {
  const username = useApp((s) => s.username);
  const [sessions, setSessions] = useState<Array<{ id: string; current: boolean; createdAt: number; lastSeenAt: number; userAgent: string | null; ip: string | null }>>([]);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  // A sign-out waiting for a yes: changes are still on this device.
  const [pending, setPending] = useState<{ all: boolean; waiting: number } | null>(null);
  const load = () => get<typeof sessions>('/api/auth/sessions').then(setSessions).catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);
  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await post('/api/auth/password', { currentPassword: current, newPassword: next });
      toast('Password changed. Other devices were signed out.', 'good');
      setCurrent('');
      setNext('');
      void load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not change the password', 'bad');
    } finally {
      setBusy(false);
    }
  };
  const signOutNow = async (all: boolean) => {
    await post(all ? '/api/auth/logout-all' : '/api/auth/logout').catch(() => undefined);
    await clearDeviceData();
    setCsrf('');
    setState({ auth: 'login', boot: null });
  };
  const signOut = async (all: boolean) => {
    const waiting = (await listQueue()).length;
    if (waiting) setPending({ all, waiting });
    else await signOutNow(all);
  };
  return (
    <div className="flex flex-col gap-5">
      <Group title={`Signed in as ${username}`}>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void signOut(false)}>
            Sign out
          </Button>
          <Button variant="ghost" onClick={() => void signOut(true)}>
            Sign out on all devices
          </Button>
        </div>
      </Group>
      <Group title="Change password" description="Other devices are signed out when the password changes.">
        <form onSubmit={changePassword} className="flex flex-col gap-4">
          <Field className="gap-1.5">
            <FieldLabel htmlFor="cur">Current password</FieldLabel>
            <Input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent((e.target as HTMLInputElement).value)} required />
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor="new">New password (12 characters or more)</FieldLabel>
            <Input id="new" type="password" autoComplete="new-password" minLength={12} value={next} onChange={(e) => setNext((e.target as HTMLInputElement).value)} required />
          </Field>
          <Button type="submit" className="self-start" disabled={busy}>
            Change password
          </Button>
        </form>
      </Group>
      <Group title="Signed-in devices" className="gap-0">
        <ul className="-my-1 divide-y">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-[0.9375rem]">{s.userAgent?.replace(/\(.*?\)/g, '').slice(0, 70) || 'Unknown browser'}</p>
                <p className="text-sm text-muted-foreground">
                  {s.current ? 'This device' : `Last active ${relative(s.lastSeenAt)}`}
                  {s.ip ? `, ${s.ip}` : ''}
                </p>
              </div>
              {!s.current && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await del(`/api/auth/sessions/${s.id}`);
                    void load();
                  }}
                >
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Group>
      <AlertDialog open={!!pending} onOpenChange={(v) => !v && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out with unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.waiting === 1 ? '1 change has' : `${pending?.waiting} changes have`} not reached your server yet. They stay on this device and sync after you sign in again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay signed in</AlertDialogCancel>
            <AlertDialogAction onClick={() => pending && void signOutNow(pending.all)}>Sign out</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
