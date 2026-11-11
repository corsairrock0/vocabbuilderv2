// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
import type { AddressInfo } from 'node:net';
import { loadConfig, type Config } from './config.ts';
import { Db } from './db/database.ts';
import { migrate } from './db/migrate.ts';
import { errorFields, log, setLogLevel } from './log.ts';
import { createAppServer, type App } from './app.ts';
import { ForvoClient } from './audio/forvo.ts';
import { BackupService } from './backup/backup.ts';
import { prepareSetupToken, pruneExpiredSessions } from './auth/auth.ts';
import { getTimezone } from './services/settings.ts';
import { finalizeStaleSessions } from './learning/sessions.ts';
import { linkStarterSentences, removeBundledSetCopies } from './vocab/importer.ts';
import { LANGUAGE_CODES } from '../shared/languages.ts';
import { COPYRIGHT } from '../shared/legal.ts';

export interface RunningServer {
  app: App;
  url: string;
  setupToken: string | null;
  stop: () => Promise<void>;
}

export async function openApp(config: Config, opts: { migrate?: boolean } = {}): Promise<App> {
  // Everything VocabBuilder writes (database, backups, uploads) is private to the service account.
  process.umask(0o077);
  const db = new Db(config.dbFile);
  const backups = new BackupService(config, () => db);
  backups.timezone = () => {
    try {
      return getTimezone(db, config.defaultTimezone);
    } catch {
      return config.defaultTimezone;
    }
  };
  if (opts.migrate !== false) await migrate(db, {
    beforeApply: async (status) => {
      log.info('creating pre-migration backup', { from: status.current, to: status.latest });
      await backups.create('pre-migration', `Before migrating schema ${status.current} → ${status.latest}`);
    },
  });
  const forvo = new ForvoClient(config.forvo, db);
  return { config, db, forvo, backups, maintenance: { active: false, reason: null } };
}

function housekeeping(app: App) {
  const now = Date.now();
  try {
    pruneExpiredSessions(app.db, now);
    app.db.tx(() => app.db.run('DELETE FROM idempotency_keys WHERE created_at < ?', now - 30 * 86_400_000));
    finalizeStaleSessions(app, now);
  } catch (err) {
    log.error('housekeeping failed', errorFields(err));
  }
}

export async function startServer(config: Config = loadConfig()): Promise<RunningServer> {
  setLogLevel(config.logLevel);
  const app = await openApp(config);
  const setupToken = prepareSetupToken(app.db, config);
  housekeeping(app);
  try {
    const removed = removeBundledSetCopies(app);
    if (removed) log.info('removed stored copies of bundled word sets', { files: removed });
    // Starter sentences loaded by an earlier version learn which meaning they show.
    let linked = 0;
    for (const code of LANGUAGE_CODES) linked += linkStarterSentences(app, code);
    if (linked) log.info('linked starter sentences to their meanings', { sentences: linked });
    // The starter sets are Lango's own content; versions before 1.6.0 marked them CC0.
    app.db.run(
      "UPDATE sources SET license = ? WHERE kind = 'curated' AND name LIKE 'VocabBuilder starter set (%' AND license = 'CC0-1.0'",
      `${COPYRIGHT}`,
    );
  } catch (err) {
    log.error('could not tidy bundled word sets', errorFields(err));
  }
  const { server, closeAll } = createAppServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  const url = `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${addr.port}`;
  app.backups.startScheduler();
  const timer = setInterval(() => housekeeping(app), 3600_000);
  timer.unref();
  log.info('VocabBuilder started', { url, version: config.version, dataDir: config.dataDir, env: config.env, forvo: app.forvo.configured });
  if (setupToken && config.env !== 'test') {
    process.stdout.write(
      `\n==============================================================\n` +
        ` VocabBuilder first-run setup code: ${setupToken}\n` +
        ` Open the app in your browser and enter this code to create\n` +
        ` the owner account. (Set VB_SETUP_TOKEN to choose your own.)\n` +
        `==============================================================\n\n`,
    );
  }
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    app.backups.stopScheduler();
    await closeAll();
    app.db.close();
    log.info('VocabBuilder stopped');
  };
  return { app, url, setupToken, stop };
}
