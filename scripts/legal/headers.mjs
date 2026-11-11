// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Copyright headers on Lango's own source files.
//
//   node scripts/legal/headers.mjs          list files without the header (exit 1 if any)
//   node scripts/legal/headers.mjs --write  add the header where it is missing
//
// Third-party code is not in these folders (it lives in node_modules); shared/fsrs.ts also credits py-fsrs.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const NOTICE = '© 2026 Lango. All rights reserved. Proprietary — see LICENSE.';
const FOLDERS = ['server', 'shared', 'web/src', 'scripts', 'tests', 'deploy'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'storage', 'test-results', 'playwright-report', '.git']);
// Applied migrations are checked by checksum at startup (server/db/migrate.ts): editing one, even a comment, would
// stop every existing database from opening. New migrations carry the header from the start.
const SKIP_PATHS = new Set([path.join('server', 'db', 'migrations')]);
const STYLE = {
  '.ts': (t) => `// ${t}`,
  '.tsx': (t) => `// ${t}`,
  '.mjs': (t) => `// ${t}`,
  '.js': (t) => `// ${t}`,
  '.css': (t) => `/* ${t} */`,
  '.sql': (t) => `-- ${t}`,
  '.py': (t) => `# ${t}`,
  '.sh': (t) => `# ${t}`,
};

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const file = path.join(dir, name);
    if (SKIP_PATHS.has(path.relative(root, file))) continue;
    if (statSync(file).isDirectory()) yield* walk(file);
    else if (STYLE[path.extname(name)]) yield file;
  }
}

export function sourceFiles() {
  const out = [];
  for (const f of FOLDERS) {
    const dir = path.join(root, f);
    try {
      statSync(dir);
    } catch {
      continue;
    }
    out.push(...walk(dir));
  }
  return out.sort();
}

export function hasNotice(text) {
  return text.split('\n').slice(0, 4).some((l) => l.includes('© 2026 Lango'));
}

/** The file's text with the header added after any shebang or encoding line. */
export function withNotice(file, text) {
  const line = STYLE[path.extname(file)](NOTICE);
  const lines = text.split('\n');
  let at = 0;
  if (lines[0]?.startsWith('#!')) at = 1;
  if (/^#.*coding[:=]/.test(lines[at] ?? '')) at += 1;
  lines.splice(at, 0, line);
  return lines.join('\n');
}

export function missingNotices() {
  return sourceFiles().filter((f) => !hasNotice(readFileSync(f, 'utf8')));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const missing = missingNotices();
  if (process.argv.includes('--write')) {
    for (const f of missing) writeFileSync(f, withNotice(f, readFileSync(f, 'utf8')));
    console.log(`added the header to ${missing.length} files`);
  } else {
    for (const f of missing) console.log(path.relative(root, f));
    console.log(`${missing.length} files without the header`);
    process.exitCode = missing.length ? 1 : 0;
  }
}
