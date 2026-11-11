// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Show review items. node show.mjs <lang> <from> <n>   (candidates, 1-based)
//                     node show.mjs <lang>-x <from> <n> (the second scan's candidates)
//                     node show.mjs <lang>-m <from> <n> (sentences reviewers noted outside the lists)
//                     node show.mjs <lang>-t <from> <n> (untranslated sentences to read through: compact)
import { readJsonl, entryOf, formsOf, ROOT } from './politics-lib.mjs';
const [which, fromArg, nArg] = process.argv.slice(2);
const skim = which.endsWith('-t');
const suffix = /-[xm]$/.test(which) ? which.slice(-2) : '';
const lang = which.replace(/-[txm]$/, '');
const from = Number(fromArg ?? 1), n = Number(nArg ?? 30);
const items = readJsonl(`${ROOT}/${skim ? 'skim' : 'cand'}/${lang}${suffix}.jsonl`).slice(from - 1, from - 1 + n);
for (const c of items) {
  if (skim) { console.log(`${c.id}  ${c.lemma} [${c.target}]  ${c.text}`); continue; }
  const e = entryOf(lang, c);
  const others = (e?.examples ?? []).filter((x) => x.text !== c.text).map((x) => x.text);
  console.log(`${c.id}  ${c.lemma} (${c.pos}, #${c.rank})${c.lemmaHit || c.mainHit ? '  THE WORD ITSELF IS ON THESE SUBJECTS' : ''}`);
  console.log(`  meanings: ${c.glosses.map((g, i) => `${i}) ${g}`).join(' | ')}`);
  console.log(`  forms: ${formsOf(e).slice(0, 40).join(', ')}`);
  console.log(`  sentence [meaning ${c.sense ?? 0}, target «${c.target}», ${c.source}]  hits: ${c.hits.join(', ')}`);
  console.log(`    ${c.text}`);
  console.log(`    ${c.translation ?? '(no translation)'}`);
  if (others.length) console.log(`  its other sentences: ${others.join('  //  ')}`);
  console.log('');
}
