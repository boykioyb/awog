"""STEP 5 + STEP 6 — where each frame sits on the fixed canvas.

The two requirements pull against each other. A fixed canvas with every frame bottom-
aligned is rock steady, and it also flattens a jump into a dog vibrating on the ground.
Preserving the raw vertical travel is honest, and on a 24-frame arc it forces the whole
sheet to scale down until the character is half the size it could be.

The compromise, per row:

  • vertical placement is measured against the *row's own* lowest point, so a grounded
    cycle keeps a dead-flat baseline for free and an airborne one keeps its arc;
  • that travel is then compressed into a fixed budget (a fraction of the canvas), so a
    tall jump costs the sheet a little arc rather than a lot of character.

Horizontal placement uses the ink centroid, not the bbox centre: an extended paw moves a
bbox edge by several pixels while barely moving the centre of mass, and that difference is
exactly the horizontal jitter that makes a walk cycle look drunk.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..models.animation import Animation, Frame


@dataclass
class RowPlacement:
    """Per-frame lift above the row baseline, in SOURCE pixels, already compressed."""

    lifts: list[float]
    raw_max: float
    compression: float


def row_placement(animation: Animation, budget_src_px: float) -> RowPlacement:
    frames = animation.frames
    if not frames:
        return RowPlacement([], 0.0, 1.0)
    if animation.align_y == "baseline":
        return RowPlacement([0.0] * len(frames), 0.0, 1.0)

    ground = max(f.bottom for f in frames)
    lifts = [float(ground - f.bottom) for f in frames]
    raw_max = max(lifts)
    compression = 1.0
    if raw_max > budget_src_px > 0:
        compression = budget_src_px / raw_max
        lifts = [value * compression for value in lifts]
    return RowPlacement(lifts, raw_max, compression)


def anchor_offset(frame: Frame, align_x: str) -> float:
    """Distance from the crop's left edge to the horizontal anchor, in source pixels."""
    if align_x == "bbox":
        return frame.width / 2
    return frame.anchor_x - frame.box[0]
