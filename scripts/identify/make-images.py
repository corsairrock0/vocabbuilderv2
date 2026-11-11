#!/usr/bin/env python3
# © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
"""Make the web copies of the Identify pictures.

    python3 scripts/identify/make-images.py [--prune] SOURCE_DIR

SOURCE_DIR holds pictures named S###.jpg (or .png/.webp), at least 1600 px wide: the pictures saved by the n8n
workflow "Identify scenes: pictures and boxes" (the files the table rows link to), or copies of them made with
"Claude: preview Drive pictures" at width 1600. For each one it writes data/identify/images/S###-800-<hash>.webp and
S###-1600-<hash>.webp (WebP; the hash is of the file's bytes, so a changed picture gets a new name) and updates that
scene in the manifest data/identify/images.json. Other scenes are left as they are, so SOURCE_DIR can hold just the
pictures that were re-made; the scene's files from earlier runs are removed. With --prune, SOURCE_DIR must hold every
scene: scenes it lacks are dropped from the manifest and every file the manifest does not name is removed.
Needs Pillow with WebP support.
"""
import hashlib
import io
import json
import os
import re
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'data', 'identify', 'images')
MANIFEST = os.path.join(ROOT, 'data', 'identify', 'images.json')
SIZES = [(800, 76), (1600, 75)]


def main(src, prune=False):
    os.makedirs(OUT, exist_ok=True)
    scenes = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding='utf-8') as f:
            scenes = json.load(f).get('scenes', {})
    done = set()
    for name in sorted(os.listdir(src)):
        m = re.fullmatch(r'(S\d{3})\.(jpe?g|png|webp)', name, re.I)
        if not m:
            continue
        sid = m.group(1)
        if sid in done:
            sys.exit(f'{sid} appears twice in {src}')
        im = Image.open(os.path.join(src, name)).convert('RGB')
        if im.width < SIZES[-1][0]:
            sys.exit(f'{name} is {im.width} px wide; at least {SIZES[-1][0]} px are needed')
        entry = {}
        for width, quality in SIZES:
            height = round(im.height * width / im.width)
            buf = io.BytesIO()
            im.resize((width, height), Image.LANCZOS).save(buf, 'WEBP', quality=quality, method=6)
            data = buf.getvalue()
            fname = f'{sid}-{width}-{hashlib.sha256(data).hexdigest()[:10]}.webp'
            path = os.path.join(OUT, fname)
            if not os.path.exists(path):
                with open(path, 'wb') as f:
                    f.write(data)
            entry[str(width)] = fname
            entry['w'], entry['h'] = width, height
        # This scene's files from earlier runs.
        for old in os.listdir(OUT):
            if old.startswith(f'{sid}-') and old not in (entry['800'], entry['1600']):
                os.remove(os.path.join(OUT, old))
        scenes[sid] = entry
        done.add(sid)
        print(sid, entry['800'], entry['1600'], flush=True)
    if prune:
        for sid in [s for s in scenes if s not in done]:
            del scenes[sid]
    scenes = dict(sorted(scenes.items()))
    named = {e[str(w)] for e in scenes.values() for w, _ in SIZES}
    if prune:
        for old in os.listdir(OUT):
            if old not in named:
                os.remove(os.path.join(OUT, old))
    missing = sorted(n for n in named if not os.path.exists(os.path.join(OUT, n)))
    if missing:
        sys.exit(f'The manifest names {len(missing)} files that are not in {OUT}, such as {missing[0]}: run with every picture')
    with open(MANIFEST, 'w', encoding='utf-8') as f:
        json.dump({'format': 'vocabbuilder-identify-images', 'sizes': [w for w, _ in SIZES], 'scenes': scenes}, f, indent=1)
        f.write('\n')
    total = sum(os.path.getsize(os.path.join(OUT, n)) for n in named)
    print(f'{len(done)} pictures made; {len(scenes)} scenes, {len(named)} files, {total / 1e6:.1f} MB')


if __name__ == '__main__':
    args = sys.argv[1:]
    prune = '--prune' in args
    args = [a for a in args if a != '--prune']
    if len(args) != 1:
        sys.exit(__doc__)
    main(args[0], prune)
