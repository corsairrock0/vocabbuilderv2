# Backups and restoration

Your learning history is the valuable part of VocabBuilder. This page explains what is backed up, where, how to check it, and how to restore it.

## What a backup contains

A backup is a consistent snapshot of the SQLite database `/data/vocabbuilder.sqlite`. It contains everything stored in the database:

- all vocabulary (imported datasets, starter sets, your custom words, edits, notes and mnemonics);
- learning progress per language: FSRS card states, the **complete review history**, every exercise attempt, per-skill evidence, study sessions (including unfinished ones), and daily statistics;
- settings: global settings, per-language preferences, accent preferences, preferred recordings and speaker notes;
- the owner account and active sign-ins.

Not included, because they are files rather than database rows:

- **your own pronunciation recordings** in `/data/audio` (copy them with `scripts/offsite-sync.sh --include-audio`, or back up the `vocabbuilder_vb_data` volume);
- uploaded import files in `/data/imports` (you still have the originals);
- `.env` (keep a copy of it, and of `VB_BACKUP_PASSPHRASE`, in your password manager).

## How backups are made

- **Method:** SQLite's online backup API. This is safe while the app is running and while you study.
- **Verification:** every new backup is opened and checked with `PRAGMA integrity_check` before it is kept. Its row counts and SHA-256 checksum are recorded in a `.json` file next to it.
- **Format:** `vocabbuilder-<UTC time>-<kind>.sqlite.gz`, gzip-compressed. With `VB_BACKUP_PASSPHRASE` set it becomes `….sqlite.gz.enc`, encrypted with AES-256-GCM using a key derived with scrypt.
- **Kinds:**

| Kind | When |
|---|---|
| `scheduled` | daily at `VB_BACKUP_TIME` (default 03:30) in your configured timezone. If the server was off at that time, a catch-up backup runs a minute after the next start. |
| `manual` | Settings → Data and backups → *Back up now*, `scripts/backup.sh`, or `server/cli.ts backup create` |
| `pre-upgrade` | `scripts/upgrade.sh`, before it changes anything (`server/cli.ts backup create --kind pre-upgrade`) |
| `pre-migration` | automatically, before a new version changes the database schema |
| `pre-restore` | automatically, before any restore replaces the current data |

- **Retention** (grandfather-father-son) for scheduled backups: the newest backup of each of the last `VB_BACKUP_KEEP_DAILY` days (14), `VB_BACKUP_KEEP_WEEKLY` weeks (8) and `VB_BACKUP_KEEP_MONTHLY` months (12). The newest 20 manual, pre-upgrade, pre-migration and pre-restore backups are kept.
- **File permissions:** backup files and their `.json` metadata are written owner-only (mode 600); they contain your password hash and all learning data.

## Keep a copy away from the server

Backups in the `vocabbuilder_vb_backups` volume sit on the same disk as the database. Keep at least one copy elsewhere. Pick one or more of these options:

1. **Second disk or NAS mount:** mount it into the app container (see the commented `/offsite` line in `docker-compose.yml`) and set `VB_OFFSITE_BACKUP_DIR=/offsite` in `.env`. Every backup is then copied there and checked against its checksum. The host directory must be writable by uid 1000: `sudo chown 1000:1000 /mnt/backup-disk/vocabbuilder`.
2. **Cloud or any rclone remote:** `scripts/offsite-sync.sh b2:my-bucket/vocabbuilder` copies new backups with [rclone](https://rclone.org/), never deleting remote files, then verifies them with `rclone check`. Add `--include-audio` to copy your recordings too. Run it daily from root's crontab after the backup time:
   ```
   15 4 * * * /opt/vocabbuilder/scripts/offsite-sync.sh b2:my-bucket/vocabbuilder --include-audio >> /var/log/vocabbuilder-offsite.log 2>&1
   ```
   Set `VB_BACKUP_PASSPHRASE` (or use an rclone *crypt* remote) so copies stored with a provider are encrypted.
3. **Download:** Settings → Data and backups → *Download*, or `scripts/backup.sh --copy-to ~/vocab-backups`.

## Checking backups

```bash
CLI="docker compose exec app node --disable-warning=ExperimentalWarning server/cli.ts"
$CLI backup list                         # newest first, with kind, size and review count
$CLI backup verify --all                 # checksum + integrity check of every backup
$CLI backup test-restore <file>          # recovery drill (see below)
```

### Recovery drill (recommended monthly)

`backup test-restore <file>` decompresses (and decrypts) a backup into a scratch database, runs the integrity check, and prints row counts such as `review_logs` and `exercise_attempts`. The live data is never touched. Compare the counts with Statistics in the app. Settings → Data and backups → *Test restore* does the same.

A full drill on a second machine proves that your off-server copy really works:

```bash
# on a spare machine or VM with Docker
git clone <your repo or extract the release> vocab-drill && cd vocab-drill
cp /path/to/your/.env .env                     # same VB_BACKUP_PASSPHRASE if backups are encrypted
docker compose up -d --build app               # Caddy is not needed for the drill
scripts/restore.sh --yes /path/to/vocabbuilder-…-scheduled.sqlite.gz
docker compose exec app node --disable-warning=ExperimentalWarning server/cli.ts status
docker compose down -v                         # remove the drill completely
```

## Restoring

Every restore first verifies the backup, then creates a `pre-restore` backup of the current data, so a restore can itself be undone. After a restore, sign in again on each device: sign-ins are part of the restored data.

### In the app (no downtime)

Settings → Data and backups → choose a backup → *Restore* → type `RESTORE` to confirm. The app pauses requests for a few seconds while it swaps the database, runs any needed migrations, and reopens. Every device is then signed out and signs in again (sign-ins stored inside the backup are not restored). You can also upload a backup file from your computer there (for example when moving to a new server).

### With the script

```bash
scripts/restore.sh vocabbuilder-2026-11-05T01-30-00-000Z-scheduled.sqlite.gz   # a backup in the volume
scripts/restore.sh /home/me/vocabbuilder-….sqlite.gz                         # a file on the host (copied in first)
```

The script verifies the backup in a scratch database, asks for confirmation (`--yes` skips the prompt), stops the app, restores (with a pre-restore backup), starts the app, and waits for the health check. Encrypted backups need the same `VB_BACKUP_PASSPHRASE` in `.env`.

The backup is verified without opening the live database. If the normal restore cannot run, the script falls back to putting the backup file in place directly. This happens when **rolling back after an upgrade** (the older version cannot open a database that a newer version already migrated) or when **the live database is damaged**. The current database files are kept as `vocabbuilder.sqlite.before-rollback-<time>`, and the app applies any needed migrations when it starts. Delete the `before-rollback` files once you are satisfied.

### Moving to a new server

1. Old server: `scripts/backup.sh --copy-to ~/move` (or download a backup in the app). Copy your recordings with `scripts/offsite-sync.sh /path --include-audio` if you have any.
2. New server: install as in [DEPLOYMENT.md](DEPLOYMENT.md) with your old `.env`, then `scripts/restore.sh --yes ~/move/vocabbuilder-…sqlite.gz`. Copy recordings into the data volume with `docker compose cp ./audio/. app:/data/audio/`.
3. Point DNS at the new server.

## If the database is damaged

Symptoms: the app restarts in a loop with errors such as `file is not a database` or `database disk image is malformed`.

1. List the backups (this does not open the database): `scripts/restore.sh`
2. Restore the newest one: `scripts/restore.sh <file>`. It is verified first; the damaged files are kept as `vocabbuilder.sqlite.before-rollback-<time>`. If it fails verification, try the next older backup.

Without any backup, a copy of the volume (`docker run --rm -v vocabbuilder_vb_data:/d -v "$PWD":/out alpine tar czf /out/data.tgz -C /d .`) preserves the damaged files for expert recovery with the `sqlite3 .recover` command.
