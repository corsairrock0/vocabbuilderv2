#!/usr/bin/env bash
# © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
# Fetch the exact source files used to build data/frequency/ (about 2 GB on disk), pinned to the
# commits the shipped sets were built from. Needs git, curl, node and network access to github.com.
#
#   scripts/freq/fetch-sources.sh <sources-dir>
#   node --max-old-space-size=6000 scripts/freq/build.mjs --sources <sources-dir>
#
# Each repository is cloned without history or unneeded files (blobless, sparse checkout).
set -euo pipefail

DEST="${1:?usage: fetch-sources.sh <sources-dir>}"
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"

# fetch <dir-name> <owner/repo> <commit> <path>...
fetch() {
  local name="$1" repo="$2" commit="$3"
  shift 3
  local dir="$DEST/$name"
  if [ ! -d "$dir/.git" ]; then
    git clone --quiet --filter=blob:none --no-checkout "https://github.com/$repo" "$dir"
  fi
  git -C "$dir" fetch --quiet --depth 1 origin "$commit"
  git -C "$dir" -c advice.detachedHead=false checkout --quiet "$commit" -- "$@"
  echo "  $repo @ ${commit:0:12}"
}

echo "Fetching frequency-set sources into $DEST"

fetch wiktionary-vuizur Vuizur/Wiktionary-Dictionaries be0cfb8d614470bc8b9d9006ddff8b921cd5c2e3 \
  "Spanish-English Wiktionary dictionary.tsv" "Portuguese-English Wiktionary dictionary.tsv" \
  "Polish-English Wiktionary dictionary.tsv" "Russian-English Wiktionary dictionary.tsv" \
  "Ukrainian-English Wiktionary dictionary.tsv" "Vietnamese-English Wiktionary dictionary.tsv"
fetch doozan-spanish_data doozan/spanish_data 8e3d52ebb39217bdb8b3998500c92ddf7dfd519a \
  README.md LICENSE es-en.data es_allforms.csv es_merged_50k.txt sentences.tsv
fetch wordfreq rspeer/wordfreq 912caf64b657478d1dff1138efdc078947d54bb1 \
  LICENSE.txt NOTICE.md wordfreq/data/large_pl.msgpack.gz wordfreq/data/large_ru.msgpack.gz wordfreq/data/large_uk.msgpack.gz
fetch FrequencyWords hermitdave/FrequencyWords 525f9b560de45753a5ea01069454e72e9aa541c6 \
  LICENSE README.md content/2018/pt_br/pt_br_50k.txt content/2018/es/es_50k.txt
fetch vn-freqs tabidots/vn-freqs ac9988a74b4188163898e59650252fe73f276289 README.md vn_word_frequencies.tsv
fetch lemmatization-lists michmech/lemmatization-lists 943c9d5f04ed714d9a76970fdb00437e94bb9afb \
  LICENCE README.md lemmatization-pt.txt lemmatization-uk.txt
fetch spacy-lookups-data explosion/spacy-lookups-data 180c5da7bead0535aee0b493910f8520bac7d966 \
  spacy_lookups_data/data/pl_license.txt \
  spacy_lookups_data/data/pl_lemma_lookup_adj.json spacy_lookups_data/data/pl_lemma_lookup_adp.json \
  spacy_lookups_data/data/pl_lemma_lookup_adv.json spacy_lookups_data/data/pl_lemma_lookup_aux.json \
  spacy_lookups_data/data/pl_lemma_lookup_noun.json spacy_lookups_data/data/pl_lemma_lookup_num.json \
  spacy_lookups_data/data/pl_lemma_lookup_part.json spacy_lookups_data/data/pl_lemma_lookup_pron.json \
  spacy_lookups_data/data/pl_lemma_lookup_verb.json
fetch russian-dictionary Badestrand/russian-dictionary 50e210c4803237779cb562bc1abcea529066031c \
  LICENSE README.md nouns.csv verbs.csv adjectives.csv others.csv
fetch dmklinger-ukrainian dmklinger/ukrainian a64057ba84ca4b47627d3aca6a9dd3afd68da7e6 README.md license.txt words.json

ud() {
  local repo="$1" commit="$2" prefix="$3"
  shift 3
  local files=(LICENSE.txt README.md)
  for part in "$@"; do files+=("$prefix-ud-$part.conllu"); done
  fetch "ud/$repo" "UniversalDependencies/$repo" "$commit" "${files[@]}"
}
ud UD_Spanish-AnCora 20adddbfcdd773c6dc97ba48ea11ca9364e74185 es_ancora train dev test
ud UD_Portuguese-Porttinari 87a07e1fb761d6d0a6e2a4d82b11b308344dabb9 pt_porttinari train dev test
ud UD_Polish-PDB 27235e131faed50feb291faed1ff2fa5389a06be pl_pdb train dev test
ud UD_Russian-SynTagRus c5266a6f6f4aaa94f4dfa9b6cc863b94a5358afa ru_syntagrus train-a train-b train-c dev test
ud UD_Ukrainian-IU 21f641ba6109044ce9aafd4b2cbfa20a4ac6e479 uk_iu train dev test
ud UD_Vietnamese-VTB 3c971fd1c5d03561e00b267d3d0057b81a9bea84 vi_vtb train dev test
# Openly licensed treebanks whose sentences serve as cloze sentences where Tatoeba has none.
ud UD_Russian-Taiga fcfd7dbdf1a7f307e23b40bb951db94a4a89df52 ru_taiga train-a train-b train-c train-d train-e dev test
ud UD_Russian-GSD 0f34b7362ac3c3facd1d6ff4b876d241bb15793e ru_gsd train dev test
ud UD_Polish-LFG 890f3855c91550d0253c8ef71a7b3cdd3d3b7c57 pl_lfg train dev test
ud UD_Polish-PUD 1ab38f20829bdb20b5e51221f762c1704003ecd2 pl_pud test

# Inflection tables (scripts/freq/paradigms/).
fetch unimorph-spa unimorph/spa b9655efb0e5ce0f99809badaa7f4e93017ab8430 README.md spa
fetch unimorph-por unimorph/por fc2778e08e2da476d9d2f27f15f218b1cbb25ad5 README.md por
fetch unimorph-ukr unimorph/ukr d7d0284e926b7d4947c52aaafd1d7f8a40a2dec0 README.md ukr
fetch verbecc bretttolbert/verbecc a5cab52168cda317a358222448a8a7c5fe58657a LICENSE.txt README.md \
  verbecc/data/xml/conjugations/conjugations-es.xml verbecc/data/xml/conjugations/conjugations-pt.xml \
  verbecc/data/xml/verbs/verbs-es.xml verbecc/data/xml/verbs/verbs-pt.xml
MORF=morfologik-polish/src/main/resources/morfologik/stemming/polish
fetch morfologik morfologik/morfologik-stemming 520392fc0df88e4dbd3e399c3991ecfd36bca66d \
  "$MORF/polish.dict" "$MORF/polish.info" "$MORF/polish.LICENSE.txt" "$MORF/polish.README.txt"

# Cloze sentences (scripts/freq/sentences.mjs): the Tatoeba-Challenge development and test sets (CC BY 2.0 FR;
# its training data, CC BY-NC-SA, is not fetched) and the Tatoeba decks of Vuizur/tatoeba-to-anki.
TC=tatoeba-challenge
TC_COMMIT=5509af44a74016748c26f41ab164b64f48445f3f
if [ ! -d "$DEST/$TC/.git" ]; then
  git clone --quiet --filter=blob:none --no-checkout "https://github.com/Helsinki-NLP/Tatoeba-Challenge" "$DEST/$TC"
fi
git -C "$DEST/$TC" fetch --quiet --depth 1 origin "$TC_COMMIT"
TC_FILES=$(git -C "$DEST/$TC" ls-tree -r --name-only "$TC_COMMIT" -- data/dev data/devtest | grep -E '^data/(dev/eng-(spa|por|pol|rus|ukr|vie)/dev\.txt|devtest/eng-(spa|por|pol|rus|ukr|vie)/test-v[0-9-]+\.txt)$')
# shellcheck disable=SC2086
git -C "$DEST/$TC" -c advice.detachedHead=false checkout --quiet "$TC_COMMIT" -- README.md LICENSE $TC_FILES
echo "  Helsinki-NLP/Tatoeba-Challenge @ ${TC_COMMIT:0:12} (development and test sets)"
node "$(dirname "$0")/fetch-tatoeba-decks.mjs" "$DEST"

echo "Done. Build with: node --max-old-space-size=6000 scripts/freq/build.mjs --sources $DEST"
