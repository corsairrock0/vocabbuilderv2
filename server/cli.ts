// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/**
 * VocabBuilder command-line tools (run inside the container: `docker compose exec app node server/cli.ts …`).
 *
 *   status                         schema version, row counts, last backup
 *   migrate                        apply pending migrations (with a pre-migration backup)
 *   backup create [note] [--kind manual|pre-upgrade]   create a verified backup now
 *   backup list                    list backups
 *   backup verify <file>|--all     integrity + checksum verification
 *   backup test-restore <file>     restore into a scratch database and report row counts (recovery drill)
 *   backup restore <file> --yes    restore into the live database (stop the app first: docker compose stop app).
 *                                  If the live database is damaged and cannot be opened, it is kept as *.damaged-<time>.
 *   Backup commands never migrate the live database, so an older version can still list and restore backups.
 *   set-password <username>        reset the owner password (reads the new password from VB_NEW_PASSWORD or stdin)
 *   import <file> --lang <code> [--format auto|csv|tsv|json|jsonl|kaikki|vocabbuilder] [--limit N]
 *   import-frequency <file> --lang <code> [--kind spoken|subtitles|written|mixed] [--name "Source name"]
 *   import-starter [<code>|all]    load the bundled curated starter sets
 *   export-progress <out.json>     write a full progress export
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.ts';
import { openApp } from './main.ts';
import { migrationStatus, schemaVersion } from './db/migrate.ts';
import { hashPassword, passwordProblems } from './auth/password.ts';
import { commitImport, createImportJob, importStarter, validateImport } from './vocab/importer.ts';
import { isLanguageCode, LANGUAGE_CODES, type LanguageCode } from '../shared/languages.ts';
import { setLogLevel } from './log.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main() {
  const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1] === '--kind'));
  const [cmd, sub, third] = positional;
  const config = loadConfig();
  setLogLevel('warn');
  if (cmd === 'backup' && sub === 'restore') {
    if (!process.argv.includes('--yes')) throw new Error('Restoring replaces the live database. Stop the app first, then re-run with --yes.');
    if (!third) throw new Error('Usage: backup restore <file> --yes');
    let opened: Awaited<ReturnType<typeof openApp>> | null = null;
    try {
      opened = await openApp(config, { migrate: false });
      opened.db.get('SELECT COUNT(*) AS n FROM sqlite_master');
    } catch (err) {
      opened?.db.close();
      opened = null;
      console.error(`The live database could not be opened (${err instanceof Error ? err.message : err}); restoring over it and keeping the damaged file.`);
      const { BackupService } = await import('./backup/backup.ts');
      const result = await new BackupService(config, () => {
        throw new Error('no database');
      }).restoreOverDamaged(third, config.dbFile);
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    try {
      console.log(JSON.stringify(await opened.backups.restore(third, opened.db), null, 2));
    } finally {
      opened.db.close();
    }
    return;
  }
  const app = await openApp(config, { migrate: cmd !== 'backup' });
  const db = app.db;
  const out = (x: unknown) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));
  const langArg = (): LanguageCode => {
    const l = arg('--lang');
    if (!l || !isLanguageCode(l)) throw new Error(`--lang must be one of ${LANGUAGE_CODES.join(', ')}`);
    return l;
  };
  try {
    switch (cmd) {
      case 'status': {
        const counts: Record<string, number> = {};
        for (const t of ['vocabulary_entries', 'learning_items', 'review_logs', 'exercise_attempts', 'study_sessions']) counts[t] = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n;
        out({ version: config.version, schema: schemaVersion(db), pending: migrationStatus(db).pending.map((m) => m.name), dataDir: config.dataDir, counts, lastBackup: app.backups.lastBackup() });
        break;
      }
      case 'migrate':
        out({ schema: schemaVersion(db), status: 'up to date' });
        break;
      case 'backup': {
        if (sub === 'create') {
          const kind = arg('--kind') ?? 'manual';
          if (kind !== 'manual' && kind !== 'pre-upgrade') throw new Error('--kind must be manual or pre-upgrade');
          out(await app.backups.create(kind, third ?? null));
        }
        else if (sub === 'list') out(app.backups.list().map((b) => ({ file: b.file, kind: b.kind, createdAt: new Date(b.createdAt).toISOString(), sizeBytes: b.sizeBytes, encrypted: b.encrypted, reviews: b.counts.review_logs })));
        else if (sub === 'verify') {
          if (!third && !process.argv.includes('--all')) throw new Error('Usage: backup verify <file>|--all');
          const files = process.argv.includes('--all') ? app.backups.list().map((b) => b.file) : [third!];
          let failed = 0;
          for (const f of files) {
            const r = app.backups.verify(f);
            if (!r.ok) failed++;
            out({ file: f, ...r });
          }
          if (failed) process.exitCode = 1;
        } else if (sub === 'test-restore') out(app.backups.testRestore(third!));
        else throw new Error('Usage: backup create|list|verify|test-restore|restore');
        break;
      }
      case 'set-password': {
        const username = sub;
        if (!username) throw new Error('Usage: set-password <username>  (new password via VB_NEW_PASSWORD or stdin)');
        const password = process.env.VB_NEW_PASSWORD || (await readStdin());
        const problems = passwordProblems(password);
        if (problems.length) throw new Error(problems.join(' '));
        const hash = await hashPassword(password);
        const now = Date.now();
        db.tx(() => {
          db.run(
            `INSERT INTO users (id, username, password_hash, created_at, updated_at, password_changed_at) VALUES (1, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET username = excluded.username, password_hash = excluded.password_hash, updated_at = excluded.updated_at, password_changed_at = excluded.password_changed_at`,
            username,
            hash,
            now,
            now,
            now,
          );
          db.run('DELETE FROM auth_sessions');
          db.run("DELETE FROM app_meta WHERE key = 'setup_token_hash'");
        });
        out('Password updated; all devices were signed out.');
        break;
      }
      case 'import':
      case 'import-frequency': {
        const file = sub;
        if (!file) throw new Error('Usage: import <file> --lang <code>');
        const language = langArg();
        const job = createImportJob(app, { language, kind: cmd === 'import' ? 'vocabulary' : 'frequency', fileName: path.basename(file), data: readFileSync(file), now: Date.now() });
        const mapping = job.suggestedMapping ?? {};
        const limit = arg('--limit') ? Number(arg('--limit')) : undefined;
        const kind = arg('--kind');
        const options = {
          limit,
          sourceName: arg('--name'),
          frequencyKind: kind ? (`frequency_${kind}` as 'frequency_spoken') : undefined,
        };
        const v = validateImport(app, job.id, mapping, options);
        out({ format: job.format, mapping, validation: v.report && 'total' in v.report ? { ...v.report, errors: (v.report as any).errors?.slice?.(0, 5) } : v });
        out(commitImport(app, job.id, mapping, options, Date.now()));
        break;
      }
      case 'import-starter': {
        const which = !sub || sub === 'all' ? LANGUAGE_CODES : [sub];
        for (const l of which) {
          if (!isLanguageCode(l)) throw new Error(`Unknown language ${l}`);
          try {
            out({ language: l, ...importStarter(app, l, Date.now()) });
          } catch (err) {
            out({ language: l, error: (err as Error).message });
          }
        }
        break;
      }
      case 'export-progress': {
        if (!sub) throw new Error('Usage: export-progress <out.json>');
        const tables = ['learning_items', 'fsrs_cards', 'review_logs', 'exercise_attempts', 'skill_evidence', 'daily_stats', 'user_settings', 'language_settings', 'entry_user_data'];
        const data: Record<string, unknown[]> = {};
        for (const t of tables) data[t] = db.all(`SELECT * FROM ${t}`);
        writeFileSync(sub, JSON.stringify({ format: 'vocabbuilder-progress-v1', exportedAt: new Date().toISOString(), data }));
        out(`Wrote ${sub}`);
        break;
      }
      default:
        out(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''));
        if (cmd) process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
