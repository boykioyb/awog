"""AWOG output stage — pack cut animations into the desktop-pet sprite sheet.

This is the part that is not generic. AWOG's pet is drawn by CSS alone
(`components/pet/PetSprite.vue`): one background image, one row per pet state, frames
stepped with `background-position`. No JS, no rAF, no per-frame DOM. That renderer imposes
three things a folder of PNGs cannot satisfy:

  • a fixed cell (132×128 — twice the 66×64 display size, for retina headroom) so every
    sheet shares one set of CSS numbers;
  • every row the same column count, because `steps(n)` and the keyframe end offset are
    written once per pack;
  • one scale and one baseline across *all* rows — the pet switches state while it sits
    on screen, and a character that changes size or hops when `idle` becomes `working`
    reads as a glitch rather than an animation.

The state list is fixed by the renderer. The map from state to animation is a product
decision and lives in the preset (`presets/shiba.yaml`).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

from ..config.schema import AwogConfig
from ..models.animation import Animation, Sheet
from ..processor.align import row_placement
from ..processor.alpha import clear_cell_gutter
from ..processor.crop import render_animation
from ..processor.normalize import plan_layout


@dataclass
class PetSheetResult:
    path: Path
    size: tuple[int, int]
    cell: tuple[int, int]
    columns: int
    rows: list[tuple[str, str, int]]  # (state, animation, frames)
    scale: float
    frames_by_state: dict[str, list[Image.Image]]

    def css_hints(self) -> str:
        """The numbers PetSprite.vue needs, so they are never derived by hand."""
        half_w, half_h = self.size[0] / 2, self.size[1] / 2
        cell_w = self.cell[0] / 2
        lines = [
            f"background-size: {half_w:g}px {half_h:g}px;",
            f"/* {self.columns} frames per row → steps({self.columns}) */",
            f"@keyframes play{self.columns} {{ to {{ background-position-x: "
            f"-{cell_w * self.columns:g}px; }} }}",
        ]
        for index, (state, _, _) in enumerate(self.rows):
            lines.append(f".is-{state} {{ background-position-y: -{index * self.cell[1] / 2:g}px; }}")
        return "\n".join(lines)


def build_pet_sheet(sheet: Sheet, cfg: AwogConfig, out: Path) -> PetSheetResult:
    picked: list[tuple[str, Animation]] = []
    for state in cfg.states:
        name = cfg.map.get(state, state)
        animation = sheet.by_name(name)
        if animation is None:
            # Never leave a row empty: an unmapped state would show transparent pixels.
            animation = sheet.animations[0]
        picked.append((state, animation))

    used = list({id(a): a for _, a in picked}.values())
    # The gutter is padding: it is the transparent margin the sampler is allowed to read
    # into, so it must be reserved *before* the scale is chosen, not erased afterwards.
    padding = {k: cfg.gutter for k in ("top", "bottom", "left", "right")}
    layout = plan_layout(used, padding, cfg.cell, default_lift_budget=0.25)

    rendered: dict[str, list[Image.Image]] = {}
    for animation in used:
        placement = row_placement(animation, layout.lift_budget_src)
        rendered[animation.name] = render_animation(animation, layout, placement)

    columns = max(len(rendered[a.name]) for a in used)
    cell_w, cell_h = cfg.cell
    canvas = Image.new("RGBA", (cell_w * columns, cell_h * len(picked)), (0, 0, 0, 0))
    rows_meta: list[tuple[str, str, int]] = []
    frames_by_state: dict[str, list[Image.Image]] = {}

    for row, (state, animation) in enumerate(picked):
        images = rendered[animation.name]
        # Short rows hold their last frame instead of going transparent: the CSS row plays
        # a fixed number of steps whatever the artwork had.
        row_frames = [images[i] if i < len(images) else images[-1] for i in range(columns)]
        frames_by_state[state] = row_frames
        for column, image in enumerate(row_frames):
            canvas.alpha_composite(image, (column * cell_w, row * cell_h))
        rows_meta.append((state, animation.name, len(images)))

    data = clear_cell_gutter(np.array(canvas), cell_w, cell_h, cfg.gutter)
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(data, mode="RGBA").save(out, optimize=True)

    return PetSheetResult(
        path=out,
        size=(canvas.width, canvas.height),
        cell=(cell_w, cell_h),
        columns=columns,
        rows=rows_meta,
        scale=layout.scale,
        frames_by_state=frames_by_state,
    )
