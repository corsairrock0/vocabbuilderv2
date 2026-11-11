#!/usr/bin/env bash
# © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
# Copy VocabBuilder backups to an independent location with rclone (another disk, a NAS, S3,
# Backblaze B2, …) so a copy survives the loss of this server.
#
#   scripts/offsite-sync.sh DEST [--source DIR] [--include-audio]
#
#   DEST             an rclone destination: "b2:my-bucket/vocabbuilder", "nas-sftp:backups/vocab",
#                    or a plain path such as /mnt/usb-disk/vocabbuilder
#   --source DIR     backup directory to copy (default: the Docker volume vocabbuilder_vb_backups)
#   --include-audio  also copy your own pronunciation recordings (/data/audio in vocabbuilder_vb_data);
#                    database backups do not contain audio files
#
# Uses `rclone copy` (never deletes anything at the destination), then `rclone check --one-way`
# to verify every local backup exists unchanged at the destination. Set VB_BACKUP_PASSPHRASE so
# the copies are encrypted, or use an rclone "crypt" remote. Reading Docker volumes needs root.
#
# Daily at 04:15 (after the default 03:30 backup), as root:
#   15 4 * * * /opt/vocabbuilder/scripts/offsite-sync.sh b2:bucket/vocabbuilder >> /var/log/vocabbuilder-offsite.log 2>&1
set -euo pipefail
RCLONE=${RCLONE:-rclone}
PROJECT=${COMPOSE_PROJECT_NAME:-vocabbuilder}

dest=""
src=""
audio=0
while [ $# -gt 0 ]; do
  case "$1" in
    --source) src=${2:?--source needs a directory}; shift 2 ;;
    --include-audio) audio=1; shift ;;
    -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
    *) dest=$1; shift ;;
  esac
done
[ -n "$dest" ] || { echo "Usage: scripts/offsite-sync.sh DEST [--source DIR] [--include-audio]" >&2; exit 1; }
command -v "$RCLONE" >/dev/null 2>&1 || { echo "rclone not found (install it: https://rclone.org/install/ or set RCLONE=/path/to/rclone)" >&2; exit 1; }

volume_path() { docker volume inspect -f '{{ .Mountpoint }}' "$1" 2>/dev/null; }
if [ -z "$src" ]; then
  src=$(volume_path "${PROJECT}_vb_backups") || true
  [ -n "$src" ] || { echo "Backup volume ${PROJECT}_vb_backups not found; pass --source DIR" >&2; exit 1; }
fi
[ -d "$src" ] || { echo "Source directory not found or not readable: $src" >&2; exit 1; }

echo "$(date -u +%FT%TZ) copying backups from $src to $dest/backups"
"$RCLONE" copy "$src" "$dest/backups" --include 'vocabbuilder-*'
"$RCLONE" check "$src" "$dest/backups" --one-way --include 'vocabbuilder-*'

if [ "$audio" -eq 1 ]; then
  data=$(volume_path "${PROJECT}_vb_data") || true
  if [ -n "$data" ] && [ -d "$data/audio" ]; then
    echo "$(date -u +%FT%TZ) copying recordings from $data/audio to $dest/audio"
    "$RCLONE" copy "$data/audio" "$dest/audio"
    "$RCLONE" check "$data/audio" "$dest/audio" --one-way
  else
    echo "No recordings directory found (nothing recorded yet)."
  fi
fi
echo "$(date -u +%FT%TZ) offsite copy verified"
