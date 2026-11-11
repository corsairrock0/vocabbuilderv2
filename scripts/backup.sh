#!/usr/bin/env bash
# © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
# Create a verified VocabBuilder backup now (runs inside the running app container).
#
#   scripts/backup.sh                       backup with the note "manual backup"
#   scripts/backup.sh "before big import"   backup with your own note
#   scripts/backup.sh --copy-to DIR [note]  also copy the backup file and its metadata out of
#                                           the Docker volume into DIR on this host
#
# Daily backups happen automatically (VB_BACKUP_TIME); see docs/BACKUP_RESTORE.md.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=${COMPOSE:-docker compose}
CLI=(node --disable-warning=ExperimentalWarning server/cli.ts)

copy_to=""
note="manual backup"
while [ $# -gt 0 ]; do
  case "$1" in
    --copy-to) copy_to=${2:?--copy-to needs a directory}; shift 2 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) note=$1; shift ;;
  esac
done

if [ -z "$($COMPOSE ps -q --status running app 2>/dev/null)" ]; then
  echo "The app container is not running. Start it with: $COMPOSE up -d" >&2
  exit 1
fi

out=$($COMPOSE exec -T app "${CLI[@]}" backup create "$note")
echo "$out"
file=$(printf '%s\n' "$out" | sed -n 's/^ *"file": *"\([^"]*\)".*/\1/p' | head -n 1)
if [ -z "$file" ]; then
  echo "Could not determine the backup file name from the output above." >&2
  exit 1
fi
echo "Backup created and verified: $file"

if [ -n "$copy_to" ]; then
  mkdir -p "$copy_to"
  $COMPOSE cp "app:/backups/$file" "$copy_to/"
  $COMPOSE cp "app:/backups/${file%%.sqlite*}.json" "$copy_to/" || true
  echo "Copied to $copy_to/$file"
fi
