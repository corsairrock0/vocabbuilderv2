// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Sentences on politics, war or living people: current or recent politics (politicians, parties, elections,
// governments and their quarrels, propaganda), war, armies and terrorism, violence (murders, shootings, beatings,
// abuse), and named real people who are alive. At the
// owner's request such example sentences are replaced by neutral ones, and Ukrainian sentences are kept off Russia and
// Russian themes and Russian sentences off Ukraine. Decisions: data/review/politics/<lang>.jsonl, one per line, in the
// same shape as the crude decisions (scripts/freq/crude.mjs):
//   { lemma, text, replace: { text, translation, target, sense? } } | { lemma, text, keep: true } | { lemma, text, drop: true }
// A decision applies whether or not the detector below matches; a sentence the detector matches with no decision is
// dropped, so a rebuild never lets an unreviewed one into the app.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const L = '[\\p{L}\\p{M}]*';
const s = (list) => list.map((w) => w.replace(/\*/g, L));

// English, matched against translations (case-insensitive). Broad on purpose: reviewers mark false matches as keep.
const EN = s([
  'president*', 'presidency', 'prime minister*', 'minister*', 'ministry', 'government*', 'parliament*', 'senat*', 'congress*',
  'election*', 'elected', 'vote*', 'voting', 'voter*', 'referendum*', 'politic*', 'candidate*', 'campaign*', 'democrat*',
  'republican*', 'communis*', 'socialis*', 'fascis*', 'nazi*', 'hitler', 'stalin*', 'lenin*', 'putin*', 'trump*', 'obama*',
  'biden*', 'clinton*', 'zelensk*', 'yanukovych*', 'poroshenko*', 'lukashenk*', 'merkel*', 'macron*', 'kremlin', 'white house',
  'nato', 'united nations', 'sanction*', 'protest*', 'revolution*', 'coup', 'dictator*', 'regime*', 'propaganda', 'war', 'wars',
  'warfare', 'wartime', 'army', 'armies', 'soldier*', 'troop*', 'military', 'navy', 'air force', 'weapon*', 'missile*', 'bomb*',
  'invasion', 'invad*', 'occupied', 'occupiers', 'terror*', 'explosion*', 'massacre*', 'genocide', 'refugee*', 'crimea*',
  'donbas*', 'donetsk', 'luhansk', 'lugansk', 'fsb', 'kgb', 'spetsnaz', 'separatist*', 'annex*', 'ceasefire', 'front line',
  'frontline', 'veteran*', 'partisan*', 'gun', 'guns', 'rifle*', 'shot dead', 'killed', 'assassinat*', 'hostage*', 'militant*',
  'insurgent*', 'rebel*', 'oligarch*', 'mayor', 'governor*', 'senator*', 'deputy', 'deputies', 'opposition',
  // Violence (added after the first Spanish and Portuguese reviews, which found murders and shootings the list missed).
  'murder*', 'kidnap*', 'abduct*', 'poisoned', 'poisoning', 'poisoner*', 'pistol*', 'revolver*', 'ammunition', 'ammo', 'trigger',
  'triggers', 'explosive*', 'shoot', 'shoots', 'shooting*', 'shooter*', 'shot him', 'shot her', 'shot them', 'shot me', 'shot you',
  'shot us', 'shot at', 'shot himself', 'shot herself', 'shots', 'gunfire', 'gunshot*', 'gunman', 'gunmen', 'stab', 'stabs', 'stabbed',
  'stabbing*', 'strangl*', 'hijack*', 'enemy', 'enemies', 'surrender*', 'battle*', 'combat*', 'sniper*', 'grenade*', 'assassin',
  'assassins', 'slaughter*', 'kill', 'kills', 'killing*', 'killer*', 'torture*', 'tortured', 'concentration camp*', 'gas chamber*',
  'holocaust', 'bloodshed', 'violence', 'violent*', 'attack*', 'revolt*', 'riot*', 'hanged', 'behead*', 'lynch*', 'execution*',
  'executed', 'warrior*', 'conquer*', 'invader*', 'fighter*', 'firing squad', 'armed', 'massacr*', 'raid*',
  // Found in the reviewers' notes after the second scan.
  'poison', 'poisons', 'fighting', 'shootout*', 'gunpoint', 'assault*', 'corpse*', 'dead body', 'dead bodies', 'mutin*', 'abortion*',
  'corrupt*', 'suicid*', 'hang himself', 'hang herself', 'hanged himself', 'hanged herself', 'air strike*', 'airstrike*', 'overthrow*',
  'uprising*', 'insurrection*', 'superpower*', 'world power*', 'underground movement*', 'air support', 'polls', 'political part*',
  // A third round, from the Spanish and Portuguese reviewers' lists of sentences both scans missed.
  'shot', 'shotgun*', 'handgun*', 'firearm*', 'punch', 'punched', 'punches', 'punching', 'slap', 'slapped', 'slaps', 'slapping', 'mugged',
  'mugger*', 'mugging*', 'beaten up', 'beat him', 'beat her', 'beat me', 'beat them', 'beat up', 'beatings', 'a beating', 'abuse*',
  'abusing', 'abusive', 'mistreat*', 'maltreat*', 'flog*', 'whipped him', 'whipped her', 'thug*', 'knife to', 'at knifepoint',
  'fingerprints', 'captor*', 'held captive', 'fugitive*', 'death row', 'death penalty', 'prisoner of war', 'prisoners of war', 'gang', 'gangs',
  'gangster*', 'blood(?!\\s+(?:pressure|types?|tests?|donors?|donations?|sugar|vessels?|banks?|groups?|cells?|counts?|samples?|orange))', 'bloodied', 'bloodstain*',
  'demonstration*', 'demonstrator*', 'strike', 'strikes', 'strikers', 'civil unrest', 'Franco', 'Mussolini', 'Fujimori', 'Churchill',
  'Kennedy', 'Napoleon*', 'Soviet*', 'USSR', 'tensions', 'alliance*', 'allies', 'allied', 'sovereignty', 'aggression', 'aggressor*',
  'clashes', 'clashed', 'platoon*', 'battalion*', 'regiment*', 'deployment of', 'nuclear', 'head of state', 'coalition*', 'capitalis*',
  'colonial*', 'censor*', 'ideolog*', 'anarch*', 'authoritarian*', 'privati*', 'decriminali*', 'manifesto*', 'constitution*',
  'party leader*', 'of the party', 'immigrant*', 'immigration', 'oppress*', 'freedom of speech', 'freedom of expression', 'liberat*',
  'patriot*', 'reich', 'gestapo', 'swastika*', 'extremis*', 'flee', 'flees', 'fleeing', 'fled', 'exile*',
]);
// Russia and Ukraine named in the translation: worth a look in every set but the country's own (the Ukrainian set
// keeps off Russia and the Russian set off Ukraine through the lists below).
const EN_RUSSIA = s(['russia*', 'moscow*', 'muscovite*']);
const EN_UKRAINE = s(['ukrain*', 'kyiv*', 'kiev*']);

const TARGET = {
  es: s(['president*', 'ministr*', 'gobiern*', 'parlament*', 'congres*', 'senad*', 'eleccion*', 'elector*', 'votar', 'vot[oóea]*',
    'polític*', 'partido político', 'candidat*', 'campaña electoral', 'democr*', 'comunis*', 'socialis*', 'fascis*', 'nazi*',
    'guerra*', 'guerriller*', 'ejércit*', 'soldad*', 'militar*', 'arma', 'armas', 'bomba*', 'terroris*', 'atentad*', 'Putin',
    'Trump', 'Obama', 'Biden', 'Zelensk*', 'Kremlin', 'OTAN', 'Crimea', 'Donbás', 'paramilitar*', 'FARC', 'ELN', 'alcald*', 'gobernador*']),
  pt: s(['president*', 'ministr*', 'govern[oa]*', 'parlament*', 'congress*', 'senad*', 'eleiç*', 'eleitor*', 'votar', 'vot[oeau]*',
    'polític*', 'candidat*', 'campanha eleitoral', 'democr*', 'comunis*', 'socialis*', 'fascis*', 'nazis*', 'guerra*',
    'exércit*', 'soldad*', 'militar*', 'arma', 'armas', 'bomba*', 'terroris*', 'atentad*', 'Putin', 'Trump', 'Obama', 'Biden',
    'Bolsonaro', 'Lula', 'Zelensk*', 'Kremlin', 'OTAN', 'Crimeia', 'prefeit*', 'governador*', 'deputad*']),
  vi: s(['tổng thống', 'chủ tịch nước', 'thủ tướng', 'bộ trưởng', 'chính phủ', 'quốc hội', 'bầu cử', 'bỏ phiếu', 'chính trị',
    'chính trị gia', 'ứng cử viên', 'đảng', 'cộng sản', 'phát xít', 'chiến tranh', 'quân đội', 'binh lính', 'người lính',
    'quân sự', 'vũ khí', 'bom', 'khủng bố', 'Putin', 'Trump', 'Obama', 'Biden', 'Kremlin', 'NATO', 'Crimea', 'biểu tình',
    'cách mạng', 'đảo chính', 'độc tài', 'tuyên truyền', 'trừng phạt']),
  ru: s(['президент*', 'министр*', 'правительств*', 'парламент*', 'Дум[аеуы]', 'депутат*', 'выбор[аыо]в?', 'выборах', 'голосова*',
    'референдум*', 'политик*', 'политическ*', 'партии', 'парти[яюей]', 'кандидат*', 'демократ*', 'коммунис*', 'социалис*',
    'фашис*', 'нацис*', 'войн[аыеуой]*', 'военн*', 'арми[яиюей]', 'солдат*', 'оружи*', 'бомб*', 'ракет*', 'террор*',
    'теракт*', 'Путин*', 'Трамп*', 'Обам*', 'Байден*', 'Зеленск*', 'Янукович*', 'Кремл*', 'НАТО', 'Крым*', 'крымск*', 'Донбасс*',
    'Донецк*', 'Луганск*', 'ФСБ', 'КГБ', 'спецназ*', 'сепаратист*', 'Украин*', 'украин*', 'Киев*', 'киевск*', 'Харьков*',
    'Одесс*', 'Львов*', 'хохл*', 'бандер*', 'Сталин*', 'Ленин*', 'Гитлер*', 'олигарх*', 'губернатор*', 'мэр', 'мэра', 'мэру', 'мэром', 'мэре', 'мэры', 'мэров', 'мэрия', 'мэрии', 'санкци*',
    'протест*', 'митинг*', 'революци*', 'оппозици*']),
  uk: s(['президент*', 'міністр*', 'уряд*', 'парламент*', 'Верховн* Рад*', 'депутат*', 'вибор*', 'голосува*', 'референдум*',
    'політик*', 'політичн*', 'парті[їяюєй]*', 'кандидат*', 'демократ*', 'комуніс*', 'соціаліс*', 'фашис*', 'нацис*', 'війн*',
    'воєнн*', 'військ*', 'арм[іїя]*', 'солдат*', 'зброя', 'зброї', 'зброю', 'бомб*', 'ракет*', 'терор*', 'теракт*', 'Путін*',
    'Трамп*', 'Обам*', 'Байден*', 'Зеленськ*', 'Янукович*', 'Кремл*', 'НАТО', 'Крим*', 'кримськ*', 'Донбас*', 'Донецьк*',
    'Луганськ*', 'ФСБ', 'КДБ', 'сепаратист*', 'Росі[їяює]*', 'росі[йя]*', 'російськ*', 'росіян*', 'Москв*', 'москов*',
    'москал*', 'рашист*', 'окупант*', 'окупац*', 'Сталін*', 'Ленін*', 'Гітлер*', 'олігарх*', 'губернатор*', 'мер', 'мера',
    'санкці*', 'протест*', 'революці*', 'опозиці*', 'УПА', 'ОУН', 'Бандер*', 'дивізі*', 'СС']),
  pl: s(['prezydent*', 'premier*', 'ministr*', 'minister*', 'rząd*', 'rządow*', 'sejm*', 'senat*', 'parlament*', 'posł*',
    'poseł*', 'wybor*', 'głosowa*', 'referend*', 'polityk*', 'polityczn*', 'parti[ia]*', 'kandydat*', 'demokra*', 'komunis*',
    'socjalis*', 'faszys*', 'nazis*', 'hitlerow*', 'wojn*', 'wojsk*', 'armi[ia]*', 'żołnierz*', 'broń', 'broni', 'bomb*',
    'rakiet*', 'terror*', 'zamach*', 'Putin*', 'Trump*', 'Obam*', 'Biden*', 'Zełensk*', 'Kreml*', 'NATO', 'Krym*', 'Donbas*',
    'sankcj*', 'protest*', 'rewolucj*', 'opozycj*', 'Kaczyńsk*', 'Tusk*', 'Duda', 'Dudy', 'Dudzie', 'Dudą', 'burmistrz*',
    'wojewod*']),
};

const boundary = (alts, flags) => new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${alts.map((w) => w.replace(/ /g, '\\s+')).join('|')})(?![\\p{L}\\p{M}\\p{N}])`, flags);
const EN_RE = boundary(EN, 'giu');
const EN_RUSSIA_RE = boundary(EN_RUSSIA, 'giu');
const EN_UKRAINE_RE = boundary(EN_UKRAINE, 'giu');
const TARGET_RE = Object.fromEntries(Object.entries(TARGET).map(([l, alts]) => [l, boundary(alts, 'giu')]));
const strip = (t) => (t ?? '').normalize('NFC').replace(/́/g, '');

/** The matched words that may put a sentence on politics, war or living people, or [] when none match. */
export function politicsHits(lang, text, translation) {
  const hits = [];
  for (const m of strip(translation).matchAll(EN_RE)) hits.push(m[0].toLowerCase());
  if (lang !== 'ru') for (const m of strip(translation).matchAll(EN_RUSSIA_RE)) hits.push(m[0].toLowerCase());
  if (lang !== 'uk') for (const m of strip(translation).matchAll(EN_UKRAINE_RE)) hits.push(m[0].toLowerCase());
  const re = TARGET_RE[lang];
  if (re) for (const m of strip(text).matchAll(re)) hits.push(m[0].toLowerCase());
  return [...new Set(hits)];
}

const textKey = (t) => t.normalize('NFC').replace(/́/g, '').replace(/\s+/g, ' ').trim();

export function politicsFile(lang) {
  return fileURLToPath(new URL(`../../data/review/politics/${lang}.jsonl`, import.meta.url));
}

/** lemma + sentence → decision. */
export function loadPoliticsDecisions(lang, file = politicsFile(lang)) {
  const map = new Map();
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    map.set(`${r.lemma}\t${textKey(r.text)}`, r);
  }
  return map;
}

export const POLITICS_CREDIT = 'Written by AI (Claude) in November 2026 to replace a sentence on politics, war or a living person; not checked by a native speaker';

/**
 * Replace, keep or drop sentences on politics, war or living people (in place). Returns { credits, stats, open }.
 * `enforce`: drop sentences the detector matches with no decision (on once a language's review is in place).
 */
export function applyPolitics(lang, entries, decisions, credits = [], enforce = decisions.size > 0) {
  const stats = { checked: 0, replaced: 0, dropped: 0, kept: 0, undecided: 0 };
  const open = [];
  const added = [];
  for (const e of entries) {
    const out = [];
    for (const x of e.examples ?? []) {
      stats.checked++;
      const d = decisions.get(`${e.lemma}\t${textKey(x.text)}`);
      if (d?.replace) {
        const sense = Number.isInteger(d.replace.sense) && d.replace.sense < (e.senses?.length ?? 0) ? d.replace.sense : x.sense;
        out.push({ ...x, text: d.replace.text, translation: d.replace.translation, target: d.replace.target, source: 'ai-claude', ref: null, sense });
        added.push({ lemma: e.lemma, text: d.replace.text, credit: POLITICS_CREDIT });
        stats.replaced++;
        continue;
      }
      if (d?.drop) {
        stats.dropped++;
        continue;
      }
      const hits = politicsHits(lang, x.text, x.translation);
      if (!hits.length || d?.keep || !enforce) {
        if (hits.length && d?.keep) stats.kept++;
        const sense = d?.keep && Number.isInteger(d.sense) && d.sense < (e.senses?.length ?? 0) ? d.sense : x.sense;
        out.push(sense === x.sense ? x : { ...x, sense });
        continue;
      }
      stats.undecided++;
      open.push({ lemma: e.lemma, pos: e.pos, rank: e.frequencyRank, text: x.text, translation: x.translation, target: x.target, hits });
    }
    e.examples = out;
  }
  const present = new Set(entries.flatMap((e) => (e.examples ?? []).map((x) => `${e.lemma}\t${textKey(x.text)}`)));
  return { credits: [...credits.filter((c) => present.has(`${c.lemma}\t${textKey(c.text)}`)), ...added], stats, open };
}

export function politicsReport(stats) {
  if (!stats.replaced && !stats.dropped && !stats.kept) return [];
  return [
    '## Sentences on politics, war or living people',
    '',
    `Sentences on politics, war or violence, or that name living people, are left out of this app (and, in the Ukrainian and Russian sets, sentences on the other country). ${stats.replaced.toLocaleString('en')} were replaced by AI-written sentences that use the word the same way, ${(stats.dropped + stats.undecided).toLocaleString('en')} were dropped, and ${stats.kept.toLocaleString('en')} more matched a keyword without being on these subjects.`,
    '',
  ];
}
