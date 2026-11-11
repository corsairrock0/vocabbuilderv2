// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Production build for the VocabBuilder web client.
//
//  * JavaScript/TypeScript/TSX  -> esbuild (code splitting, minification, hashed names)
//  * CSS                        -> Tailwind CSS v4 compiler API + esbuild CSS lowering/minification
//  * Service worker             -> esbuild, with the precache manifest injected at build time
//  * index.html / manifest      -> templated with hashed asset names
//
// Vite was not available in the offline build environment, so this script performs the
// production steps Vite would perform for this app. It has no dependencies beyond
// esbuild and tailwindcss (both pinned in package.json).
import { build, context, transform } from 'esbuild';
import { compile } from 'tailwindcss';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { thirdPartyNotices } from './legal/notices.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(root, 'web');
/** Kept at the top of every shipped script and stylesheet (esbuild keeps banners through minification). */
const BANNER = '/*! VocabBuilder by Lango. (c) 2026 Lango. All rights reserved. Third-party notices: /third-party-notices.txt */';
const outDir = path.join(root, 'dist', 'web');
const assetsDir = path.join(outDir, 'assets');
const browserTargets = ['es2022', 'safari16.4', 'chrome111', 'firefox115', 'edge111'];

const sha = (data) => createHash('sha256').update(data).digest('hex').slice(0, 10);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** Extract Tailwind class candidates from source files (superset; Tailwind ignores non-classes). */
function extractCandidates(source, into) {
  for (const raw of source.split(/[\s"'`]+/)) {
    const token = raw.replace(/^[{(,;]+|[}),;]+$/g, '');
    if (token && token.length < 160) into.add(token);
  }
}

export async function compileCss({ minify = true } = {}) {
  const entry = path.join(webDir, 'src', 'styles', 'app.css');
  const tailwindDir = path.dirname(require.resolve('tailwindcss/package.json'));
  const compiler = await compile(await readFile(entry, 'utf8'), {
    base: path.dirname(entry),
    async loadStylesheet(id, base) {
      let file;
      if (id === 'tailwindcss') file = path.join(tailwindDir, 'index.css');
      else if (id.startsWith('tailwindcss/')) file = path.join(tailwindDir, id.slice('tailwindcss/'.length));
      else file = path.resolve(base, id);
      if (!file.endsWith('.css')) file += '.css';
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    },
    async loadModule(id) {
      throw new Error(`Tailwind JS plugins/configs are not used by VocabBuilder (requested: ${id})`);
    },
  });
  const candidates = new Set();
  for (const dir of [path.join(webDir, 'src'), path.join(root, 'shared'), path.join(webDir, 'index.html')]) {
    const info = await stat(dir).catch(() => null);
    if (!info) continue;
    const files = info.isDirectory() ? walk(dir) : [dir];
    for await (const file of files) {
      if (/\.(tsx?|html)$/.test(file)) extractCandidates(await readFile(file, 'utf8'), candidates);
    }
  }
  const css = compiler.build([...candidates]);
  // Lower modern syntax (e.g. nesting) for older Safari/iOS and minify.
  const out = await transform(css, { loader: 'css', minify, target: browserTargets, legalComments: 'none' });
  return `${BANNER}\n${out.code}`;
}

function jsOptions({ dev, version, buildId }) {
  return {
    entryPoints: { app: path.join(webDir, 'src', 'main.tsx') },
    bundle: true,
    format: 'esm',
    splitting: true,
    outdir: assetsDir,
    entryNames: '[name]-[hash]',
    chunkNames: 'chunk-[hash]',
    assetNames: 'asset-[hash]',
    minify: !dev,
    sourcemap: true,
    target: browserTargets,
    jsx: 'automatic',
    metafile: true,
    tsconfig: path.join(webDir, 'tsconfig.json'),
    define: {
      'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
      __APP_VERSION__: JSON.stringify(version),
      __BUILD_ID__: JSON.stringify(buildId),
    },
    legalComments: 'linked',
    banner: { js: BANNER },
    logLevel: 'warning',
  };
}

async function writeShell({ jsFile, cssFile, version, buildId, dev }) {
  const assetFiles = (await readdir(assetsDir)).filter((f) => !f.endsWith('.map') && !f.endsWith('.LEGAL.txt'));
  const publicDir = path.join(webDir, 'public');
  await cp(publicDir, outDir, { recursive: true });
  const publicFiles = [];
  for await (const file of walk(publicDir)) publicFiles.push('/' + path.relative(publicDir, file).split(path.sep).join('/'));
  // Identify practice pictures (about 50 MB): served from /identify/ and cached by the service worker only when
  // shown, never precached. Their names carry a content hash, so they are cached for good.
  const identifyDir = path.join(root, 'data', 'identify', 'images');
  const identifyOut = path.join(outDir, 'identify');
  await rm(identifyOut, { recursive: true, force: true });
  if (await stat(identifyDir).catch(() => null)) await cp(identifyDir, identifyOut, { recursive: true });

  const template = await readFile(path.join(webDir, 'index.html'), 'utf8');
  const html = template
    .replaceAll('%APP_JS%', `/assets/${jsFile}`)
    .replaceAll('%APP_CSS%', `/assets/${cssFile}`)
    .replaceAll('%BUILD_ID%', buildId)
    .replaceAll('%APP_VERSION%', version);
  await writeFile(path.join(outDir, 'index.html'), html);

  // Precache list for the service worker: the app shell and its static assets only.
  // API responses and third-party audio (Forvo) are never cached by the service worker.
  const precache = ['/', ...assetFiles.map((f) => `/assets/${f}`), ...publicFiles.filter((f) => !f.endsWith('.DS_Store'))];
  await build({
    entryPoints: [path.join(webDir, 'src', 'sw.ts')],
    bundle: true,
    format: 'iife',
    outfile: path.join(outDir, 'sw.js'),
    minify: !dev,
    target: browserTargets,
    define: { __PRECACHE__: JSON.stringify(precache), __BUILD_ID__: JSON.stringify(buildId) },
    banner: { js: BANNER },
    logLevel: 'warning',
  });
  await writeFile(path.join(outDir, 'third-party-notices.txt'), thirdPartyNotices());
  await writeFile(
    path.join(outDir, 'build-info.json'),
    JSON.stringify({ version, buildId, builtAt: new Date().toISOString(), js: jsFile, css: cssFile, precache }, null, 2),
  );
}

function entryFile(metafile) {
  // With code splitting, lazily imported routes are entry points too; the app entry is the one built from main.tsx.
  for (const [file, meta] of Object.entries(metafile.outputs)) {
    if (meta.entryPoint && meta.entryPoint.endsWith('src/main.tsx') && file.endsWith('.js')) return path.basename(file);
  }
  throw new Error('esbuild produced no entry chunk for web/src/main.tsx');
}

export async function buildWeb({ dev = false } = {}) {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const version = pkg.version;
  const buildId = `${version}+${Date.now().toString(36)}`;
  await rm(outDir, { recursive: true, force: true });
  await mkdir(assetsDir, { recursive: true });

  const result = await build(jsOptions({ dev, version, buildId }));
  const jsFile = entryFile(result.metafile);
  const css = await compileCss({ minify: !dev });
  const cssFile = `app-${sha(css)}.css`;
  await writeFile(path.join(assetsDir, cssFile), css);
  await writeShell({ jsFile, cssFile, version, buildId, dev });
  return { jsFile, cssFile, buildId };
}

/** Incremental rebuilds for `npm run dev`. */
export async function watchWeb(onRebuild) {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  let first = true;
  const ctx = await context({
    ...jsOptions({ dev: true, version: pkg.version, buildId: 'dev' }),
    plugins: [
      {
        name: 'vocabbuilder-shell',
        setup(b) {
          b.onStart(async () => {
            if (first) {
              await rm(outDir, { recursive: true, force: true });
              await mkdir(assetsDir, { recursive: true });
              first = false;
            }
          });
          b.onEnd(async (res) => {
            if (res.errors.length) return;
            for (const f of await readdir(assetsDir)) {
              if (f.startsWith('app-') || f.startsWith('chunk-')) {
                const keep = Object.keys(res.metafile.outputs).some((o) => path.basename(o) === f || path.basename(o) + '.map' === f);
                if (!keep) await rm(path.join(assetsDir, f), { force: true });
              }
            }
            const jsFile = entryFile(res.metafile);
            const css = await compileCss({ minify: false });
            const cssFile = `app-${sha(css)}.css`;
            await writeFile(path.join(assetsDir, cssFile), css);
            await writeShell({ jsFile, cssFile, version: pkg.version, buildId: `dev-${Date.now().toString(36)}`, dev: true });
            onRebuild?.();
          });
        },
      },
    ],
  });
  await ctx.watch();
  return ctx;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const started = Date.now();
  buildWeb({ dev: process.argv.includes('--dev') })
    .then(({ jsFile, cssFile }) => console.log(`web build ok in ${Date.now() - started} ms: ${jsFile}, ${cssFile}`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
