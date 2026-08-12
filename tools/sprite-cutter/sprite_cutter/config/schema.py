"""Config schema + loader (YAML or JSON).

Every knob has a default that works on an untouched AI sheet, so a config file is only
ever needed to *override* auto-detection — which is the whole point of STEP 13: detection
is best-effort, the file is authoritative.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Canonical animation names (STEP 16). Detected rows are normalised against this list so
# a sheet labelled "LIE_DOWN" / "lie down" / "Lie-Down" all land in the same folder.
CANONICAL_NAMES = (
    "idle walk run sprint jump fall land turn attack hurt die "
    "pee poop dig shake roll sit lie_down sleep"
).split()


def normalize_name(raw: str) -> str:
    slug = "_".join(raw.strip().lower().replace("-", " ").replace("_", " ").split())
    return slug or "row"


@dataclass
class MatteConfig:
    # auto → use the source alpha when it carries real transparency, else flood-fill.
    strategy: str = "auto"
    # Alpha (0-255) at or below which a pixel counts as background. AI sheets leave a
    # wide soft halo; too low a value drags a grey fringe into every frame.
    threshold: int = 40
    # Flood-fill tolerance per channel, only used when there is no usable alpha.
    tolerance: int = 26
    # Ink smaller than this is noise — but effects (Z's, droplets) are small too, so the
    # floor is deliberately low and attachment happens later in frames.py.
    min_ink_area: int = 10


@dataclass
class RowConfig:
    """Manual override for one animation row. Any field left None keeps auto-detection."""

    name: str
    frames: int | None = None
    fps: int | None = None
    loop: bool = True
    y: int | None = None
    height: int | None = None
    align_x: str | None = None
    # None → decided per row by processor/cycle.py ("row" vs "baseline").
    align_y: str | None = None
    # "loop" (default) or "pingpong" — see processor/cycle.py; not auto-detectable.
    mode: str | None = None
    lift_budget: float | None = None
    # Explicit source boxes [x, y, w, h]; wins over every detector.
    frame_regions: list[list[int]] = field(default_factory=list)
    skip: bool = False


@dataclass
class SectionConfig:
    """One block of the sheet, cut independently.

    A sheet is not always one stack of full-width rows. The dino sheet is four columns of
    blocks: eleven long rows on the left, seven more beside them, and small two-frame
    blocks tiled across the bottom. Two blocks that sit side by side share a Y band, so
    any row detector will read them as one row — the only thing that separates them is
    saying where they are.

    `crop` is [x, y, w, h]; artwork not fully inside it is left to the other sections.
    """

    crop: tuple[int, int, int, int] | None = None
    rows: list["RowConfig"] = field(default_factory=list)


@dataclass
class AwogConfig:
    """The AWOG-specific packing stage (see awog/petsheet.py)."""

    enabled: bool = False
    cell: tuple[int, int] = (132, 128)
    gutter: int = 3
    # AWOG pet state → animation name on this sheet.
    map: dict[str, str] = field(default_factory=dict)
    # Rows of the pet sheet, top to bottom. Fixed by PetSprite.vue.
    states: list[str] = field(
        default_factory=lambda: [
            "idle",
            "working",
            "awaiting",
            "done",
            "offline",
            "working-alt",
            "idle-alt",
        ]
    )


@dataclass
class Config:
    fps: int = 12
    # Target frame count per animation. Rows with more are sampled across the whole
    # cycle, rows with fewer are held — never truncated (STEP 4).
    frames: int | None = None
    padding: dict[str, int] = field(
        default_factory=lambda: {"top": 3, "bottom": 3, "left": 3, "right": 3}
    )
    # None → one canvas sized to fit the whole sheet. A fixed [w, h] forces it.
    canvas: tuple[int, int] | None = None
    matte: MatteConfig = field(default_factory=MatteConfig)
    # Escape hatch for a sheet whose captions are not solid chips: everything left of this
    # x is treated as caption. Normally captions are found by shape (detector/rows.py).
    label_gutter: int | None = None
    rows: list[RowConfig] = field(default_factory=list)
    # Multi-block sheets. Empty → the whole sheet is one section using `rows`.
    sections: list[SectionConfig] = field(default_factory=list)
    awog: AwogConfig = field(default_factory=AwogConfig)
    preview_bg: str = "checker"


def _rows(entries: Any) -> list[RowConfig]:
    """A row is either a bare name or a mapping of overrides."""
    out: list[RowConfig] = []
    for entry in entries or []:
        if isinstance(entry, str):
            out.append(RowConfig(name=normalize_name(entry)))
            continue
        entry = dict(entry)
        entry["name"] = normalize_name(entry["name"])
        out.append(RowConfig(**entry))
    return out


def _load_raw(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() in (".yaml", ".yml"):
        import yaml  # optional dependency: only needed for YAML configs

        return yaml.safe_load(text) or {}
    return json.loads(text)


def load_config(path: Path | None) -> Config:
    if path is None:
        return Config()
    raw = _load_raw(path)
    cfg = Config(
        fps=int(raw.get("fps", 12)),
        frames=raw.get("frames"),
        preview_bg=str(raw.get("preview_bg", "checker")),
        label_gutter=raw.get("label_gutter"),
    )
    if "padding" in raw:
        pad = raw["padding"]
        cfg.padding = (
            {k: int(pad) for k in cfg.padding} if isinstance(pad, int) else {**cfg.padding, **pad}
        )
    if raw.get("canvas"):
        cfg.canvas = (int(raw["canvas"][0]), int(raw["canvas"][1]))
    if "matte" in raw:
        cfg.matte = MatteConfig(**{**vars(MatteConfig()), **raw["matte"]})
    cfg.rows = _rows(raw.get("rows"))
    for entry in raw.get("sections", []) or []:
        crop = entry.get("crop")
        cfg.sections.append(
            SectionConfig(
                crop=tuple(int(v) for v in crop) if crop else None,  # type: ignore[arg-type]
                rows=_rows(entry.get("rows")),
            )
        )
    if "awog" in raw:
        a = dict(raw["awog"])
        cfg.awog = AwogConfig(
            enabled=bool(a.get("enabled", True)),
            cell=tuple(a.get("cell", (132, 128))),  # type: ignore[arg-type]
            gutter=int(a.get("gutter", 3)),
            map={k: normalize_name(v) for k, v in (a.get("map") or {}).items()},
            states=a.get("states") or AwogConfig().states,
        )
    return cfg
