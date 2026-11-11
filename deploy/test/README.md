# Deployment test tools (not used in production)

These helpers test the production `Dockerfile` and the operations scripts without registry access.

| File | Purpose |
|---|---|
| `make-node-standin.sh` | Builds a minimal local stand-in for `node:24-bookworm-slim` from a Node 24 installation (node, `/bin/sh`, a few coreutils, glibc, CA certs, `node` user uid 1000). |
| `container-smoke.mjs` | Drives a running container through the API. `seed` runs first-run setup, imports a fixture and the Spanish starter set, checks that the image contains all six most-frequent-word sets and their reports, loads the Polish set, checks that Identify has pictures for it and that a picture is served, and answers session exercises. `verify` signs in from a new device and checks that progress, the session position, language separation and the Polish set survived. |

Typical run (prebuilt runtime payload in `/tmp/vb-prebuilt/out`, laid out like the build stage's `/out`):

```bash
deploy/test/make-node-standin.sh /opt/node24 vocabbuilder-test/node:24-standin
docker buildx build --load --build-context build=/tmp/vb-prebuilt \
  --build-arg NODE_IMAGE=vocabbuilder-test/node:24-standin --target runtime -t vocabbuilder:test .
docker run -d --name vbt1 --init -e VB_SETUP_TOKEN=CONTAINER-TEST-TOKEN \
  -v vbt_data:/data -v vbt_backups:/backups -p 127.0.0.1:3901:3000 vocabbuilder:test
SETUP_TOKEN=CONTAINER-TEST-TOKEN node deploy/test/container-smoke.mjs seed http://127.0.0.1:3901 /tmp/state.json tests/fixtures/ru-mini.json
docker rm -f vbt1        # hard kill, no graceful shutdown
docker run -d --name vbt2 --init -v vbt_data:/data -v vbt_backups:/backups -p 127.0.0.1:3901:3000 vocabbuilder:test
node deploy/test/container-smoke.mjs verify http://127.0.0.1:3901 /tmp/state.json
```

`--build-context build=…` replaces the Dockerfile's `build` stage (which needs `npm ci` with registry access) with a local directory. The runtime stage under test is unchanged.

`../tools/offline-lockfile.mjs` regenerates `package-lock.json` from existing lockfiles when no registry is reachable. With network access, use `npm install --package-lock-only` instead.
