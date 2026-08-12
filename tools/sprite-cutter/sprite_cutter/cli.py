"""CLI (STEP 14).

    python3 -m sprite_cutter INPUT.png --out out/shiba
    python3 -m sprite_cutter INPUT.png --config presets/shiba.yaml --out out/shiba \
        --awog-sheet ../../apps/desktop/ui-next/public/pet/shiba.png
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .awog.petsheet import build_pet_sheet
from .config.schema import load_config, normalize_name
from .debug import write_debug_overlay
from .export import export
from .pipeline import cut_sheet
from .preview.contact_sheet import write_contact_sheet
from .preview.gif import write_gif
from .quality import check_animation


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sprite-cutter", description="Cut an AI-generated sprite sheet into aligned frames."
    )
    parser.add_argument("input", type=Path, help="source sprite sheet (PNG/JPG)")
    parser.add_argument("--out", type=Path, default=Path("out"), help="output directory")
    parser.add_argument("--config", type=Path, help="YAML/JSON config; overrides auto-detection")
    parser.add_argument("--frames", type=int, help="target frame count for every row")
    parser.add_argument("--fps", type=int, help="playback rate written to animations.json/GIFs")
    parser.add_argument(
        "--animation",
        action="append",
        default=[],
        help="only export this animation (repeatable)",
    )
    parser.add_argument("--awog-sheet", type=Path, help="also pack an AWOG pet sheet to this path")
    parser.add_argument("--debug", action="store_true", help="write a detection overlay PNG")
    parser.add_argument("--dry-run", action="store_true", help="detect and report, write nothing")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cfg = load_config(args.config)
    if args.frames:
        cfg.frames = args.frames
    if args.fps:
        cfg.fps = args.fps

    sheet = cut_sheet(args.input, cfg)
    if not sheet.animations:
        print("no animation rows detected", file=sys.stderr)
        return 1

    wanted = {normalize_name(a) for a in args.animation}
    if wanted:
        sheet.animations = [a for a in sheet.animations if a.name in wanted]
        if not sheet.animations:
            print(f"no rows matched {sorted(wanted)}", file=sys.stderr)
            return 1

    print(f"{args.input.name} {sheet.size[0]}x{sheet.size[1]} → {len(sheet.animations)} animations")
    for animation in sheet.animations:
        print(
            f"  {animation.name:<10} {animation.count:>3} frames @ {animation.fps}fps"
            f"  {animation.mode:<8} align_y={animation.align_y:<8} (detected {animation.detected})"
        )

    if args.debug:
        overlay = write_debug_overlay(args.input, cfg, args.out / "debug_detection.png")
        print(f"  debug overlay → {overlay}")

    if args.dry_run:
        return 0

    result = export(sheet, cfg, args.out)
    print(f"canvas {result.canvas[0]}x{result.canvas[1]} · scale {result.scale:.3f} → {args.out}")

    if args.awog_sheet or cfg.awog.enabled:
        target = args.awog_sheet or (args.out / "awog-pet.png")
        pet = build_pet_sheet(sheet, cfg.awog, target)
        print(f"\nAWOG pet sheet → {pet.path}  ({pet.size[0]}x{pet.size[1]}, scale {pet.scale:.3f})")
        for index, (state, animation, count) in enumerate(pet.rows):
            print(f"  row {index}  {state:<12} ← {animation:<10} {count} frames")
        print(pet.css_hints())
        preview = args.out / "preview"
        for state, images in pet.frames_by_state.items():
            write_gif(images, preview / f"awog-{state}.gif", 12, cfg.preview_bg)
            write_contact_sheet(
                images, preview / f"awog-{state}_contact.png", background=cfg.preview_bg, title=state
            )
            # Re-checked against the PET cell: the generic export uses a roomier canvas,
            # so clipping at 132×128 would otherwise go unreported.
            result.issues += check_animation(
                f"awog:{state}", images, grounded=False, allow_duplicates=True
            )

    errors = [i for i in result.issues if i.level == "error"]
    for issue in result.issues:
        print(str(issue), file=sys.stderr)
    print(f"\nquality: {len(errors)} errors, {len(result.issues) - len(errors)} warnings")
    return 1 if errors else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
