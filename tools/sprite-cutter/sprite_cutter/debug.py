"""Detection overlay — the fastest way to see *why* a row came out wrong.

Draws every detected frame box over the source, coloured per row, numbered, with section
crops outlined. A misdetection is obvious here and invisible in the exported PNGs.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

from .config.schema import Config, SectionConfig
from .detector.background import extract_matte
from .detector.components import find_components
from .detector.frames import detect_frames
from .detector.rows import detect_rows, split_captions
from .pipeline import _inside

PALETTE = [
    (255, 92, 92),
    (92, 224, 132),
    (108, 168, 255),
    (255, 214, 74),
    (226, 122, 255),
    (92, 226, 226),
]


def write_debug_overlay(source: Path, cfg: Config, out: Path) -> Path:
    image = Image.open(source)
    rgba, mask = extract_matte(image, cfg.matte)
    comps, _ = find_components(mask)
    chips, artwork = split_captions(comps, cfg.label_gutter)

    layer = Image.fromarray(rgba, mode="RGBA")
    canvas = Image.new("RGB", image.size, (18, 18, 22))
    canvas.paste(layer, (0, 0), layer)
    draw = ImageDraw.Draw(canvas)
    for chip in chips:
        draw.rectangle(chip.box, outline=(150, 150, 160))

    sections = cfg.sections or [SectionConfig(crop=None, rows=cfg.rows)]
    index = 0
    for section in sections:
        if section.crop:
            x, y, w, h = section.crop
            draw.rectangle((x, y, x + w, y + h), outline=(255, 255, 255))
        rows = detect_rows(
            [c for c in artwork if _inside(c.box, section.crop)],
            [c for c in chips if _inside(c.box, section.crop)],
        )
        for row in rows:
            colour = PALETTE[index % len(PALETTE)]
            groups, _ = detect_frames(row.components, mask)
            for number, group in enumerate(groups):
                draw.rectangle(group.box, outline=colour)
                draw.text((group.box[0] + 1, group.box[1] - 9), str(number), fill=colour)
            anchor = row.label_box or (0, int(row.anchor_y), 0, 0)
            draw.text((anchor[0], anchor[1] - 10), f"{index}:{len(groups)}", fill=colour)
            index += 1

    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out)
    return out
