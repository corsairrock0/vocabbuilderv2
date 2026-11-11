// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Scan every sentence the app ships for crude content candidates.
// Usage: node scan.mjs  → cand/<lang>.jsonl (frequency-set examples) and other.txt (starter sets, reading passages)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { crudeHits } from '/home/claude/vocabbuilder/scripts/freq/crude.mjs';
const APP = '/home/claude/vocabbuilder/data';
const LANGS = ['es', 'pt', 'vi', 'ru', 'uk', 'pl'];
mkdirSync('/home/claude/crude/cand', { recursive: true });
const other = [];
const glossWords = [];
const summary = {};
for (const lang of LANGS) {
  const d = JSON.parse(readFileSync(`${APP}/frequency/${lang}.json`, 'utf8'));
  const out = [];
  const byHit = {};
  for (const e of d.entries) {
    const lemmaHit = crudeHits(lang, e.lemma, '').length > 0;
    const glossHits = crudeHits(lang, '', (e.senses ?? []).map((s) => s.gloss).join(' ; '));
    const mainHit = crudeHits(lang, '', e.senses?.[0]?.gloss ?? '').length > 0;
    if (glossHits.length) glossWords.push(`${lang}\t${e.lemma}\t${e.frequencyRank}\t${e.pos}\t${(e.senses ?? []).map((s) => s.gloss).join(' | ')}\t[${glossHits}]\t${(e.examples ?? []).length} sentences`);
    for (const x of e.examples ?? []) {
      let hits = crudeHits(lang, x.text, x.translation);
      if (!hits.length && (lemmaHit || mainHit)) hits = ['(word)'];
      if (!hits.length) continue;
      for (const h of hits) byHit[h] = (byHit[h] ?? 0) + 1;
      out.push({ lemma: e.lemma, pos: e.pos, rank: e.frequencyRank, gloss: (e.senses?.[x.sense ?? 0] ?? e.senses?.[0])?.gloss ?? null,
        glosses: (e.senses ?? []).map((s) => s.gloss), text: x.text, translation: x.translation, target: x.target, sense: x.sense ?? null,
        source: x.source, lemmaHit, mainHit, hits });
    }
  }
  out.forEach((c, i) => (c.id = `${lang}-${String(i + 1).padStart(4, '0')}`));
  writeFileSync(`/home/claude/crude/cand/${lang}.jsonl`, out.map((c) => JSON.stringify(c)).join('\n') + '\n');
  const top = Object.entries(byHit).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([h, n]) => `${h}:${n}`).join(' ');
  summary[lang] = { candidates: out.length, lemmaHits: out.filter((c) => c.lemmaHit).length };
  console.log(lang, summary[lang], '\n  ', top);
  // Starter set and reading passages.
  const st = JSON.parse(readFileSync(`${APP}/starter/${lang}.json`, 'utf8'));
  for (const e of st.entries) for (const x of e.examples ?? []) { const h = crudeHits(lang, x.text, x.translation); if (h.length) other.push(`starter ${lang} ${e.lemma}: ${x.text} | ${x.translation} [${h}]`); }
  const rd = JSON.parse(readFileSync(`${APP}/reading/${lang}.json`, 'utf8'));
  for (const p of rd.passages) {
    for (const sent of p.text.split(/(?<=[.!?…])\s+/)) { const h = crudeHits(lang, sent, ''); if (h.length) other.push(`reading ${p.id}: ${sent} [${h}]`); }
    const h2 = crudeHits(lang, '', `${p.titleEn ?? ''} ${p.topic ?? ''}`); if (h2.length) other.push(`reading ${p.id} title/topic: ${p.titleEn} / ${p.topic} [${h2}]`);
    for (const q of p.questions ?? []) { const all = [q.q, ...(q.options ?? []), q.explain].join(' '); const h3 = crudeHits(lang, all, all); if (h3.length) other.push(`reading ${p.id} question: ${q.q} [${h3}]`); }
  }
}
writeFileSync('/home/claude/crude/other.txt', other.join('\n') + '\n');
writeFileSync('/home/claude/crude/gloss-words.tsv', glossWords.join('\n') + '\n');
console.log('words with a crude-looking gloss:', glossWords.length);
console.log('other (starter + reading):', other.length);
