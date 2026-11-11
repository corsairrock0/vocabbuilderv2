// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// The frequency-set build (scripts/freq): Wiktionary parsing, lemmatization, and the shipped data files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PARTS_OF_SPEECH } from '../../shared/languages.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const load = async (rel: string): Promise<any> => import(pathToFileURL(path.join(ROOT, rel)).href);

test('Wiktionary glosses: labels, pointers, meanings carried by form-of glosses, contractions', async () => {
  const { parseSense, splitLabels } = await load('scripts/freq/wiktionary.mjs');
  assert.deepEqual(splitLabels('(Brazil, colloquial) dog'), { labels: ['Brazil', 'colloquial'], text: 'dog' });
  assert.deepEqual(splitLabels('[+prepositional] in, at'), { labels: ['+prepositional'], text: 'in, at' });
  assert.deepEqual(splitLabels('(with a, para)'), { labels: [], text: '(with a, para)' }, 'an all-label gloss is kept as text');

  assert.equal(parseSense('plural of casa').pointer, 'casa');
  assert.equal(parseSense('third-person singular present indicative of ser').pointer, 'ser');
  assert.equal(parseSense('inflection of casar: third-person singular present indicative').pointer, 'casar');
  assert.equal(parseSense('Alternative form of проє́кт: project, design').pointer, 'проє́кт', 'spelling variants are always re-routed');

  const mi = parseSense('apocopic form of "mío", my');
  assert.equal(mi.pointer, null, 'a form-of gloss with its own meaning is a real sense');
  assert.equal(mi.text, 'my');
  assert.deepEqual(mi.labels, ['apocopic form of mío']);

  const contraction = parseSense('Contraction of de o: of the');
  assert.equal(contraction.contraction, true);
  assert.equal(contraction.pointer, null);
  assert.equal(parseSense('rare word of praise').pointer, null);
});

test('form-of glosses from the 2022–23 extraction: glued apocopes and contraction meanings', async () => {
  const { parseSense } = await load('scripts/freq/wiktionary.mjs');
  const su = parseSense("(before the noun) Apocopic form of suyo His, her, its, one's, their, your (formal)");
  assert.equal(su.pointer, null);
  assert.equal(su.text, "his, her, its, one's, their, your (formal)");
  assert.deepEqual(su.labels, ['before the noun', 'Apocopic form of suyo']);
  assert.equal(parseSense('Clipping of ave Maria.').pointer, 'ave', 'only apocopes take a glued meaning');

  const meaning = (g: string) => [parseSense(g).text, parseSense(g).labels];
  assert.deepEqual(meaning('Contraction of a o (“to the”).'), ['to the', ['Contraction of a o']]);
  assert.deepEqual(meaning('Contraction of de o (“pertaining or relating to the”); of the; from the (masculine singular)'), ['of the; from the (masculine singular)', ['Contraction of de o']]);
  assert.deepEqual(meaning('Contraction of em uma (“in a”). (feminine of num)'), ['in a', ['Contraction of em uma', 'feminine of num']]);
  assert.deepEqual(meaning('Contraction of por o; by the; for the; through the'), ['by the; for the; through the', ['Contraction of por o']]);
  assert.equal(parseSense('Contraction of de (“of”) and ele (“him”)').text, 'Contraction of de (“of”) and ele (“him”)', 'one gloss per part: no single meaning');
});

test('flashcard glosses: the head before a long explanation, grammar brackets and headings moved out', async () => {
  const { shapeGloss } = await load('scripts/freq/wiktionary.mjs');
  const dog = 'dog (Any member of the subspecies Canis lupus familiaris, domesticated for thousands of years and of variable appearance)';
  assert.deepEqual(shapeGloss(dog), { gloss: 'dog', definition: dog });
  assert.equal(shapeGloss('to put (something) on (oneself), to dress oneself in, to wear, to don clothes or accessories of any kind at all').gloss, 'to put (something) on (oneself), to dress oneself in, to wear', 'short parentheses are not cut points');
  assert.equal(shapeGloss('translated as "to like", but uses a construction similar to "to please" (with the subject and object swapped)').gloss, 'translated as "to like"', 'a long head is cut at a separator instead');
  assert.deepEqual(shapeGloss('to wait [+ na (accusative)]'), { gloss: 'to wait', definition: 'to wait [+ na (accusative)]' });
  assert.equal(shapeGloss('chance, opportunity [+infinitive = to do what] or [+genitive = of what] or [+ na (accusative) = for what]').gloss, 'chance, opportunity');
  assert.equal(shapeGloss('chocolate (food made from cocoa beans) [from 16th c.]').gloss, 'chocolate (food made from cocoa beans)');
  assert.equal(shapeGloss('to be [in a fixed location]').gloss, 'to be [in a fixed location]', 'placeholders in brackets stay');
  assert.equal(shapeGloss('used to express necessity: (one) must (one) has to (it is) necessary (impersonal, + dative (optionally) + infinitive)').gloss, 'used to express necessity: (one) must (one) has to (it is) necessary');
  assert.equal(shapeGloss('world, earth, universe:').gloss, 'world, earth, universe');
  assert.equal(shapeGloss('either, or').gloss, 'either, or');
});

test('not vocabulary meanings: letter names, notes, chess pieces, sum-of-parts notes, single-letter symbols', async () => {
  const { parseSense, usableBlocks } = await load('scripts/freq/wiktionary.mjs');
  const glosses = (word: string, pos: string, ...gs: string[]) =>
    usableBlocks([{ word, forms: [], blocks: [{ pos, senses: gs.map((g) => parseSense(g)) }] }]).flatMap((u: any) => u.senses.map((s: any) => s.text));
  assert.deepEqual(glosses('экс', 'noun', 'X, x'), []);
  assert.deepEqual(glosses('до', 'noun', 'C'), [], 'a musical note');
  assert.deepEqual(glosses('я', 'pron', 'I'), ['I'], 'the pronoun I is a meaning');
  assert.deepEqual(glosses('о', 'noun', 'The name of the Cyrillic script letter О.'), []);
  assert.deepEqual(glosses('é', 'noun', 'e (name of the letter E, e)'), []);
  assert.deepEqual(glosses('r', 'noun', 'the letter r'), []);
  assert.deepEqual(glosses('ê', 'noun', 'The close-mid front unrounded vowel.'), []);
  assert.deepEqual(glosses('một cách', 'phrase', 'Used other than figuratively or idiomatically: see một, cách.'), []);
  assert.deepEqual(glosses('t', 'noun', 'Abbreviation of tiempo: time'), [], 'a single letter as an abbreviation');
  assert.deepEqual(glosses('h', 'noun', 'used to indicate time in relation to a 24-hour clock'), []);
  assert.deepEqual(glosses('вуз', 'noun', 'acronym of высшее учебное заведение: university, college'), ['university, college'], 'longer acronyms keep their meaning');
  assert.deepEqual(usableBlocks([{ word: 'T', forms: [], blocks: [{ pos: 'noun', senses: [parseSense('adaptor')] }] }]), [], 'a single capital letter is not an all-capitals word');
  assert.equal(usableBlocks([{ word: 'TV', forms: [], blocks: [{ pos: 'noun', senses: [parseSense('TV')] }] }]).length, 1);
});

test('long glosses are shortened at a separator and kept whole as the definition', async () => {
  const { shapeGloss } = await load('scripts/freq/wiktionary.mjs');
  assert.deepEqual(shapeGloss('water'), { gloss: 'water', definition: null });
  const long = 'house, building (a residential building), home, dwelling, residence, abode, lodging, accommodation';
  const r = shapeGloss(long);
  assert.ok(r.gloss.length <= 90 && long.startsWith(r.gloss));
  assert.equal(r.definition, long);
});

test('senses: the corpus part of speech picks the block; target-region senses come first; obsolete ones go', async () => {
  const { chooseSenses, parseSense } = await load('scripts/freq/wiktionary.mjs');
  const h = { word: 'cachorro', forms: [], blocks: [] };
  const usable = [
    { headword: h, wiktPos: 'adj', pos: 'adjective', block: {}, senses: [parseSense('canine')] },
    { headword: h, wiktPos: 'noun', pos: 'noun', block: {}, senses: [parseSense('(Portugal) puppy'), parseSense('(obsolete) cub'), parseSense('(Brazil, colloquial) dog')] },
  ];
  const r = chooseSenses(usable, 'pt', { preferredFamily: ['noun'] });
  assert.equal(r.main.pos, 'noun');
  assert.deepEqual(r.senses.map((s: any) => s.gloss), ['dog', 'puppy', 'canine']);
  assert.match(r.senses[2].note, /As an adjective/);
  assert.ok(!r.senses.some((s: any) => s.gloss === 'cub'), 'obsolete senses are dropped when others exist');
});

test('spelling variants: Portuguese reform and Brazilian spellings, Vietnamese tone placement and i/y', async () => {
  const { portugueseVariants, vietnameseKey } = await load('scripts/freq/attach.mjs');
  assert.deepEqual(portugueseVariants('idéia')[0], { k: 'ideia', keepSpelling: false, note: 'Older spelling: idéia.' });
  assert.equal(portugueseVariants('gênero').find((v: any) => v.keepSpelling).k, 'género');
  assert.deepEqual(portugueseVariants('casa'), []);
  assert.equal(vietnameseKey('hòa'), vietnameseKey('hoà'));
  assert.equal(vietnameseKey('quản lý'), vietnameseKey('quản lí'));
  assert.equal(vietnameseKey('kỹ thuật'), vietnameseKey('kĩ thuật'));
  assert.notEqual(vietnameseKey('ma'), vietnameseKey('má'), 'tones still distinguish words');
});

test('lemmatization: treebank decides frequent forms, evidence splits the rest, unknown forms are reported', async () => {
  const { lemmatize } = await load('scripts/freq/lemmatize.mjs');
  const known = new Set(['para', 'parar', 'casa', 'casar', 'rosa']);
  const resolver = { has: (k: string) => known.has(k), hasEntry: (k: string) => known.has(k), resolve: (k: string) => (known.has(k) ? k : null), pointers: () => [] };
  const lexicon = {
    forms: new Map<string, Set<string>>([
      ['para', new Set(['para', 'parar'])],
      ['parou', new Set(['parar'])],
      ['casa', new Set(['casa', 'casar'])],
      ['casas', new Set(['casa', 'casar'])],
      ['casou', new Set(['casar'])],
    ]),
  };
  const treebank = {
    formLemma: new Map([['para', new Map([['para', 95], ['parar', 5]])]]),
    formLemmaPos: new Map([['para', new Map([['para\tADP', 95], ['parar\tVERB', 5]])]]),
    mwt: new Map(),
  };
  const list = [
    { word: 'para', count: 1000 },
    { word: 'parou', count: 20 },
    { word: 'casa', count: 300 },
    { word: 'casas', count: 60 },
    { word: 'casou', count: 10 },
    { word: 'xyzzy', count: 50 },
    { word: '123', count: 5 },
  ];
  const r = lemmatize(list, { lang: 'pt', lexicon, treebank, resolver });
  const count = (l: string) => r.lemmas.get(l)?.count ?? 0;
  assert.ok(count('para') > 900, `para stays the preposition (${count('para')})`);
  assert.ok(count('parar') >= 20 && count('parar') < 100);
  assert.ok(count('casa') > count('casar'), 'the noun casa outweighs the verb casar');
  assert.deepEqual(r.unassigned.map((u: any) => u.word), ['xyzzy']);
  assert.equal(r.stats.skippedTokens, 5, 'non-words are not counted');
});

test('names shared with another language’s subtitles are subtracted, real words are kept', async () => {
  const { subtractSharedNames } = await load('scripts/freq/rank.mjs');
  const list = [
    { word: 'jack', count: 100 },
    { word: 'tom', count: 150 },
    { word: 'casa', count: 400 },
  ];
  const ref = [
    { word: 'jack', count: 100 },
    { word: 'tom', count: 100 },
    { word: 'casa', count: 450 }, // same corpus size (650 tokens), so expected name counts are not rescaled
  ];
  const r = subtractSharedNames(list, ref, (k: string) => k === 'casa', 'pt', 'es');
  const out = Object.fromEntries(r.list.map((x: any) => [x.word, Math.round(x.count)]));
  assert.equal(out.jack, undefined, 'a name with no surplus disappears');
  assert.equal(out.tom, 50, 'tom keeps its surplus over the shared name');
  assert.equal(out.casa, 400, 'a word of the reference language is never subtracted');
});

test('Kaikki.org JSONL: sub-senses keep their parent gloss, form-of entries point, labels and IPA are read', async () => {
  const { loadKaikkiDictionary, lookup, usableBlocks, pointerTargets } = await load('scripts/freq/wiktionary.mjs');
  const dict = await loadKaikkiDictionary(path.join(ROOT, 'tests/fixtures/freq/kaikki-pt.jsonl'), 'pt');
  assert.equal(lookup(dict, 'water', 'pt').length, 0, 'other languages are skipped');
  const casa = usableBlocks(lookup(dict, 'casa', 'pt'));
  assert.deepEqual(casa.map((u: any) => u.pos), ['noun'], 'the verb block only points to casar');
  assert.equal(casa[0].senses[0].text, 'house (structure serving as an abode of human beings)');
  assert.equal(casa[0].block.ipa, '/ˈka.za/', 'the Brazilian pronunciation is preferred');
  assert.equal(casa[0].block.examples[0].translation, 'That house is big.');
  assert.deepEqual(pointerTargets(lookup(dict, 'casas', 'pt')), ['casa']);
  const dog = usableBlocks(lookup(dict, 'cachorro', 'pt'))[0].senses;
  assert.deepEqual(dog[1].labels, ['Brazil', 'colloquial']);
  assert.equal(usableBlocks(lookup(dict, 'do', 'pt'))[0].pos, 'contraction');
  assert.equal(usableBlocks(lookup(dict, 'lisboa', 'pt')).length, 0, 'proper nouns are not vocabulary');
});

test('attach: definitions from the main dictionary, a tagged fallback, skipped words, consecutive ranks', async () => {
  const { attach } = await load('scripts/freq/attach.mjs');
  const { parseSense } = await load('scripts/freq/wiktionary.mjs');
  const hw = (word: string, pos: string, ...glosses: string[]) => [{ word, forms: [], blocks: [{ pos, senses: glosses.map((g) => parseSense(g)), gender: null, usage: null }] }];
  const main = new Map<string, any>([['вода', hw('вода', 'noun', 'water')], ['да', [{ word: 'да', forms: [], blocks: [{ pos: 'particle', senses: [parseSense('let')] }, { pos: 'adv', senses: [parseSense('yes')] }] }]]]);
  const fallback = new Map<string, any>([['за', hw('за', 'prep', 'behind')]]);
  const ranked = [
    { lemma: 'вода', spelling: 'вода', count: 30, forms: [['воду', 10, 1]], upos: { NOUN: 5 } },
    { lemma: 'ксенон', spelling: 'ксенон', count: 20, forms: [], upos: null },
    { lemma: 'за', spelling: 'за', count: 15, forms: [], upos: { ADP: 9 } },
    { lemma: 'да', spelling: 'да', count: 10, forms: [], upos: { PART: 9 } },
  ];
  const r = attach('uk', ranked, { dicts: [{ name: 'wiktionary', dict: main, tag: null }, { name: 'other', dict: fallback, tag: 'fallback-dictionary' }], top: 10 });
  assert.deepEqual(r.entries.map((e: any) => [e.frequencyRank, e.lemma, e.senses[0].gloss]), [
    [1, 'вода', 'water'],
    [2, 'за', 'behind'],
    [3, 'да', 'let'],
  ]);
  assert.deepEqual(r.entries[1].tags, ['fallback-dictionary']);
  assert.deepEqual(r.entries[0].forms.map((f: any) => f.form), ['воду']);
  assert.deepEqual(r.skipped, [{ position: 2, lemma: 'ксенон', count: 20 }]);
});

test('attach: a word tagged as an adposition without a preposition section opens with its adverb or conjunction use', async () => {
  const { attach } = await load('scripts/freq/attach.mjs');
  const { parseSense } = await load('scripts/freq/wiktionary.mjs');
  const blocks = (...b: [string, string][]) => b.map(([pos, g]) => ({ pos, senses: [parseSense(g)], gender: null, usage: null }));
  const dict = new Map<string, any>([
    ['của', [{ word: 'của', forms: [], blocks: blocks(['noun', 'property; belongings'], ['conj', 'of (belonging to or associated with)']) }]],
    ['salvo', [{ word: 'salvo', forms: [], blocks: blocks(['adj', 'safe'], ['adv', 'except, apart from'], ['conj', 'unless']) }]],
  ]);
  const vi = attach('vi', [{ lemma: 'của', spelling: 'của', count: 9, forms: [], upos: { ADP: 569, NOUN: 3 } }], { dicts: [{ name: 'wiktionary', dict, tag: null }], top: 5 });
  assert.equal(vi.entries[0].pos, 'conjunction');
  assert.equal(vi.entries[0].senses[0].gloss, 'of (belonging to or associated with)');
  const es = attach('es', [{ lemma: 'salvo', spelling: 'salvo', count: 9, forms: [], upos: { ADP: 40, ADJ: 2 } }], { dicts: [{ name: 'wiktionary', dict, tag: null }], top: 5 });
  assert.equal(es.entries[0].senses[0].gloss, 'except, apart from', 'the adverb section comes before the conjunction section');
});

const LANGS = ['es', 'pt', 'pl', 'ru', 'uk', 'vi'];

test('shipped frequency sets: the 6,000 most frequent words less those left out as crude, in rank order, every word defined, valid parts of speech', () => {
  for (const lang of LANGS) {
    const file = path.join(ROOT, 'data', 'frequency', `${lang}.json`);
    assert.ok(existsSync(file), `${lang}.json exists`);
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(doc.format, 'vocabbuilder-v1');
    assert.equal(doc.language, lang);
    assert.match(doc.source.kind, /^frequency_/);
    // Words that are crude in every meaning are left out (data/review/crude/<lang>-words.jsonl): their ranks are gaps.
    const wordsFile = path.join(ROOT, 'data', 'review', 'crude', `${lang}-words.jsonl`);
    const left = existsSync(wordsFile) ? readFileSync(wordsFile, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
    const gaps = new Set(left.map((r: any) => r.rank));
    const ranks = Array.from({ length: 6000 }, (_, i) => i + 1).filter((r) => !gaps.has(r));
    assert.equal(doc.entries.length, 6000 - left.length, `${lang} has 6,000 words less the ${left.length} left out as crude`);
    const seen = new Set<string>();
    doc.entries.forEach((e: any, i: number) => {
      assert.equal(e.frequencyRank, ranks[i], `${lang} rank order at ${i}`);
      assert.ok(e.lemma && /\p{L}/u.test(e.lemma), `${lang} lemma at ${i}`);
      assert.ok(e.senses.length > 0 && /[A-Za-z]/.test(e.senses[0].gloss), `${lang} ${e.lemma} has an English gloss`);
      assert.ok((PARTS_OF_SPEECH as readonly string[]).includes(e.pos), `${lang} ${e.lemma} pos ${e.pos}`);
      const k = `${e.lemma.toLowerCase()}|${e.pos}`;
      assert.ok(!seen.has(k), `${lang} duplicate ${k}`);
      seen.add(k);
    });
    assert.ok(existsSync(path.join(ROOT, 'data', 'frequency', 'reports', `${lang}.md`)), `${lang} report exists`);
  }
});
