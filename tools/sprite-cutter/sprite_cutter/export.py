"""Write the generic output tree: frames, metadata, previews, quality report."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from .config.schema import Config
from .models.animation import Sheet
from .preview.contact_sheet import write_contact_sheet
from .preview.gif import write_gif, write_strip_gif
from .processor.align import row_placement
from .processor.crop import render_animation
from .processor.normalize import plan_layout
from .quality import Issue, check_animation, check_loop_seam


@dataclass
class ExportResult:
    out: Path
    canvas: tuple[int, int]
    scale: float
    rendered: dict[str, list[Image.Image]]
    issues: list[Issue]


def export(sheet: Sheet, cfg: Config, out: Path) -> ExportResult:
    layout = plan_layout(sheet.animations, cfg.padding, cfg.canvas, default_lift_budget=0.25)
    rendered: dict[str, list[Image.Image]] = {}
    issues: list[Issue] = []
    meta: dict[str, dict] = {}

    for animation in sheet.animations:
        placement = row_placement(animation, layout.lift_budget_src)
        images = render_animation(animation, layout, placement)
        rendered[animation.name] = images

        folder = out / animation.name
        folder.mkdir(parents=True, exist_ok=True)
        files = []
        for index, image in enumerate(images):
            name = f"{index:03d}.png"
            image.save(folder / name)
            files.append(f"{animation.name}/{name}")

        issues += check_animation(
            animation.name,
            images,
            grounded=animation.align_y == "baseline",
            allow_duplicates=animation.mode == "pingpong",
        )
        if animation.loop and animation.mode != "pingpong":
            issues += check_loop_seam(animation.name, images)
        for warning in animation.warnings:
            issues.append(Issue("warning", animation.name, None, warning))

        write_gif(images, out / "preview" / f"{animation.name}.gif", animation.fps, cfg.preview_bg)
        write_contact_sheet(
            images,
            out / "preview" / f"{animation.name}_contact.png",
            background=cfg.preview_bg,
            title=animation.name,
        )
        meta[animation.name] = {
            "frames": len(images),
            "fps": animation.fps,
            "loop": animation.loop,
            "files": files,
        }

    write_strip_gif(
        [(a.name, rendered[a.name]) for a in sheet.animations],
        out / "preview" / "preview_all.gif",
        cfg.fps,
        cfg.preview_bg,
    )

    (out / "animations.json").write_text(
        json.dumps(
            {
                "source": Path(sheet.source).name,
                "fps": cfg.fps,
                "canvas": {"width": layout.canvas[0], "height": layout.canvas[1]},
                "baseline": layout.baseline,
                "scale": round(layout.scale, 4),
                "animations": meta,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return ExportResult(out, layout.canvas, layout.scale, rendered, issues)
