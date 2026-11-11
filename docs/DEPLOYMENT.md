# Deploying VocabBuilder on your own server

VocabBuilder runs as two containers started by one Docker Compose file:

| Service | What it does |
|---|---|
| `app` | Node.js 24 server + SQLite database. Serves the web app (PWA) and the API. Runs as an unprivileged user (uid 1000). Not exposed to the internet directly. |
| `caddy` | [Caddy](https://caddyserver.com/) reverse proxy. Gets and renews HTTPS certificates automatically, compresses responses, adds HSTS. The only service with open ports (80, 443). |

All learning data lives in Docker **named volumes**, so restarting, replacing or upgrading containers never touches it:

| Volume | Mounted at | Contents |
|---|---|---|
| `vocabbuilder_vb_data` | `/data` | `vocabbuilder.sqlite` (+ `-wal`/`-shm`), `imports/` (uploaded import files), `audio/` (your own recordings) |
| `vocabbuilder_vb_backups` | `/backups` | verified daily backups and their `.json` metadata |
| `vocabbuilder_caddy_data` | `/data` (Caddy) | TLS certificates and keys |
| `vocabbuilder_caddy_config` | `/config` (Caddy) | Caddy runtime config |

> `docker compose down` keeps volumes. **Never run `docker compose down -v`** unless you really want to delete everything.

## 1. Requirements

- A Linux server (x86-64 or ARM64) with at least 1 CPU, 1 GB RAM and a few GB of disk for the database and backups.
- Docker Engine 25+ and the Docker Compose v2 plugin (2.20+). Install them from [docs.docker.com/engine/install](https://docs.docker.com/engine/install/). Distribution packages are often too old.
- One of:
  - **Public domain** (recommended): a DNS `A`/`AAAA` record such as `vocab.example.com` pointing at the server, and ports **80 and 443** reachable from the internet (Let's Encrypt validates through them).
  - **Tailscale**: the server in your tailnet with HTTPS enabled in the Tailscale admin console.
  - **LAN only**: a local hostname or IP. Caddy's internal CA issues the certificate, and you install its root certificate on your devices once.

HTTPS matters. Browsers only allow installing the PWA, offline mode and microphone recording on HTTPS origins.

## 2. First installation

```bash
# 1. Put the source on the server, e.g. into /opt/vocabbuilder (or git clone your copy there)
sudo unzip vocabbuilder-2.0.0.zip -d /opt && sudo chown -R "$USER": /opt/vocabbuilder && cd /opt/vocabbuilder

# 2. Create your configuration
cp .env.example .env
nano .env            # set VB_DOMAIN and VB_PUBLIC_ORIGIN; optionally ACME_EMAIL, VB_FORVO_API_KEY, VB_BACKUP_PASSPHRASE
chmod 600 .env

# 3. Build and start (the first build downloads Node/npm packages and takes a few minutes)
docker compose up -d --build

# 4. Check that both services are up (app should say "healthy")
docker compose ps

# 5. Get the one-time setup code
docker compose logs app | grep -A1 "setup code"
```

Open `https://<your VB_DOMAIN>` and enter the setup code. Then choose a username and a password of at least 12 characters. The setup code stops working once the owner account exists. To set your own code instead of a random one, put `VB_SETUP_TOKEN=...` in `.env` before the first start. A new random code is printed on every start until setup is complete.

Then, in the app:

1. **Settings → General:** check that your timezone is right. It defines study days, streaks and the daily backup time.
2. **Today:** pick a language (the language button, or *Other languages*), then load its most frequent words (also in
   Settings → Data and backups → *Most frequent words*), a small starter set, or your own list (*Import a word list*).
3. On each phone or tablet, open the URL and use **Add to Home Screen** (iOS Safari) or **Install app** (Chrome/Edge/Android) to install the PWA.

### Configuration reference

Every option is documented in [`.env.example`](../.env.example). The most important ones:

| Variable | Purpose |
|---|---|
| `VB_DOMAIN` | Address Caddy serves (domain, `*.ts.net` name, or LAN host/IP). Required. |
| `VB_PUBLIC_ORIGIN` | `https://` + your domain. The app accepts write requests only from its own pages. |
| `VB_SETUP_TOKEN` | Optional fixed first-run setup code. |
| `VB_FORVO_API_KEY` | Enables native-speaker recordings from Forvo (see §5). |
| `VB_BACKUP_PASSPHRASE` | Encrypts backups (AES-256-GCM). Keep the passphrase safe: without it, encrypted backups cannot be restored. |
| `VB_OFFSITE_BACKUP_DIR` | A second directory (other disk/NAS) that receives a verified copy of every backup. |
| `VB_SESSION_IDLE_DAYS` / `VB_SESSION_MAX_DAYS` | How long a device stays signed in. |

After editing `.env`, run `docker compose up -d` to apply it. The containers are recreated, and data is kept.

## 3. HTTPS options

### Public domain (default)

Nothing else to do: `deploy/Caddyfile` serves `VB_DOMAIN` with an automatic Let's Encrypt/ZeroSSL certificate, and it redirects HTTP to HTTPS. Watch the first certificate being issued with `docker compose logs -f caddy`.

### Tailscale (`*.ts.net`)

1. In the Tailscale admin console, enable **MagicDNS** and **HTTPS certificates**.
2. Set `VB_DOMAIN=<machine>.<tailnet>.ts.net` in `.env` (keep `VB_CADDYFILE=./deploy/Caddyfile`).
3. In `docker-compose.yml`, uncomment the `tailscaled.sock` volume line of the `caddy` service. Caddy then fetches Tailscale's publicly trusted certificate automatically.
4. Close ports 80/443 in your firewall if the server should only be reachable through Tailscale.

### LAN only (internal CA)

1. In `.env`: `VB_CADDYFILE=./deploy/Caddyfile.lan` and, for example, `VB_DOMAIN="vocab.lan, 192.168.1.20"`.
2. `docker compose up -d`, then copy Caddy's root certificate out:
   `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./vocabbuilder-root.crt`
3. Install `vocabbuilder-root.crt` as a trusted root on each device:
   - **iPhone/iPad:** AirDrop or e-mail the file → Settings → *Profile Downloaded* → Install. Then Settings → General → About → Certificate Trust Settings → enable full trust.
   - **Android:** Settings → Security → Encryption & credentials → Install a certificate → CA certificate.
   - **macOS:** open the file in Keychain Access (System keychain) → set *When using this certificate* to *Always Trust*.
   - **Windows:** double-click → Install Certificate → Local Machine → *Trusted Root Certification Authorities*.
   - **Firefox** uses its own store: Settings → Privacy & Security → Certificates → View Certificates → Authorities → Import.

### Plain HTTP on localhost (testing only)

Uncomment the `ports: - "127.0.0.1:3000:3000"` lines of the `app` service and open `http://localhost:3000` on the server (or through an SSH tunnel). Do not expose plain HTTP on a network.

## 4. Importing vocabulary

Small and medium files (CSV, TSV, JSON, JSONL, Kaikki/Wiktextract, frequency lists) are imported in the app under **Settings → Data and backups → *Import vocabulary***: preview, column mapping, validation, then a single all-or-nothing commit that you can undo. The upload limit is `VB_MAX_UPLOAD_MB` (default 25 MB). See `docs/VOCABULARY_SOURCES.md` for sources and licences.

Large dictionary dumps go through the command line:

```bash
# Reduce a Kaikki.org raw dump (GBs) to one language and, optionally, the words in a frequency list's top N
node scripts/kaikki-filter.mjs raw-wiktextract-data.jsonl.gz --lang uk --freq uk_50k.txt --top 15000 --out uk-dictionary.jsonl

# Copy the result into the data volume and import it
docker compose cp uk-dictionary.jsonl app:/data/imports/
docker compose exec app node --disable-warning=ExperimentalWarning server/cli.ts import /data/imports/uk-dictionary.jsonl --lang uk

# Attach frequency ranks from a list ("word count" lines) to existing words
docker compose cp uk_50k.txt app:/data/imports/
docker compose exec app node --disable-warning=ExperimentalWarning server/cli.ts import-frequency /data/imports/uk_50k.txt --lang uk --kind subtitles --name "FrequencyWords uk (OpenSubtitles)"
```

`kaikki-filter.mjs` needs only Node.js 18 or newer on the host. It is also included in the image (`docker compose exec app node scripts/kaikki-filter.mjs …`). Delete processed files from `/data/imports` when you no longer need them.

## 5. Forvo pronunciations

1. Get an API key with a plan from [api.forvo.com](https://api.forvo.com/) and put it in `.env` as `VB_FORVO_API_KEY`. Use the API host shown for your plan as `VB_FORVO_API_BASE`.
2. Set `VB_FORVO_DAILY_LIMIT` to your plan's daily limit or lower. Forvo counts **every lookup and every audio play** as a request, and limits reset at 22:00 UTC.
3. `docker compose up -d` to apply. The key stays on the server. Browsers receive only short-lived audio links, and audio is never downloaded or cached by VocabBuilder (per Forvo's terms).

Without a key, everything else works. Audio falls back to your own uploaded recordings or, if you enable it per language, your device's text-to-speech voice (always labelled as synthesized).

## 6. Day-to-day operations

| Task | Command |
|---|---|
| Status | `docker compose ps` · `docker compose exec app node --disable-warning=ExperimentalWarning server/cli.ts status` |
| Logs | `docker compose logs -f app` · `docker compose logs -f caddy` (rotated, 5 × 10 MB) |
| Backup now | `scripts/backup.sh "note"` (`--copy-to DIR` to copy it to the host) |
| Restore | `scripts/restore.sh <backup file>` — see [BACKUP_RESTORE.md](BACKUP_RESTORE.md) |
| Copy backups off the server | `scripts/offsite-sync.sh <rclone remote or path>` |
| Reset the owner password | `docker compose exec -T -e VB_NEW_PASSWORD='new long passphrase' app node --disable-warning=ExperimentalWarning server/cli.ts set-password <username>` (signs out every device) |
| Restart | `docker compose restart app` |
| Stop everything | `docker compose down` (volumes are kept) |

## 7. Upgrading

```bash
cd /opt/vocabbuilder
scripts/upgrade.sh                       # git checkout: pulls the latest version
scripts/upgrade.sh vocabbuilder-2.0.0.tar.gz   # or: extract a release archive (your .env is kept)
```

The script:

1. creates and verifies a **pre-upgrade backup** while the old version is still running;
2. updates the source (`git pull --ff-only` or the archive), rebuilds the image with fresh base images, and restarts;
3. waits for the health check. On start, the new version applies any database migrations, and it makes its own **pre-migration backup** first;
4. prints the backup file name and the rollback steps.

Manual equivalent: `scripts/backup.sh "pre-upgrade"` → update the files → `docker compose build --pull app && docker compose up -d` → `docker compose ps`.

**If the build stops with `additional privileges requested: pass "--allow=fs.read=Dockerfile"`.** The message comes
from Docker, not from VocabBuilder. Since Buildx 0.37.2, Compose builds through Bake and gives it read access only
to the build folder, and on Windows (Docker Desktop) Bake asks for the Dockerfile too, even though it is in that
folder. Build the image without Compose, then start it as usual:

```bash
docker build --pull -t vocabbuilder:latest .
docker compose up -d
```

Use the same tag if you set `VB_IMAGE_TAG` in `.env` (and `--build-arg NODE_IMAGE=…` if you set `NODE_IMAGE`). The
other way is to switch off Bake's file check for one PowerShell window, `$env:BUILDX_BAKE_ENTITLEMENTS_FS = "0"`,
before `docker compose build --pull app`; it relaxes a Docker safety check, so only use it for builds you trust.

**Sets loaded with an earlier version.** Version 1.2.0 added inflection tables and example sentences to the most
frequent words sets, and 1.2.1 added AI-written sentences for the words that had none. A set you loaded with an
earlier version does not gain them by itself. To add them, open *Import vocabulary*, choose *Undo* next to that set
under *Recent imports*, then load it again from Settings → Data and backups. Words you have started are kept through
the undo, with their progress, and gain the tables and sentences when the set is loaded again.

**After upgrading to 2.0.0.** There is no database migration. The sets of all six languages changed (the rest of the
meaning review is applied: reviewed meanings, sentences linked to them and fixed combinations for 2,500 more words,
see [FREQUENCY_SETS.md](FREQUENCY_SETS.md#meaning-review)). For each language whose set you loaded, Today and
Settings → Data and backups show *Update*: it makes a backup, takes 2 to 15 seconds per language, and gives your
words the new set's content while keeping their progress. From 2.0.0 on, answers in practice count as reviews of the
words you are learning, so some words come due later than before; nothing else about your schedule changes unless
you fit your memory model (Settings → Learning → Memory).

### Rolling back

1. Return to the previous source: `git checkout <previous commit>`, or put the previous release files back (keep `.env`).
2. `docker compose build app && docker compose up -d`
3. If the newer version migrated the database, the older version refuses to start with *"Database schema version N … is newer than this application supports"*. Restore the pre-upgrade (or pre-migration) backup:
   `scripts/restore.sh vocabbuilder-…-manual.sqlite.gz`
   The script detects this case, keeps the current database files as `vocabbuilder.sqlite.before-rollback-<time>`, and puts the backup in place without running migrations.

Progress made **after** the pre-upgrade backup is not part of that backup. Roll back soon after an upgrade, or export your progress first (Settings → Data and backups → Export).

## 8. Security notes

- Only Caddy publishes ports. The app listens on the internal Docker network, and the SQLite file is never reachable from outside.
- Single owner account, no public registration. Passwords are hashed with scrypt (N=2¹⁷, r=8, p=1). Sign-in is rate-limited (5 failures per 15 minutes per IP, 30 per hour overall).
- Session cookies are `HttpOnly`, `SameSite=Lax` and `Secure` over HTTPS. Write requests require a CSRF token and a same-origin `Origin` header.
- Strict Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff` and HSTS (from Caddy). No analytics, trackers or telemetry.
- Secrets (`VB_FORVO_API_KEY`, `VB_BACKUP_PASSPHRASE`, `VB_SETUP_TOKEN`) live only in `.env` on the server: `chmod 600 .env`.
- Keep the host updated, allow only SSH/80/443 in the firewall, and run `scripts/upgrade.sh` (or `docker compose pull caddy && docker compose up -d`) regularly for security fixes.
- `VB_TRUST_PROXY=1` (set by Compose) is correct only behind Caddy. Do not publish the app's port to a network while it is enabled.
