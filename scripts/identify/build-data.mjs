// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Builds data/identify/identify.json, the scene data the server uses for the Identify practice.
//
//   node scripts/identify/build-data.mjs
//
// Inputs (all in data/identify/):
//   scene-plan.json     scenes, objects and the words that name each object per language (see README.md)
//   boxes.json          box and point per object, as Gemini found them (exported from the n8n table)
//   images.json         the web copies of the pictures (scripts/identify/make-images.py)
//   word-review.jsonl   optional: words checked against the finished pictures ({scene, n, lang, keep, drop, add, first})
// Objects with the same English label (singular and plural alike) get the same words, so a word is never right in
// one picture and wrong in another; for people only words without a gender note are shared. Then the review
// applies per picture: dropped words are left out, `add` takes words named for other objects, and `first` becomes
// the word asked for.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'data', 'identify');
const read = (f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
const plan = read('scene-plan.json');
const boxes = read('boxes.json').scenes;
const images = read('images.json').scenes;
const LANGS = ['es', 'pt', 'vi', 'ru', 'uk', 'pl'];

const review = new Map();
const reviewFile = path.join(dir, 'word-review.jsonl');
if (existsSync(reviewFile)) {
  for (const line of readFileSync(reviewFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    review.set(`${r.scene}:${r.n}:${r.lang}`, r);
  }
}

// The same thing under the same English label: "soldier" and "soldiers", "vegetable" and "vegetables".
const labelKey = (label) => {
  const l = label.toLowerCase().trim();
  if (/[^s]ies$/.test(l)) return l.slice(0, -3) + 'y';
  if (/[^s]s$/.test(l) && l.length > 3) return l.slice(0, -1);
  return l;
};
const PEOPLE =
  /\b(man|men|woman|women|boy|girl|child|children|kid|baby|teen|teenager|pupil|student|teacher|doctor|nurse|dentist|vet|veterinarian|cashier|waiter|waitress|chef|cook|driver|pilot|tourist|soldiers?|police|policeman|officer|firefighter|farmer|fisherman|worker|builder|mechanic|barber|hairdresser|journalist|reporter|actor|actress|singer|musician|dancer|player|athlete|runner|coach|referee|judge|priest|monk|nun|bride|groom|guest|customer|shopper|seller|vendor|beggar|gardener|graduate|crowd|audience|fans?|crew|passengers?|patient|surgeon|paramedic|archer|boxer|swimmer|skier|cyclist|scientist|painter|artist|photographer|postman|courier|guard|king|queen|grandmother|grandfather|mother|father|parent|twins?|family|couple|friend|neighbour|owner|baker|butcher|tailor|carpenter|plumber|electrician|engineer|clown|astronaut|sailor|captain|lifeguard|secretary|businessman|employee|cleaner|lady|gentleman|elderly|person|people|blind|pregnant|wheelchair|hiker|climber|jogger|rider|spectator|visitor|traveller|diver|surfer|skater|goalkeeper|footballer)\b/i;
const gendered = (w) => /^[mf](;|$)/.test(w.note ?? '');
const shared = new Map();
for (const s of plan.scenes) {
  for (const o of s.objects) {
    const key = labelKey(o.label);
    const person = PEOPLE.test(o.label);
    for (const lang of LANGS) {
      const bucket = shared.get(`${key}|${lang}`) ?? [];
      for (const w of o.words[lang] ?? []) if ((!person || !gendered(w)) && !bucket.some((b) => b.lemma === w.lemma)) bucket.push(w);
      shared.set(`${key}|${lang}`, bucket);
    }
  }
}
const lexicon = new Map();
for (const s of plan.scenes) for (const o of s.objects) for (const lang of LANGS) for (const w of o.words[lang] ?? []) lexicon.set(`${lang}|${w.lemma}`, w);

const problems = [];
let unified = 0;
const inRange = (v) => typeof v === 'number' && v >= 0 && v <= 1000;
let dropped = 0;
let reordered = 0;
const usedReview = new Set();
const scenes = plan.scenes.map((s) => {
  const img = images[s.id];
  const bx = boxes[s.id];
  if (!img) problems.push(`${s.id}: no picture in images.json`);
  if (!bx) problems.push(`${s.id}: no boxes in boxes.json`);
  return {
    id: s.id,
    title: s.title,
    w: img?.w ?? 0,
    h: img?.h ?? 0,
    src: img ? { 800: img['800'], 1600: img['1600'] } : {},
    objects: s.objects.map((o) => {
      const b = bx?.find((x) => x.id === o.n);
      const box = b?.box_2d;
      const point = b?.point;
      const ok = Array.isArray(box) && box.length === 4 && box.every(inRange) && box[0] < box[2] && box[1] < box[3] && Array.isArray(point) && point.length === 2 && point.every(inRange);
      if (!ok) problems.push(`${s.id} #${o.n}: no usable box and point`);
      const words = {};
      for (const lang of LANGS) {
        const own = o.words[lang] ?? [];
        const extra = (shared.get(`${labelKey(o.label)}|${lang}`) ?? []).filter((w) => !own.some((x) => x.lemma === w.lemma));
        unified += extra.length;
        let ws = [...own, ...extra].map((w) => [w.lemma, w.display]);
        const key = `${s.id}:${o.n}:${lang}`;
        const r = review.get(key);
        if (r) {
          usedReview.add(key);
          for (const l of r.add ?? []) {
            const w = lexicon.get(`${lang}|${l}`);
            if (!w) problems.push(`${key}: review adds "${l}", which names no object in this language`);
            else if (!ws.some((x) => x[0] === l)) ws.push([w.lemma, w.display]);
          }
          const all = new Set(ws.map((w) => w[0]));
          for (const l of [...(r.keep ?? []), ...(r.drop ?? [])]) if (!all.has(l)) problems.push(`${key}: review names "${l}", which is not a word of this object`);
          const drop = new Set(r.drop ?? []);
          dropped += ws.filter((w) => drop.has(w[0])).length;
          ws = ws.filter((w) => !drop.has(w[0]));
          if (r.first && ws.length && ws[0][0] !== r.first) {
            const i = ws.findIndex((w) => w[0] === r.first);
            if (i > 0) {
              ws = [ws[i], ...ws.slice(0, i), ...ws.slice(i + 1)];
              reordered++;
            }
          }
        }
        if (ws.length) words[lang] = ws;
      }
      return { n: o.n, o: o.object, label: o.label, point, box, words };
    }),
  };
});
for (const k of review.keys()) if (!usedReview.has(k)) problems.push(`review line for ${k} matches no object`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

const out = {
  format: 'vocabbuilder-identify',
  version: plan.version,
  credit: 'Pictures made with Google Gemini (Nano Banana 2.1) for VocabBuilder in 2026; objects located with Gemini Flash; words mapped from the frequency lists and checked against the pictures.',
  scenes,
};
writeFileSync(path.join(dir, 'identify.json'), JSON.stringify(out) + '\n');
const perLang = Object.fromEntries(LANGS.map((l) => [l, scenes.reduce((n, s) => n + s.objects.filter((o) => o.words[l]).length, 0)]));
console.log(`identify.json: ${scenes.length} scenes, ${scenes.reduce((n, s) => n + s.objects.length, 0)} objects; objects with words: ${JSON.stringify(perLang)}; ${unified} words shared between objects with the same label; review: ${review.size} lines, ${dropped} words dropped, ${reordered} reordered`);
