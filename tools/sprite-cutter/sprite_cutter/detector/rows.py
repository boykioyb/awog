"""STEP 2 — find the animation rows.

A horizontal projection is the obvious way to band a sheet and it is wrong on exactly the
sheets this tool targets: a jump arc dips into the row below, so the empty scanline that
was supposed to separate them does not exist. On the shiba sheet, projection collapses
15 rows into 4.

What does survive is that these sheets caption their rows, and a caption is a per-row
anchor no amount of overlap can smear. Captions are found by SHAPE — a filled rounded
rectangle, roughly one line tall — not by position:

  • the shiba sheet stacks them in a left margin, where a position rule would also work;
  • the dino sheet scatters them across four columns and lets the first frame of a row
    overlap its own caption, where a position rule cuts the character in half.

The same shape test also keeps caption text out of the exported frames (STEP 2).

When a sheet has no captions at all, rows fall back to 1-D clustering of pose centres.
"""

from __future__ import annotations

import numpy as np

from ..models.animation import Box
from .components import Component, pose_area_threshold, rect_distance

# A caption chip: about one line of text tall, wider than it is tall, and SOLID — the
# fill ratio is what separates it from artwork, which never fills its own bounding box.
CHIP_MIN_H = 14
CHIP_MAX_H = 34
CHIP_MIN_FILL = 0.85
CHIP_MIN_ASPECT = 1.2


class RowBand:
    __slots__ = ("index", "anchor_y", "components", "label_box")

    def __init__(self, index: int, anchor_y: float, label_box: Box | None = None) -> None:
        self.index = index
        self.anchor_y = anchor_y
        self.components: list[Component] = []
        self.label_box = label_box


def is_caption_chip(comp: Component) -> bool:
    if not CHIP_MIN_H <= comp.height <= CHIP_MAX_H:
        return False
    if comp.width < comp.height * CHIP_MIN_ASPECT:
        return False
    return comp.area / max(1, comp.width * comp.height) >= CHIP_MIN_FILL


def split_captions(
    comps: list[Component], forced_gutter: int | None = None
) -> tuple[list[Component], list[Component]]:
    """Return (chips, artwork). `forced_gutter` is the escape hatch for a sheet whose
    captions are not chips: everything left of it is treated as caption."""
    if forced_gutter is not None:
        return (
            [c for c in comps if c.box[2] <= forced_gutter],
            [c for c in comps if c.box[0] >= forced_gutter],
        )
    chips = [c for c in comps if is_caption_chip(c)]
    return chips, [c for c in comps if not is_caption_chip(c)]


def _cluster_rows(comps: list[Component]) -> list[float]:
    """Fallback anchors: split sorted centres wherever the gap exceeds half a pose."""
    if not comps:
        return []
    centres = sorted(c.cy for c in comps)
    median_h = float(np.median([c.height for c in comps]))
    threshold = max(8.0, median_h * 0.55)
    groups: list[list[float]] = [[centres[0]]]
    for value in centres[1:]:
        if value - groups[-1][-1] > threshold:
            groups.append([value])
        else:
            groups[-1].append(value)
    return [float(np.mean(g)) for g in groups]


# How much a pixel of horizontal distance counts against a pixel of vertical distance when
# matching a pose to its caption. Small: a row runs hundreds of pixels sideways but only a
# few tens of pixels up and down, so the vertical term has to dominate — the horizontal one
# is only there to break ties between two captions stacked in the same column.
_H_WEIGHT = 0.25


def _owner_chip(pose: Component, chips: list[Component]) -> int:
    """Index of the caption a pose belongs to.

    A caption sits at the START of its row, so its row is everything to its RIGHT on the
    same band. That side condition is what makes a multi-column sheet work: on the dino
    sheet the right-hand column's captions sit a few pixels lower than the left column's,
    so a plain nearest-anchor match hands the whole right column to the left column's rows.
    """
    candidates = [i for i, chip in enumerate(chips) if chip.box[0] <= pose.box[2]]
    if not candidates:
        return int(np.argmin([rect_distance(pose.box, chip.box) for chip in chips]))
    return min(
        candidates,
        key=lambda i: abs(chips[i].cy - pose.cy) + _H_WEIGHT * max(0.0, pose.cx - chips[i].cx),
    )


def detect_rows(poses: list[Component], chips: list[Component]) -> list[RowBand]:
    """Group artwork into rows, top to bottom (then left to right for side-by-side blocks).

    Effects (dust, droplets, Z's) follow the pose they are nearest to rather than being
    binned on their own: the water droplets of one row hang lower than its centre, and
    binning them by centre drops them into the row below as debris.
    """
    if not poses:
        return []
    threshold = pose_area_threshold([c.area for c in poses])
    big = [c for c in poses if c.area >= threshold] or poses
    small = [c for c in poses if c.area < threshold] if big is not poses else []

    if chips:
        chips = sorted(chips, key=lambda c: (c.box[1], c.box[0]))
        bands = [RowBand(i, c.cy, c.box) for i, c in enumerate(chips)]
        for pose in big:
            bands[_owner_chip(pose, chips)].components.append(pose)
    else:
        anchors = _cluster_rows(big)
        bands = [RowBand(i, y) for i, y in enumerate(anchors)]
        anchor_array = np.array(anchors, dtype=float)
        for pose in big:
            bands[int(np.argmin(np.abs(anchor_array - pose.cy)))].components.append(pose)

    rows = [b for b in bands if b.components]
    for effect in small:
        owner = min(
            rows, key=lambda r: min(rect_distance(effect.box, p.box) for p in r.components)
        )
        owner.components.append(effect)
    for index, row in enumerate(rows):
        row.index = index
    return rows
