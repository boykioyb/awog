"""STEP 12 — a numbered strip of every frame in an animation.

The GIF tells you something is wrong; the contact sheet tells you *which frame*. Cells are
drawn with a hairline border so a frame whose ink runs to the edge is obvious.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

from .gif import _ground

LABEL_H = 14
GAP = 4


def write_contact_sheet(
    images: list[Image.Image],
    path: Path,
    columns: int = 12,
    background: str = "checker",
    title: str | None = None,
) -> None:
    if not images:
        return
    cell_w, cell_h = images[0].size
    columns = max(1, min(columns, len(images)))
    rows = (len(images) + columns - 1) // columns
    title_h = 16 if title else 0
    width = columns * (cell_w + GAP) + GAP
    height = rows * (cell_h + LABEL_H + GAP) + GAP + title_h

    sheet = Image.new("RGB", (width, height), (30, 30, 34))
    draw = ImageDraw.Draw(sheet)
    if title:
        draw.text((GAP, 3), f"{title} — {len(images)} frames", fill=(235, 235, 240))

    tile = _ground((cell_w, cell_h), background)
    for index, image in enumerate(images):
        cx = GAP + (index % columns) * (cell_w + GAP)
        cy = GAP + title_h + (index // columns) * (cell_h + LABEL_H + GAP)
        cell = tile.copy()
        cell.paste(image, (0, 0), image)
        sheet.paste(cell, (cx, cy))
        draw.rectangle((cx, cy, cx + cell_w - 1, cy + cell_h - 1), outline=(90, 90, 98))
        draw.text((cx + 2, cy + cell_h + 1), f"{index:02d}", fill=(200, 200, 208))

    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)
