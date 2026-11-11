#!/usr/bin/env python3
# © 2026 Lango. All rights reserved. Proprietary — see LICENSE.
"""Regenerate VocabBuilder's bundled font subset and app icons (developer tool; outputs are committed).

Requires fontTools and rsvg-convert. Usage:
    python3 scripts/make-assets.py [path/to/Lora-Variable.ttf]

Font: Lora (SIL Open Font License 1.1, Reserved Font Name "Lora"). Subsetting is a modification under the OFL,
so the subset is renamed "VB Serif"; the copyright and licence records are kept and OFL.txt ships beside it.
Icons: a lowercase "v" with an acute stress mark, drawn from the same font's outlines.
"""
import shutil
import subprocess
import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1] if len(sys.argv) > 1 else '/usr/share/fonts/truetype/google-fonts/Lora-Variable.ttf')
FONT_OUT = ROOT / 'web/public/fonts/vb-serif.woff'
ICON_DIR = ROOT / 'web/public/icons'

RANGES = [
    (0x0020, 0x007E), (0x00A0, 0x024F),  # Latin, Latin-1, Latin Extended-A/B (ơ ư ł ś ź ż ã õ ç ñ …)
    (0x02B9, 0x02DD),                    # modifier letters incl. ʼ (Ukrainian apostrophe)
    (0x0300, 0x036F),                    # combining marks: Vietnamese tones, Cyrillic stress marks
    (0x0400, 0x045F), (0x0490, 0x0491),  # Russian and Ukrainian Cyrillic incl. Ґ ґ Є є І і Ї ї
    (0x1EA0, 0x1EF9),                    # Vietnamese precomposed letters
    (0x2010, 0x2027), (0x2030, 0x203A),  # dashes, quotes, ellipsis, guillemets
    (0x20AB, 0x20AC), (0x2116, 0x2116),  # ₫ € №
]

INK = '#1b2333'
PAPER = '#f3f5f9'
MARK = '#e3ad4a'


def subset_font() -> None:
    font = TTFont(SRC)
    opts = Options()
    opts.flavor = 'woff'
    opts.layout_features = ['kern', 'mark', 'mkmk', 'ccmp', 'locl', 'liga', 'calt']
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    opts.notdef_outline = True
    unicodes = [u for a, b in RANGES for u in range(a, b + 1)]
    sub = Subsetter(options=opts)
    sub.populate(unicodes=unicodes)
    sub.subset(font)
    name = font['name']
    for rec in list(name.names):
        if rec.nameID in (1, 16):
            rec.string = 'VB Serif'
        elif rec.nameID == 3:
            rec.string = 'VB Serif (subset of Lora 3.008)'
        elif rec.nameID == 4:
            rec.string = 'VB Serif'
        elif rec.nameID == 6:
            rec.string = 'VBSerif'
    FONT_OUT.parent.mkdir(parents=True, exist_ok=True)
    font.flavor = 'woff'
    font.save(FONT_OUT)
    print(f'font: {FONT_OUT.relative_to(ROOT)} {FONT_OUT.stat().st_size // 1024} KB')
    ofl = next((p for p in (SRC.with_name('OFL.txt'), SRC.with_name('Lora-OFL.txt')) if p.exists()), None)
    if ofl:
        shutil.copy(ofl, FONT_OUT.parent / 'OFL.txt')
    elif not (FONT_OUT.parent / 'OFL.txt').exists():
        print('WARNING: copy the Lora OFL.txt next to the font; the OFL requires it to ship with the font.')


def glyph_paths(weight: int = 600):
    font = instantiateVariableFont(TTFont(SRC), {'wght': weight})
    gs = font.getGlyphSet()

    def bounds(name: str):
        bp = BoundsPen(gs)
        gs[name].draw(bp)
        return bp.bounds

    vb = bounds('v')
    ab = bounds('acutecomb')
    return gs, vb, ab


def compose_svg(size: int, inner: float, rounded: bool) -> str:
    gs, vb, ab = glyph_paths()
    # Place the acute centred over the v with a small gap, leaning slightly right like a stress mark.
    gap = 40
    v_w, v_h = vb[2] - vb[0], vb[3] - vb[1]
    a_w, a_h = ab[2] - ab[0], ab[3] - ab[1]
    a_dx = (vb[0] + v_w / 2 + 25) - (ab[0] + a_w / 2)
    a_dy = (vb[3] + gap) - ab[1]
    total_top = ab[3] + a_dy
    comp = (vb[0], vb[1], vb[2], total_top)
    comp_w, comp_h = comp[2] - comp[0], comp[3] - comp[1]
    scale = inner * size / max(comp_w, comp_h)
    tx = size / 2 - (comp[0] + comp_w / 2) * scale
    ty = size / 2 + (comp[1] + comp_h / 2) * scale + size * 0.01

    def path_for(name: str, dx: float, dy: float) -> str:
        pen = SVGPathPen(gs)
        gs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, tx + dx * scale, ty - dy * scale)))
        return pen.getCommands()

    v_path = path_for('v', 0, 0)
    a_path = path_for('acutecomb', a_dx, a_dy)
    radius = size * 0.22 if rounded else 0
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">'
        f'<rect width="{size}" height="{size}" rx="{radius:.1f}" fill="{INK}"/>'
        f'<path d="{v_path}" fill="{PAPER}"/>'
        f'<path d="{a_path}" fill="{MARK}"/>'
        '</svg>\n'
    )


def make_icons() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    (ICON_DIR / 'icon.svg').write_text(compose_svg(512, 0.56, rounded=True))
    (ICON_DIR / 'maskable.svg').write_text(compose_svg(512, 0.44, rounded=False))
    # Apple touch icons are masked by iOS itself, so they are full-bleed like the maskable icon.
    (ICON_DIR / 'apple.svg').write_text(compose_svg(512, 0.52, rounded=False))
    jobs = [
        ('icon.svg', 'icon-32.png', 32),
        ('icon.svg', 'icon-192.png', 192),
        ('icon.svg', 'icon-512.png', 512),
        ('maskable.svg', 'maskable-512.png', 512),
        ('maskable.svg', 'maskable-192.png', 192),
        ('apple.svg', 'apple-touch-icon.png', 180),
    ]
    for src, out, px in jobs:
        subprocess.run(['rsvg-convert', '-w', str(px), '-h', str(px), '-o', str(ICON_DIR / out), str(ICON_DIR / src)], check=True)
    (ICON_DIR / 'apple.svg').unlink()
    print('icons:', ', '.join(sorted(p.name for p in ICON_DIR.iterdir())))


if __name__ == '__main__':
    subset_font()
    make_icons()
