#!/usr/bin/env node
// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Generate package-lock.json for this project WITHOUT network access, by extracting the
// exact pinned packages (and their transitive dependencies) from existing npm v3 lockfiles
// that were produced by real `npm install` runs.
//
// Used because the development environment had no registry access. Each copied entry keeps
// its registry `integrity` hash; `resolved` URLs are rewritten from the private mirror to
// https://registry.npmjs.org/ (same tarballs, same hashes). Dependency flags (dev/optional)
// are recomputed for this project's dependency graph.
//
// Usage: node deploy/tools/offline-lockfile.mjs [projectDir] [sourceLock ...]
// With network access you can simply run `npm install --package-lock-only` instead.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const projectDir = path.resolve(process.argv[2] ?? '.');
const sourceFiles = process.argv.length > 3 ? process.argv.slice(3) : ['/opt/npm-tools/package-lock.json', '/opt/node-tools/package-lock.json'];
const MIRROR = /^https:\/\/artifactory\.infra\.ant\.dev(?::443)?\/artifactory\/api\/npm\/npm-approved-virtual\//;
const REGISTRY = 'https://registry.npmjs.org/';

const pkg = JSON.parse(readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
const sources = sourceFiles.map((f) => ({ file: f, lock: JSON.parse(readFileSync(f, 'utf8')) }));

/** Node's module resolution inside a lockfile tree: nearest node_modules first, then ancestors. */
function resolveIn(packages, from, dep) {
  let base = from;
  for (;;) {
    const candidate = (base ? `${base}/` : '') + `node_modules/${dep}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const idx = base.lastIndexOf('/node_modules/');
    base = idx === -1 ? '' : base.slice(0, idx);
  }
}

const roots = [
  ...Object.entries(pkg.dependencies ?? {}).map(([name, version]) => ({ name, version, prod: true })),
  ...Object.entries(pkg.devDependencies ?? {}).map(([name, version]) => ({ name, version, prod: false })),
];

const nodes = new Map(); // lock path -> { entry, source, prod, required }
const problems = [];
const queue = [];

function visit(source, lockPath, prod, required) {
  let n = nodes.get(lockPath);
  if (n && n.source !== source) {
    if (n.entry.version !== source.lock.packages[lockPath].version) problems.push(`conflicting versions for ${lockPath}`);
  }
  if (!n) {
    n = { entry: source.lock.packages[lockPath], source, prod: false, required: false };
    nodes.set(lockPath, n);
  }
  const changed = (prod && !n.prod) || (required && !n.required);
  n.prod ||= prod;
  n.required ||= required;
  if (changed || !n.seen) {
    n.seen = true;
    queue.push(lockPath);
  }
}

for (const r of roots) {
  if (!/^\d+\.\d+\.\d+/.test(r.version)) problems.push(`${r.name}: pin an exact version (got ${r.version})`);
  const source = sources.find((s) => s.lock.packages[`node_modules/${r.name}`]?.version === r.version);
  if (!source) {
    const seen = sources.map((s) => `${path.basename(path.dirname(s.file))}:${s.lock.packages[`node_modules/${r.name}`]?.version ?? '-'}`).join(', ');
    problems.push(`${r.name}@${r.version} not found in source locks (${seen})`);
    continue;
  }
  visit(source, `node_modules/${r.name}`, r.prod, true);
}

while (queue.length) {
  const p = queue.shift();
  const n = nodes.get(p);
  const e = n.entry;
  const edges = [
    ...Object.keys(e.dependencies ?? {}).map((d) => ({ d, optional: false })),
    ...Object.keys(e.optionalDependencies ?? {}).map((d) => ({ d, optional: true })),
    ...Object.keys(e.peerDependencies ?? {}).map((d) => ({ d, optional: !!e.peerDependenciesMeta?.[d]?.optional, peer: true })),
  ];
  for (const { d, optional, peer } of edges) {
    const target = resolveIn(n.source.lock.packages, p, d);
    if (!target) {
      if (!optional) problems.push(`${p} -> ${d}: not present in ${n.source.file}`);
      continue; // optional (platform-specific) deps the source never recorded
    }
    if (peer && optional && !nodes.has(target)) continue;
    visit(n.source, target, n.prod, n.required && !optional);
  }
}

if (problems.length) {
  console.error('Cannot build lockfile:\n  ' + problems.join('\n  '));
  process.exit(1);
}

const packages = {
  '': {
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    dependencies: pkg.dependencies,
    devDependencies: pkg.devDependencies,
    engines: pkg.engines,
  },
};
for (const key of [...nodes.keys()].sort((a, b) => a.localeCompare(b, 'en'))) {
  const { entry, prod, required } = nodes.get(key);
  const copy = { ...entry };
  delete copy.dev;
  delete copy.optional;
  delete copy.devOptional;
  delete copy.peer;
  if (!copy.resolved || !copy.integrity) problems.push(`${key}: missing resolved/integrity`);
  copy.resolved = copy.resolved.replace(MIRROR, REGISTRY);
  if (!copy.resolved.startsWith(REGISTRY)) problems.push(`${key}: unexpected resolved URL ${copy.resolved}`);
  const ordered = {};
  for (const k of ['version', 'resolved', 'integrity']) if (k in copy) ordered[k] = copy[k];
  if (!prod) ordered.dev = true;
  if (!required) ordered.optional = true;
  for (const [k, v] of Object.entries(copy)) if (!(k in ordered)) ordered[k] = v;
  packages[key] = ordered;
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const lock = { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages };
writeFileSync(path.join(projectDir, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
const count = Object.keys(packages).length - 1;
const opt = Object.values(packages).filter((p) => p.optional).length;
console.log(`package-lock.json written: ${count} packages (${opt} optional/platform-specific), sources: ${sources.map((s) => s.file).join(', ')}`);
