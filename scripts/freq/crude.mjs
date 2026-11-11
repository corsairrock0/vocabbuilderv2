// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Crude sentences: swearing, sexual content, slurs and vulgar insults, and crude toilet talk, which a textbook would
// not print. Such a sentence is replaced by a clean one that uses the word in the same meaning and form, or dropped
// when no replacement is listed. Decisions: data/review/crude/<lang>.jsonl, one per line:
//   { lemma, text, replace: { text, translation, target, sense? } }   or   { lemma, text, keep: true, sense?, translation? }
//   (not crude; sense corrects the meaning the sentence is linked to when it was a crude meaning the sentence does not
//   show, translation one that used an offensive English word)
//   or { lemma, text, drop: true } (the word itself is crude, or no clean sentence can show its meaning)
// A decision applies to its sentence whether or not the detector below matches it, since reviewers also caught crude
// sentences that no keyword finds. A sentence the detector matches with no decision is dropped, so a rebuild that finds
// new sentences never lets an unreviewed crude one into the app.
// Words that are vulgar, slurs, curses or words for sex in every meaning are left out of the sets altogether, at the
// owner's request: data/review/crude/<lang>-words.jsonl, one { lemma, pos, rank, why } per line.
// Crude slang meanings of other words are dropped and offensive wording of clean meanings is replaced:
// data/review/crude/<lang>-meanings.jsonl, one { lemma, pos, rank, drop: [meaning numbers], gloss: { number: text },
// note?: { number: text or null }, display?: text, retag?: { sentence: meaning number }, why } per line (numbers as in
// the set before the change). note and display serve a word the dictionary data matched to an offensive homograph:
// Ukrainian москва, whose only listed meaning was a collective word for Russians, is the city its sentences name. The
// file also corrects a few meanings that did not fit the sentences written for words left without any (added.mjs).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const L = '[\\p{L}\\p{M}]*';
const s = (list) => list.map((w) => w.replace(/\*/g, L));

// English, matched against translations (case-insensitive). Broad on purpose: reviewers mark false matches as keep.
const EN = s([
  'fuck*', 'motherfuck*', 'shit*', 'bullshit*', 'crap', 'crappy', 'damn*', 'goddamn*', 'dammit', 'the hell', 'go to hell', 'bloody hell',
  'bitch*', 'bastard*', 'ass', 'asses', 'asshole*', 'arse', 'arses', 'arsehole*', 'jackass*', 'dumbass*', 'badass*', 'piss*', 'wank*', 'twat*', 'cunt*',
  'cock', 'cocks', 'dick', 'dicks', 'dickhead*', 'prick', 'pricks', 'pussy', 'pussies', 'tit', 'tits', 'titties', 'boob', 'boobs', 'boobies',
  'slut*', 'whore*', 'hooker*', 'prostitut*', 'pimp', 'pimps', 'pimping', 'pimped', 'bollocks', 'bugger*', 'screw you', 'screw it', 'screw him', 'screw her', 'screw them',
  'blowjob*', 'blow job*', 'handjob*', 'hand job*', 'jerk off', 'jerking off', 'jerked off', 'jack off', 'jacking off', 'suck my', 'blow me',
  'porn*', 'nude*', 'naked', 'sex', 'sexy', 'sexual*', 'intercourse', 'orgasm*', 'erection*', 'horny', 'aroused', 'arousal',
  'masturbat*', 'penis*', 'vagina*', 'genital*', 'testicle*', 'scrotum', 'condom*', 'dildo*', 'vibrator*', 'rape', 'raped', 'rapes',
  'raping', 'rapist*', 'molest*', 'incest*', 'pedophil*', 'paedophil*', 'fetish*', 'kinky', 'lust', 'lusts', 'lusted', 'lustful', 'seduc*', 'make love', 'made love',
  'making love', 'makes love', 'sleep with', 'slept with', 'sleeping with', 'sleeps with', 'go to bed with', 'went to bed with',
  'in bed with', 'virgin', 'virgins', 'virginity', 'breast', 'breasts', 'nipple*', 'butt', 'butts', 'buttock*', 'bum', 'booty',
  'stripper*', 'striptease*', 'undress*', 'panties', 'lingerie', 'poop*', 'pee', 'peed', 'peeing', 'fart', 'farts', 'farted', 'farting', 'turd*', 'puke*',
  'nigg*', 'negro*', 'fag', 'fags', 'faggot*', 'dyke*', 'tranny', 'trannies', 'retard*', 'spastic*', 'gypsy', 'gypsies', 'kike*',
  'chink*', 'jap', 'japs', 'wop', 'spic', 'spics', 'kraut*', 'gook*', 'redskin*', 'midget*', 'cripple*', 'queer*', 'homo', 'homos',
  'sissy', 'pansy', 'lesbo*', 'poof*', 'scumbag*', 'bimbo*', 'skank*', 'douche*', 'jew', 'jews', 'jewess', 'tatar*', 'suck', 'sucks',
  'sucked', 'sucking', 'cum', 'cumming', 'jizz', 'spunk', 'semen', 'boner', 'boners', 'hard-on', 'balls', 'nuts', 'knockers', 'crotch',
  'anal', 'anus', 'pervert*', 'perv', 'pervs', 'lewd', 'obscen*', 'smut*', 'erotic*', 'brothel*', 'harlot*', 'strumpet*', 'hussy',
  'floozy', 'tramp', 'tramps', 'wetback*', 'beaner*', 'towelhead*', 'raghead*', 'coon', 'coons', 'darkie*', 'half-breed*', 'chinaman',
  'paki', 'pakis', 'polack*', 'dago', 'dagos', 'yid', 'yids', 'gyp', 'gypped', 'tard', 'tards', 'one-night stand', 'stud',
]);

// Target-language words, matched against the sentence (case-insensitive, stress marks removed).
const RU_PRE = '(?:о|а|на|по|за|до|ни|от|вы|у|при|рас|раз|под|с|об)?';
const UK_PRE = '(?:о|а|на|по|за|до|ні|від|ви|у|при|роз|під|з|с|об)?';
const PL_PRE = '(?:s|za|wy|od|na|po|prze|roz|do|u|w|ob|przy|pod|nad|ze)?';
const TARGET = {
  es: s([
    'puta', 'putas', 'puto', 'putos', 'putit*', 'putería', 'putear*', 'hijueput*', 'hijoeput*', 'mierd*', 'coño*', 'carajo*', 'jod*',
    'foll(?!et|aj)*', 'culo', 'culos', 'culito*', 'cule(?!br)*', 'culia*', 'verga*', 'polla', 'pollas', 'chimba*', 'gonorrea', 'malparid*',
    'marica*', 'maric[oó]n*', 'pendej*', 'huev[oó]n*', 'güev[oó]n*', 'guev[oó]n*', 'cabr[oó]n*', 'cabrona*', 'zorra', 'zorras',
    'perra', 'perras', 'tetas?', 'tetona*', 'tetica*', 'pez[oó]n*', 'penes?', 'vagina*', 'chúpa*', 'chupal[ao]s?', 'chupame*', 'sexo',
    'sexual*', 'sexy', 'desnud*', 'porno*', 'pornogr*', 'orgasm*', 'masturb*', 'violar', 'violaci[oó]n*', 'violad[oa]r*', 'prostitut*',
    'ramera*', 'cond[oó]n*', 'preservativo*', 'erecci[oó]n*', 'cachond*', 'chingar*', 'ching[aáoóue]*', 'pinche*', 'mear*', 'meando',
    'cagar*', 'cag[aáoóué]*', 'pedos?', 'pedorr*', 'nalga*', 'sudaca*', 'gitan[oa]s?', 'mongólic*', 'retrasad[oa]s?', 'subnormal*',
    'negrat*', 'marimacho*', 'bollera*', 'tortillera*', 'maldit[oa]s?', 'maldita sea', 'demonios', 'diablos', 'puñeter*', 'judío*',
    'judía*', 'marran[oa]s?', 'gringo*', 'indio*', 'cholo*', 'gilipollas', 'cojon*', 'cojón', 'pelotud*', 'bolud*', 'mamón*',
    'chupapollas', 'comemierda*', 'lameculos', 'putada*', 'joto', 'jotos', 'travelo*', 'pelotas', 'huevos', 'semental*', 'amantes',
  ]),
  pt: s([
    'porra*', 'caralh*', 'merd*', 'puta', 'putas', 'puto', 'putos', 'putaria*', 'puteiro*', 'fod[aeiou]*', 'fud[eiao]*', 'buceta*',
    'boceta*', 'xoxota*', 'xereca*', 'cu', 'cuz[ãa]o*', 'cuzinho*', 'bunda*', 'piroca*', 'cacete*', 'bosta*', 'cagar*', 'cag[aoueõ]*',
    'mij[aoe]*', 'peid[ao]*', 'transa(?:r|m|mos|ram|va|vam|ndo|do|da|s|ste)?', 'trans(?:o|ou|ei|amos)', 'trepa*', 'trepo*', 'trepou',
    'tes[ãa]o', 'tesud*', 'safad*', 'vadia*', 'piranha*', 'vagabund*', 'prostitut*', 'punheta*', 'siririca*', 'boquete*', 'chupa*',
    'chupe*', 'chupo*', 'chupou', 'sexo*', 'sexua*', 'sexy', 'nu', 'nua', 'nus', 'nuas', 'pelad[ao]s?', 'pornô*', 'porn*', 'masturb*',
    'orgasm*', 'estupr*', 'viado*', 'veado*', 'bicha*', 'sapat[ãa]o*', 'traveco*', 'macac[oa]s?', 'crioul[oa]s?', 'negão', 'neguinh*',
    'mongol*', 'retardad*', 'desgraçad*', 'fdp', 'arrombad*', 'escrot*', 'corn[oa]s?', 'chifrud*', 'tetas?', 'mamilo*', 'p[êe]nis',
    'vagina*', 'camisinha*', 'preservativo*', 'judeu*', 'judia*', 'cigan[oa]s?', 'colhões', 'boiola*', 'baitola*', 'piru*',
    'xota*', 'goz[aeo]*', 'gozou', 'putz', 'bolas', 'amantes', 'sêmen', 'esperma*',
  ]),
  vi: s([
    'địt', 'đụ', 'đéo', 'đếch', 'lồn', 'cặc', 'buồi', 'dái', 'đĩ', 'điếm', 'cave', 'đm', 'đ\\.m', 'dm', 'vcl', 'vl', 'vãi', 'cứt',
    'ỉa', 'đái', 'đít', 'chó đẻ', 'đồ chó', 'thằng chó', 'chó cái', 'mẹ kiếp', 'khốn nạn', 'mả mẹ', 'mẹ mày', 'bố mày', 'cha mày',
    'tình dục', 'khiêu dâm', 'làm tình', 'ngủ với', 'khỏa thân', 'khoả thân', 'trần truồng', 'cởi truồng', 'hiếp dâm', 'cưỡng hiếp',
    'dương vật', 'âm đạo', 'bao cao su', 'thủ dâm', 'cực khoái', 'bê đê', 'pê đê', 'xăng pha nhớt', 'mọi rợ', 'thằng mọi', 'người mọi',
    'tàu khựa', 'khựa', 'chệt', 'nứng', 'dâm', 'sex', 'sexy', 'gái gọi', 'gái điếm', 'ăn cứt', 'vú', 'ngực trần', 'phịch', 'chịch',
    'khốn kiếp', 'chó má', 'đù', 'mẹ nó', 'con mẹ', 'tinh trùng', 'tinh dịch',
  ]),
  ru: s([
    `${RU_PRE}ху[йяеёию]*`, `${RU_PRE}пизд*`, '(?:за|вы|от|отъ|на|по|у|съ|при|раз|разъ|до|про|въ|подъ|о|об|долбо|недо)?[её]б(?:а|у|ё|е|и|л|н|ы|ош|ч)?*',
    'бля*', 'сука', 'суки', 'суке', 'суку', 'сукой', 'сукам*', 'сучк*', 'сучь*', 'сукин*', 'мудак*', 'мудил*', 'мудо*', 'залуп*',
    'хер(?!сон|увим)*', 'нахер*', 'похер*', 'пидор*', 'пидар*', 'педик*', 'педераст*', 'гомик*', 'пидрил*', 'шлюх*', 'шалав*',
    'проститут*', 'потаскух*', 'блудниц*', 'дерьм*', 'говн*', '(?:на|об|за|вы|по|рас)?сра(?:ть|л|н|к)*', 'срёт', 'срет', 'срут',
    '(?:об|вы|на|за)?сса(?:ть|л)*', 'ссыт', 'ссут', 'ссыкл*', 'обосс*', 'перд*', 'жоп*', 'задниц*', 'сиськ*', 'сиси', 'титьк*',
    'пенис*', 'вагин*', 'секс*', 'порн*', 'оргазм*', 'мастурб*', 'дроч*', 'трах(?:а|н)*', 'изнасил*', 'насильник*', 'презерватив*',
    'голая', 'голый', 'голые', 'голым', 'голой', 'голую', 'голого', 'голышом', 'раздева*', 'разделся', 'разделась', 'раздеться',
    'раздет*', 'полов(?:ой|ая|ое|ые|ых|ую|ым|ыми)', 'жид(?!к)*', 'чурк*', 'черномаз*', 'негр*', 'нигер*', 'ниггер*', 'узкоглаз*',
    'хохл*', 'хохол', 'кацап*', 'москал*', 'чучмек*', 'хач(?!ап)*', 'цыган*', 'татарин*', 'чукч*', 'дебил*', 'имбецил*',
    'олигофрен*', 'ублюд*', 'выблядок', 'сволоч*', 'падл*', 'мраз*', 'гнид*', 'чёрт*', 'черт', 'черти', 'чертов*', 'еврей*', 'евреек',
    'еврейк*', 'минет*', 'отсос*', 'сперм*', 'эрекц*', 'гандон*', 'гондон*', 'манд(?:а|ы|у|ой|е)', 'мандавош*', 'шмар*', 'давалк*',
    'чмо', 'чмош*', 'анальн*', 'любовниц*',
  ]),
  uk: s([
    `${UK_PRE}ху[йяєїюи]*`, `${UK_PRE}пизд*`, '(?:за|ви|від|на|по|у|з|з[\'’ʼ]|при|роз|до|про|в|під|об)?(?:їб|єб)*', 'йоб*', 'бля*',
    'сука', 'суки', 'суко', 'суку', 'сукою', 'сукам*', 'сучк*', 'сучий', 'сучого', 'сучої', 'сукин*', 'курв*', 'мудак*', 'мудил*',
    'мудо*', 'залуп*', 'хер(?!сон|увим)*', 'підар*', 'підор*', 'педик*', 'педераст*', 'гомік*', 'шльондр*', 'шлюх*', 'повія',
    'повії', 'повію', 'повією', 'повій', 'повіям*', 'проститут*', 'хвойд*', 'лайн(?!ер)*', 'гівн*',
    '(?:об|за|на|ви|по|роз)?сра(?:ти|в|ла|ли|ло|ка|ки|ку|кою|н)*', 'сере', 'серу', 'серуть', 'сцят*', 'сцю', 'сциш', 'сцикл*',
    '(?:об|за|на|ви)?сса(?:ти|в)*', 'перд*', 'дуп(?!л)*', 'жоп*', 'срак*', 'цицьк*', 'сиськ*', 'пеніс*', 'вагін*', 'піхв*', 'секс*',
    'порн*', 'оргазм*', 'мастурб*', 'дроч*', 'трах(?:а|н)*', 'зґвалт*', 'згвалт*', 'ґвалтівн*', 'презерватив*', 'голий', 'гола',
    'голі', 'голого', 'голу', 'голим', 'голою', 'голяка', 'роздяга*', 'роздягну*', 'статев*', 'кацап*', 'москал*', 'жид*', 'хохл*',
    'хохол', 'чурк*', 'негр*', 'нігер*', 'циган*', 'дебіл*', 'виродок', 'виродк*', 'покидьок', 'покидьк*', 'сволот*', 'падлюк*',
    'падл*', 'скотин*', 'тварюк*', 'чорт*', 'єврей*', 'єврейк*', 'мінет*', 'сперм*', 'ерекц*', 'гандон*', 'гондон*', 'анальн*',
    'манд(?:а|и|у|ою|і)', 'чмо', 'коханк*',
  ]),
  pl: s([
    'kurw*', 'chuj*', `${PL_PRE}pierd*`, `${PL_PRE}jeb*`, `${PL_PRE}pizd*`, 'dup(?!l)*', 'cip(?:a|y|ie|ę|ą|o|ka|ki|ce|ek|kach|ką|kę)',
    'kutas*', 'fiut*', 'skurw*', 'sukinsyn*', 'suka', 'suki', 'suce', 'sukę', 'suką', 'suko', 'dziwk*', 'kurewsk*', 'prostytut*',
    'szmat*', 'gówn*', '(?:o|ob|na|po|za|wy|ze|s)?sra(?:ć|ł|m|sz|ją|nie|cz|k)*', 'sika*', 'siku', 'pedał*', 'pedzi*', 'ciot(?!k|ecz)*',
    'cyc(?:ek|ki|ków|kami|kach|e|uszki)', 'penis*', 'wagin*', 'pochw*', 'seks*', 'porno*', 'pornogr*', 'orgazm*', 'masturb*', 'onani*',
    'walić konia', 'gwałt*', 'zgwałc*', 'prezerwatyw*', 'nagi', 'naga', 'nadzy', 'nagie', 'nago', 'nagą', 'nagiego', 'nagich', 'nagim',
    'rozbiera*', 'rozebra*', 'czarnuch*', 'murzyn*', 'cygan*', 'żyd*', 'szwab*', 'żółtek', 'żółtk*', 'debil*',
    'kacap*', 'moskal*', 'cholera*', 'cholern*', 'do diabła', 'diabli', 'loda', 'obciąg*', 'sperm*', 'erekc*', 'analn*', 'jajca*',
    'kurew*', '(?:wy|prze|po|za)?rucha(?:ć|ł|ła|li|nie|m|sz|ją|j)*', 'kochank*', 'kurde', 'burdel*', 'psia mać',
  ]),
};

const boundary = (alts, flags) => new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${alts.map((w) => w.replace(/ /g, '\\s+')).join('|')})(?![\\p{L}\\p{M}\\p{N}])`, flags);
const EN_RE = boundary(EN, 'giu');
const TARGET_RE = Object.fromEntries(Object.entries(TARGET).map(([l, alts]) => [l, boundary(alts, 'giu')]));
const strip = (t) => (t ?? '').normalize('NFC').replace(/́/g, '');

/** The matched words that may make a sentence crude, or [] when none match. */
export function crudeHits(lang, text, translation) {
  const hits = [];
  for (const m of strip(translation).matchAll(EN_RE)) hits.push(m[0].toLowerCase());
  const re = TARGET_RE[lang];
  if (re) for (const m of strip(text).matchAll(re)) hits.push(m[0].toLowerCase());
  return [...new Set(hits)];
}

const textKey = (t) => t.normalize('NFC').replace(/́/g, '').replace(/\s+/g, ' ').trim();

export function crudeFile(lang) {
  return fileURLToPath(new URL(`../../data/review/crude/${lang}.jsonl`, import.meta.url));
}

/** lemma + sentence → decision. */
export function loadCrudeDecisions(lang, file = crudeFile(lang)) {
  const map = new Map();
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    map.set(`${r.lemma}\t${textKey(r.text)}`, r);
  }
  return map;
}

export const CRUDE_CREDIT = 'Written by AI (Claude) in November 2026 to replace a crude sentence; not checked by a native speaker';

/**
 * Replace or drop crude sentences (in place). Returns { credits, stats, open }: open lists the sentences the detector
 * matched with no decision yet (dropped, so they never reach the app).
 */
export function applyCrude(lang, entries, decisions, credits = []) {
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
        added.push({ lemma: e.lemma, text: d.replace.text, credit: CRUDE_CREDIT });
        stats.replaced++;
        continue;
      }
      if (d?.drop) {
        stats.dropped++;
        continue;
      }
      const hits = crudeHits(lang, x.text, x.translation);
      if (!hits.length || d?.keep) {
        if (hits.length) stats.kept++;
        // A kept sentence may carry a corrected meaning (it was tagged with a crude meaning it does not show) or a
        // corrected translation (one that used an offensive English word).
        const sense = d?.keep && Number.isInteger(d.sense) && d.sense < (e.senses?.length ?? 0) ? d.sense : x.sense;
        const translation = d?.keep && typeof d.translation === 'string' && d.translation.trim() ? d.translation.trim() : x.translation;
        out.push(sense === x.sense && translation === x.translation ? x : { ...x, sense, translation });
        continue;
      }
      stats.undecided++;
      open.push({ lemma: e.lemma, pos: e.pos, rank: e.frequencyRank, text: x.text, translation: x.translation, target: x.target, sense: x.sense ?? null, gloss: e.senses[x.sense ?? 0]?.gloss ?? e.senses[0]?.gloss, hits });
    }
    e.examples = out;
  }
  const present = new Set(entries.flatMap((e) => (e.examples ?? []).map((x) => `${e.lemma}\t${textKey(x.text)}`)));
  return { credits: [...credits.filter((c) => present.has(`${c.lemma}\t${textKey(c.text)}`)), ...added], stats, open };
}

export function crudeReport(stats) {
  return [
    '## Crude sentences',
    '',
    `Crude sentences (swearing, sexual content, slurs and vulgar insults, crude toilet talk) are left out of this app. ${stats.replaced.toLocaleString('en')} were replaced by AI-written sentences that use the word in a clean meaning, ${(stats.dropped + stats.undecided).toLocaleString('en')} were dropped (the word itself is crude, or no replacement was written yet), and ${stats.kept.toLocaleString('en')} more matched a keyword without being crude.`,
    '',
  ];
}

// ------------------------------------------------------------------ words left out of the sets

export function crudeWordsFile(lang) {
  return fileURLToPath(new URL(`../../data/review/crude/${lang}-words.jsonl`, import.meta.url));
}

/** The words to leave out: lemma + part of speech + rank (the rank tells homographs apart). */
export function loadCrudeWords(lang, file = crudeWordsFile(lang)) {
  const set = new Set();
  if (!existsSync(file)) return set;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    set.add(`${r.lemma.normalize('NFC')}\t${r.pos}\t${r.rank}`);
  }
  return set;
}

/** The entries without the listed words, and the words left out. Credits keep only sentences still present. */
export function applyCrudeWords(entries, words, credits = []) {
  const removed = [];
  const kept = entries.filter((e) => {
    const out = words.has(`${e.lemma.normalize('NFC')}\t${e.pos}\t${e.frequencyRank}`);
    if (out) removed.push(e.lemma);
    return !out;
  });
  const present = new Set(kept.flatMap((e) => (e.examples ?? []).map((x) => `${e.lemma}\t${textKey(x.text)}`)));
  return { entries: kept, removed, credits: credits.filter((c) => present.has(`${c.lemma}\t${textKey(c.text)}`)) };
}

export function crudeWordsReport(removed) {
  if (!removed.length) return [];
  return [
    '## Words left out as crude',
    '',
    `${removed.length.toLocaleString('en')} words that are vulgar, slurs, curses or words for sex in every meaning are left out of this set: ${removed.join(', ')}.`,
    '',
  ];
}

// ------------------------------------------------------------------ crude meanings

export function crudeMeaningsFile(lang) {
  return fileURLToPath(new URL(`../../data/review/crude/${lang}-meanings.jsonl`, import.meta.url));
}

/** lemma + part of speech + rank → { drop, gloss, retag }. */
export function loadCrudeMeanings(lang, file = crudeMeaningsFile(lang)) {
  const map = new Map();
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    map.set(`${r.lemma.normalize('NFC')}\t${r.pos}\t${r.rank}`, r);
  }
  return map;
}

/**
 * Drop crude slang meanings and reword offensive glosses (in place). Sentences follow their meaning to its new number;
 * one linked to a dropped meaning shows all the word's remaining meanings (or the meaning `retag` gives it). Extra
 * accepted answers that are crude go with them. A decision that would leave a word without meanings is ignored.
 */
export function applyCrudeMeanings(lang, entries, decisions) {
  const stats = { words: 0, dropped: 0, reworded: 0 };
  for (const e of entries) {
    const d = decisions.get(`${e.lemma.normalize('NFC')}\t${e.pos}\t${e.frequencyRank}`);
    if (!d) continue;
    const drop = new Set((d.drop ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < e.senses.length));
    if (drop.size >= e.senses.length) continue;
    const gloss = d.gloss ?? {};
    const note = d.note ?? {};
    const map = new Map();
    const senses = [];
    e.senses.forEach((s, i) => {
      if (drop.has(i)) return;
      map.set(i, senses.length);
      const g = typeof gloss[i] === 'string' && gloss[i].trim() ? gloss[i].trim() : null;
      if (g) stats.reworded++;
      const n = Object.hasOwn(note, String(i)) ? { note: typeof note[i] === 'string' && note[i].trim() ? note[i].trim() : null } : {};
      senses.push({ ...s, gloss: g ?? s.gloss, ...n, translations: (s.translations ?? []).filter((t) => !crudeHits(lang, '', t).length) });
    });
    if (typeof d.display === 'string' && d.display.trim()) e.display = d.display.trim();
    const retag = new Map(Object.entries(d.retag ?? {}).map(([t, i]) => [textKey(t), i]));
    e.examples = (e.examples ?? []).map((x) => {
      const old = retag.has(textKey(x.text)) ? retag.get(textKey(x.text)) : x.sense;
      if (old == null) return x;
      const sense = map.has(old) ? map.get(old) : null;
      return sense === x.sense ? x : { ...x, sense };
    });
    e.senses = senses;
    stats.words++;
    stats.dropped += drop.size;
  }
  return stats;
}

export function crudeMeaningsReport(stats) {
  if (!stats.words) return [];
  return [
    '## Crude meanings',
    '',
    `${stats.dropped.toLocaleString('en')} meanings were dropped and ${stats.reworded.toLocaleString('en')} glosses reworded, to keep out crude slang, offensive English and political slang and to correct a few wrong meanings and place names, in ${stats.words.toLocaleString('en')} words.`,
    '',
  ];
}
