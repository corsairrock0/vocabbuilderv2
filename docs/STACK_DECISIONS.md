# Stack decisions

The specification's preferred stack:

- **Front end:** React, TypeScript, Vite and Tailwind.
- **Back end:** Node.js and TypeScript, with SQLite through an ORM with migrations.
- **Deployment and app:** Docker Compose, Caddy and a PWA.

This project was built in an environment **without registry access**: `npm install` could not fetch new
packages, so only already-installed packages were usable. Each deviation below is a deliberate substitute, not a
downgrade of the requirement. Each one has a path back to the preferred tool.

| Preferred | Used | Why | To switch (with network access) |
|---|---|---|---|
| React + TypeScript | **React 19 + TypeScript** | As preferred | — |
| Tailwind | **Tailwind CSS 4**, compiled through its programmatic API in `scripts/build-web.mjs` | As preferred. The CLI and Vite plugin were unavailable, so the build calls `compile()` directly and scans sources for class candidates | `npm i -D @tailwindcss/vite`, then add it to the Vite config below |
| Vite | **esbuild** (the bundler Vite itself uses for transforms) with a ~150-line build script: hashed code-split chunks, CSS, service worker with a precache list, `index.html` templating; `npm run dev` watches and rebuilds | Vite was not installed; esbuild was | `npm i -D vite @vitejs/plugin-react`. Use `web/` as root and `web/index.html` as entry; replace `%APP_JS%`/`%APP_CSS%` with `<script type="module" src="/src/main.tsx">` and a CSS import; build `web/src/sw.ts` with `vite-plugin-pwa` (injectManifest) or keep the esbuild step for it |
| Node.js + TypeScript | **Node 24** running `.ts` files directly (type stripping), with `erasableSyntaxOnly` enforced by `tsc` | No compile step and no `ts-node`/`tsx`; the production image runs the same files that were tested | Nothing to change. To compile anyway: `tsc --rewriteRelativeImportExtensions` |
| HTTP framework (not specified) | A small router on `node:http` (`server/http/http.ts`, ~300 lines) | Fastify and Express were not installed. The router covers what is needed: params, zod validation, error envelope, body limits, idempotency | Fastify: each `router.get/post(...)` maps one-to-one to `fastify.get/post` with a zod type provider. Keep `runIdempotent` as a hook |
| SQLite + ORM with migrations | **`node:sqlite`** (built into Node 24) with hand-written SQL, a typed `Db` wrapper, transactions with savepoints, and **checksummed SQL migrations** with automatic pre-migration backups (`server/db/migrate.ts`) | `better-sqlite3` and Drizzle/Prisma were not installed. `node:sqlite` provides WAL, `synchronous=FULL` and the online backup API | Drizzle: introspect the existing schema (`drizzle-kit introspect`) to generate a schema matching `0001_initial.sql`, then switch queries module by module. Migration files stay SQL. `better-sqlite3` is API-compatible enough for the `Db` wrapper |
| FSRS (ts-fsrs referenced) | **FSRS-6 port of py-fsrs 6.3.0** (`shared/fsrs.ts`), verified to 1e-9 against recorded py-fsrs outputs | `ts-fsrs` was not installed. A tested port of a maintained reference implementation meets "maintained or tested implementation" | `npm i ts-fsrs` and adapt `server/learning/scheduling.ts`; `tests/unit/fsrs.test.ts` keeps the reference fixtures for comparison |
| Test runner (not specified) | **`node:test`** for unit/integration, **Playwright** (already installed) for browser tests | Vitest/Jest were not installed | Vitest runs `node:test`-style suites with small changes (`describe/it`, `expect`) |
| React types | A local declaration file, `web/src/types/react-shim.d.ts`, covering the API used, with typed DOM events | `@types/react` was not installed | `npm i -D @types/react@19 @types/react-dom@19`, delete the shim, then fix any stricter typing errors that `npm run typecheck` reports |
| Docker Compose + Caddy | **Docker Compose + Caddy 2.11** | As preferred | — |
| PWA | Manifest, icons, a hand-written service worker (`web/src/sw.ts`) and an IndexedDB outbox | As preferred. Workbox was not available, so the service worker implements only what is needed: app-shell precache, a navigation fallback, and no API caching | — |

## Other choices

- **Server-authoritative grading and scheduling.** The browser grades answers immediately for feedback, using the
  same `shared/answer.ts`. The server grades every answer again and alone decides scheduling. A modified client
  therefore cannot corrupt FSRS state, and offline answers stay consistent.
- **Two FSRS cards per word** (recognition and recall), instead of one card per exercise type. This matches how
  vocabulary knowledge actually splits, and it keeps the review load predictable.
- **SQLite, not Postgres.** One user and a handful of devices produce writes measured in answers per minute. SQLite
  with WAL handles this easily. It makes backups a single file and needs no second container.
- **Icons:** Lucide through `react-icons`. **Font:** a renamed subset of Lora (OFL), which covers Latin, Vietnamese
  and Cyrillic and makes stress marks render well. It is served by the app itself: no external font service.
