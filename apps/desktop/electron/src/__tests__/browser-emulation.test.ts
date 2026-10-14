// Bài kiểm hình học giả lập thiết bị: view luôn nằm TRỌN trong rect renderer cấp.
//
//   npx tsc -p tsconfig.json && node --test dist/__tests__/browser-emulation.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { fitEmulation } from "../browser-emulation";

const inside = (
  inner: { x: number; y: number; width: number; height: number },
  outer: typeof inner,
) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

test("thiết bị cao hơn khung: co vừa khung, căn giữa ngang, không lố", () => {
  const slot = { x: 20, y: 60, width: 600, height: 300 };
  const { bounds, scale } = fitEmulation(slot, 390, 844);
  assert.ok(inside(bounds, slot));
  assert.ok(scale < 0.36 && scale > 0.35);
  assert.equal(bounds.y, slot.y);
  const left = bounds.x - slot.x;
  const right = slot.x + slot.width - (bounds.x + bounds.width);
  assert.ok(Math.abs(left - right) <= 1);
});

test("thiết bị nhỏ hơn khung: giữ 1:1, căn giữa cả hai trục", () => {
  const slot = { x: 0, y: 0, width: 800, height: 1000 };
  const { bounds, scale } = fitEmulation(slot, 390, 844);
  assert.equal(scale, 1);
  assert.deepEqual(bounds, { x: 205, y: 78, width: 390, height: 844 });
});

test("khung rất bé hoặc rỗng: không NaN, không lố", () => {
  for (const slot of [
    { x: 5, y: 5, width: 0, height: 0 },
    { x: 5, y: 5, width: 3, height: 2 },
  ]) {
    const { bounds, scale } = fitEmulation(slot, 390, 844);
    assert.ok(Number.isFinite(scale) && scale > 0 && scale <= 1);
    assert.ok(
      Number.isFinite(bounds.x + bounds.y + bounds.width + bounds.height),
    );
    if (slot.width > 0) assert.ok(inside(bounds, slot));
  }
});

test("mọi cỡ khung: nội dung (device × scale) vừa bounds trong sai số < 1px", () => {
  for (let w = 120; w <= 1400; w += 37) {
    for (let h = 90; h <= 1200; h += 53) {
      const slot = { x: 7, y: 11, width: w, height: h };
      const { bounds, scale } = fitEmulation(slot, 390, 844);
      assert.ok(inside(bounds, slot), `${w}x${h}`);
      assert.ok(390 * scale < bounds.width + 1);
      assert.ok(844 * scale < bounds.height + 1);
    }
  }
});
