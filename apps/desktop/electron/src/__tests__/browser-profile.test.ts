// Bài kiểm ánh xạ profile id → partition: `default` giữ partition cũ, id hợp lệ
// tách partition riêng, mọi id có thể trượt khỏi thư mục Partitions bị từ chối.
//
//   npx tsc -p tsconfig.json && node --test dist/__tests__/browser-profile.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionForProfile } from "../browser-profile";

test("default keeps the legacy partition", () => {
  assert.equal(partitionForProfile("default"), "persist:awog-browser");
});

test("minted ids get their own partition", () => {
  assert.equal(
    partitionForProfile("p-0a1b2c3d"),
    "persist:awog-browser-p-0a1b2c3d",
  );
  assert.equal(partitionForProfile("a"), "persist:awog-browser-a");
  assert.equal(
    partitionForProfile("x".repeat(32)),
    `persist:awog-browser-${"x".repeat(32)}`,
  );
});

test("rejects ids that are empty, uppercase, too long or path-like", () => {
  for (const bad of [
    "",
    "../x",
    "P-1",
    "a/b",
    "a.b",
    "a b",
    "x".repeat(33),
    "p_1",
    "..",
  ]) {
    assert.throws(
      () => partitionForProfile(bad),
      /invalid browser profile id/,
      bad,
    );
  }
  assert.throws(() => partitionForProfile(undefined as unknown as string));
});
