// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Every build and maintenance script parses. Most are command-line tools that no other test imports, so a syntax
// error in one (as once in scripts/freq/build.mjs) would otherwise go unnoticed until someone runs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.join(import.meta.dirname, '../..');

function scripts(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === 'node_modules') continue;
    if (statSync(p).isDirectory()) out.push(...scripts(p));
    else if (name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

test('every .mjs script under scripts/ and deploy/ parses', () => {
  const files = [...scripts(path.join(root, 'scripts')), ...scripts(path.join(root, 'deploy'))];
  assert.ok(files.length > 20, `${files.length} scripts found`);
  const broken = files.filter((f) => spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }).status !== 0).map((f) => path.relative(root, f));
  assert.deepEqual(broken, []);
});
