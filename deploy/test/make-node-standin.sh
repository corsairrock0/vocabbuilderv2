#!/usr/bin/env bash
# © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
# TEST ONLY — builds a minimal local stand-in for the official node:24 image from a Node 24
# installation on this machine, for testing the Dockerfile's runtime stage without registry access.
# It contains: node, /bin/sh (dash), a few coreutils, glibc libraries, CA certificates and a
# `node` user (uid 1000) like the official image. Production builds use node:24-bookworm-slim.
#
#   deploy/test/make-node-standin.sh [/opt/node24] [image-tag]
set -euo pipefail
NODE_HOME=${1:-/opt/node24}
TAG=${2:-vocabbuilder-test/node:24-standin}
ROOT=$(mktemp -d)
trap 'rm -rf "$ROOT"' EXIT

mkdir -p "$ROOT"/{bin,usr/bin,usr/local/bin,etc/ssl/certs,tmp,home/node,lib64,lib/x86_64-linux-gnu}
chmod 1777 "$ROOT/tmp"
cp "$NODE_HOME/bin/node" "$ROOT/usr/local/bin/node"
cp /bin/dash "$ROOT/bin/sh"
for b in mkdir chown cp ls cat rm; do cp "/bin/$b" "$ROOT/bin/$b"; done
for b in env id; do cp "/usr/bin/$b" "$ROOT/usr/bin/$b"; done
# Shared libraries needed by the binaries above (resolved through symlinks).
for bin in "$ROOT"/usr/local/bin/node "$ROOT"/bin/* "$ROOT"/usr/bin/*; do
  ldd "$bin" 2>/dev/null | awk '{ for (i=1;i<=NF;i++) if ($i ~ /^\//) print $i }'
done | sort -u | while read -r lib; do
  mkdir -p "$ROOT$(dirname "$lib")"
  cp -L "$lib" "$ROOT$lib"
done
cp -L /etc/ssl/certs/ca-certificates.crt "$ROOT/etc/ssl/certs/ca-certificates.crt"
cat > "$ROOT/etc/passwd" <<'EOF'
root:x:0:0:root:/root:/bin/sh
node:x:1000:1000::/home/node:/bin/sh
EOF
cat > "$ROOT/etc/group" <<'EOF'
root:x:0:
node:x:1000:
EOF
chown 1000:1000 "$ROOT/home/node"
tar -C "$ROOT" -cf - . | docker import \
  --change 'ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
  --change 'ENV NODE_VERSION=24-standin' \
  --change 'CMD ["node"]' \
  - "$TAG" >/dev/null
echo "built $TAG ($(docker image inspect -f '{{.Size}}' "$TAG") bytes)"
docker run --rm "$TAG" node -e 'console.log("node", process.version, "sqlite", require("node:sqlite").DatabaseSync.name)'
