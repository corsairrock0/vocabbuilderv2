#!/usr/bin/env bash
# © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
# Restore a VocabBuilder backup into the live database.
#
#   scripts/restore.sh                                                 list available backups
#   scripts/restore.sh vocabbuilder-2026-11-05T01-30-00-000Z-scheduled.sqlite.gz
#   scripts/restore.sh /path/on/this/host/vocabbuilder-....sqlite.gz   (copied into the backup volume first)
#   scripts/restore.sh --yes <file>                                    (no confirmation prompt)
#
# Steps: copy (if needed) → verify the backup in a scratch database (the live database is not
# opened) → stop the app → restore (a pre-restore backup of the current data is made) → start
# the app → wait until it is healthy. Encrypted backups need VB_BACKUP_PASSPHRASE in .env.
#
# The CLI restore also handles rolling back an upgrade (backup commands never migrate the live
# database) and a damaged live database (kept as *.damaged-<time>). Should it still fail, the
# current database files are kept as *.before-rollback-<time> and the backup is put in place
# directly; the app applies any needed migrations when it starts.
#
# You can also restore from Settings → Data and backups in the app without stopping anything.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=${COMPOSE:-docker compose}
CLI=(node --disable-warning=ExperimentalWarning server/cli.ts)

yes=0
arg=""
for a in "$@"; do
  case "$a" in
    -y|--yes) yes=1 ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) arg=$a ;;
  esac
done
if [ -z "$arg" ]; then
  echo "Usage: scripts/restore.sh [--yes] <backup file name or path>"
  echo "Backups in the volume (newest first):"
  $COMPOSE run --rm --no-deps -T --entrypoint sh app -c 'cd /backups && ls -1r vocabbuilder-*.sqlite.gz* 2>/dev/null || echo "  (none)"'
  exit 1
fi

# Helper run inside the app image; it never opens the live database.
#   verify <file>       extract to a scratch file, integrity check, schema check, row counts
#   raw-restore <file>  keep the current database files (renamed) and put the backup in place
HELPER_JS='
const [mode, file] = process.argv.slice(1);
try {
const fs = await import("node:fs");
const { loadConfig } = await import("/app/server/config.ts");
const { BackupService, inspectDatabaseFile } = await import("/app/server/backup/backup.ts");
const { latestVersion } = await import("/app/server/db/migrate.ts");
const config = loadConfig();
const backups = new BackupService(config, () => { throw new Error("database not opened"); });
const staging = config.dbFile + (mode === "verify" ? ".verify-staging" : ".rollback-staging");
const cleanup = (p) => { for (const ext of ["", "-wal", "-shm"]) fs.rmSync(p + ext, { force: true }); };
cleanup(staging);
backups.extract(file, staging);
const info = inspectDatabaseFile(staging);
for (const ext of ["-wal", "-shm"]) fs.rmSync(staging + ext, { force: true });
if (info.integrity !== "ok") { cleanup(staging); console.error("Backup integrity check failed: " + info.integrity); process.exit(3); }
if (info.schemaVersion > latestVersion()) { cleanup(staging); console.error("This backup comes from a newer VocabBuilder (schema " + info.schemaVersion + "); upgrade the app first."); process.exit(4); }
if (mode === "verify") { cleanup(staging); console.log(JSON.stringify({ ok: true, schemaVersion: info.schemaVersion, counts: info.counts }, null, 2)); process.exit(0); }
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const kept = config.dbFile + ".before-rollback-" + stamp;
for (const ext of ["", "-wal", "-shm"]) if (fs.existsSync(config.dbFile + ext)) fs.renameSync(config.dbFile + ext, kept + ext);
fs.renameSync(staging, config.dbFile);
{ const { DatabaseSync } = await import("node:sqlite"); const d = new DatabaseSync(config.dbFile); try { d.exec("DELETE FROM auth_sessions"); } catch {} d.close(); }
console.log(JSON.stringify({ restored: file, schemaVersion: info.schemaVersion, counts: info.counts, previousDatabaseKeptAs: fs.existsSync(kept) ? kept : null }, null, 2));
} catch (err) { console.error("Error: " + (err && err.message ? err.message : err)); process.exit(1); }
'
helper() { $COMPOSE run --rm --no-deps -T --entrypoint node app --disable-warning=ExperimentalWarning --input-type=module -e "$HELPER_JS" "$@"; }

file=$(basename "$arg")
if [ -f "$arg" ]; then
  src_dir=$(cd "$(dirname "$arg")" && pwd)
  echo "Copying $file into the backup volume…"
  $COMPOSE run --rm --no-deps -T -v "$src_dir:/import:ro" --entrypoint cp app "/import/$file" /backups/
  sidecar="${file%%.sqlite*}.json"
  if [ -f "$src_dir/$sidecar" ]; then
    $COMPOSE run --rm --no-deps -T -v "$src_dir:/import:ro" --entrypoint cp app "/import/$sidecar" /backups/
  fi
fi

echo "Verifying $file in a scratch database (live data untouched)…"
helper verify "$file" || { echo "The backup could not be verified — nothing was changed." >&2; exit 1; }

if [ "$yes" -ne 1 ]; then
  printf 'Restore %s now? Current data is kept. Type RESTORE to continue: ' "$file"
  read -r answer
  [ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }
fi

echo "Stopping the app…"
$COMPOSE stop app
restore_ok=1
if ! $COMPOSE run --rm --no-deps -T app "${CLI[@]}" backup restore "$file" --yes; then
  echo
  echo "The normal restore could not run (see above). Putting the backup in place directly;"
  echo "the current database files are kept."
  helper raw-restore "$file" || restore_ok=0
fi
echo "Starting the app…"
$COMPOSE up -d app

status=unknown
for _ in $(seq 1 60); do
  cid=$($COMPOSE ps -q app)
  status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)
  [ "$status" = "healthy" ] && break
  sleep 2
done
echo "App status: $status"
if [ "$restore_ok" -ne 1 ]; then
  echo "Restore FAILED — the previous database was kept. See the output above." >&2
  exit 1
fi
if [ "$status" != "healthy" ]; then
  echo "The app did not become healthy; check: $COMPOSE logs --tail 100 app" >&2
  exit 1
fi
echo "Restore complete. Every device has been signed out: sign in again on each one."
