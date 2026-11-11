// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Export every word of the six frequency sets for the meaning review.
// For each language: data/<lang>.json (structured, for merging later) and in/<lang>-NN.txt chunks for reviewers.
// Each word lists its senses, its sentences (with a hint when the word sits inside a known fixed combination),
// and the combinations that make up a large share of the word's uses in a sentence corpus.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';

const ROOT = '/home/claude/vocabbuilder';
const OUT = '/home/claude/review';
const WIKT = '/tmp/fs-test/wiktionary-vuizur';
const TC = '/home/claude/src-tc/tc/data';
const UD = '/tmp/fs-test/ud';
const LANGS = process.argv[2] ? process.argv[2].split(',') : ['es', 'pt', 'vi', 'ru', 'uk', 'pl'];
const CHUNK = Number(process.argv[3] || 250);
const NAMES = { es: 'Spanish', pt: 'Portuguese', vi: 'Vietnamese', ru: 'Russian', uk: 'Ukrainian', pl: 'Polish' };
const TC_CODE = { es: 'spa', pt: 'por', vi: 'vie', ru: 'rus', uk: 'ukr', pl: 'pol' };
const UD_PREFIX = { es: 'UD_Spanish', pt: 'UD_Portuguese', vi: 'UD_Vietnamese', ru: 'UD_Russian', uk: 'UD_Ukrainian', pl: 'UD_Polish' };

const norm = (s) => s.normalize('NFC').toLowerCase().replace(/́/g, '').replace(/ё/g, 'е').replace(/[’ʼ]/g, "'");
const TOKEN = /[\p{L}\p{M}]+(?:['’ʼ-][\p{L}\p{M}]+)*/gu;
const tokens = (s) => (norm(s).match(TOKEN) ?? []);
const stripHtml = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

async function eachLine(file, fn) {
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) fn(line);
}

function loadExpressions(lang) {
  const file = path.join(WIKT, `${NAMES[lang]}-English Wiktionary dictionary.tsv`);
  const map = new Map(); // joined tokens -> { text, gloss, n }
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const heads = line.slice(0, tab).split('|');
    const html = line.slice(tab + 1);
    if (/<i>(name|proper noun)<\/i>/.test(html)) continue;
    const glosses = [...html.matchAll(/<li>(.*?)<\/li>/g)].map((m) => stripHtml(m[1])).filter((g) => g && !/^(alternative|obsolete|archaic|misspelling|nonstandard) (form|spelling) of/i.test(g));
    if (!glosses.length) continue;
    const gloss = glosses.slice(0, 2).join('; ').slice(0, 90);
    for (const h of heads) {
      if (/^[\x00-\x7f]+$/.test(h) && (lang === 'ru' || lang === 'uk')) continue; // transliteration
      const t = tokens(h);
      if (t.length < 2 || t.length > 4) continue;
      const key = t.join(' ');
      if (!map.has(key)) map.set(key, { text: h.replace(/́/g, ''), gloss, n: t.length });
    }
  }
  return map;
}

async function loadCorpus(lang) {
  const seen = new Set();
  const out = [];
  const add = (s) => {
    const k = s.trim();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  };
  for (const sub of ['dev', 'devtest']) {
    const dir = path.join(TC, sub, `eng-${TC_CODE[lang]}`);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) await eachLine(path.join(dir, f), (line) => {
      const c = line.split('\t');
      if (c.length >= 4) add(c[3]);
    });
  }
  for (const d of readdirSync(UD).filter((x) => x.startsWith(UD_PREFIX[lang]))) {
    for (const f of readdirSync(path.join(UD, d)).filter((x) => x.endsWith('.conllu'))) {
      await eachLine(path.join(UD, d, f), (line) => {
        if (line.startsWith('# text = ')) add(line.slice(9));
      });
    }
  }
  return out;
}

mkdirSync(path.join(OUT, 'in'), { recursive: true });
mkdirSync(path.join(OUT, 'data'), { recursive: true });

for (const lang of LANGS) {
  const set = JSON.parse(readFileSync(path.join(ROOT, 'data/frequency', `${lang}.json`), 'utf8'));
  const entries = set.entries;
  const exprs = loadExpressions(lang);
  const corpus = await loadCorpus(lang);
  for (const e of entries) for (const x of e.examples ?? []) corpus.push(x.text);

  // word token sets
  const wordTokens = entries.map((e) => {
    const s = new Set([e.lemma, ...(e.forms ?? []).map((f) => f.form)].map((x) => tokens(x).join(' ')).filter(Boolean));
    return s;
  });
  // index: single-token or multi-token key -> word ids
  const keyToWords = new Map();
  wordTokens.forEach((s, i) => s.forEach((k) => (keyToWords.get(k) ?? keyToWords.set(k, []).get(k)).push(i)));
  // expressions per word: expression contains one of the word's keys as a contiguous token run and is longer
  const exprByWord = entries.map(() => []);
  for (const [key, x] of exprs) {
    const t = key.split(' ');
    const hit = new Set();
    for (let a = 0; a < t.length; a++) for (let b = a + 1; b <= t.length; b++) {
      if (b - a === t.length) continue;
      for (const w of keyToWords.get(t.slice(a, b).join(' ')) ?? []) hit.add(w);
    }
    for (const w of hit) exprByWord[w].push(key);
  }
  // corpus counts
  const wordCount = new Int32Array(entries.length);
  const exprCount = new Map();
  const maxKey = Math.max(4, ...[...keyToWords.keys()].map((k) => k.split(' ').length));
  for (const s of corpus) {
    const t = tokens(s);
    const wHit = new Set();
    const xHit = new Set();
    for (let i = 0; i < t.length; i++) {
      let key = '';
      for (let n = 1; n <= maxKey && i + n <= t.length; n++) {
        key = n === 1 ? t[i] : `${key} ${t[i + n - 1]}`;
        for (const w of keyToWords.get(key) ?? []) wHit.add(w);
        if (n >= 2 && n <= 4 && exprs.has(key)) xHit.add(key);
      }
    }
    for (const w of wHit) wordCount[w]++;
    for (const k of xHit) exprCount.set(k, (exprCount.get(k) ?? 0) + 1);
  }

  // Related entries in the same list: same spelling, or one is a form of the other (это and этот, всё and весь).
  const lemmaKey = entries.map((e) => tokens(e.lemma).join(' '));
  const byLemma = new Map();
  lemmaKey.forEach((k, i) => (byLemma.get(k) ?? byLemma.set(k, []).get(k)).push(i));
  const relatedOf = (i) => {
    const out = new Map();
    for (const j of byLemma.get(lemmaKey[i]) ?? []) if (j !== i) out.set(j, 'same spelling');
    for (const j of keyToWords.get(lemmaKey[i]) ?? []) if (j !== i && !out.has(j)) out.set(j, 'this word is one of its forms');
    for (const k of wordTokens[i]) for (const j of byLemma.get(k) ?? []) if (j !== i && !out.has(j)) out.set(j, 'one of this word\'s forms');
    return [...out].sort((a, b) => a[0] - b[0]).slice(0, 4);
  };

  const words = [];
  const lines = [];
  let flagged = 0;
  let hinted = 0;
  entries.forEach((e, i) => {
    const mine = new Set(exprByWord[i]);
    const examples = (e.examples ?? []).map((x) => {
      const t = tokens(x.text);
      const target = tokens(x.target ?? '').join(' ');
      const tt = target.split(' ');
      let pos = -1;
      for (let p = 0; p + tt.length <= t.length; p++) if (t.slice(p, p + tt.length).join(' ') === target) { pos = p; break; }
      let inExpr = null;
      if (pos >= 0) {
        for (let n = 4; n >= 2 && !inExpr; n--) for (let a = Math.max(0, pos + tt.length - n); a <= pos && !inExpr; a++) {
          if (a + n > t.length) continue;
          const key = t.slice(a, a + n).join(' ');
          if (mine.has(key)) inExpr = key;
        }
      }
      if (inExpr) flagged++;
      return { text: x.text, translation: x.translation ?? null, target: x.target, source: x.source, ref: x.ref ?? null, inExpr };
    });
    const total = wordCount[i] || 0;
    const combos = [...mine]
      .map((k) => ({ key: k, count: exprCount.get(k) ?? 0 }))
      .filter((c) => c.count >= 3 && total && c.count / total >= 0.15)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((c) => ({ text: exprs.get(c.key).text, gloss: exprs.get(c.key).gloss, share: Math.round((100 * c.count) / total) }));
    if (combos.length) hinted++;
    const word = {
      id: i + 1,
      rank: e.frequencyRank,
      lemma: e.lemma,
      display: e.display ?? null,
      pos: e.pos,
      gender: e.gender ?? null,
      aspect: e.aspect ?? null,
      senses: e.senses.map((s) => ({ gloss: s.gloss, note: s.note ?? null, definition: s.definition ?? null })),
      examples,
      combos,
      forms: [...wordTokens[i]],
      related: relatedOf(i).map(([j, why]) => ({ id: j + 1, why })),
    };
    words.push(word);
    const head = [e.display || e.lemma, e.display && e.display.replace(/́/g, '') !== e.lemma ? `(${e.lemma})` : '', '·', e.pos, e.gender ?? '', e.aspect ? `${e.aspect}` : ''].filter(Boolean).join(' ');
    const block = [`@${word.id} ${head}`];
    e.senses.forEach((s, k) => block.push(`S${k + 1} ${s.gloss}${s.note ? ` [${s.note}]` : ''}`));
    examples.forEach((x, k) => {
      const hint = x.inExpr ? ` ⟨in "${exprs.get(x.inExpr).text}" = ${exprs.get(x.inExpr).gloss}⟩` : '';
      block.push(`E${k + 1} ${x.text}${x.translation ? ` | ${x.translation}` : ''} [${x.source}]${hint}`);
    });
    for (const c of combos) block.push(`C ${c.text} = ${c.gloss} (${c.share}% of uses)`);
    for (const [j, why] of relatedOf(i)) {
      const o = entries[j];
      block.push(`O @${j + 1} ${o.display || o.lemma} · ${o.pos}: ${o.senses.slice(0, 3).map((x) => x.gloss).join('; ').slice(0, 110)} (${why})`);
    }
    lines.push(block.join('\n'));
  });
  writeFileSync(path.join(OUT, 'data', `${lang}.json`), JSON.stringify(words));
  // all blocks in one file; slice.mjs cuts review chunks from it
  writeFileSync(path.join(OUT, 'in', `${lang}.all.txt`), lines.join('\n\n') + '\n');
  const n = Math.ceil(lines.length / CHUNK);
  const bytes = Buffer.byteLength(lines.join('\n\n'));
  console.log(`${lang}: ${entries.length} words, corpus ${corpus.length} sentences, expressions ${exprs.size}, examples in a combination ${flagged}, words with combination hints ${hinted}, text ${(bytes / 1024).toFixed(0)} KB, ${n} chunks of ${CHUNK}`);
}
