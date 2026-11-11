// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
/** Language profiles for the six target languages (English is the reference language). */

export type LanguageCode = 'es' | 'pt' | 'vi' | 'ru' | 'uk' | 'pl';
export const LANGUAGE_CODES: readonly LanguageCode[] = ['es', 'pt', 'vi', 'ru', 'uk', 'pl'];

export function isLanguageCode(x: unknown): x is LanguageCode {
  return typeof x === 'string' && (LANGUAGE_CODES as readonly string[]).includes(x);
}

export interface AccentOption {
  id: string;
  label: string;
  /** ISO 3166-1 alpha-3 codes, the format Forvo's `country` filter requires. */
  countries: string[];
  /** Whether the country metadata alone can confirm this variety. */
  countryConfirmsVariety: boolean;
  description: string;
}

export interface LanguageProfile {
  code: LanguageCode;
  name: string;
  nativeName: string;
  flag: string;
  variety: string;
  script: 'latin' | 'cyrillic';
  /** Forvo language code (forvo.com/languages-codes). */
  forvoCode: string;
  defaultAccent: string;
  accents: AccentOption[];
  /** BCP-47 locales to try, in order, for optional device text-to-speech fallback. */
  ttsLocales: string[];
  /** Learner stress marks (combining acute U+0301) appear in display forms. */
  stressMarks: boolean;
  /** Russian: ё is often written as е in ordinary text. */
  yoOptional: boolean;
  /** Diacritics/tones distinguish words (affects answer checking). */
  meaningfulDiacritics: boolean;
  /** Characters offered by the on-screen helper for typed answers. */
  helperChars: string[];
  /** Full on-screen keyboard rows (Cyrillic) for devices without the layout. */
  keyboardRows?: string[][];
  slowedAudioNote?: string;
  locale: string;
}

const LATAM = ['MEX', 'ARG', 'PER', 'VEN', 'CHL', 'ECU', 'BOL', 'URY', 'PRY', 'GTM', 'CRI', 'PAN', 'DOM', 'CUB', 'HND', 'SLV', 'NIC', 'PRI'];

export const LANGUAGES: Record<LanguageCode, LanguageProfile> = {
  es: {
    code: 'es',
    name: 'Spanish',
    nativeName: 'Español',
    flag: '🇨🇴',
    variety: 'Colombian Spanish (Bogotá preferred)',
    script: 'latin',
    forvoCode: 'es',
    defaultAccent: 'es-CO',
    accents: [
      { id: 'es-CO', label: 'Colombian Spanish', countries: ['COL'], countryConfirmsVariety: true, description: 'Speakers whose Forvo country is Colombia. City (e.g. Bogotá) cannot be verified from Forvo metadata.' },
      { id: 'es-419', label: 'Latin American Spanish', countries: ['COL', ...LATAM], countryConfirmsVariety: true, description: 'Colombia first, then other Latin American countries.' },
      { id: 'es-ES', label: 'Spain', countries: ['ESP'], countryConfirmsVariety: true, description: 'European Spanish speakers.' },
      { id: 'any', label: 'Any accent', countries: [], countryConfirmsVariety: false, description: 'No country preference.' },
    ],
    ttsLocales: ['es-CO', 'es-419', 'es-US', 'es-MX'],
    stressMarks: false,
    yoOptional: false,
    meaningfulDiacritics: true,
    helperChars: ['á', 'é', 'í', 'ó', 'ú', 'ñ', 'ü', '¿', '¡'],
    locale: 'es-CO',
  },
  pt: {
    code: 'pt',
    name: 'Portuguese',
    nativeName: 'Português',
    flag: '🇧🇷',
    variety: 'Brazilian Portuguese',
    script: 'latin',
    forvoCode: 'pt',
    defaultAccent: 'pt-BR',
    accents: [
      { id: 'pt-BR', label: 'Brazilian Portuguese', countries: ['BRA'], countryConfirmsVariety: true, description: 'Speakers whose Forvo country is Brazil. Regional Brazilian accent is not verified.' },
      { id: 'pt-PT', label: 'European Portuguese', countries: ['PRT'], countryConfirmsVariety: true, description: 'Speakers from Portugal.' },
      { id: 'any', label: 'Any accent', countries: [], countryConfirmsVariety: false, description: 'No country preference.' },
    ],
    ttsLocales: ['pt-BR'],
    stressMarks: false,
    yoOptional: false,
    meaningfulDiacritics: true,
    helperChars: ['á', 'â', 'ã', 'à', 'ç', 'é', 'ê', 'í', 'ó', 'ô', 'õ', 'ú'],
    locale: 'pt-BR',
  },
  vi: {
    code: 'vi',
    name: 'Vietnamese',
    nativeName: 'Tiếng Việt',
    flag: '🇻🇳',
    variety: 'Southern Vietnamese (Ho Chi Minh City)',
    script: 'latin',
    forvoCode: 'vi',
    defaultAccent: 'vi-South',
    accents: [
      { id: 'vi-South', label: 'Southern Vietnamese', countries: ['VNM'], countryConfirmsVariety: false, description: 'Forvo only reports the country (Vietnam), so Southern accent stays unverified unless you confirm a speaker yourself.' },
      { id: 'vi-North', label: 'Northern Vietnamese', countries: ['VNM'], countryConfirmsVariety: false, description: 'Country verified only; region must be confirmed per speaker.' },
      { id: 'any', label: 'Any accent', countries: [], countryConfirmsVariety: false, description: 'No preference.' },
    ],
    ttsLocales: ['vi-VN'],
    stressMarks: false,
    yoOptional: false,
    meaningfulDiacritics: true,
    helperChars: ['ă', 'â', 'đ', 'ê', 'ô', 'ơ', 'ư'],
    slowedAudioNote: 'Slowed playback can distort Vietnamese tones and rhythm — use 1.0× to check tones.',
    locale: 'vi-VN',
  },
  ru: {
    code: 'ru',
    name: 'Russian',
    nativeName: 'Русский',
    flag: '🇷🇺',
    variety: 'Contemporary standard Russian (Moscow)',
    script: 'cyrillic',
    forvoCode: 'ru',
    defaultAccent: 'ru-RU',
    accents: [
      { id: 'ru-RU', label: 'Russia (standard)', countries: ['RUS'], countryConfirmsVariety: false, description: 'Country verified only; a Moscow accent cannot be verified from Forvo metadata.' },
      { id: 'any', label: 'Any accent', countries: [], countryConfirmsVariety: false, description: 'No preference.' },
    ],
    ttsLocales: ['ru-RU'],
    stressMarks: true,
    yoOptional: true,
    meaningfulDiacritics: false,
    helperChars: ['ё', 'ъ', 'ь', 'ы', 'э', 'й'],
    keyboardRows: [
      ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х', 'ъ'],
      ['ф', 'ы', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'э', 'ё'],
      ['я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю', '-'],
    ],
    locale: 'ru-RU',
  },
  uk: {
    code: 'uk',
    name: 'Ukrainian',
    nativeName: 'Українська',
    flag: '🇺🇦',
    variety: 'Contemporary standard Ukrainian (Kyiv)',
    script: 'cyrillic',
    forvoCode: 'uk',
    defaultAccent: 'uk-UA',
    accents: [
      { id: 'uk-UA', label: 'Ukraine (standard)', countries: ['UKR'], countryConfirmsVariety: false, description: 'Country verified only; a Kyiv accent cannot be verified from Forvo metadata.' },
      { id: 'any', label: 'Any accent', countries: [], countryConfirmsVariety: false, description: 'No preference.' },
    ],
    ttsLocales: ['uk-UA'],
    stressMarks: true,
    yoOptional: false,
    meaningfulDiacritics: false,
    helperChars: ['ґ', 'є', 'і', 'ї', 'й', 'ь', '’'],
    keyboardRows: [
      ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х', 'ї'],
      ['ф', 'і', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'є', 'ґ'],
      ['я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю', '’', '-'],
    ],
    locale: 'uk-UA',
  },
  pl: {
    code: 'pl',
    name: 'Polish',
    nativeName: 'Polski',
    flag: '🇵🇱',
    variety: 'Contemporary standard Polish (Warsaw)',
    script: 'latin',
    forvoCode: 'pl',
    defaultAccent: 'pl-PL',
    accents: [
      { id: 'pl-PL', label: 'Poland (standard)', countries: ['POL'], countryConfirmsVariety: false, description: 'Country verified only; a Warsaw accent cannot be verified from Forvo metadata.' },
      { id: 'any', label: 'Any accent', countries: [], countryConfirmsVariety: false, description: 'No preference.' },
    ],
    ttsLocales: ['pl-PL'],
    stressMarks: false,
    yoOptional: false,
    meaningfulDiacritics: true,
    helperChars: ['ą', 'ć', 'ę', 'ł', 'ń', 'ó', 'ś', 'ź', 'ż'],
    locale: 'pl-PL',
  },
};

/** Country names as they may appear in Forvo pronunciation metadata, by alpha-3 code. */
export const COUNTRY_NAMES: Record<string, string[]> = {
  COL: ['colombia'],
  BRA: ['brazil', 'brasil'],
  VNM: ['vietnam', 'viet nam', 'việt nam'],
  RUS: ['russia', 'russian federation'],
  UKR: ['ukraine'],
  POL: ['poland', 'polska'],
  ESP: ['spain', 'españa'],
  PRT: ['portugal'],
  MEX: ['mexico', 'méxico'],
  ARG: ['argentina'],
  PER: ['peru', 'perú'],
  VEN: ['venezuela'],
  CHL: ['chile'],
  ECU: ['ecuador'],
  BOL: ['bolivia'],
  URY: ['uruguay'],
  PRY: ['paraguay'],
  GTM: ['guatemala'],
  CRI: ['costa rica'],
  PAN: ['panama', 'panamá'],
  DOM: ['dominican republic'],
  CUB: ['cuba'],
  HND: ['honduras'],
  SLV: ['el salvador'],
  NIC: ['nicaragua'],
  PRI: ['puerto rico'],
  USA: ['united states', 'united states of america'],
};

export function countryCodeFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  if (/^[a-z]{3}$/i.test(n) && COUNTRY_NAMES[n.toUpperCase()]) return n.toUpperCase();
  for (const [code, names] of Object.entries(COUNTRY_NAMES)) if (names.includes(n)) return code;
  return null;
}

export const PARTS_OF_SPEECH = [
  'noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction', 'numeral', 'particle',
  'interjection', 'phrase', 'determiner', 'classifier', 'contraction', 'other',
] as const;
export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number];

export function normalizePos(raw: string | null | undefined): PartOfSpeech {
  const v = (raw ?? '').trim().toLowerCase().replace(/[^a-z ]/g, '');
  const map: Record<string, PartOfSpeech> = {
    n: 'noun', noun: 'noun', nouns: 'noun', substantive: 'noun', name: 'noun',
    v: 'verb', verb: 'verb', verbs: 'verb',
    adj: 'adjective', adjective: 'adjective', a: 'adjective',
    adv: 'adverb', adverb: 'adverb',
    pron: 'pronoun', pronoun: 'pronoun',
    prep: 'preposition', preposition: 'preposition', postposition: 'preposition',
    conj: 'conjunction', conjunction: 'conjunction',
    num: 'numeral', numeral: 'numeral', number: 'numeral',
    part: 'particle', particle: 'particle',
    intj: 'interjection', interj: 'interjection', interjection: 'interjection',
    phrase: 'phrase', phr: 'phrase', expression: 'phrase', idiom: 'phrase', proverb: 'phrase',
    det: 'determiner', determiner: 'determiner', article: 'determiner',
    classifier: 'classifier', clf: 'classifier',
    contraction: 'contraction', contr: 'contraction',
  };
  return map[v] ?? 'other';
}

export const TOPIC_TAGS = [
  'greetings', 'people', 'family', 'food-drink', 'home', 'city', 'travel', 'transport', 'time', 'numbers', 'weather',
  'body-health', 'feelings', 'work', 'shopping', 'money', 'communication', 'daily-routine', 'colors', 'places',
  'basic-verbs', 'questions', 'connectors',
];
