"""Frame-count normalisation (STEP 4) and the one scale the whole sheet shares.

FPS and frame count are independent: 24 fps says how fast a frame is shown, the count says
how many exist. A row with 19 drawn poses played at 12 fps is a 1.6s loop; asking for 12
frames resamples the *cycle*, it does not change the speed.

Resampling takes evenly spaced positions across the cycle. Truncating instead (taking the
first N) cuts a walk cycle in half and the loop jerks backwards at the seam.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..models.animation import Animation, Frame


def resample(frames: list[Frame], target: int) -> list[Frame]:
    """Even sampling across the whole cycle. Upsampling holds frames rather than blending —
    an invented in-between on hand-drawn art reads as a ghost."""
    count = len(frames)
    if target <= 0 or count == 0 or target == count:
        return frames
    return [frames[min(count - 1, round(i * count / target))] for i in range(target)]


@dataclass
class Layout:
    """Geometry shared by every frame of every animation on one output sheet."""

    canvas: tuple[int, int]
    scale: float
    baseline: int
    centre_x: float
    lift_budget_src: float
    # Kept so placement can be clamped inside it: rounding can otherwise push the widest
    # frame of a row a pixel past the margin, where the gutter pass then erases real ink.
    padding: dict[str, int]

    @property
    def size(self) -> tuple[int, int]:
        return self.canvas


def plan_layout(
    animations: list[Animation],
    padding: dict[str, int],
    canvas: tuple[int, int] | None,
    default_lift_budget: float,
) -> Layout:
    """One canvas, one scale, one baseline — for the entire sheet.

    Per-animation scaling is the classic sprite-sheet bug: the character changes size
    when the state changes. Per-animation baselines are the same bug in the other axis.
    """
    frames = [f for a in animations for f in a.frames]
    if not frames:
        raise ValueError("no frames to lay out")
    content_w = max(f.width for f in frames)
    content_h = max(f.height for f in frames)

    # Headroom is reserved for the travel that is actually there, capped by each row's
    # budget. Reserving a fixed fraction whether or not any row leaves the ground is how
    # a sheet ends up with a character 25% smaller than its cell for no reason.
    lift = max((min(_raw_lift(a), a.lift_budget * content_h) for a in animations), default=0.0)

    if canvas is None:
        # Auto canvas: keep the artwork at 1:1 — resampling AI art is a one-way loss.
        width = content_w + padding["left"] + padding["right"]
        height = int(round(content_h + lift)) + padding["top"] + padding["bottom"]
        canvas = (width + width % 2, height + height % 2)
        scale = 1.0
    else:
        inner_w = canvas[0] - padding["left"] - padding["right"]
        inner_h = canvas[1] - padding["top"] - padding["bottom"]
        scale = min(inner_w / content_w, inner_h / (content_h + lift))

    return Layout(
        canvas=canvas,
        scale=scale,
        baseline=canvas[1] - padding["bottom"],
        centre_x=canvas[0] / 2,
        lift_budget_src=lift,
        padding=padding,
    )


def _raw_lift(animation: Animation) -> float:
    if animation.align_y == "baseline" or not animation.frames:
        return 0.0
    ground = max(f.bottom for f in animation.frames)
    return float(max(ground - f.bottom for f in animation.frames))
