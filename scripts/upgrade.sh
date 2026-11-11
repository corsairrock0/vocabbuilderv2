#!/usr/bin/env bash
# © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
# Upgrade VocabBuilder safely: verified pre-upgrade backup → update source → rebuild → restart →
# wait for the health check. Database migrations run automatically on start and make their own
# pre-migration backup as well.
#
#   scripts/upgrade.sh                                     git checkout: pull and upgrade
#   scripts/upgrade.sh path/to/vocabbuilder-1.1.0.tar.gz   extract a release archive over this directory
#   scripts/upgrade.sh --no-pull                           rebuild the source already present here
#   scripts/upgrade.sh --no-build                          restart only (image built elsewhere)
#
# Your data lives in Docker volumes and is never touched by an upgrade; .env is kept.
# UPGRADE_SERVICES="app" limits which services are (re)started (default: all).
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=${COMPOSE:-docker compose}
CLI=(node --disable-warning=ExperimentalWarning server/cli.ts)
read -r -a SERVICES <<< "${UPGRADE_SERVICES:-}"

pull=1
build=1
archive=""
for a in "$@"; do
  case "$a" in
    --no-pull) pull=0 ;;
    --no-build) build=0 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) archive=$a ;;
  esac
done

version() { sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' package.json | head -n 1; }
prev_version=$(version)
prev_commit=$(git rev-parse --short HEAD 2>/dev/null || echo "")
backup_file=""

rollback() {
  echo
  echo "To roll back:"
  if [ -n "$prev_commit" ]; then echo "  1. git checkout $prev_commit"; else echo "  1. Put the previous release files back (keep .env)"; fi
  echo "  2. $COMPOSE build app && $COMPOSE up -d"
  if [ -n "$backup_file" ]; then
    echo "  3. If the new version changed the database schema, restore the pre-upgrade backup:"
    echo "     scripts/restore.sh $backup_file"
  else
    echo "  3. If the database schema changed, restore the newest pre-migration backup (scripts/restore.sh <file>)."
  fi
}

fail() {
  echo "Upgrade problem: $1" >&2
  $COMPOSE logs --tail 60 app >&2 || true
  rollback
  exit 1
}

echo "Current version: $prev_version ${prev_commit:+(commit $prev_commit)}"
if [ -n "$($COMPOSE ps -q --status running app 2>/dev/null)" ]; then
  echo "Creating a verified pre-upgrade backup…"
  out=$($COMPOSE exec -T app "${CLI[@]}" backup create --kind pre-upgrade "Before upgrading from v$prev_version") || { echo "$out"; echo "Pre-upgrade backup failed — nothing was changed." >&2; exit 1; }
  backup_file=$(printf '%s\n' "$out" | sed -n 's/^ *"file": *"\([^"]*\)".*/\1/p' | head -n 1)
  [ -n "$backup_file" ] || { echo "$out"; echo "Pre-upgrade backup failed — nothing was changed." >&2; exit 1; }
  echo "Pre-upgrade backup: $backup_file"
else
  echo "The app is not running, so no pre-upgrade backup was made here (migrations still create a pre-migration backup)."
fi

if [ -n "$archive" ]; then
  [ -f "$archive" ] || { echo "Archive not found: $archive" >&2; exit 1; }
  echo "Extracting $archive…"
  tar -xzf "$archive" --strip-components=1 --exclude='./.env' --exclude='*/.env' -C .
elif [ "$pull" -eq 1 ] && [ -d .git ]; then
  echo "Pulling the latest version…"
  git pull --ff-only || fail "git pull failed (local changes?)"
fi
new_version=$(version)

if [ "$build" -eq 1 ]; then
  echo "Building v$new_version…"
  $COMPOSE build --pull app || fail "the image build failed; the running version was not replaced"
fi
$COMPOSE up -d "${SERVICES[@]}" || fail "docker compose up failed"

echo "Waiting for the app to become healthy (migrations may take a moment)…"
status=unknown
for _ in $(seq 1 90); do
  cid=$($COMPOSE ps -q app)
  status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo unknown)
  [ "$status" = "healthy" ] && break
  sleep 2
done
[ "$status" = "healthy" ] || fail "the app is '$status' after the upgrade"

health=$($COMPOSE exec -T app node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>r.text()).then(t=>console.log(t))" 2>/dev/null || true)
echo "Upgrade complete: v$prev_version → v$new_version  $health"
rollback
