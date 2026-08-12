"""Cut a detected group out of the source and keep its edges intact.

Two things happen here that are easy to get wrong:

  • the frame is masked to *its own* components, so a neighbouring pose whose box
    overlaps this one does not bleed in as a floating paw;
  • the mask is dilated before it is applied, so the antialiased rim of the artwork
    survives. Applying the hard threshold mask directly leaves a jagged, aliased cutout —
    visible as crawling edges once the animation plays.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

from ..detector.frames import FrameGroup
from ..models.animation import Frame

# How far the keep-mask is grown before it gates the source alpha (px).
FEATHER = 2


def cut_frame(
    rgba: np.ndarray, labels: np.ndarray, group: FrameGroup, align_x: str = "centroid"
) -> Frame | None:
    x0, y0, x1, y1 = group.box
    label_crop = labels[y0:y1, x0:x1]
    keep = np.isin(label_crop, list(group.labels))
    if not keep.any():
        return None
    grown = ndimage.binary_dilation(keep, iterations=FEATHER)

    crop = rgba[y0:y1, x0:x1].copy()
    crop[..., 3] = np.where(grown, crop[..., 3], 0)

    # Re-tighten: the dilation and the mask can both move the true edge.
    solid = crop[..., 3] > 0
    rows_on = np.where(solid.any(axis=1))[0]
    cols_on = np.where(solid.any(axis=0))[0]
    if rows_on.size == 0 or cols_on.size == 0:
        return None
    ty0, ty1 = int(rows_on[0]), int(rows_on[-1]) + 1
    tx0, tx1 = int(cols_on[0]), int(cols_on[-1]) + 1
    crop = crop[ty0:ty1, tx0:tx1]
    box = (x0 + tx0, y0 + ty0, x0 + tx1, y0 + ty1)

    alpha = crop[..., 3].astype(float)
    if align_x == "bbox" or alpha.sum() <= 0:
        anchor_x = (box[0] + box[2]) / 2
    else:
        weights = alpha.sum(axis=0)
        anchor_x = box[0] + float((weights * np.arange(len(weights))).sum() / weights.sum())

    return Frame(box=box, pixels=crop, anchor_x=anchor_x, bottom=box[3])


def clear_cell_gutter(sheet: np.ndarray, cell_w: int, cell_h: int, gutter: int) -> np.ndarray:
    """Erase a transparent border inside every cell of a packed sheet.

    The sheet is drawn through `background-size` at half scale and then through the pet's
    own `transform: scale()`. At fractional ratios the sampler reads *past* the cell edge,
    so ink touching a border shows up as debris from the neighbouring frame. A few empty
    pixels per cell cost nothing and make that impossible.
    """
    if gutter <= 0:
        return sheet
    out = sheet.copy()
    h, w = out.shape[:2]
    for y in range(0, h, cell_h):
        for x in range(0, w, cell_w):
            cell = out[y : y + cell_h, x : x + cell_w]
            cell[:gutter, :, 3] = 0
            cell[-gutter:, :, 3] = 0
            cell[:, :gutter, 3] = 0
            cell[:, -gutter:, 3] = 0
    return out
