# Identify scenes

The Identify practice (VocabBuilder 1.4.0) uses the files in this folder:

| File | What it is | Made by |
| --- | --- | --- |
| `scene-plan.json` | the plan: scenes, prompts, objects and the words that name them (below) | planning, 6–7 November 2026 |
| `boxes.json` | the box and point Gemini found for each object, exported from the n8n table after the picture review | n8n, then exported |
| `images/` | the web copies: `S###-800-<hash>.webp` and `S###-1600-<hash>.webp`, about 48 MB | `scripts/identify/make-images.py` |
| `images.json` | which web copy belongs to which scene, with its size | `scripts/identify/make-images.py` |
| `word-review.jsonl` | each object's words checked against its finished picture: kept, dropped, the most natural first | review, 7 November 2026 |
| `identify.json` | what the server reads: per scene the picture files, and per object its point, box and words | `scripts/identify/build-data.mjs` |

To change a picture: make it again with the n8n workflows (below), save the new pictures at 1600 px or more as
`S###.jpg` in a folder, run `python3 scripts/identify/make-images.py <folder>` (needs Pillow with WebP), update
`boxes.json` from the table, then run `node scripts/identify/build-data.mjs`. The folder can hold just the re-made
pictures: the script updates those scenes and leaves the others; with `--prune` it expects every picture and
removes the rest. To change which words name an object, edit `scene-plan.json` or add a line to
`word-review.jsonl` (`keep`, `drop`, `add`, `first`), then run the last script again. The web build copies `images/`
to `/identify/` (not precached; the service worker caches each picture when it is first shown).

`build-data.mjs` gives objects with the same English label the same words, so a horse is *caballo* in every picture
that shows one (people are the exception: a word marked for one sex stays with its own object), then applies the
word review. In the practice the plurals of those words are right too; see `docs/LEARNING_ENGINE.md`.

The word review (781 lines) looked at every object that shows people and every word the mappers had marked unsure.
It dropped 65 words that did not fit the picture: feminine or masculine forms for the other sex (Ukrainian
*вчителька* for a male teacher, Portuguese *cantor* for a woman singing), words for a young woman used for a girl of
eight or ten (*дівчина*, *dziewczyna*, Colombian *chica*), the wrong kind of thing (Ukrainian *шапка* for a brimmed
hat, Vietnamese *mì* for rice vermicelli, Portuguese *muro* for a room's wall), and words that only work inside a
longer phrase (Vietnamese *ben* for a dump truck). It put the most natural word first for 62 objects; any listed
word counts as right in the practice. The display of Ukrainian *сім'я* (family) was corrected to *сім'я́* here; the
Ukrainian frequency set still shows *сі́м'я*, the stress of "seed".

## The scene plan

`scene-plan.json` plans the pictures for the Identify practice: 194 everyday scenes showing 1,174 different
objects. The same pictures serve all six languages. It was made on 6 November 2026 from the VocabBuilder 1.2.1 word
lists; the pictures are made by the owner's n8n workflows (below). Work list for reference:
`identify-scene-plan.xlsx`.

Changes on 7 November 2026: every box prompt asks for a point on each object as well as its box; every image prompt
except S002–S005 adds "Each of them is large enough to recognise at a glance, even on a phone screen."; S001 was
re-staged with the girl close to the camera. Under the owner's rule against African, Indian, Middle Eastern,
Islamic and biblical content, six scenes moved: S062 became Maya ruins in Mexico (its camel is taught in S156), S093
a Malaysian jungle stream, S096 a river in a European safari park, S142 lost "South African", S156 became the Gobi
Desert with a Bactrian camel (its palm tree is taught in S016 and S179), and S166 a harbour without its mosque. The
mosque target (O3967) was dropped, as words on these topics were in 1.3.0; it is listed in `skipped[]`.

## Contents

- `coverage`: scene and object counts, and per language the nouns that name a drawn object (`words`), the objects
  they name, the nouns in that language's list, and named objects that ended up without a scene.
- `scenes[]`, in the order to generate them (scenes whose words are most frequent first):
  - `id` (S001…, also the file names of the picture and its boxes), `title`, `setting`, `description`.
  - `imagePrompt`: for Nano Banana 2.1 at 4:3 and 2K.
  - `boxPrompt`: for Gemini Flash with the finished picture; asks for a box and a point per object.
  - `objects[]`: the targets, numbered as in the box prompt. Each has `object` (O id), `label`, `where` (which
    instance to box) and `words`, by language: `lemma`, `display` (with stress marks), `rank` in that language's
    frequency list, and an optional `note` (`f`/`m` for gendered words for people, or why a call was unsure).
- `skipped[]`: objects left without a scene, with the reason.

| Language | Nouns with a scene | Nouns in the list |
| --- | ---: | ---: |
| Ukrainian | 609 | 3,250 |
| Russian | 570 | 3,105 |
| Polish | 600 | 3,009 |
| Spanish | 752 | 3,327 |
| Portuguese | 842 | 3,356 |
| Vietnamese | 609 | 2,731 |

No list has 1,000 nouns that a native speaker would use to name something in a photo; the rest are abstract (time,
problem, idea) or not visible (friend, mother).

## How it was made

1. English concepts were taken from the noun glosses of the six lists and judged picturable or not; concepts with
   the same picture became one object.
2. Scenes were designed by subject: 5–9 targets each, small things in close-ups, near-synonyms in different scenes,
   neutral content and no readable text.
3. Each language's nouns were then mapped to the drawn objects by reviewers working in that variety (Kyiv, Moscow,
   Warsaw, Colombia, Brazil, Southern Vietnam). This found 77 objects the first list lacked, which got 14 more
   scenes. Objects that no language names stay out of the targets, though they may still appear in a picture.

## How the pictures are made

Three workflows on the owner's n8n Cloud instance (vocabbuilder.app.n8n.cloud) work over the data table "Identify
scenes" (id `ryWZ0s8XdVcEW0Qo`; columns `scene_id`, `title`, `image_prompt`, `box_prompt`, `object_count`, `status`,
`attempts`, `image_file`, `boxes_file`, `boxes`, `missing`, `note`, `finished_at`). All 194 scenes are loaded.

- "Identify scenes: add scenes" (`iMHLUiGvrKGuIzyY`) takes scenes in a short form (`i`, `t`, `s`, `d`, `p` for the
  people line, `o` as `[label, where]` pairs, `z` for the size line, `st` for the status), builds both prompts
  exactly as in this file and upserts the rows by `scene_id`.
- "Identify scenes: pictures and boxes" (`sPZ55GZwD1Ort85a`) takes the next rows with status `todo` or
  `redo_boxes` (batch size in "Run settings") and calls the sub-workflow once per scene, so each picture's data is
  freed after its scene.
- "Identify scenes: make one scene" (`P1mYvZNs1grOOvJw`):
  1. `todo`: `POST https://generativelanguage.googleapis.com/v1beta/interactions` with `gemini-nano-banana-2.1` and
     `response_format: {type: "image", mime_type: "image/jpeg", aspect_ratio: "4:3", image_size: "2K"}`; saved as
     `S###.jpg`, or `S###-2.jpg` (and so on) when the scene was made before. `redo_boxes`: the saved picture is
     downloaded and reused.
  2. The same endpoint with `gemini-3.8-flash`, the picture inline and the box prompt, asking for JSON. On a
     `redo_boxes` run, an object the new answer misses keeps its good box and point from the row's last pass (the
     note says which).
  3. The boxes go to `S###.json` in the Drive folder "VocabBuilder Identify scenes", numbered by attempt like the
     pictures (so a boxes-only redo can give `S061-3.json` beside `S061.jpg`; the row's `image_file` and
     `boxes_file` links are what counts). The row gets `ready`, `check` (an object, its point or the answer is
     missing, or a point lies outside its box) or `failed` (no picture; the reason is in `note`). The Drive steps
     retry up to 3 times, 5 s apart: without that, an upload was refused ("Forbidden") once an hour, when the
     Google sign-in token renews. Successful runs of this sub-workflow are not saved in n8n, because each holds the
     whole picture as text.

To make a scene again, set its status to `todo` (edit its prompt first if needed); to redo only its boxes, set
`redo_boxes`. Both API calls use the owner's own n8n credentials (a Google Gemini API key from AI Studio, on a
billed project, and a Google Drive sign-in); no key is stored in the workflows or in this repo. To look at the
pictures, Claude uses "Claude: preview Drive pictures" (`Vce93LWkWUv3haDy`), which returns shrunk copies as text.

## What comes back

For each scene, the picture and `S###.json`, which holds `scene_id`, `status`, `missing`, `note` and `boxes`: one
`{"id": n, "label": "...", "box_2d": [ymin, xmin, ymax, xmax], "point": [y, x]}` per object, numbered as in the box
prompt, normalized to 0–1000, with `null` for an object Gemini could not find. The same boxes are in the table's
`boxes` column. The practice should mark the target with a dot at `point` and use `box_2d` only to zoom: boxes of
large or overlapping things (a road, grass, a seated man and his chair) also cover other targets, while points were
on the right object in every scene checked. Before building the practice, make web-size images, and check the words
for people (girl, young woman, old man) and the words marked unsure against the finished pictures. The pictures are
AI-generated and carry Google's SynthID watermark; the app should label them as AI-generated.

## Picture review (2026-11-07)

All 194 pictures were checked at 800 px with their points and boxes drawn on: every listed object present and
recognisable, every point on its own object, no readable text, the people line, the topic rule, and defects. Five
reviewer agents went through all scenes and Claude checked every scene they flagged, plus a sample of the rest.
Plan version `1+2026-11-07-review`.

- New pictures (prompt changed in this file, status `todo`): S018 (the pimple was barely visible), S036 (the globe
  showed Africa and the Arabian peninsula; now turned to North America), S096 (the chimpanzee was a speck; now on a
  log in the foreground), S106 (the scissors looked like forceps), S109 (the walkie-talkie was a speck; now on the
  equipment case), S136 (the icon showed the Virgin and Child, which the no-biblical-content rule excludes; now Saint
  Nicholas), S181 (no recognisable hood; the sweatshirt now hangs by its hood). All seven were viewed again and pass.
- New boxes (`where` sharpened, status `redo_boxes`): S161 (the mask point was on a cut-off mask at the edge) and
  S179 (the lotus point was on a small distant flower). Both pass.
- Prompt corrected without a new picture: S011, S035, S050, S062 and S087 describe people but ended "No people in
  the picture."; they now end "Only the people described above appear in the picture." The pictures already showed
  exactly the described people.
- Kept on purpose: church buildings and crosses, a priest, a monk and a nun (S015, S025, S032, S050, S094, S126,
  S133) and a Buddhist pagoda and statue (S132, S152), because the topic rule covers biblical and Islamic content;
  tiny background people in S047 and S119; painted figures in S022; the placeholder portraits and blurred pseudo-text
  on the ID cards in S034 and S073; the Vietnamese-style curry in S103.
- The smallest targets (S018 pimple, S023 pills, S100 dice, under 2–3 % of the picture) are recognisable only when
  zoomed to their boxes, so the practice should zoom small targets.
