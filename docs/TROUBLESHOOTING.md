# Troubleshooting

Start with:

```bash
docker compose ps                    # is app "healthy"? is caddy "Up"?
docker compose logs --tail 100 app   # JSON log lines; errors have "level":"error"
docker compose logs --tail 100 caddy
docker compose exec app node --disable-warning=ExperimentalWarning server/cli.ts status
```

## Installation and start-up

**`required variable VB_DOMAIN is missing a value`**: create `.env` from `.env.example` and set `VB_DOMAIN`.

**`env file .env not found`**: run Compose in the project directory, after `cp .env.example .env`.

**The build fails at `npm ci`**: the server needs internet access to the npm registry while building. Retry with `docker compose build --no-cache app`. ARM64 servers are supported; the right esbuild binary is selected automatically.

**`app` restarts in a loop**: read `docker compose logs app`. Common causes:

| Log message | Fix |
|---|---|
| `Database schema version N … is newer than this application supports` | You are running an older version against a database a newer version already migrated. Upgrade again, or roll back the data with `scripts/restore.sh <pre-upgrade or pre-migration backup>`. |
| `Migration … was modified after it was applied` | A migration file was edited. Restore the original file from the release you are running. |
| `EACCES` / `permission denied` on `/data`, `/backups` or `/offsite` | Bind-mounted host directories must be writable by uid 1000: `sudo chown -R 1000:1000 <dir>`. Named volumes set this up automatically. |
| `EADDRINUSE` | Another process uses the port. This only happens when you publish 3000 yourself. |

**Port 80 or 443 already in use** (Caddy will not start): stop the other web server (`sudo ss -tlpn 'sport = :443'`), or put VocabBuilder behind your existing proxy instead. In that case, remove the `caddy` service, publish the app on `127.0.0.1:3000`, and forward your proxy there with `X-Forwarded-For`/`-Proto` headers.

## HTTPS and certificates

**Caddy cannot obtain a certificate** (`docker compose logs caddy` shows ACME errors):

- check that DNS resolves to the server: `dig +short vocab.example.com`;
- check that ports 80 and 443 are open in the server firewall and at your provider (Let's Encrypt connects from the internet);
- after many failed attempts, Let's Encrypt rate-limits for a while. Fix the cause, then `docker compose restart caddy`.

**Browser warns about the certificate in LAN mode**: install Caddy's root certificate on that device (see DEPLOYMENT.md §3). Firefox has its own certificate store.

**The PWA cannot be installed, offline mode or recording is unavailable**: browsers allow these only on HTTPS (or `localhost`). Open the `https://` address.

## Signing in

**Lost the first-run setup code**: `docker compose logs app | grep -A1 "setup code"`. A new code is printed on every start until the owner account exists. Or set `VB_SETUP_TOKEN` in `.env` and run `docker compose up -d`.

**Forgot the password**:
`docker compose exec -T -e VB_NEW_PASSWORD='a new long passphrase' app node --disable-warning=ExperimentalWarning server/cli.ts set-password <username>` (signs out all devices).

**"Too many failed sign-in attempts"**: wait 15 minutes; the lock is per IP address. Many failures from anywhere lock sign-in for up to an hour. Restarting does not clear the lock, because attempts are stored in the database.

**"Security token missing or expired" (CSRF) or "Cross-origin request rejected"**: reload the page. If it persists, check that `VB_PUBLIC_ORIGIN` is exactly `https://<your domain>`, or leave it empty.

**Signed out after a restore**: expected; sign-ins are part of the restored data.

**Not staying signed in on plain HTTP (`http://localhost:3000`)**: keep `VB_COOKIE_SECURE=auto`. With `true`, browsers drop the cookie on non-HTTPS pages.

## Study data and sync

**A device shows old progress**: everything is saved on the server, and a device fetches changes when it regains focus or reconnects. Pull to refresh or reopen the app. If the sync indicator shows pending changes, keep the app open while online until it shows *Saved*.

**Study days, streaks or "due today" are off by a day**: set your timezone in Settings → General. The server uses it for local days.

**Importing a file fails**:

- save the file as UTF-8 (in Excel: *CSV UTF-8*);
- the file is larger than `VB_MAX_UPLOAD_MB`: raise the limit, or import with the CLI (DEPLOYMENT.md §4);
- "Choose which column contains …": map the word and English-meaning columns in the mapping step;
- a failed import is rolled back completely, so nothing partial is left behind.

**A word has no declension or conjugation table, or no example sentences**:

- Tables and sentences come with the most frequent words sets of version 1.2.0, and AI-written sentences for the
  remaining words with 1.2.1. A set loaded with an earlier version lacks them: undo it under *Recent imports* on the
  import page, then load it again (DEPLOYMENT.md §7). Words you have started keep their progress.
- Vietnamese words do not inflect, so Vietnamese has sentence practice but no tables.
- Some words have no table in any open source. Each set's report (Settings → Data and backups → *Sources and skipped
  words*) lists them. Since 1.8.3 every word of the sets has at least one sentence; a set loaded with an earlier
  version gets them with *Update* in Settings. You can add your own sentences on the word's edit page.

**Practice says nothing matches**: the drill only uses words with tables (or sentences). Choose *All words* rather
than *Words I'm learning*, or turn on more tenses, cases or persons.

## Pronunciation (Forvo)

| Message in the app | Meaning / fix |
|---|---|
| *Forvo is not configured* | Set `VB_FORVO_API_KEY` in `.env`, then `docker compose up -d`. |
| *Daily Forvo request limit reached* | `VB_FORVO_DAILY_LIMIT` was reached (lookups + plays). It resets at 22:00 UTC. Raise it only within your plan's limit. |
| *Forvo: …* (API error text) | Check the key and plan in your Forvo account, and that `VB_FORVO_API_BASE` matches your plan's host. |
| *No Forvo recording found* | Forvo has no recording for this word. Upload your own, or enable the labelled TTS fallback for the language. |
| Audio stops working after ~2 hours | Forvo links expire. The app fetches fresh links automatically; reopen the word if needed. |

## Backups

**"offsite backup copy failed" in the logs**: the `/offsite` mount is missing or not writable by uid 1000, or the disk is full. The main backup is still made.

**Restoring an encrypted backup fails with "Wrong backup passphrase"**: `VB_BACKUP_PASSPHRASE` must be exactly the passphrase that was set when the backup was made.

**Disk filling up**: lower the `VB_BACKUP_KEEP_*` values, and delete old files in `/data/imports` and any `vocabbuilder.sqlite.before-rollback-*` files you no longer need. Check usage with `docker system df -v`.

**Files ending in `-wal` and `-shm` next to the database**: these are normal SQLite write-ahead-log files. Never delete them while the app is running.

## Getting more detail

Set `VB_LOG_LEVEL=debug` in `.env` and run `docker compose up -d` to log every API request (method, path, status, duration; request bodies are never logged). Check the health endpoint from inside the container:
`docker compose exec app node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>r.text()).then(console.log)"`
