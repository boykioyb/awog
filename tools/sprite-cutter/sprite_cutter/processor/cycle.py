"""Playback shape of a row: how it loops, and whether its vertical travel is real.

Getting either wrong produces the two complaints this tool exists to prevent:

  • a *turnaround* (the character rotates from front view to back view) played as a loop
    snaps back to the front once per cycle. Several rows of the shiba sheet are exactly
    that, including the one captioned IDLE. `pingpong` fixes it by construction;
  • a *grounded* row whose source art wanders a few pixels vertically looks like the
    character is bouncing on a trampoline once the feet are no longer pinned — while a
    real jump pinned to the ground stops being a jump. `estimate_align_y` tells them
    apart.

Loop shape is NOT auto-detected. It was tried and it does not work on AI art: on this
sheet a true walk cycle scores a bigger seam (last frame vs first) than the turnaround
does, because the generator redraws the character slightly on every frame and that drift
swamps the signal. It is one flag per row in the config, decided by looking at the GIF.
"""

from __future__ import annotations

import numpy as np

from ..models.animation import Frame


def pingpong(frames: list[Frame], target: int) -> list[Frame]:
    """Play the row out and back, so the loop is seamless by construction.

    Costs half the distinct poses at the same frame count — the trade that buys a loop
    with no snap. Only the two end frames are held for a single tick, exactly like a
    hand-animated ease.
    """
    from .normalize import resample

    if target < 4 or len(frames) < 2:
        return frames
    unique = resample(frames, target // 2 + 1)
    out = unique + unique[-2:0:-1]
    return out if len(out) == target else resample(out, target)


def estimate_align_y(frames: list[Frame], min_travel_ratio: float = 0.08) -> str:
    """'row' when the vertical travel is real motion, 'baseline' when it is drift.

    A jump leaves the ground and comes back: its lift curve peaks in the middle and ends
    low at both ends, stays up for a while, and moves smoothly. Everything else in this
    family of sheets is drift, and there are two kinds:

      • a *ramp* — the generator drew the row along a slightly descending diagonal, so the
        lift falls monotonically from the first frame to the last. Preserving it makes the
        character sink across the loop and snap back at the seam. Every grounded row of
        the shiba sheet does this by 5–22px;
      • a *spike* — one frame drawn 50px high while the rest sit flat.

    So three conditions, each killing one failure: ends low (ramp), sustained (spike),
    smooth (noise).
    """
    if len(frames) < 3:
        return "baseline"
    ground = max(f.bottom for f in frames)
    lifts = np.array([ground - f.bottom for f in frames], dtype=float)
    peak = float(lifts.max())
    height = float(np.median([f.height for f in frames]))
    if height <= 0 or peak < height * min_travel_ratio:
        return "baseline"

    ends_low = max(lifts[0], lifts[-1]) <= peak * 0.45
    sustained = float((lifts > peak * 0.3).mean()) >= 0.25
    smooth = float(np.abs(np.diff(lifts)).sum()) <= peak * 2.5
    return "row" if ends_low and sustained and smooth else "baseline"
