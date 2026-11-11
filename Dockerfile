# VocabBuilder production image.
#
#   docker compose build            (normal use — see docs/DEPLOYMENT.md)
#   docker build -t vocabbuilder .  (standalone)
#
# NODE_IMAGE can be overridden (e.g. a mirrored or pinned-digest image):
#   docker build --build-arg NODE_IMAGE=node:24-bookworm-slim@sha256:... .
ARG NODE_IMAGE=node:24-bookworm-slim

# ---------------------------------------------------------------- build
# Install all dependencies from package-lock.json, build the web client (esbuild + Tailwind),
# then remove development dependencies. Only the runtime payload in /out is kept.
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    npm_config_fund=false \
    npm_config_audit=false \
    npm_config_update_notifier=false
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build \
 && npm prune --omit=dev \
 && mkdir -p /out/data /out/scripts \
 && cp -r package.json package-lock.json node_modules server shared dist /out/ \
 && if [ -d data/starter ]; then cp -r data/starter /out/data/starter; fi \
 && if [ -d data/frequency ]; then cp -r data/frequency /out/data/frequency && rm -rf /out/data/frequency/ranks; fi \
 && if [ -f data/identify/identify.json ]; then mkdir -p /out/data/identify && cp data/identify/identify.json /out/data/identify/; fi \
 && if ls data/reading/*.json >/dev/null 2>&1; then mkdir -p /out/data/reading && cp data/reading/*.json /out/data/reading/; fi \
 && if ls data/grammar/*.json >/dev/null 2>&1; then mkdir -p /out/data/grammar && cp data/grammar/*.json /out/data/grammar/; fi \
 && if ls data/writing/*.json >/dev/null 2>&1; then mkdir -p /out/data/writing && cp data/writing/*.json /out/data/writing/; fi \
 && cp scripts/kaikki-filter.mjs /out/scripts/

# ---------------------------------------------------------------- runtime
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    VB_HOST=0.0.0.0 \
    VB_PORT=3000 \
    VB_DATA_DIR=/data \
    VB_BACKUP_DIR=/backups \
    VB_STATIC_DIR=/app/dist/web \
    VB_TRUST_PROXY=1
WORKDIR /app
# Application code is owned by root and read-only for the service user.
COPY --from=build /out/ /app/
# Persistent data: SQLite database, uploaded imports and your recordings (/data); verified backups (/backups).
RUN mkdir -p /data /backups && chown node:node /data /backups
VOLUME ["/data", "/backups"]
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.VB_PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# Node 24 runs the TypeScript server directly (type stripping); no compile step is needed.
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.ts"]
