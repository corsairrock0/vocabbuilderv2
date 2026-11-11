// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import { useEffect, useRef, useState } from 'react';
import { LuDownload, LuEllipsis, LuFlaskConical, LuRefreshCw, LuRotateCcw, LuTrash2, LuUpload } from 'react-icons/lu';
import { LANGUAGES, LANGUAGE_CODES } from '../../../../shared/languages.ts';
import { listJoin } from '../../../../shared/stats.ts';
import { ApiError, api, del, get, post } from '../../lib/api.ts';
import { discardOp, listQueue, retryFailed, type QueuedOp } from '../../lib/outbox.ts';
import { idb } from '../../lib/idb.ts';
import { Link } from '../../lib/router.tsx';
import { clearDeviceData, loadBootstrap, setState, toast, useApp } from '../../lib/store.ts';
import { bytes, dateTime, relative } from '../../lib/format.ts';
import { useSync } from '../../components/Shell.tsx';
import { Alert, AlertDescription } from '../../components/ui/alert.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog.tsx';
import { Field, FieldLabel } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../components/ui/menu.tsx';
import { Confirm, Group, type Ask } from './parts.tsx';

interface BackupInfo {
  file: string;
  kind: string;
  createdAt: number;
  sizeBytes: number;
  encrypted: boolean;
  integrity: string;
  counts: Record<string, number>;
  offsiteCopiedAt: number | null;
  note: string | null;
}

export function DataSettings() {
  return (
    <div className="flex flex-col gap-5">
      <SyncQueue />
      <Backups />
      <FrequentWords />
      <Vocabulary />
      <Exports />
      <OfflineData />
      <SystemInfo />
    </div>
  );
}

function SyncQueue() {
  const status = useSync();
  const [ops, setOps] = useState<QueuedOp[]>([]);
  useEffect(() => {
    void listQueue().then(setOps);
  }, [status.pending, status.failed]);
  const exportQueue = () => {
    const blob = new Blob([JSON.stringify(ops, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vocabbuilder-unsynced-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  const [ask, setAsk] = useState<Ask | null>(null);
  return (
    <Group
      title="Sync"
      description={
        ops.length > 0
          ? `${ops.length} change${ops.length === 1 ? '' : 's'} on this device ${ops.length === 1 ? 'is' : 'are'} not on the server yet.`
          : status.state === 'saved'
            ? `Everything on this device is saved to your server${status.lastSyncedAt ? ` (last sync ${relative(status.lastSyncedAt)})` : ''}.`
            : 'Waiting for your server.'
      }
    >
      {ops.length > 0 && (
        <>
          <ul className="divide-y rounded-xl border text-[0.9375rem]">
            {ops.slice(0, 50).map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="min-w-0">
                  {o.label} <span className="text-muted-foreground">{relative(o.createdAt)}</span>
                  {o.status === 'failed' && <span className="block text-sm text-destructive">{o.lastError}</span>}
                </span>
                {o.status === 'failed' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setAsk({
                        title: 'Discard this change?',
                        text: 'It is removed from this device for good and never reaches your server. Export the unsynced changes first if you might need it.',
                        action: 'Discard',
                        destructive: true,
                        run: () => void discardOp(o.id).then(async () => setOps(await listQueue())),
                      })
                    }
                  >
                    Discard
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void retryFailed().then(async () => setOps(await listQueue()))}>
              <LuRefreshCw aria-hidden="true" /> Sync now
            </Button>
            <Button variant="ghost" onClick={exportQueue}>
              Export unsynced changes
            </Button>
          </div>
        </>
      )}
      <Confirm ask={ask} onClose={() => setAsk(null)} />
    </Group>
  );
}

function Backups() {
  const [list, setList] = useState<BackupInfo[]>([]);
  const [cfg, setCfg] = useState<{ enabled: boolean; time: string; keepDaily: number; keepWeekly: number; keepMonthly: number; encrypted: boolean; offsite: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [restore, setRestore] = useState<BackupInfo | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const load = () =>
    get<{ backups: BackupInfo[]; settings: any }>('/api/backups')
      .then((r) => {
        setList(r.backups);
        setCfg(r.settings);
      })
      .catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);
  const run = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(label);
    try {
      await fn();
      if (done) toast(done, 'good');
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'bad');
    } finally {
      setBusy(null);
    }
  };
  const doRestore = async () => {
    if (!restore) return;
    await run(
      'restore',
      async () => {
        await post(`/api/backups/${encodeURIComponent(restore.file)}/restore`, { confirm: 'RESTORE' });
        setRestore(null);
        await clearDeviceData(); // cached sessions and dashboard data describe the replaced database
        toast('Backup restored. Please sign in again.', 'good');
        setState({ auth: 'login', boot: null });
      },
    );
  };
  const [ask, setAsk] = useState<Ask | null>(null);
  return (
    <Group
      title="Backups"
      description={
        cfg && (
          <>
            {cfg.enabled ? `Automatic backups run daily at ${cfg.time} in your timezone, keeping ${cfg.keepDaily} daily, ${cfg.keepWeekly} weekly and ${cfg.keepMonthly} monthly copies.` : 'Automatic backups are turned off on the server.'}{' '}
            {cfg.encrypted ? 'Backups are encrypted.' : 'Backups are not encrypted (set VB_BACKUP_PASSPHRASE to encrypt).'}{' '}
            {cfg.offsite ? 'A copy is written to your second backup location.' : 'No second location for copies is set up; see the backup guide.'}
          </>
        )
      }
    >
      <div className="flex flex-wrap gap-2">
        <Button disabled={!!busy} onClick={() => void run('create', () => post('/api/backups', { note: 'Manual backup' }), 'Backup created and verified.')}>
          {busy === 'create' ? 'Creating backup' : 'Back up now'}
        </Button>
        <Button variant="outline" disabled={!!busy} onClick={() => fileRef.current?.click()}>
          <LuUpload aria-hidden="true" /> Upload a backup file
        </Button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept=".gz,.enc,.sqlite"
          onChange={(e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) void run('upload', () => api('POST', `/api/backups/upload?filename=${encodeURIComponent(f.name)}`, f, { contentType: 'application/octet-stream' }), 'Backup uploaded and checked.');
          }}
        />
      </div>
      {list.length === 0 ? (
        <p className="text-muted-foreground">No backups yet.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {list.slice(0, 30).map((b) => (
            <li key={b.file} className="flex items-center justify-between gap-3 py-2.5 pr-2 pl-4">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                  {dateTime(b.createdAt)}
                  <Badge variant="secondary" className="font-normal">
                    {b.kind.replace('-', ' ')}
                  </Badge>
                </p>
                <p className="text-sm text-muted-foreground">
                  {bytes(b.sizeBytes)}, {(b.counts.review_logs ?? 0).toLocaleString('en')} reviews, {(b.counts.vocabulary_entries ?? 0).toLocaleString('en')} words{b.encrypted ? ', encrypted' : ''}
                  {b.integrity === 'ok' ? ', checked' : `, check: ${b.integrity}`}
                  {b.offsiteCopiedAt ? ', copied off the server' : ''}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon" disabled={!!busy} aria-label={`Backup of ${dateTime(b.createdAt)}: actions`}>
                      <LuEllipsis aria-hidden="true" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end" label="Backup actions">
                  <DropdownMenuItem render={<a href={`/api/backups/${encodeURIComponent(b.file)}/download`} download />}>
                    <LuDownload aria-hidden="true" /> Download
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      void run('verify', async () => {
                        const r = await post<{ ok: boolean; integrity: string; counts: Record<string, number> }>(`/api/backups/${encodeURIComponent(b.file)}/test-restore`);
                        toast(r.ok ? `Test restore OK: ${r.counts.review_logs} reviews, ${r.counts.vocabulary_entries} words readable.` : `Test restore failed: ${r.integrity}`, r.ok ? 'good' : 'bad');
                      })
                    }
                  >
                    <LuFlaskConical aria-hidden="true" /> Test restore
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      setRestore(b);
                      setConfirmText('');
                    }}
                  >
                    <LuRotateCcw aria-hidden="true" /> Restore
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() =>
                      setAsk({
                        title: 'Delete this backup?',
                        text: `The backup file from ${dateTime(b.createdAt)} is removed from the server.`,
                        action: 'Delete',
                        destructive: true,
                        run: () => void run('delete', () => del(`/api/backups/${encodeURIComponent(b.file)}`)),
                      })
                    }
                  >
                    <LuTrash2 aria-hidden="true" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!restore} onOpenChange={(v) => !v && setRestore(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore this backup?</DialogTitle>
            {restore && (
              <DialogDescription>
                Your current data will be replaced by the backup from <strong className="text-foreground">{dateTime(restore.createdAt)}</strong> ({(restore.counts.review_logs ?? 0).toLocaleString('en')} reviews). A safety backup of the current data is made first, so this can be undone.
              </DialogDescription>
            )}
          </DialogHeader>
          <Field className="gap-1.5">
            <FieldLabel htmlFor="confirm-restore">Type RESTORE to confirm</FieldLabel>
            <Input id="confirm-restore" autoComplete="off" autoCapitalize="characters" value={confirmText} onChange={(e) => setConfirmText((e.target as HTMLInputElement).value)} />
          </Field>
          <DialogFooter>
            <Button variant="destructive" size="lg" disabled={confirmText !== 'RESTORE' || !!busy} onClick={() => void doRestore()}>
              {busy === 'restore' ? 'Restoring' : 'Restore backup'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Confirm ask={ask} onClose={() => setAsk(null)} />
    </Group>
  );
}

function FrequentWords() {
  const boot = useApp((st) => st.boot);
  const [busy, setBusy] = useState<string | null>(null);
  const load = async (code: (typeof LANGUAGE_CODES)[number]) => {
    setBusy(code);
    try {
      const r = await post<{ stats: { created: number; merged: number } }>('/api/import/frequency-set', { language: code });
      toast(`${LANGUAGES[code].name}: ${r.stats.created.toLocaleString('en')} words added, ${r.stats.merged.toLocaleString('en')} existing words updated.`, 'good');
      void loadBootstrap();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'bad');
    } finally {
      setBusy(null);
    }
  };
  const update = async (code: (typeof LANGUAGE_CODES)[number]) => {
    setBusy(code);
    try {
      const r = await post<{ stats: { created: number; refreshed: number; keptEdited: number; removed?: number; keptStarted?: number } }>('/api/import/frequency-set/update', { language: code });
      const parts = [`${r.stats.refreshed.toLocaleString('en')} words updated`];
      if (r.stats.created) parts.push(`${r.stats.created.toLocaleString('en')} words added`);
      if (r.stats.keptEdited) parts.push(`${r.stats.keptEdited.toLocaleString('en')} words you edited kept as they are`);
      if (r.stats.removed) parts.push(`${r.stats.removed.toLocaleString('en')} words removed (no longer in the set)`);
      if (r.stats.keptStarted) parts.push(`${r.stats.keptStarted.toLocaleString('en')} words kept that you’ve started or added to (no longer in the set)`);
      toast(`${LANGUAGES[code].name}: ${parts.join(', ')}.`, 'good');
      void loadBootstrap();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'bad');
    } finally {
      setBusy(null);
    }
  };
  const sets = (boot?.languages ?? []).filter((l) => l.frequencySet);
  if (!sets.length) return null;
  const updates = sets.filter((l) => l.frequencySet!.loaded && l.frequencySet!.updateAvailable);
  return (
    <Group
      title="Most frequent words"
      description="Each set holds a language’s most frequent words, ranked by an open frequency list, with meanings from English Wiktionary (for Ukrainian words Wiktionary lacks, from a fallback dictionary; those words are tagged fallback-dictionary). New words come in frequency order, a few each day. Words you already have are updated, not duplicated, and you can undo the import from the list of recent imports."
    >
      {updates.length > 0 && (
        <Alert variant="info" data-testid="set-updates">
          <LuRefreshCw aria-hidden="true" />
          <AlertDescription>
            A newer version of your {listJoin(updates.map((l) => LANGUAGES[l.code].name))} words is ready, with the corrections, sentences and word tables added since you loaded {updates.length === 1 ? 'them' : 'each set'}. Updating keeps your progress and any words
            you edited, and keeps a word that was taken out if you’ve started learning it. A backup is made first.
          </AlertDescription>
        </Alert>
      )}
      <ul className="divide-y rounded-xl border">
        {sets.map((l) => (
          <li key={l.code} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                {LANGUAGES[l.code].flag} {LANGUAGES[l.code].name}: {l.frequencySet!.words.toLocaleString('en')} words
                {l.frequencySet!.loaded && l.frequencySet!.updateAvailable && (
                  <Badge variant="soft" className="font-medium">
                    Update ready
                  </Badge>
                )}
              </div>
              <a className="rounded text-sm text-muted-foreground underline decoration-dotted underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" href={`/api/import/frequency-sets/${l.code}/report`} target="_blank" rel="noopener">
                Sources and skipped words
              </a>
            </div>
            {l.frequencySet!.loaded && l.frequencySet!.updateAvailable ? (
              <Button variant="outline" disabled={!!busy} onClick={() => void update(l.code)}>
                {busy === l.code ? 'Updating words' : 'Update'}
              </Button>
            ) : l.frequencySet!.loaded ? (
              <Badge variant="success">Loaded</Badge>
            ) : (
              <Button variant="outline" disabled={!!busy} onClick={() => void load(l.code)}>
                {busy === l.code ? 'Adding words' : 'Load'}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Group>
  );
}

function Vocabulary() {
  const [busy, setBusy] = useState<string | null>(null);
  const loadStarter = async (code: (typeof LANGUAGE_CODES)[number]) => {
    setBusy(code);
    try {
      const r = await post<{ stats: { created: number; skipped: number } }>('/api/import/starter', { language: code });
      toast(`${LANGUAGES[code].name}: ${r.stats.created} words added, ${r.stats.skipped} already present.`, 'good');
      void loadBootstrap();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : String(err), 'bad');
    } finally {
      setBusy(null);
    }
  };
  return (
    <Group
      title="Your own lists and starter sets"
      description="Import frequency-ranked lists or dictionaries (CSV, TSV, JSON, JSONL, Kaikki/Wiktextract), or load a small starter set. The starter sets were written by an AI assistant: useful to begin with, not drawn from a corpus. Review and edit them freely."
    >
      <Button className="self-start" render={<Link to="/import" />}>
        <LuUpload aria-hidden="true" /> Import words
      </Button>
      <div className="flex flex-wrap gap-2">
        {LANGUAGE_CODES.map((c) => (
          <Button key={c} variant="outline" size="sm" disabled={!!busy} onClick={() => void loadStarter(c)}>
            {LANGUAGES[c].flag} {busy === c ? 'Loading' : `${LANGUAGES[c].name} starter set`}
          </Button>
        ))}
      </div>
    </Group>
  );
}

function Exports() {
  return (
    <Group title="Export" description="Download your data in open formats.">
      <Button variant="outline" className="self-start" render={<a href="/api/export/progress" download />}>
        <LuDownload aria-hidden="true" /> All learning progress (JSON)
      </Button>
      <ul className="divide-y rounded-xl border">
        {LANGUAGE_CODES.map((c) => (
          <li key={c} className="flex flex-wrap items-center justify-between gap-2 py-1.5 pr-2 pl-4">
            <span className="text-[0.9375rem]">
              {LANGUAGES[c].flag} {LANGUAGES[c].name} words
            </span>
            <span className="flex gap-1">
              <Button variant="ghost" size="sm" render={<a href={`/api/export/vocabulary?lang=${c}&format=csv`} download aria-label={`${LANGUAGES[c].name} words (CSV)`} />}>
                CSV
              </Button>
              <Button variant="ghost" size="sm" render={<a href={`/api/export/vocabulary?lang=${c}&format=json`} download title="Full word data in the import format" aria-label={`${LANGUAGES[c].name} words (JSON)`} />}>
                JSON
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Group>
  );
}

function OfflineData() {
  const [count, setCount] = useState<number | null>(null);
  const load = () => idb.getAll<any>('sessions').then((s) => setCount(s.length)).catch(() => setCount(null));
  useEffect(() => {
    void load();
  }, []);
  return (
    <Group
      title="Offline data on this device"
      description={
        <>
          {count == null ? 'Offline storage is unavailable in this browser.' : `${count} study session${count === 1 ? '' : 's'} kept for offline use.`} Forvo recordings are never stored offline; your own uploaded recordings can play offline after you have heard them once online.
        </>
      }
    >
      {count ? (
        <Button
          variant="outline"
          className="self-start"
          onClick={async () => {
            await idb.clear('sessions');
            void load();
            toast('Stored sessions removed from this device. Nothing on the server was changed.');
          }}
        >
          Clear stored sessions
        </Button>
      ) : null}
    </Group>
  );
}

function SystemInfo() {
  const [info, setInfo] = useState<any>(null);
  useEffect(() => {
    get('/api/system').then(setInfo).catch(() => undefined);
  }, []);
  if (!info) return null;
  return (
    <p className="px-1 text-sm text-muted-foreground">
      VocabBuilder {info.version}, database schema {info.schemaVersion}, timezone {info.timezone}. Last backup: {info.backups.last ? dateTime(info.backups.last.createdAt) : 'none yet'}. Web build {__BUILD_ID__}.
    </p>
  );
}
