// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Hover styles must not apply on touch screens: iOS keeps :hover on whatever lands under the finger after a tap,
// so the choice that appeared where "Start" had been looked selected (reported 2026-11-08 from an iPhone).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const APP_CSS = path.resolve(import.meta.dirname, '../../web/src/styles/app.css');

/** Selectors with :hover that are not inside an `@media (hover: hover)` block. */
export function unguardedHover(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const open: string[] = [];
  const found: string[] = [];
  let prelude = '';
  for (const ch of text) {
    if (ch === '{') {
      const p = prelude.trim().replace(/\s+/g, ' ');
      const isRule = !p.startsWith('@'); // "@media(hover:hover)" itself contains ":hover" once minified
      if (isRule && p.includes(':hover') && !open.some((o) => /^@media\b.*\(\s*hover\s*:\s*hover\s*\)/.test(o))) found.push(p);
      open.push(p);
      prelude = '';
    } else if (ch === '}') {
      open.pop();
      prelude = '';
    } else if (ch === ';') {
      prelude = '';
    } else {
      prelude += ch;
    }
  }
  return found;
}

test('every :hover rule in app.css applies only where the pointer can hover', () => {
  assert.deepEqual(unguardedHover(readFileSync(APP_CSS, 'utf8')), []);
});

test('the hover check finds unguarded rules, nested or not', () => {
  const css = `@layer components {
    .a:hover { color: red; }
    @media (hover: hover) { .b:hover:not(:disabled) { color: blue; } }
    @media (min-width: 40rem) { .c:hover { color: green; } }
  }
  /* .d:hover { } in a comment */
  .e { color: red; &:hover { color: blue; } }`;
  assert.deepEqual(unguardedHover(css), ['.a:hover', '.c:hover', '&:hover']);
  // Minified, as the build writes it.
  assert.deepEqual(unguardedHover('@media(hover:hover){.f:hover{color:red}}.g:hover{color:red}'), ['.g:hover']);
});
