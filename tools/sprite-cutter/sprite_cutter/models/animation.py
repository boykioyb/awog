"""Data model shared by every stage of the pipeline.

A `Frame` is one pose *as found on the source sheet*: the tight RGBA crop plus the
anchors the aligner needs. Nothing here knows about canvases — placement happens in
`processor/`, so detection stays a pure "where is what" step.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

# (x0, y0, x1, y1) in source pixels, x1/y1 exclusive — same convention as PIL.
Box = tuple[int, int, int, int]


def box_width(box: Box) -> int:
    return box[2] - box[0]


def box_height(box: Box) -> int:
    return box[3] - box[1]


def union_box(boxes: list[Box]) -> Box:
    return (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )


@dataclass
class Frame:
    """One pose, cropped tight to its ink."""

    box: Box
    # RGBA crop of exactly `box`, background already knocked out.
    pixels: np.ndarray
    # Horizontal anchor in source pixels. The ink centroid by default, because a bbox
    # centre wobbles by several pixels whenever a paw or tail extends — and that wobble
    # is precisely the "character rung" this tool exists to prevent.
    anchor_x: float
    # Lowest ink row. Feet for a grounded pose; the belly for an airborne one.
    bottom: int

    @property
    def width(self) -> int:
        return box_width(self.box)

    @property
    def height(self) -> int:
        return box_height(self.box)


@dataclass
class Animation:
    """One row of the sheet: an ordered list of poses plus its playback contract."""

    name: str
    frames: list[Frame]
    fps: int
    loop: bool = True
    # Vertical placement. 'row' keeps each frame's height above the row's own lowest
    # point (a jump stays a jump); 'baseline' nails every frame to the ground line.
    align_y: str = "row"
    align_x: str = "centroid"
    # 'loop' plays 0→n→0. 'pingpong' already contains the return leg, so the row closes on
    # itself no matter what the source did (see processor/cycle.py).
    mode: str = "loop"
    # Fraction of the canvas height the vertical travel of this row may use. Airborne
    # rows are compressed into it rather than being allowed to shrink the whole sheet.
    lift_budget: float = 0.25
    # How many poses the detector actually found, before any resampling.
    detected: int = 0
    warnings: list[str] = field(default_factory=list)

    @property
    def count(self) -> int:
        return len(self.frames)


@dataclass
class Sheet:
    """Everything cut out of one source image."""

    source: str
    size: tuple[int, int]
    animations: list[Animation]

    def by_name(self, name: str) -> Animation | None:
        return next((a for a in self.animations if a.name == name), None)
