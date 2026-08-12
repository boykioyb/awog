"""Connected components + proximity grouping.

A pose is rarely one component: an ear outlined away from the head, a tail tip, the dust
under a landing, the Z's above a sleeping dog. Grouping by proximity is what turns those
back into one frame — but it has to stay *local*, or two poses standing close together
merge into one and the row silently loses a frame.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

from ..models.animation import Box


class Component:
    __slots__ = ("box", "area", "label")

    def __init__(self, box: Box, area: int, label: int = 0) -> None:
        self.box = box
        self.area = area
        # Id in the label image, so a frame can be masked to *its own* ink even when a
        # neighbouring pose overlaps its box (STEP 8).
        self.label = label

    @property
    def cx(self) -> float:
        return (self.box[0] + self.box[2]) / 2

    @property
    def cy(self) -> float:
        return (self.box[1] + self.box[3]) / 2

    @property
    def width(self) -> int:
        return self.box[2] - self.box[0]

    @property
    def height(self) -> int:
        return self.box[3] - self.box[1]

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Component(box={self.box}, area={self.area})"


def find_components(mask: np.ndarray) -> tuple[list[Component], np.ndarray]:
    """Return (components, label image)."""
    labels, count = ndimage.label(mask)
    if count == 0:
        return [], labels
    out: list[Component] = []
    areas = np.bincount(labels.ravel())
    for index, slices in enumerate(ndimage.find_objects(labels), start=1):
        if slices is None:
            continue
        ys, xs = slices
        out.append(Component((xs.start, ys.start, xs.stop, ys.stop), int(areas[index]), index))
    return out, labels


def _rect_gap(a: Box, b: Box) -> float:
    """Chebyshev gap between two rectangles; 0 when they touch or overlap."""
    dx = max(0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0, max(a[1], b[1]) - min(a[3], b[3]))
    return max(dx, dy)


def rect_distance(a: Box, b: Box) -> float:
    """Euclidean gap between two rectangles; 0 when they touch or overlap."""
    dx = max(0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0, max(a[1], b[1]) - min(a[3], b[3]))
    return float((dx * dx + dy * dy) ** 0.5)


def pose_area_threshold(areas: list[int], ratio: float = 0.28) -> float:
    """Area below which a blob is an effect (dust, droplets, Z's) rather than a pose.

    Anchored on the *upper half* of the areas so one oversized blob — two poses that
    touched and merged — cannot drag the threshold up and reclassify real poses as dust.
    """
    if not areas:
        return 0.0
    upper = sorted(areas)[len(areas) // 2 :]
    return float(np.median(upper)) * ratio


def group_by_proximity(comps: list[Component], gap: float) -> list[list[Component]]:
    """Union-find over "closer than `gap`". Returns groups ordered by leftmost edge."""
    parent = list(range(len(comps)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri

    for i in range(len(comps)):
        for j in range(i + 1, len(comps)):
            if _rect_gap(comps[i].box, comps[j].box) <= gap:
                union(i, j)

    groups: dict[int, list[Component]] = {}
    for i, comp in enumerate(comps):
        groups.setdefault(find(i), []).append(comp)
    return sorted(groups.values(), key=lambda g: min(c.box[0] for c in g))
