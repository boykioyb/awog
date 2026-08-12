"""Source image → `Sheet`. Detection only; nothing is placed or resized here."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from .config.schema import CANONICAL_NAMES, Config, RowConfig, SectionConfig, normalize_name
from .detector.background import extract_matte
from .detector.components import Component, find_components
from .detector.frames import FrameGroup, detect_frames
from .detector.rows import detect_rows, split_captions
from .models.animation import Animation, Box, Sheet
from .processor.alpha import cut_frame
from .processor.cycle import estimate_align_y, pingpong
from .processor.normalize import resample


def _row_config(rows: list[RowConfig], index: int, name: str) -> RowConfig:
    """Row configs are POSITIONAL — entry i describes the i-th row of its section.

    Not keyed by name on purpose: the names in the config are what the rows are *called*,
    and a sheet is free to order them however it likes (the shiba sheet puts `pee` where
    the canonical order expects `attack`). Matching by name would then bind two different
    rows to the same entry.
    """
    return rows[index] if index < len(rows) else RowConfig(name=name)


def _default_name(index: int) -> str:
    return CANONICAL_NAMES[index] if index < len(CANONICAL_NAMES) else f"row_{index:02d}"


def _inside(box: Box, crop: tuple[int, int, int, int] | None) -> bool:
    if crop is None:
        return True
    x, y, w, h = crop
    return box[0] >= x and box[1] >= y and box[2] <= x + w and box[3] <= y + h


def _groups_from_regions(regions: list[list[int]], labels: np.ndarray) -> list[FrameGroup]:
    out: list[FrameGroup] = []
    for x, y, w, h in regions:
        patch = labels[y : y + h, x : x + w]
        ids = {int(v) for v in patch.ravel() if v}
        group = FrameGroup.__new__(FrameGroup)
        group.box = (x, y, x + w, y + h)
        group.labels = ids or {0}
        group.area = w * h
        out.append(group)
    return out


def _cut_row(
    rgba: np.ndarray,
    labels: np.ndarray,
    mask: np.ndarray,
    members: list[Component],
    row_cfg: RowConfig,
    name: str,
    cfg: Config,
) -> Animation | None:
    if row_cfg.frame_regions:
        groups, warnings = _groups_from_regions(row_cfg.frame_regions, labels), []
    else:
        groups, warnings = detect_frames(members, mask)

    align_x = row_cfg.align_x or "centroid"
    frames = [cut_frame(rgba, labels, g, align_x) for g in groups]
    frames = [f for f in frames if f is not None]
    if not frames:
        return None

    target = row_cfg.frames if row_cfg.frames is not None else cfg.frames
    detected = len(frames)
    mode = row_cfg.mode or "loop"
    if target:
        frames = pingpong(frames, target) if mode == "pingpong" else resample(frames, target)
        if detected != target:
            warnings.append(f"{detected} detected frames → {target} ({mode})")

    return Animation(
        name=name,
        frames=frames,
        fps=row_cfg.fps or cfg.fps,
        loop=row_cfg.loop,
        align_x=align_x,
        align_y=row_cfg.align_y or estimate_align_y(frames),
        mode=mode,
        lift_budget=row_cfg.lift_budget if row_cfg.lift_budget is not None else 0.25,
        detected=detected,
        warnings=warnings,
    )


def cut_sheet(path: Path, cfg: Config) -> Sheet:
    image = Image.open(path)
    rgba, mask = extract_matte(image, cfg.matte)
    comps, labels = find_components(mask)
    chips, artwork = split_captions(comps, cfg.label_gutter)

    sections = cfg.sections or [SectionConfig(crop=None, rows=cfg.rows)]
    animations: list[Animation] = []
    for section in sections:
        rows = detect_rows(
            [c for c in artwork if _inside(c.box, section.crop)],
            [c for c in chips if _inside(c.box, section.crop)],
        )
        for index, band in enumerate(rows):
            row_cfg = _row_config(section.rows, index, _default_name(index))
            if row_cfg.skip:
                continue
            members = band.components
            if row_cfg.y is not None and row_cfg.height is not None:
                lo, hi = row_cfg.y, row_cfg.y + row_cfg.height
                members = [c for c in artwork if lo <= c.cy < hi and _inside(c.box, section.crop)]

            animation = _cut_row(
                rgba, labels, mask, members, row_cfg, normalize_name(row_cfg.name), cfg
            )
            if animation is not None:
                animations.append(animation)

    return Sheet(source=str(path), size=(image.width, image.height), animations=animations)
