"""Tests run against a synthetic sheet, so they assert behaviour rather than pixels.

The generator reproduces the traps that make real AI sheets hard: uneven pitch, poses that
touch, a detached effect blob, a row that drifts downwards, and an arc that dips into the
row below.
"""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from PIL import Image, ImageDraw

from sprite_cutter.config.schema import Config, RowConfig, load_config
from sprite_cutter.detector.background import extract_matte
from sprite_cutter.detector.components import find_components
from sprite_cutter.detector.frames import detect_frames
from sprite_cutter.detector.rows import detect_rows, is_caption_chip, split_captions
from sprite_cutter.models.animation import Animation, Frame
from sprite_cutter.pipeline import cut_sheet
from sprite_cutter.processor.cycle import estimate_align_y, pingpong
from sprite_cutter.processor.normalize import plan_layout, resample

WIDTH, HEIGHT = 640, 300


def _blob(draw: ImageDraw.ImageDraw, cx: int, cy: int, w: int, h: int) -> None:
    draw.ellipse((cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2), fill=(220, 150, 60, 255))


def build_sheet() -> Image.Image:
    """Three rows: a drifting walk, a jump arc that overlaps the row below, a still row."""
    image = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    # Caption chips in a left gutter, same height, aligned left edge.
    for cy in (50, 150, 250):
        draw.rounded_rectangle((6, cy - 11, 54, cy + 11), radius=6, fill=(40, 40, 40, 255))

    # Row 0 — 7 poses sinking 2px per frame (generator drift). The pair at 270/340 is
    # closer together than the poses are wide, so it arrives as ONE component.
    for i, x in enumerate((100, 185, 270, 340, 425, 510, 595)):
        _blob(draw, x, 50 + i * 2, 76, 44)

    # Row 1 — 6 poses on an arc; the peak reaches into row 0's band.
    lifts = [0, 18, 34, 34, 18, 0]
    for i, lift in enumerate(lifts):
        _blob(draw, 100 + i * 85, 150 - lift, 38, 40)
    # A detached effect (a dust puff) that belongs to the third pose.
    draw.ellipse((262, 178, 272, 186), fill=(200, 200, 210, 255))

    # Row 2 — 5 identical poses, dead flat.
    for i in range(5):
        _blob(draw, 100 + i * 95, 250, 42, 42)
    return image


def _frame(width: int, height: int, bottom: int, anchor: float = 0.0) -> Frame:
    pixels = np.zeros((height, width, 4), dtype=np.uint8)
    pixels[..., 3] = 255
    return Frame(box=(0, bottom - height, width, bottom), pixels=pixels, anchor_x=anchor, bottom=bottom)


class DetectionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.image = build_sheet()
        self.cfg = Config()
        self.rgba, self.mask = extract_matte(self.image, self.cfg.matte)
        self.comps, self.labels = find_components(self.mask)

    def test_captions_are_recognised_by_shape_and_kept_out_of_the_rows(self) -> None:
        chips, artwork = split_captions(self.comps)
        self.assertEqual(len(chips), 3, "one solid chip per row")
        self.assertFalse(any(is_caption_chip(c) for c in artwork))

        rows = detect_rows(artwork, chips)
        self.assertEqual(len(rows), 3, "an arc reaching into the row above must not merge rows")
        self.assertEqual([len(r.components) for r in rows][2], 5, "the flat row keeps its 5 poses")

    def test_touching_poses_are_split_and_effects_attach(self) -> None:
        chips, artwork = split_captions(self.comps)
        rows = detect_rows(artwork, chips)
        first, _ = detect_frames(rows[0].components, self.mask)
        self.assertEqual(len(first), 7, "the merged pair must be cut back into two frames")

        second, _ = detect_frames(rows[1].components, self.mask)
        self.assertEqual(len(second), 6, "a dust puff is an effect, not a seventh frame")
        owner = second[2]
        self.assertGreater(owner.box[3], 176, "the puff should extend its pose's box")

    def test_pipeline_names_rows_positionally(self) -> None:
        cfg = Config(frames=8)
        cfg.rows = [RowConfig(name="walk"), RowConfig(name="jump"), RowConfig(name="sleep")]
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "sheet.png"
            self.image.save(path)
            sheet = cut_sheet(path, cfg)
        self.assertEqual([a.name for a in sheet.animations], ["walk", "jump", "sleep"])
        for animation in sheet.animations:
            self.assertEqual(animation.count, 8, "every row is normalised to the target count")


class AlignmentTest(unittest.TestCase):
    def test_monotone_drift_is_flattened(self) -> None:
        frames = [_frame(40, 40, bottom=100 - i) for i in range(10)]
        self.assertEqual(estimate_align_y(frames), "baseline")

    def test_single_stray_frame_is_flattened(self) -> None:
        frames = [_frame(40, 40, bottom=100) for _ in range(10)]
        frames[4] = _frame(40, 40, bottom=50)
        self.assertEqual(estimate_align_y(frames), "baseline")

    def test_real_arc_is_preserved(self) -> None:
        lifts = [0, 8, 20, 30, 34, 34, 30, 20, 8, 0]
        frames = [_frame(40, 40, bottom=100 - lift) for lift in lifts]
        self.assertEqual(estimate_align_y(frames), "row")

    def test_layout_is_shared_by_every_animation(self) -> None:
        tall = Animation("jump", [_frame(30, 60, 100), _frame(30, 60, 70)], fps=12, align_y="row")
        wide = Animation("run", [_frame(80, 40, 100)], fps=12, align_y="baseline")
        layout = plan_layout([tall, wide], {k: 3 for k in "top bottom left right".split()}, (132, 128), 0.25)
        self.assertLessEqual(layout.scale * 80, 126, "the widest frame must fit the cell")
        self.assertLessEqual(
            layout.scale * (60 + layout.lift_budget_src), 122, "content plus lift must fit"
        )
        self.assertLess(layout.lift_budget_src, 30, "a 30px arc must be compressed into the budget")


class ResampleTest(unittest.TestCase):
    def test_downsample_spans_the_whole_cycle(self) -> None:
        frames = [_frame(10, 10, 10, anchor=i) for i in range(19)]
        out = resample(frames, 12)
        self.assertEqual(len(out), 12)
        self.assertEqual(out[0].anchor_x, 0)
        self.assertGreater(out[-1].anchor_x, 15, "truncating instead of sampling cuts the cycle")

    def test_upsample_holds_frames(self) -> None:
        frames = [_frame(10, 10, 10, anchor=i) for i in range(5)]
        self.assertEqual(len(resample(frames, 12)), 12)

    def test_pingpong_returns_to_the_start(self) -> None:
        frames = [_frame(10, 10, 10, anchor=i) for i in range(7)]
        out = pingpong(frames, 12)
        self.assertEqual(len(out), 12)
        self.assertEqual(out[1].anchor_x, out[-1].anchor_x, "the loop must close on itself")


class ConfigTest(unittest.TestCase):
    def test_yaml_round_trip(self) -> None:
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "c.yaml"
            path.write_text(
                "fps: 24\nframes: 16\npadding: 8\nrows:\n  - {name: Lie Down, mode: pingpong}\n"
                "awog:\n  map: {idle: idle}\n",
                encoding="utf-8",
            )
            cfg = load_config(path)
        self.assertEqual(cfg.fps, 24)
        self.assertEqual(cfg.frames, 16)
        self.assertEqual(cfg.padding["top"], 8)
        self.assertEqual(cfg.rows[0].name, "lie_down", "names are normalised to the canonical slug")
        self.assertEqual(cfg.rows[0].mode, "pingpong")
        self.assertTrue(cfg.awog.enabled)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
