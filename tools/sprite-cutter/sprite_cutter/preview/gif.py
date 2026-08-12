"""STEP 11 — animated previews.

A contact sheet shows the frames; only a GIF at the real frame rate shows the *problems*
(jitter, sliding feet, a seam in the loop). GIF alpha is 1-bit, so frames are composited
onto a visible ground first — a checkerboard, because a flat colour hides a wobbling
baseline that the checker's straight lines make obvious.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

CHECKER_LIGHT = (232, 232, 236)
CHECKER_DARK = (206, 206, 212)


def _ground(size: tuple[int, int], style: str) -> Image.Image:
    if style == "none":
        return Image.new("RGB", size, (255, 255, 255))
    if style != "checker":
        return Image.new("RGB", size, style)
    tile = 8
    base = Image.new("RGB", size, CHECKER_LIGHT)
    dark = Image.new("RGB", (tile, tile), CHECKER_DARK)
    for y in range(0, size[1], tile):
        for x in range(0, size[0], tile):
            if (x // tile + y // tile) % 2:
                base.paste(dark, (x, y))
    return base


def write_gif(
    images: list[Image.Image], path: Path, fps: int, background: str = "checker", loop: bool = True
) -> None:
    if not images:
        return
    ground = _ground(images[0].size, background)
    flat = []
    for image in images:
        frame = ground.copy()
        frame.paste(image, (0, 0), image)
        flat.append(frame.convert("P", palette=Image.ADAPTIVE, colors=255))
    path.parent.mkdir(parents=True, exist_ok=True)
    flat[0].save(
        path,
        save_all=True,
        append_images=flat[1:],
        duration=max(20, round(1000 / max(1, fps))),
        loop=0 if loop else 1,
        disposal=2,
        optimize=False,
    )


def write_strip_gif(
    rows: list[tuple[str, list[Image.Image]]], path: Path, fps: int, background: str = "checker"
) -> None:
    """One GIF playing every animation side by side — the fastest way to spot a row whose
    scale or baseline does not match the others."""
    rows = [r for r in rows if r[1]]
    if not rows:
        return
    cell_w, cell_h = rows[0][1][0].size
    length = max(len(images) for _, images in rows)
    frames: list[Image.Image] = []
    for i in range(length):
        canvas = Image.new("RGBA", (cell_w * len(rows), cell_h), (0, 0, 0, 0))
        for column, (_, images) in enumerate(rows):
            canvas.alpha_composite(images[i % len(images)], (column * cell_w, 0))
        frames.append(canvas)
    write_gif(frames, path, fps, background)
