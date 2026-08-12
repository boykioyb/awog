"""STEP 3 + STEP 8 — split one row into individual poses.

`frame_width = row_width / count` is the assumption this module exists to avoid. On an
AI sheet the pitch drifts by 30% across a single row, some frames are missing outright,
and the poses are not centred in any grid.

Order matters here:

  1. merge ink that is *obviously* one pose (an outlined ear, a tail tip);
  2. separate poses from effects by area — dust, droplets, Z's, a puddle;
  3. measure the pitch from the poses that are left;
  4. give each effect to the pose it belongs to, using that pitch as the reach limit;
  5. split any box that swallowed two poses, at the emptiest column inside it.

Step 5 is what keeps a run cycle honest: when two poses touch, the connected component
is one blob, and cutting it at the deepest valley is the only thing between "24 frames"
and "23 frames plus one double-exposure".
"""

from __future__ import annotations

import numpy as np

from ..models.animation import Box
from .components import Component, group_by_proximity, pose_area_threshold


def _union(boxes: list[Box]) -> Box:
    return (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )


class FrameGroup:
    """Pose ink + its effects, before any cropping happens."""

    __slots__ = ("box", "labels", "area")

    def __init__(self, comps: list[Component]) -> None:
        self.box = _union([c.box for c in comps])
        self.labels = {c.label for c in comps}
        self.area = sum(c.area for c in comps)

    @property
    def cx(self) -> float:
        return (self.box[0] + self.box[2]) / 2

    def merge(self, other: "FrameGroup") -> None:
        self.box = _union([self.box, other.box])
        self.labels |= other.labels
        self.area += other.area


def _median_pitch(groups: list[FrameGroup]) -> float:
    if len(groups) < 2:
        return float(groups[0].box[2] - groups[0].box[0]) if groups else 0.0
    centres = sorted(g.cx for g in groups)
    diffs = np.diff(centres)
    return float(np.median(diffs))


def _profile_pitch(groups: list[FrameGroup], mask: np.ndarray) -> float:
    """Frame pitch read off the row's own ink profile, by autocorrelation.

    Needed when the poses TOUCH: on the dino sheet a whole 12-frame run cycle is a single
    connected component, so there are no centres to measure a pitch between and the row
    would come out as one enormous frame. A row of similar poses is periodic, so the lag
    at which its column profile best matches itself IS the pitch — no gaps required.
    """
    x0 = min(g.box[0] for g in groups)
    x1 = max(g.box[2] for g in groups)
    y0 = min(g.box[1] for g in groups)
    y1 = max(g.box[3] for g in groups)
    profile = mask[y0:y1, x0:x1].sum(axis=0).astype(float)
    if profile.size < 16:
        return 0.0
    centred = profile - profile.mean()
    auto = np.correlate(centred, centred, mode="full")[len(centred) - 1 :]
    if auto[0] <= 0:
        return 0.0
    auto = auto / auto[0]
    # A frame is never much narrower than half the row's height, and a period longer than
    # half the row is not a period — it is the row itself.
    low = max(8, int((y1 - y0) * 0.4))
    high = max(low + 2, len(profile) // 2)
    best, best_value = 0, -np.inf
    for lag in range(low, min(high, len(auto) - 1)):
        if auto[lag] >= auto[lag - 1] and auto[lag] >= auto[lag + 1] and auto[lag] > best_value:
            best, best_value = lag, auto[lag]
    return float(best)


def _cuts_for(profile: np.ndarray, parts: int) -> tuple[list[int], float]:
    """Cut positions for `parts` even slices, each snapped to the emptiest nearby column.

    The score is the WORST cut, not the average: one cut through a body ruins a frame no
    matter how clean the other eleven are.
    """
    cuts: list[int] = []
    span = len(profile) / parts
    worst = 0.0
    for k in range(1, parts):
        centre = int(span * k)
        window = max(3, int(span * 0.3))
        lo, hi = max(1, centre - window), min(len(profile) - 1, centre + window)
        if hi <= lo:
            continue
        position = lo + int(np.argmin(profile[lo:hi]))
        cuts.append(position)
        worst = max(worst, float(profile[position]))
    return cuts, worst


def _split_wide(
    group: FrameGroup, mask: np.ndarray, pitch: float, parts: int
) -> list[FrameGroup]:
    """Cut a box that holds several poses, at the emptiest interior columns.

    `parts` is only an estimate — a pitch read off a drifting row is easily a pixel or two
    out, and over a twelve-frame run that is the difference between 11 and 12. So the
    neighbouring counts are tried too and the one whose cuts land in the deepest gaps
    wins: a wrong count has to put at least one cut through a character, and that shows up
    immediately in the score.
    """
    x0, y0, x1, y1 = group.box
    profile = mask[y0:y1, x0:x1].sum(axis=0).astype(float)
    best: tuple[list[int], float] | None = None
    for count in {parts - 1, parts, parts + 1}:
        if count < 2 or (x1 - x0) / count < max(8.0, pitch * 0.5):
            continue
        cuts, score = _cuts_for(profile, count)
        if cuts and (best is None or score < best[1]):
            best = (cuts, score)
    cuts = best[0] if best else []
    edges = [0, *sorted(set(cuts)), x1 - x0]
    out: list[FrameGroup] = []
    for a, b in zip(edges, edges[1:]):
        if b - a < max(4, pitch * 0.2):
            continue
        sub = mask[y0:y1, x0 + a : x0 + b]
        if not sub.any():
            continue
        rows_on = np.where(sub.any(axis=1))[0]
        cols_on = np.where(sub.any(axis=0))[0]
        piece = FrameGroup.__new__(FrameGroup)
        piece.box = (
            x0 + a + int(cols_on[0]),
            y0 + int(rows_on[0]),
            x0 + a + int(cols_on[-1]) + 1,
            y0 + int(rows_on[-1]) + 1,
        )
        piece.labels = set(group.labels)
        piece.area = int(sub.sum())
        out.append(piece)
    return out or [group]


def detect_frames(
    comps: list[Component],
    mask: np.ndarray,
    *,
    # Ink this close is treated as one pose (a detached ear, a tail tip). Kept SMALL:
    # the dino sheet packs its poses 2–5px apart, so a generous gap swallows the whole row
    # into one component and a twelve-frame run cycle comes out as a single frame.
    merge_gap: float = 3.0,
    effect_reach: float = 0.55,
    split_ratio: float = 1.55,
) -> tuple[list[FrameGroup], list[str]]:
    """Return (frames left→right, warnings)."""
    warnings: list[str] = []
    if not comps:
        return [], warnings

    groups = [FrameGroup(g) for g in group_by_proximity(comps, merge_gap)]
    threshold = pose_area_threshold([g.area for g in groups])
    poses = [g for g in groups if g.area >= threshold]
    effects = [g for g in groups if g.area < threshold]
    if not poses:
        poses, effects = groups, []

    pitch = _median_pitch(poses)
    profile = _profile_pitch(poses, mask)
    if profile > 0 and (len(poses) < 3 or profile < pitch * 0.9):
        # Fewer than three separated poses means there is no pitch to measure; a profile
        # pitch far below the measured one means poses merged and inflated it. Both are
        # the touching-poses case, and the profile is the only honest answer there.
        pitch = profile

    # Effects join the nearest pose — but only within reach, so a stray mark in the
    # margin cannot silently stretch a frame across half the row.
    for effect in effects:
        target = min(poses, key=lambda p: abs(p.cx - effect.cx))
        if abs(target.cx - effect.cx) <= pitch * effect_reach + (target.box[2] - target.box[0]) / 2:
            target.merge(effect)

    # A box far wider than the pitch is two (or more) poses that touched. Splitting is
    # repeated on the pieces: a three-pose blob often comes apart into 1 + 2 first,
    # because the cleanest gap in it is not the one in the middle.
    resolved: list[FrameGroup] = []
    queue = list(poses)
    guard = 0
    while queue and guard < 64:
        guard += 1
        pose = queue.pop()
        width = pose.box[2] - pose.box[0]
        parts = int(round(width / pitch)) if pitch > 0 else 1
        if pitch > 0 and width > pitch * split_ratio and parts >= 2:
            pieces = _split_wide(pose, mask, pitch, parts)
            if len(pieces) > 1:
                warnings.append(f"split a {width}px box into {len(pieces)} frames")
                queue.extend(pieces)
                continue
        resolved.append(pose)
    resolved.extend(queue)

    resolved.sort(key=lambda g: g.cx)
    if pitch > 0:
        for a, b in zip(resolved, resolved[1:]):
            if b.cx - a.cx > pitch * 1.7:
                warnings.append(f"gap of {b.cx - a.cx:.0f}px near x={a.cx:.0f} (missing frame?)")
    return resolved, warnings
