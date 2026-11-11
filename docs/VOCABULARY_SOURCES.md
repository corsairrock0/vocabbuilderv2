# Vocabulary data sources for VocabBuilder

Research date: 2026-11-05. Scope: importable vocabulary for Colombian Spanish (es), Brazilian Portuguese (pt-BR),
Southern Vietnamese (vi), Russian (ru), Ukrainian (uk) and Polish (pl), with English glosses, for a private,
self-hosted, single-user app.

How this was checked: every finding below was read on the linked page on the research date (web search/fetch only).
"Unverified" means the page was blocked or not fetchable, or it said nothing on the point. Only URLs actually seen are
listed; none were constructed. This is a planning summary, not legal advice.

> **What the bundled sets use.** The research below informed the "6,000 most frequent words" sets in
> `data/frequency/`. The sources finally chosen, the reasons, the build method, coverage and licences are in
> [FREQUENCY_SETS.md](FREQUENCY_SETS.md). Two findings from building them change this page's recommendations. First,
> Sharoff's RNC lemma list undercounts several very common Russian words (теперь, можно), so the Russian set uses
> wordfreq instead. Second, the ukvocab (UberText) list was not reachable from the build environment.

Terms used: **lemma** = dictionary headword counts; **surface** = counts of written word forms (ru *воду* and *воды*
are counted separately); **segmented** (Vietnamese) = multi-syllable words such as *thời gian* are kept as one unit.

## 1. At a glance: best free combination per language

| Lang | Glosses, forms, IPA | Frequency (best free) | Examples with English | Main licensing caveat |
|---|---|---|---|---|
| es (CO) | Kaikki Spanish | doozan `frequency.csv` (lemma) or wordfreq `es` (surface) | Kaikki, Tatoeba `spa` | No free Colombia-specific frequency list found |
| pt-BR | Kaikki Portuguese | FrequencyWords `pt_br` (Brazilian subtitles, surface) | Kaikki, Tatoeba `por` | LexPorBR is CC BY-NC-SA |
| vi (S) | Kaikki Vietnamese (multi-syllable headwords) | tabidots `vn-freqs` (pyvi-segmented) | Kaikki, Tatoeba `vie` | Most Vietnamese lists state no license |
| ru | OpenRussian dump + Kaikki | Sharoff lemma+POS lists (RNC etc.) | OpenRussian (from Tatoeba), Kaikki | Sharoff lists state no license; RNC terms forbid redistribution and cap downloads at 500 lemmas |
| uk | Kaikki Ukrainian (+ VESUM forms) | ukvocab: top 12,000 lemmas over UberText 2.0 | Kaikki, Tatoeba `ukr` | VESUM data and the PULS level layer are NonCommercial |
| pl | Kaikki Polish | KWJP lemma lists, or NKJP unigrams (CC BY) | Kaikki, Tatoeba `pol` | KWJP list license unverified |

## 2. Multilingual sources

### 2.1 Kaikki.org / Wiktextract (machine-readable English Wiktionary)

| Item | Finding |
|---|---|
| Provides | Lemma entries **and** separate inflected-form entries: English glosses, POS, inflections, IPA, examples with English translations, regional and usage tags |
| Freshness | "structured data extracted on 2026-10-30 from the enwiktionary dump dated 2026-10-01" ([index](https://kaikki.org/dictionary/index.html)) |
| License | "same licenses as Wiktionary - both CC-BY-SA and GFDL". Academic users are asked to cite Ylonen (LREC 2022) and link to the kaikki.org pages ([index](https://kaikki.org/dictionary/index.html)) |
| Per-language JSONL | One JSON object per line. All are marked **DEPRECATED** and "will be removed in the near future" (linked wiktextract issue #1178). Sizes: [Spanish](https://kaikki.org/dictionary/Spanish/kaikki.org-dictionary-Spanish.jsonl) 1.0 GB, [Portuguese](https://kaikki.org/dictionary/Portuguese/kaikki.org-dictionary-Portuguese.jsonl) 581.9 MB, [Vietnamese](https://kaikki.org/dictionary/Vietnamese/kaikki.org-dictionary-Vietnamese.jsonl) 79.6 MB, [Russian](https://kaikki.org/dictionary/Russian/kaikki.org-dictionary-Russian.jsonl) 904.6 MB, [Ukrainian](https://kaikki.org/dictionary/Ukrainian/kaikki.org-dictionary-Ukrainian.jsonl) 307.8 MB, [Polish](https://kaikki.org/dictionary/Polish/kaikki.org-dictionary-Polish.jsonl) 855.9 MB (see each language's index page, e.g. [Russian](https://kaikki.org/dictionary/Russian/index.html)) |
| Long-term download | `raw-wiktextract-data.jsonl.gz` (2.9 GB; 24.8 GB unpacked) holds every language from the English edition; filter it on `lang_code`. The `downloads/<code>/` files on the same page come from *other* Wiktionary editions, so their glosses are not in English ([rawdata](https://kaikki.org/dictionary/rawdata.html)) |
| Size | Senses: es 879,175; pt 527,775; vi 62,555; ru 493,243; uk 82,051; pl 267,966 ([index](https://kaikki.org/dictionary/index.html)). Counts labeled "All word forms" (these include form-of entries): es 775,464; pt 425,855; vi 45,519; ru 428,275; uk 55,939; pl 176,753 (per-language index pages) |

**JSONL field names.** I checked these against live kaikki.org entry JSON rather than relying only on the README:

- Top level: `word`, `pos`, `lang`, `lang_code`, `senses`, `forms`, `sounds`, `head_templates`,
  `inflection_templates`, `etymology_text`, `categories` ([этот](https://kaikki.org/dictionary/Russian/meaning/%D1%8D/%D1%8D%D1%82/%D1%8D%D1%82%D0%BE%D1%82.html),
  [злий](https://kaikki.org/dictionary/Ukrainian/meaning/%D0%B7/%D0%B7%D0%BB/%D0%B7%D0%BB%D0%B8%D0%B9.html)). The same `word`
  can appear on several lines; этот has both a determiner entry and a pronoun entry.
- `senses[]`: `glosses` (list), `raw_glosses`, `tags`, `categories`, `examples`. Inflected-form entries have the tag
  `form-of` and `form_of: [{"word": "джерело́", "extra": "džereló"}]` ([джерела](https://kaikki.org/dictionary/Ukrainian/meaning/%D0%B4/%D0%B4%D0%B6/%D0%B4%D0%B6%D0%B5%D1%80%D0%B5%D0%BB%D0%B0.html)).
- `senses[].examples[]`: `text`, **`translation`** and the legacy **`english`** (both present, with identical values, in
  the ru and pt entries I checked), plus `type` (`example`/`quotation`), `ref`, `roman`, `bold_text_offsets` and
  `bold_translation_offsets` ([этот](https://kaikki.org/dictionary/Russian/meaning/%D1%8D/%D1%8D%D1%82/%D1%8D%D1%82%D0%BE%D1%82.html),
  [depois](https://kaikki.org/dictionary/Portuguese/meaning/d/de/depois.html)). The wiktextract README still documents
  only `english` ([README](https://github.com/tatuylonen/wiktextract)), and a third-party Rust model reads only
  `translation` ([wty](https://docs.rs/crate/wty/latest/source/src/models/kaikki.rs)). **Read `translation` first and fall back to `english`.**
- `forms[]`: `form`, `tags`, and sometimes `source` (e.g. `"conjugation"`) ([znaczyć](https://kaikki.org/dictionary/Polish/meaning/z/zn/znaczyć.html)).
  Some forms are metadata rather than inflections: `canonical` (ru stressed `э́тот`) and `romanization` (`étot`).
- `sounds[]`: `ipa` and `tags` (pt: `Brazil`, `Rio-de-Janeiro`, `Portugal`). Some entries use `note` instead of tags: the
  Saigon IPA in vi entries has `"note": "Saigon"`. Other keys: `audio`, `ogg_url`, `mp3_url`, `rhymes`, `homophone`
  ([depois](https://kaikki.org/dictionary/Portuguese/meaning/d/de/depois.html),
  [heo](https://kaikki.org/dictionary/Vietnamese/meaning/h/he/heo.html), [README](https://github.com/tatuylonen/wiktextract)).

Caveats:
- **Stress is inconsistent.** ru `word` values are unstressed, and the stressed form sits in a `canonical` form. In uk
  злий there was no `canonical` form; stress appeared only in template arguments and in some forms ([злий](https://kaikki.org/dictionary/Ukrainian/meaning/%D0%B7/%D0%B7%D0%BB/%D0%B7%D0%BB%D0%B8%D0%B9.html)).
- **Regional tags work as filters.** es *parcero* has the sense tags `Colombia`, `Ecuador`, `slang` and the category
  "Colombian Spanish". Its IPA lists both `/paɾˈθeɾo/` and `/paɾˈseɾo/`, so pick the /s/ (seseo) variant for Colombia
  ([parcero](https://kaikki.org/dictionary/Spanish/meaning/p/pa/parcero.html)). vi *heo* is tagged `Southern`,
  `Central`, `Vietnam`, with the category "Southern Vietnamese"; its synonym *lợn* is tagged `Northern` ([heo](https://kaikki.org/dictionary/Vietnamese/meaning/h/he/heo.html)).
- **Coverage is uneven.** vi and uk have roughly a tenth of the senses that es and ru have.

### 2.2 wordfreq (rspeer)

| Item | Finding |
|---|---|
| Provides | Merged frequencies on the Zipf scale (log10 of occurrences per billion words); no glosses. The README never mentions lemmatization. A Unicode UAX #29 regex tokenizer is used, with special segmenters only for zh, ja and ko ([README](https://github.com/rspeer/wordfreq)). Treat entries as **surface forms** (inference) |
| Coverage | es: 7 sources, large list; pt: 5, large; **vi: 3, no large list**; ru: 5, large; uk: 5, large; pl: 6, large. Sources: Wikipedia, OpenSubtitles 2018 + SUBTLEX, NewsCrawl/GlobalVoices, Google Books 2012, OSCAR web, Twitter, Reddit ([README](https://github.com/rspeer/wordfreq)) |
| Size / precision | The "small" lists cover words seen at least once per million words; the "large" lists, at least once per 100 million ([PyPI](https://pypi.org/project/wordfreq)). Values are rounded to 0.01 Zipf ([README](https://github.com/rspeer/wordfreq)) |
| Access | Python package, latest 3.1.1 (2023-11-21). Export with `iter_wordlist()`, `get_frequency_dict()` or `top_n_list()` ([PyPI](https://pypi.org/project/wordfreq)) |
| License | Code: Apache. Data: CC BY-SA 4.0. Derived work "must credit the SUBTLEX authors"; OpenSubtitles data "may be used with attribution"; acknowledging Google Books Ngram is requested ([README](https://github.com/rspeer/wordfreq)) |
| Status | **Frozen**: "a snapshot of language usage through about 2021". The author will not update it because generative-AI text has polluted the web, so newer data "would make it worse". Existing data stays available ([SUNSET.md](https://github.com/rspeer/wordfreq/blob/master/SUNSET.md)) |
| Caveats | One `pt` list (no BR/PT split) and one `es` list (no country split). Vietnamese tokens are probably syllables, since UAX #29 splits on spaces (inference, unverified) |

### 2.3 hermitdave/FrequencyWords (OpenSubtitles)

| Item | Finding |
|---|---|
| Provides | Surface word counts from tokenized OPUS OpenSubtitles 2016 and 2018 data. Each line is `word count`, separated by a space (e.g. `you 22484400`) ([README](https://raw.githubusercontent.com/hermitdave/FrequencyWords/525f9b560de45753a5ea01069454e72e9aa541c6/README.md)) |
| Coverage | es, pt, **pt_br** (a separate Brazilian list), vi, ru, uk, pl, as listed by a Hugging Face clone of the 2018 data ([card](https://huggingface.co/datasets/StephanAkkerman/frequency-words-2018), [tree](https://huggingface.co/datasets/StephanAkkerman/frequency-words-2018/tree/main)). Each language has `xx_50k.txt`, `xx_full.txt` and `xx_ignored.txt`; for pt_br these are 650 kB, 9.88 MB and 4.13 MB ([pt_br](https://huggingface.co/datasets/StephanAkkerman/frequency-words-2018/tree/10d0156d6aba73b253011ebfcb1fbee94a5ce04a/pt_br)) |
| License | "MIT License for code", "CC-by-sa-4.0 for content" ([repo](https://github.com/hermitdave/FrequencyWords)). One downstream project cites it as CC BY-SA 3.0 ([doozan](https://github.com/doozan/spanish_data)), and the HF clone is tagged cc-by-4.0. Follow the upstream terms |
| Upstream | OPUS: "We do not own any of the text from which the data has been extracted"; it asks for a citation of Lison & Tiedemann 2016 and gives no explicit license ([OPUS](https://opus.nlpl.eu/OpenSubtitles/en&/v2018/OpenSubtitles)) |
| Caveats | Subtitle register: dialogue, often translated from English. Names and noise in the tail. Vietnamese tokens are probably syllables (unverified) |

### 2.4 Tatoeba (sentence pairs)

| Item | Finding |
|---|---|
| Exports | Weekly (Saturdays, 06:30 UTC), tab-separated, with ISO 639-3 codes (spa, por, vie, rus, ukr, pol, eng). Sentences: `Sentence id, Lang, Text`. Detailed: adds `Username, Date added, Date last modified`. CC0 subset: `Sentence id, Lang, Text, Date last modified`. Links (`links.tar.bz2`): `Sentence id, Translation id`, stored in both directions. Tags (`tags.tar.bz2`). Audio (`sentences_with_audio.tar.bz2`): `Sentence id, Audio id, Username, License, Attribution URL`. Self-reported skill (`user_languages.tar.bz2`) ([downloads](https://tatoeba.org/ca/downloads)) |
| URLs | https://downloads.tatoeba.org/exports/links.tar.bz2 and https://downloads.tatoeba.org/exports/sentences_with_audio.tar.bz2 ([downloads](https://tatoeba.org/ca/downloads)). A third-party script uses per-language files such as https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2 and reads `links.csv` from inside the links archive ([gist](https://gist.github.com/joeminicucci/fd84dfc0d4d9438a00abfad8f42f8d2f)). The downloads page names the all-language sentence file only through a template placeholder, so its exact file name (`sentences.csv` or other) is unverified. "Sentence pairs" downloads are generated on demand |
| License | Text: "These files are released under CC BY 2.0 FR"; part is also CC0 1.0. **Audio**: "The license covering an audio file is chosen by the contributor", and "If the license field is empty, you may not reuse the audio outside the Tatoeba project" ([downloads](https://tatoeba.org/ca/downloads)) |
| Caveats | The exports have no field for regional variety, so pt-BR/pt-PT and Colombian/Peninsular Spanish can't be told apart (inference). Quality varies; the `user_languages` skill level is a rough proxy |

### 2.5 Other multilingual resources

| Source | Finding | License |
|---|---|---|
| Leipzig Corpora Collection | Downloads contain "words (+frequency), cooccurrences" plus example sentences ([LINDAT record](https://lindat.mff.cuni.cz/services/catalog/view/http:__hdl_handle_net_11372_LRT-704)); counts are surface forms. Example corpus: Ukrainian `ukr_mixed_2014`, 1.55 B tokens ([k-centre list](https://k-centre.uacorpus.org/corpora.html)) | "All corpora provided for download are licensed under CC BY"; use of the web interface is CC BY-NC, non-commercial ([catalogue quoting Leipzig's terms](https://sprogressource.digst.govcloud.dk/dataset/leipzig-corpora-collection)). The [download page](https://wortschatz.uni-leipzig.de/en/download) sits behind a JavaScript bot check, so per-country corpora (Colombia, Brazil) are **unverified** |
| Sharoff "robust frequency lists" | Russian lemma+POS lists; Polish and Ukrainian Wikipedia lists. TSV columns: `Word, Raw, Adjusted, Clipped, Total Doc` ([frqc](https://ssharoff.github.io/frqc)) | None stated |
| Wiktionary frequency lists | Mostly "distinct orthographic words (not lemmas)" ([index](https://en.wiktionary.com/wiki/Wiktionary:Frequency_lists)) | Varies by list |

## 3. Per-language findings

### 3.1 Spanish (target: Colombian)

| Source | What it provides | Access / format | License | Notes |
|---|---|---|---|---|
| Kaikki Spanish | See 2.1 | JSONL, 1.0 GB | CC BY-SA + GFDL | Sense tags `Colombia`; category "Colombian Spanish" |
| doozan/spanish_data | `frequency.csv`: "most frequently used Spanish lemmas with part of speech and word forms combined into lemma", built from FrequencyWords with FreeLing POS. Also `es-en.data` (Wiktionary dictionary) and `sentences.tsv` (Tatoeba en/es pairs with POS and lemmas) ([repo](https://github.com/doozan/spanish_data)) | GitHub; column names unverified | Repo: "CC-BY-4.0". Per-file credits: Wiktionary CC BY-SA; FrequencyWords "CC-BY-SA 3.0"; Tatoeba CC BY 2.0 FR | Ready-made lemma ranking; subtitle-based, not Colombia-specific |
| wordfreq / FrequencyWords `es` | Surface frequencies | See 2.2 / 2.3 | CC BY-SA 4.0 | Mixes all Spanish varieties |
| Corpus del Español (Davies) | Web/Dialects: about 2.1 B words of web text from 21 countries; **Colombia: 180,145,658 words in 189,007 pages** ([texts](https://www.corpusdelespanol.org/web-dial/help/texts.asp)) | Online search; full-text data via corpusdata.org, price not shown ([resources](https://www.corpusdelespanol.org/resources.asp)) | Not stated | The only real Colombia split found; not a free download |
| wordfrequency.info Spanish (based on Corpus del Español) | `span_40k_lemmas` (ID, lemma, PoS, freq, texts); `span_40k_forms` (lemID, lemFreq, lemma, PoS, wordFreq, word, % form); `span_200k` (ID, word, freq, #texts, %caps). No English glosses; samples are available ([files](https://wordfrequency.info/span/files.asp)) | Paid; 20k lists cost "about $200 for academic use" ([english-corpora](https://www.english-corpora.org/word_frequency.asp)) | "In no case can the word frequency data be distributed beyond the university or company that purchased the data" ([license](https://wordfrequency.info/license.asp)) | Private use only, and only if purchased |
| Sketch Engine / Lexical Computing | Lists from a 28 B-word corpus. Each document records its top-level domain, so per-country lists (e.g. `.co`) can be built. Priced by quotation; free sample CSV ([page](https://www.lexicalcomputing.com/spanish-word-frequency-lists-for-download/)) | Paid | Not stated | |
| SUBTLEX-ESP (Cuetos et al. 2011) | 41.5 M-word subtitle corpus, of which 38.6 M words come from English-speaking films. Subtitles came from argenteam, subdivx and solosubtitulos. Data at `http://www.unioviedo.es/neurociencias_cognitivas/data/` ([article](https://www.uv.es/revispsi/articulos2.11/1CUETOS.pdf)) | Current availability unverified | None stated | Mostly translated dialogue |
| Buchmeier subtitle list | 27.4 M words from 6,527 subtitle files ([Perea page](https://www.uv.es/mperea/subtitles.htm)) | Wiktionary user page / BPAL txt | "CC-BY-SA 3.0, GFDL, or LGPL" (as stated by Perea) | Surface forms |
| TUBELEX (YouTube subtitles) | Spanish "default" and **lemma** lists, with counts per video and channel ([paper](https://arxiv.org/html/2410.03240v2)) | github.com/naist-nlp/tubelex (repo not fetched) | The paper names no license (unverified) | Closer to everyday speech, but not country-specific |
| CORPES XXI (RAE) | Not determined (page fetch failed) | Unverified | Unverified | |

### 3.2 Brazilian Portuguese

| Source | What it provides | Access / format | License | Notes |
|---|---|---|---|---|
| Kaikki Portuguese | See 2.1; IPA tagged `Brazil` / `Rio-de-Janeiro` / `Portugal` ([depois](https://kaikki.org/dictionary/Portuguese/meaning/d/de/depois.html)) | JSONL, 581.9 MB | CC BY-SA + GFDL | |
| FrequencyWords `pt_br` | Surface counts from Brazilian subtitles | `pt_br_50k.txt`, `pt_br_full.txt` (2.3) | CC BY-SA 4.0 | Best free Brazil-specific list found |
| LexPorBR (Estivalet & Meunier 2017) | 215,175 entries × 21 columns: POS, orthographic frequency (raw, per million, log), neighbourhood measures and more. The "Alfa" version described has no phonology or lemma links; these were planned for "Beta" ([article](https://www.e-publicacoes.uerj.br/soletras/article/download/29702/21229/98444)) | UTF-8 CSV, about 45 MB, from http://www.lexicodoportugues.com/downloads.php (site not fetched; current version unverified) | **CC BY-NC-SA 4.0** | Built from the NILC corpus (about 32 M words, 1999, written) |
| SUBTLEX-PT-BR (Tang 2012) | 61,609,241 tokens and 136,147 types from 12,104 Brazilian subtitle files; word forms plus contextual diversity; no POS ([paper](https://slam.phil-fak.uni-duesseldorf.de/papers/older_than_2020/Tang_2012_SUBTLEXPTBR_UCLWPL2.pdf)) | `http://crr.ugent.be/subtlex-pt-br/` (unverified) | None stated | |
| wordfreq `pt` | Surface; Brazilian and European Portuguese mixed | See 2.2 | CC BY-SA 4.0 | |
| wordfrequency.info Portuguese | `port_40k_lemmas` and others, with the same columns as Spanish; no BR/PT split stated ([files](https://wordfrequency.info/port/files.asp)) | Paid | Same restrictive license | |
| Sketch Engine Portuguese | 17 B-word corpus; can be split by `.br` domain ([page](https://lexicalcomputing.com/?p=1249)) | Paid | Not stated | |

### 3.3 Vietnamese (target: Southern)

Segmentation matters. Spaces mark syllable boundaries as well as word boundaries, and much of the lexicon is
polysyllabic ([tabidots README](https://github.com/tabidots/vn-freqs)). Kaikki headwords are whole words such as
`"word": "tất cả"` ([entry](https://kaikki.org/dictionary/Vietnamese/meaning/t/t%E1%BA%A5/t%E1%BA%A5t%20c%E1%BA%A3.html)),
so only segmented frequency lists can be matched to them reliably.

| Source | Segmented? | What it provides | Access | License |
|---|---|---|---|---|
| tabidots/vn-freqs | **Yes** (pyvi tokenizer) | Word frequencies from the Leipzig "1M mixed-source Vietnamese sentences" plus OpenSubtitles2016 (vi); tone-mark placement, case and final i/y normalized ([repo](https://github.com/tabidots/vn-freqs)) | `vn_word_frequencies.tsv` (columns and entry count unverified) | **No license file in the repo listing** |
| DevinTDHa (Trung Đức Hà) lists | **Yes** (VnCoreNLP; compounds joined with `_`, e.g. `thời_gian`) | Per-corpus and merged lists from OpenSubtitles, Binhvq news (about 3 B words), viwik18 Wikipedia and Facebook comments. Filtered against a word list built from Wiktextract and the Free Vietnamese Dictionary; split into 1,000-entry files ([blog](https://trungducha.de/blog/2024/extracting-most-common-words-in-vi/)) | Releases at https://github.com/DevinTDHa/vn-nlp-exp/tree/main (not fetched) | Not stated |
| Vietnamese Lab | Partly (mostly syllables, but includes `công ty`, `thời gian`, `Hà Nội`) | Top 1,000 words **with English glosses**; no corpus named, no POS, no dialect information ([page](https://vietnameselab.com/frequency)) | [CSV](https://vietnameselab.com/frequency/vietnamese-frequency-list-top-1000.csv), [Anki CSV](https://vietnameselab.com/frequency/vietnamese-frequency-list-top-1000-anki.csv) | None; "© 2026 Vietnamese Lab" |
| bietviet (Scott Lawson) | Yes (multi-syllable entries) | Rank, count and English definitions, "ranked by frequency from Vietnamese Wikipedia" ([levels](https://bietviet.scottlawsonbc.com/levels?level=3)) | Web only | None stated |
| wordfreq `vi`, FrequencyWords `vi` | Probably **no** (unverified) | Surface tokens | See 2.2 / 2.3 | CC BY-SA 4.0 |
| Pham, Kohnert & Carney (2008) newspaper list | **No** (syllables; ASCII-coded diacritics such as `ddã`) | Newspaper corpus of 851,174 tokens ([PDF](https://vnspeech.sdsu.edu/wp-content/uploads/2024/01/Research-Corpora-Word-Lists-Newspaper-word-freq-list.pdf)) | PDF | None; citation requested |
| hieuthi syllable list | No | 7,184 syllables covering more than 94% of occurrences ([gist](https://gist.github.com/hieuthi/1f5d80fca871f3642f61f7e3de883f3a)) | txt | None stated |
| Ho Ngoc Duc word lists | Yes (words and phrases) | 11K–74K entries in dictionary order, **no frequencies** ([page](https://informatik.uni-leipzig.de/~duc/software/misc/wordlist.html), [GitHub copy](https://github.com/duyet/vietnamese-wordlist)) | txt | GPL (GitHub copy: GPL-2.0) |
| SUBTLEX-VIET / GENLEX-VIET (Pham, Tucker & Baayen 2019) | A tokenized version is released | Subtitle and news/story corpora with frequency, dispersion and other measures ([record](https://experts.nau.edu/en/publications/constructing-two-vietnamese-corpora-and-building-a-lexical-databa/)) | Download location unverified | Unverified |

Southern Vietnamese: none of these frequency lists is Southern-specific. Use Kaikki for dialect signals: senses tagged
`Southern`/`Central`, the category "Southern Vietnamese", synonyms tagged `Northern`, and the Saigon IPA under `note`
([heo](https://kaikki.org/dictionary/Vietnamese/meaning/h/he/heo.html)).

### 3.4 Russian

| Source | What it provides | Access | License | Notes |
|---|---|---|---|---|
| OpenRussian | "full database of words, translations and declensions" ([dictionary](https://en.openrussian.org/dictionary)); the site shows stress ("including the accents"), CEFR A1–C2 filters and a "Top russian words" list of 90,179 words ([list](https://en.openrussian.org/list/all?start=1850)). Sentences come from Tatoeba, with Tatoeba IDs and usernames ([GitHub](https://github.com/Badestrand/russian-dictionary)) | Dumps "freshly produced every night" ([dictionary](https://en.openrussian.org/dictionary)); SQL archive `openrussian-sql.zip` ([openrussian-cli](https://git.fmsbw.de/openrussian-cli/plain/README.md?h=1.0.0)); TogetherDB CSV export ([mdict project](https://awesome.ecosyste.ms/projects/github.com%2Fholence%2Fopenrussian_mdict)); GitHub `nouns.csv`, `verbs.csv`, `adjectives.csv`, `others.csv`, described as "a bit outdated" | "all data is licensed under the CC BY-SA license": mention the source and share modifications under the same license. The GitHub copy is CC BY-SA 4.0. **Audio is not included** | Column names (e.g. rank or level fields) unverified. The README warns of artefacts such as a stray "asterisk or slash" |
| Sharoff lists | Lemma+POS frequencies from RNC, ruTenTen, ruWac, GICR news, Aranea and CCNet, in files such as `ru/rnc-orig.out.lpos-clean2-biwt.tsv.xz` ([frqc](https://ssharoff.github.io/frqc)) | TSV.xz | **None stated** | Best free lemma ranking. The same page links the Lyashevskaya & Sharoff (2009) dictionary at `http://dict.ruslang.ru/freq.php` (not fetched) |
| Russian National Corpus | Online frequency dictionary of the top 500 lemmas (rank, lemma, ipm, absolute count) for the Main, Educational and Media corpora. Excel/CSV download is "limited to 500 lemmas" ([tool](https://ruscorpora.ru/en/page/tool-freq/)) | Web | Non-commercial only. Reproduction or distribution "without prior written permission of the RNC is prohibited". Personal use is allowed if copyright marks are kept; a CAPTCHA blocks robots ([terms](https://ruscorpora.ru/en/page/terms)) | **Red flag** for bulk use |
| Kaikki Russian | See 2.1; stressed `canonical` form | JSONL, 904.6 MB | CC BY-SA + GFDL | |
| wordfreq / FrequencyWords `ru` | Surface | See 2.2 / 2.3 | CC BY-SA 4.0 | |

### 3.5 Ukrainian

| Source | What it provides | Access | License | Notes |
|---|---|---|---|---|
| GRAC | Reference corpus, 1816 to the present. More than 2 B tokens and over 812,000 texts as of 2025-11-29 ([Wikipedia](https://en.wikipedia.org/wiki/General_Regionally_Annotated_Corpus_of_Ukrainian)). Search by period, register, text type and region ([site](https://uacorpus.org/en)) | Web search. One frequency dictionary is offered, "Частотний словник на основі ГРАК-15" (fiction and journalism, 1950–2009), as a [Google Sheet](https://docs.google.com/spreadsheets/d/1lfAfCYxuxXK_8MrnQVy5YpUPOQjt8Q3bySyKWEnccZI/edit?usp=sharing) ([dictionaries page](https://uacorpus.org/en/slovniki)) | **None stated**; "Please cite GRAC" | The frequency dictionary stops at 2009 |
| ukvocab (UberText 2.0) | "top-12,000 lemma frequency list over UberText 2.0", plus the PULS CEFR overlay (A1–C1), the Borodin A1/A2 minimums, aspect partners, case government and collocations. English glosses are not mentioned ([PyPI](https://pypi.org/project/ukvocab/)) | Python package; data at https://www.jakelawrence.xyz/downloads/ukrainian-frequency/ (not fetched) | Package: CC BY-NC-SA 4.0. **The frequency list alone: CC BY 4.0.** Government and collocation tables: CC BY-SA 4.0 | Best free modern lemma list found |
| UberText 2.0 (lang.org.ua) | 3.27 B tokens before filtering (news, fiction, Telegram, Wikipedia, court decisions). Lemmatized and POS-tagged exports and lemma frequency lists are listed as deliverables ([paper](https://aclanthology.org/2023.unlp-1.1.pdf)) | [Project page](https://lang.org.ua/en/ubertext/) (not fetched) | The paper names no license (unverified) | |
| PULS | CEFR A1–C2 profile built from 21 textbooks (1 M words) plus GRAC/BRUK frequencies. The full list has over 37,000 lemmas; 5,891 are published ([record](https://er.ucu.edu.ua/items/1e6f36f8-edf0-4128-ad62-a2b7f9245129/full)) | https://puls.peremova.org (downloads unverified) | Unverified | |
| VESUM / dict_uk | Every inflected form with POS tags; `./gradlew expand` produces `dict_corp_vis.txt`, `dict_corp_lt.txt` and `lemmas.txt` ([repo](https://github.com/brown-uk/dict_uk)) | GitHub | Data: **CC BY-NC-SA 4.0**; software: GPL 3.0+ | No stress |
| ukrainian-word-stress-dictionary | Stress (U+0301 after the stressed vowel) for 2,931,496 word forms and phrases, from ULIF's "Словники України"; file `stress.txt` ([repo](https://github.com/lang-uk/ukrainian-word-stress-dictionary/)) | GitHub | **No license file** | The MIT-licensed [ukrainian-word-stress](https://github.com/lang-uk/ukrainian-word-stress) package bundles about 2.9 M entries and uses Stanza to resolve heteronyms |
| Kaikki Ukrainian | See 2.1 (82,051 senses, including form-of entries) | JSONL, 307.8 MB | CC BY-SA + GFDL | Smaller coverage |
| wordfreq, FrequencyWords, Sharoff Wikipedia list (`wiki/uk.-clean2-biwt.tsv.xz`) | Surface (Sharoff list: lemmatization unverified) | See 2.2, 2.3, 2.5 | CC BY-SA 4.0 / none stated | |

### 3.6 Polish

| Source | What it provides | Access | License | Notes |
|---|---|---|---|---|
| KWJP (Corpus of Contemporary Polish, 2011–2020) | Written Polish: 100 M segments in the balanced corpus, 1.43 B in the full corpus ([IPI PAN](https://language.ipipan.waw.pl/resources/2023-12-kwjp)). Lists from the balanced corpus, by genre (fiction, factual, journalism), of lemmas or text words, units with at least 5 occurrences. Columns: `R, Unit, POS (lemma lists), F, IPM, ARF, 1-DP, logDice` ([about](https://kwjp.pl/lists/doc/about/en)) | Web tool, plus GitHub `ipipan/kwjp100-varia/tree/main/freqlists` (named on the about page; repo not fetched) | Not stated; the pages show only "Copyright © Institute of Computer Science PAS, 2023" (**unverified**) | Best lemma list with dispersion measures; written text only |
| NKJP n-grams | 1- to 5-grams from the balanced 300 M-token subcorpus. Unigrams are lower-cased chunks without whitespace (surface); files `1grams.gz` … `5grams.gz` ([page](https://zil.ipipan.waw.pl/NKJPNGrams?action=raw)) | Wiki attachments | "made available on CC-BY licence" | Map forms to lemmas yourself |
| NKJP 1M subcorpus | Manually annotated with lemma and morphosyntactic tag ([IPI PAN](https://language.ipipan.waw.pl/resources/2012-01-national-corpus-of-polish), [HF card: cc-by-4.0](https://huggingface.co/datasets/ipipan/nkjp1m/blame/main/README.md)) | tar.gz | CC BY | Lemma counts can be computed, but it is only 1 M tokens |
| SUBTLEX-PL (Mandera et al.) | 146 M tokens (101 M accepted as correctly spelled Polish). Per-form frequency with dominant POS and lemma, plus a separate lemma file covering 78,361 lemmas ([paper](https://core.ac.uk/download/53122387.pdf)) | `http://crr.ugent.be/subtlex-pl` (unverified) | "freely available for research purposes" | Subtitle register |
| PL196x frequency corpus | 1960s corpus of about 500,000 units (Kurcz et al.) ([article](https://journals.polon.uw.edu.pl/index.php/pj/article/download/1488/1060)); CLARIN ISO image `wksf.iso.bz2` ([CLARIN](https://clarin-pl.eu/dspace/handle/11321/715)) | ISO image | GNU GPL3 | Historical only |
| Kaikki Polish | See 2.1; forms carry `source: "conjugation"` | JSONL, 855.9 MB | CC BY-SA + GFDL | |
| wordfreq / FrequencyWords `pl` | Surface | See 2.2 / 2.3 | CC BY-SA 4.0 | |

## 4. Recommended import pipelines (personal use)

### 4.1 Common backbone (all six languages)

1. **Dictionary**: load the Kaikki per-language JSONL while it still exists. Later, filter `raw-wiktextract-data.jsonl.gz`
   on `lang_code` (es, pt, vi, ru, uk, pl). Group lines by (`word`, `pos`).
2. **Split entries**: lemma entries are senses without `form_of` (and without the `form-of` tag); the rest are
   inflected-form entries.
3. **Surface-to-lemma map**: take `forms[].form` from lemma entries (skipping `canonical` and `romanization`) and
   `form_of[].word` from form entries. Normalize to NFC and lowercase, strip U+0301 (Kaikki `form_of` values carry stress,
   e.g. `джерело́`), and turn `_` into spaces for VnCoreNLP-style Vietnamese lists.
4. **Rank**: sum the frequency-list counts into lemma counts, then sort. Where a lemma-native list exists (Sharoff ru, KWJP pl,
   ukvocab uk, doozan es), use it directly and use the map only for coverage checks.
5. **Examples**: Kaikki `examples[]` (`translation`, falling back to `english`), plus Tatoeba. Join
   `{lang}_sentences.tsv` with `eng_sentences.tsv` through `links.csv`, then attach a pair to a lemma when one of its
   forms appears as a token. Keep the Tatoeba sentence ID and username for attribution.
6. **Attribution**: store `source`, `license` and `retrieved` per field, not just per entry. Licenses differ field by field.

| Importer field | Primary source | Alternatives |
|---|---|---|
| lemma | Kaikki `word` (display form: ru `forms` tagged `canonical`) | OpenRussian accented form; uk stress dictionary |
| English meanings | `senses[].glosses`, skipping form-of senses | OpenRussian translations; Vietnamese Lab glosses (top 1,000 only) |
| part of speech | `pos` | KWJP / Sharoff POS codes |
| frequency rank/count | Frequency list after lemma aggregation | Lemma-native lists (above) |
| examples + English | `examples[].text` + `translation`/`english` | Tatoeba pairs |
| pronunciation | `sounds[].ipa`, filtered on `tags` or `note` | uk `stress.txt` |
| grammar / inflections | `forms[]` (`form`, `tags`), `head_templates`, sense `tags` | VESUM (uk), OpenRussian declension tables |
| tags | sense `tags` and `categories` (e.g. `Colombia`, `Southern`, `slang`) | Frequency band, source register |
| attribution | "Wiktionary via kaikki.org, extracted 2026-10-30, CC BY-SA/GFDL" | Per-source license string |

### 4.2 Per-language recipes

- **es-CO**: Kaikki + doozan `frequency.csv` (lemma ranks), or wordfreq `es` aggregated to lemmas. Boost senses tagged
  `Colombia`, use the seseo IPA, and add Tatoeba `spa` pairs. Ranks reflect Spanish in general, not Colombian Spanish.
  A real Colombian ranking needs a paid source: the Corpus del Español Colombia subset, or Sketch Engine `.co`.
- **pt-BR**: Kaikki + FrequencyWords `pt_br_full.txt` aggregated to lemmas. Keep `sounds` tagged `Brazil`; add Tatoeba
  `por`. LexPorBR can add POS and written-frequency columns (NonCommercial).
- **vi-S**: join Kaikki headwords to tabidots `vn-freqs` (or the DevinTDHa merged list) on the exact multi-syllable
  string. Take the Saigon IPA from `note`, boost `Southern` senses and flag `Northern`-only ones. Use Vietnamese Lab's
  top 1,000 to spot-check glosses. Tatoeba `vie` sentences must be segmented (pyvi or VnCoreNLP) before matching.
- **ru**: the OpenRussian dump supplies the lemma, accented form, English translations, inflection data and sentences;
  rank by Sharoff's RNC lemma list; fill in IPA and extra senses from Kaikki.
- **uk**: ukvocab top-12,000 lemma list for rank (the CC BY 4.0 part), Kaikki for glosses and IPA, `stress.txt` for
  stressed display, VESUM for inflections (NonCommercial), and Tatoeba `ukr`.
- **pl**: KWJP lemma list (rank, POS, ARF), or NKJP `1grams.gz` aggregated through Kaikki forms, plus Kaikki and
  Tatoeba `pol`. SUBTLEX-PL adds a spoken-like lemma ranking if the crr.ugent.be download still works.

### 4.3 Caveats when matching surface forms to lemmas

- **Homographs** split their counts across lemmas (e.g. ru *стали*: a form of *стать* "become" and of *сталь* "steel").
  Assign each count to one lemma deliberately, or split it, and mark the rank as approximate.
- **Tokenizers disagree**: clitics (es *dámelo*), contractions (pt *do* = de + o), hyphenation, apostrophes and case.
  Lower-case consistently, and expect proper nouns in subtitle and Wikipedia lists.
- **Diacritics**: strip stress marks (U+0301) before matching. For Vietnamese, normalize tone-mark placement (tabidots
  already does) and treat pyvi and VnCoreNLP segmentations as different.
- **Coverage gaps**: frequent forms with no Kaikki match should be kept and flagged "no gloss", not dropped.

### 4.4 Frequency lists are evidence, not ground truth

- Subtitle lists over-represent translated film and TV dialogue: in SUBTLEX-ESP, 38.6 M of 41.6 M words came from
  English-language productions ([article](https://www.uv.es/revispsi/articulos2.11/1CUETOS.pdf)).
- News, web and Wikipedia lists over-represent politics, encyclopedic terms and place names (Vietnamese Lab ranks
  *Hà Nội* 107th).
- wordfreq stops at about 2021 and is binned to 0.01 Zipf. Beyond roughly the top 5–10k, rank order is noisy in every list.
- No free list found reflects Colombian or Southern Vietnamese usage. Treat rank as a prior, and let SRS performance
  and personal relevance (people, travel, food, work) override it.

## 5. Licensing summary and red flags

- **Fine for private use; share-alike only if you ever publish the data**: Kaikki/Wiktionary (CC BY-SA + GFDL), wordfreq data
  and FrequencyWords (CC BY-SA 4.0), OpenRussian (CC BY-SA), Tatoeba text (CC BY 2.0 FR), NKJP n-grams and the 1M
  subcorpus (CC BY), Leipzig downloads (CC BY), the ukvocab frequency list (CC BY 4.0).
- **NonCommercial**: LexPorBR, VESUM, and the full ukvocab package (because of PULS). Fine for this app; not for a
  commercial product.
- **Restrictive**: RNC (no reproduction or redistribution without written permission; 500-lemma cap); wordfrequency.info
  (paid; no distribution beyond the purchaser).
- **No license stated** (all rights reserved by default; keep local, don't redistribute): tabidots vn-freqs, Vietnamese
  Lab, DevinTDHa lists, bietviet, Sharoff lists, the GRAC-15 frequency sheet, ukrainian-word-stress-dictionary, KWJP
  lists (unverified), and the SUBTLEX lists ("research purposes" or silent).
- **Tatoeba audio** is licensed per contributor; an empty license field means no reuse outside Tatoeba.
- **Mixed licenses in derived data**: OpenRussian sentences are Tatoeba's (CC BY 2.0 FR) inside a CC BY-SA dataset;
  doozan mixes CC BY-SA and CC BY 2.0 FR material.
- **Inflection tables and cloze sentences in the bundled sets** (version 1.2): UniMorph (CC BY-SA 3.0, from
  Wiktionary), verbecc conjugation templates (GPL-2.0-or-later, derived from Verbiste; only its XML data is read),
  PoliMorf in the Morfologik Polish dictionary (BSD-2-Clause), OpenRussian and dmklinger/ukrainian as above.
  Sentences: Tatoeba (CC BY 2.0 FR) via the Vuizur/tatoeba-to-anki decks and the Helsinki-NLP Tatoeba-Challenge
  development and test sets (CC BY 2.0 FR; its training data is CC BY-NC-SA and is not used), then UD treebanks:
  AnCora (CC BY 4.0), Porttinari, VTB, Taiga, Russian GSD and Polish PUD (CC BY-SA 4.0), Polish LFG (GPL-3.0), and,
  only where no other sentence exists, **SynTagRus, PDB and IU (CC BY-NC-SA 4.0)**. Every sentence carries its
  source; `scripts/freq/build.mjs --commercial-safe` leaves the non-commercial ones out.
- **Availability risk**: the Kaikki per-language JSONL files are deprecated (plan for the raw dump), and wordfreq is frozen.

## 6. Not verified (could not access, or the page was silent)

- Whether OpenRussian's live database exports frequency rank or CEFR level. The column layouts are now known from the
  build: tabidots `vn_word_frequencies.tsv` is `rank, count, word, Wiktionary parts of speech`; doozan
  `frequency.csv` is `count,spanish,pos,flags,usage`; the OpenRussian CSVs are tab-separated with `bare`, `accented`,
  `translations_en`, gender or aspect, and one column per inflected form.
- The licenses of the KWJP GitHub lists, UberText 2.0, TUBELEX, PULS and the Pham et al. (2019) Vietnamese corpora.
- Current availability of the crr.ugent.be SUBTLEX pages (PL, PT-BR), the SUBTLEX-ESP data URL, lexicodoportugues.com
  (current LexPorBR version) and dict.ruslang.ru.
- Leipzig per-country corpora (blocked by the bot check) and CORPES XXI (RAE page failed to load).
- Whether wordfreq and FrequencyWords Vietnamese entries are syllables (likely, from their tokenizers, but unconfirmed).
