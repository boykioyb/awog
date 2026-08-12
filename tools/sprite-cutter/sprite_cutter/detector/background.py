"""STEP 1 + STEP 7 — turn the source image into RGBA + a foreground mask.

Three strategies, tried in this order. They are separate because they fail differently:
the alpha channel is exact when present, flood-fill is safe on a solid-ish background,
and colour distance is the last resort on a background that drifts across the sheet.

The one rule that outranks all of them: never eat ink *inside* the character. A white
belly or a cream muzzle is the same colour as a cream background, so nothing global by
colour is allowed — the fill has to reach a pixel from the border to remove it.
"""

from __future__ import annotations

import numpy as np
from PIL import Image
from scipy import ndimage

from ..config.schema import MatteConfig


def _has_usable_alpha(rgba: np.ndarray) -> bool:
    """True when the source already carries a real matte rather than a token 255 plane."""
    alpha = rgba[..., 3]
    return float((alpha < 8).mean()) > 0.05


def _flood_fill_matte(rgba: np.ndarray, tolerance: int) -> np.ndarray:
    """Background = whatever the border colour reaches. Interior colour matches survive."""
    import cv2

    rgb = rgba[..., :3].astype(np.uint8)
    h, w = rgb.shape[:2]
    filled = np.zeros((h, w), dtype=bool)
    mask = np.zeros((h + 2, w + 2), dtype=np.uint8)
    seeds = (
        [(x, 0) for x in range(0, w, max(1, w // 64))]
        + [(x, h - 1) for x in range(0, w, max(1, w // 64))]
        + [(0, y) for y in range(0, h, max(1, h // 64))]
        + [(w - 1, y) for y in range(0, h, max(1, h // 64))]
    )
    work = rgb.copy()
    for sx, sy in seeds:
        if mask[sy + 1, sx + 1]:
            continue
        cv2.floodFill(
            work,
            mask,
            (sx, sy),
            newVal=(0, 0, 0),
            loDiff=(tolerance,) * 3,
            upDiff=(tolerance,) * 3,
            flags=4 | cv2.FLOODFILL_MASK_ONLY | (255 << 8),
        )
    filled = mask[1:-1, 1:-1] > 0
    return (~filled).astype(np.uint8) * 255


def _color_distance_matte(rgba: np.ndarray, tolerance: int) -> np.ndarray:
    """Fallback: distance from the modal border colour, then fill enclosed holes."""
    rgb = rgba[..., :3].astype(np.int16)
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)
    dist = np.abs(rgb - bg).max(axis=2)
    fg = dist > tolerance
    return ndimage.binary_fill_holes(fg).astype(np.uint8) * 255


def extract_matte(image: Image.Image, cfg: MatteConfig) -> tuple[np.ndarray, np.ndarray]:
    """Return (rgba, mask) where mask is a bool foreground map at full resolution.

    The RGBA is returned alongside because the alpha plane may be *rewritten* here (a
    flood-filled sheet has no alpha of its own until this point).
    """
    rgba = np.array(image.convert("RGBA"))
    strategy = cfg.strategy
    if strategy == "auto":
        strategy = "alpha" if _has_usable_alpha(rgba) else "floodfill"

    if strategy == "alpha":
        alpha = rgba[..., 3]
    elif strategy == "floodfill":
        alpha = _flood_fill_matte(rgba, cfg.tolerance)
        rgba = rgba.copy()
        rgba[..., 3] = np.minimum(rgba[..., 3], alpha)
    elif strategy == "color":
        alpha = _color_distance_matte(rgba, cfg.tolerance)
        rgba = rgba.copy()
        rgba[..., 3] = np.minimum(rgba[..., 3], alpha)
    else:
        raise ValueError(f"unknown matte strategy: {cfg.strategy}")

    mask = alpha > cfg.threshold
    if cfg.min_ink_area > 1:
        mask = _despeckle(mask, cfg.min_ink_area)
    return rgba, mask


def _despeckle(mask: np.ndarray, min_area: int) -> np.ndarray:
    """Drop specks below `min_area`. Kept small on purpose: sleep Z's and water droplets
    are legitimately tiny, and they belong to their pose (frames.py attaches them)."""
    labels, count = ndimage.label(mask)
    if count == 0:
        return mask
    areas = np.bincount(labels.ravel())
    keep = areas >= min_area
    keep[0] = False
    return keep[labels]
