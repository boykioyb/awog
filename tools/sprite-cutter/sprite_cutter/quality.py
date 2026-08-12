"""STEP 10 — check the export instead of trusting it.

Every check answers a failure you can see in the GIF but not in a single frame: a clipped
paw, a character that changes size between rows, feet that slide, a loop that repeats a
frame at the seam.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from PIL import Image


@dataclass
class Issue:
    level: str  # "warning" | "error"
    animation: str
    frame: int | None
    message: str

    def __str__(self) -> str:
        where = f"{self.animation}/{self.frame:03d}.png" if self.frame is not None else self.animation
        return f"{self.level.upper()}: {where} — {self.message}"


def _bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    alpha = np.array(image.getchannel("A"))
    rows_on = np.where(alpha.any(axis=1))[0]
    cols_on = np.where(alpha.any(axis=0))[0]
    if rows_on.size == 0 or cols_on.size == 0:
        return None
    return int(cols_on[0]), int(rows_on[0]), int(cols_on[-1]) + 1, int(rows_on[-1]) + 1


def check_animation(
    name: str,
    images: list[Image.Image],
    grounded: bool,
    expected: int | None = None,
    # A ping-pong row is half mirrored frames by definition, so duplicates are the design.
    allow_duplicates: bool = False,
) -> list[Issue]:
    issues: list[Issue] = []
    if expected is not None and len(images) != expected:
        issues.append(Issue("error", name, None, f"expected {expected} frames, got {len(images)}"))
    if not images:
        return issues

    size = images[0].size
    bottoms: list[int] = []
    digests: dict[bytes, int] = {}
    for index, image in enumerate(images):
        if image.size != size:
            issues.append(Issue("error", name, index, f"size {image.size} != {size}"))
        if image.mode != "RGBA":
            issues.append(Issue("error", name, index, f"mode {image.mode} is not RGBA"))
        box = _bbox(image)
        if box is None:
            issues.append(Issue("error", name, index, "frame is empty"))
            continue
        if box[0] <= 0 or box[1] <= 0 or box[2] >= size[0] or box[3] >= size[1]:
            issues.append(Issue("warning", name, index, "ink touches the canvas edge (clipped?)"))
        bottoms.append(box[3])
        digest = image.tobytes()[::97]
        if allow_duplicates:
            continue
        if digest in digests:
            issues.append(
                Issue("warning", name, index, f"identical to frame {digests[digest]:03d}")
            )
        else:
            digests[digest] = index

    if grounded and len(bottoms) > 1:
        drift = max(bottoms) - min(bottoms)
        if drift > 2:
            issues.append(Issue("warning", name, None, f"baseline drifts {drift}px across the row"))
    return issues


def check_loop_seam(name: str, images: list[Image.Image]) -> list[Issue]:
    """A loop whose last frame duplicates the first stutters once per cycle (STEP 17)."""
    if len(images) < 2:
        return []
    if images[0].tobytes() == images[-1].tobytes():
        return [Issue("warning", name, None, "last frame duplicates the first — loop will stutter")]
    return []
