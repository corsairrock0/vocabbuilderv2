// © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
// Which sources build each language's frequency set, and how they are credited.
// Paths are relative to the sources directory created by scripts/freq/fetch-sources.sh.

const ud = (repo, prefix, parts) => parts.map((p) => `ud/${repo}/${prefix}-ud-${p}.conllu`);
const VUIZUR = 'English Wiktionary, via the Wiktextract/Kaikki.org extraction in Vuizur/Wiktionary-Dictionaries (2022–23 snapshot; CC BY-SA 4.0 and GFDL)';

export const LANGUAGE_INFO = {
  es: {
    name: 'Colombian Spanish',
    setName: 'Most frequent words: Spanish (OpenSubtitles + RAE CREA, English Wiktionary)',
    frequency: {
      type: 'frequencywords',
      path: 'doozan-spanish_data/es_merged_50k.txt',
      kind: 'frequency_mixed',
      description:
        'word counts from OpenSubtitles 2018 (hermitdave/FrequencyWords, CC BY-SA 4.0) merged with the Real Academia Española CREA frequency list, as published in doozan/spanish_data (es_merged_50k.txt). CREA covers written and spoken Spanish from Spain and Latin America. No Colombia-only frequency list is openly available.',
    },
    lexicon: { type: 'allforms', path: 'doozan-spanish_data/es_allforms.csv', description: 'English Wiktionary inflection data (doozan/spanish_data es_allforms.csv, CC BY-SA)' },
    names: { list: 'FrequencyWords/content/2018/pt_br/pt_br_50k.txt', lang: 'pt' },
    // Character names that are also rare dictionary words, so the subtraction above cannot remove them.
    excludeAsNames: ['bob'],
    treebank: { files: ud('UD_Spanish-AnCora', 'es_ancora', ['train', 'dev', 'test']), description: 'UD Spanish AnCora treebank (CC BY 4.0), used only to split ambiguous forms such as la (article or pronoun)' },
    wiktionary: { type: 'doozan', path: 'doozan-spanish_data/es-en.data', description: 'English Wiktionary as extracted by doozan/spanish_data (es-en.data, November 2026; CC BY-SA 4.0 and GFDL)' },
    fallback: {
      type: 'tsv',
      name: 'wiktionary-2023',
      path: 'wiktionary-vuizur/Spanish-English Wiktionary dictionary.tsv',
      description: `${VUIZUR}, for the few words the November 2026 extraction lacks (such as the preposition a)`,
      tag: null,
    },
  },
  pt: {
    name: 'Brazilian Portuguese',
    setName: 'Most frequent words: Brazilian Portuguese (OpenSubtitles pt-BR, English Wiktionary)',
    frequency: {
      type: 'frequencywords',
      path: 'FrequencyWords/content/2018/pt_br/pt_br_50k.txt',
      kind: 'frequency_subtitles',
      description: 'OpenSubtitles 2018 Brazilian Portuguese word counts (hermitdave/FrequencyWords pt_br, CC BY-SA 4.0), the largest open frequency list that is specifically Brazilian.',
    },
    lexicon: { type: 'michmech', path: 'lemmatization-lists/lemmatization-pt.txt', description: 'michmech/lemmatization-lists Portuguese (ODbL 1.0) plus Wiktionary headwords and form-of entries' },
    names: { list: 'FrequencyWords/content/2018/es/es_50k.txt', lang: 'es' },
    excludeAsNames: ['bob', 'henry', 'jack'],
    treebank: { files: ud('UD_Portuguese-Porttinari', 'pt_porttinari', ['train', 'dev', 'test']), description: 'UD Portuguese Porttinari treebank of Brazilian news (CC BY-SA 4.0), used only to split ambiguous forms' },
    wiktionary: { type: 'tsv', path: 'wiktionary-vuizur/Portuguese-English Wiktionary dictionary.tsv', description: VUIZUR },
  },
  pl: {
    name: 'Polish',
    setName: 'Most frequent words: Polish (wordfreq, English Wiktionary)',
    frequency: {
      type: 'wordfreq',
      path: 'wordfreq/wordfreq/data/large_pl.msgpack.gz',
      kind: 'frequency_mixed',
      description: 'wordfreq 3.1 "large" list (rspeer/wordfreq; data CC BY-SA 4.0), which combines six sources: Wikipedia, OpenSubtitles, news, web text, Twitter and Reddit.',
    },
    lexicon: { type: 'spacy-pl', path: 'spacy-lookups-data/spacy_lookups_data/data', description: 'PoliMorf/SGJP morphological dictionary (BSD-2-Clause), as packaged in explosion/spacy-lookups-data, plus Wiktionary headwords' },
    names: { list: 'FrequencyWords/content/2018/es/es_50k.txt', lang: 'es' },
    excludeAsNames: ['daniel'],
    treebank: { files: ud('UD_Polish-PDB', 'pl_pdb', ['train', 'dev', 'test']), description: 'UD Polish PDB treebank (CC BY-NC-SA 4.0), used only to split ambiguous forms such as nie (particle or pronoun); none of its text is included' },
    wiktionary: { type: 'tsv', path: 'wiktionary-vuizur/Polish-English Wiktionary dictionary.tsv', description: VUIZUR },
  },
  ru: {
    name: 'Russian',
    setName: 'Most frequent words: Russian (wordfreq, English Wiktionary)',
    frequency: {
      type: 'wordfreq',
      path: 'wordfreq/wordfreq/data/large_ru.msgpack.gz',
      kind: 'frequency_mixed',
      description: 'wordfreq 3.1 "large" list (rspeer/wordfreq; data CC BY-SA 4.0), which combines Wikipedia, OpenSubtitles, news, Google Books and Twitter.',
    },
    lexicon: { type: 'openrussian', path: 'russian-dictionary', description: 'OpenRussian.org inflection tables (Badestrand/russian-dictionary, CC BY-SA 4.0) plus Wiktionary headwords' },
    treebank: {
      files: ud('UD_Russian-SynTagRus', 'ru_syntagrus', ['train-a', 'train-b', 'train-c', 'dev', 'test']),
      description: 'UD Russian SynTagRus treebank (CC BY-NC-SA 4.0), used only to split ambiguous forms such as уже (already, or narrower); none of its text is included',
    },
    wiktionary: { type: 'tsv', path: 'wiktionary-vuizur/Russian-English Wiktionary dictionary.tsv', description: VUIZUR },
    openRussian: 'russian-dictionary',
    extras: ['Stress marks, gender, aspect and inflection tables: OpenRussian.org (Badestrand/russian-dictionary, CC BY-SA 4.0).'],
  },
  uk: {
    name: 'Ukrainian',
    setName: 'Most frequent words: Ukrainian (wordfreq, English Wiktionary)',
    frequency: {
      type: 'wordfreq',
      path: 'wordfreq/wordfreq/data/large_uk.msgpack.gz',
      kind: 'frequency_mixed',
      description: 'wordfreq 3.1 "large" list (rspeer/wordfreq; data CC BY-SA 4.0), which combines Wikipedia, OpenSubtitles, web text, Twitter and Reddit.',
    },
    lexicon: { type: 'michmech', path: 'lemmatization-lists/lemmatization-uk.txt', description: 'michmech/lemmatization-lists Ukrainian (ODbL 1.0) and the inflection tables in dmklinger/ukrainian, plus Wiktionary headwords' },
    treebank: { files: ud('UD_Ukrainian-IU', 'uk_iu', ['train', 'dev', 'test']), description: 'UD Ukrainian IU treebank (CC BY-NC-SA 4.0), used only to split ambiguous forms; none of its text is included' },
    wiktionary: { type: 'tsv', path: 'wiktionary-vuizur/Ukrainian-English Wiktionary dictionary.tsv', description: VUIZUR },
    fallback: {
      type: 'dmklinger',
      name: 'dmklinger/ukrainian',
      tag: 'fallback-dictionary',
      path: 'dmklinger-ukrainian/words.json',
      description: 'dmklinger/ukrainian, a Ukrainian–English dictionary compiled from English Wiktionary and DBnary (June 2026; CC BY-SA 3.0)',
    },
    extras: ['Stress marks: Wiktionary forms, else dmklinger/ukrainian (whose inflection tables come from the ULIF grammatical dictionary).'],
  },
  vi: {
    name: 'Southern Vietnamese',
    setName: 'Most frequent words: Vietnamese (vn-freqs, English Wiktionary)',
    frequency: {
      type: 'vnfreqs',
      path: 'vn-freqs/vn_word_frequencies.tsv',
      kind: 'frequency_mixed',
      description:
        'tabidots/vn-freqs: Leipzig Corpora Collection (1M mixed Vietnamese sentences) and OpenSubtitles 2016, segmented into words (not syllables) with pyvi. No Southern-only frequency list is openly available; Wiktionary labels such as "Southern Vietnam" are kept in the notes.',
    },
    treebank: { files: ud('UD_Vietnamese-VTB', 'vi_vtb', ['train', 'dev', 'test']), description: 'UD Vietnamese VTB treebank (CC BY-SA 4.0), used only to choose each word\'s main part of speech (là: the copula)' },
    wiktionary: { type: 'tsv', path: 'wiktionary-vuizur/Vietnamese-English Wiktionary dictionary.tsv', description: VUIZUR },
  },
};
