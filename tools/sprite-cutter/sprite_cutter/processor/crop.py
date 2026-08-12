"""Paste one frame onto the fixed canvas."""

from __future__ import annotations

import numpy as np
from PIL import Image

from ..models.animation import Animation, Frame
from .align import RowPlacement, anchor_offset
from .normalize import Layout


def render_frame(
    frame: Frame, animation: Animation, layout: Layout, lift_src: float
) -> Image.Image:
    canvas = Image.new("RGBA", layout.canvas, (0, 0, 0, 0))
    sprite = Image.fromarray(frame.pixels, mode="RGBA")

    if abs(layout.scale - 1.0) > 1e-3:
        target = (
            max(1, int(round(sprite.width * layout.scale))),
            max(1, int(round(sprite.height * layout.scale))),
        )
        # LANCZOS on premultiplied-looking RGBA drags colour out of transparent pixels as
        # a dark rim; splitting the alpha out and resampling it separately avoids it.
        sprite = _resize_rgba(sprite, target)

    offset = anchor_offset(frame, animation.align_x) * layout.scale
    x = int(round(layout.centre_x - offset))
    y = int(round(layout.baseline - lift_src * layout.scale - sprite.height))
    # Keep the frame inside the margin. Only ever bites on the widest/tallest frame of a
    # sheet, where a rounded anchor can land a pixel outside — and a pixel of anchor error
    # is invisible, while a pixel of ink erased by the gutter pass is a chopped-off paw.
    x = _clamp(x, layout.padding["left"], layout.canvas[0] - layout.padding["right"] - sprite.width)
    y = _clamp(y, layout.padding["top"], layout.canvas[1] - layout.padding["bottom"] - sprite.height)
    canvas.alpha_composite(sprite, (x, y))
    return canvas


def _clamp(value: int, low: int, high: int) -> int:
    return low if high < low else max(low, min(value, high))


def _resize_rgba(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    rgb = image.convert("RGB").resize(size, Image.LANCZOS)
    alpha = image.getchannel("A").resize(size, Image.LANCZOS)
    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    # Colour under fully transparent pixels is undefined and leaks when the browser
    # samples between cells; zero it so any leak is invisible instead of grey.
    data = np.array(out)
    data[..., :3] = np.where(data[..., 3:4] > 0, data[..., :3], 0)
    return Image.fromarray(data, mode="RGBA")


def render_animation(
    animation: Animation, layout: Layout, placement: RowPlacement
) -> list[Image.Image]:
    return [
        render_frame(frame, animation, layout, placement.lifts[i])
        for i, frame in enumerate(animation.frames)
    ]
