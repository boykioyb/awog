// Bài kiểm phần thuần của wspreview://: parse URL → token + rel, MIME theo đuôi.
// parsePreviewUrl phải từ chối mọi thứ có thể trượt khỏi root TRƯỚC khi chạm đĩa.
//
//   npx tsc -p tsconfig.json && node --test dist/__tests__/html-preview.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePreviewUrl, previewMimeOf } from "../preview-url";

test("parses token + workspace-relative path", () => {
  assert.deepEqual(parsePreviewUrl("wspreview://abc123/index.html"), {
    token: "abc123",
    rel: "index.html",
  });
  assert.deepEqual(parsePreviewUrl("wspreview://abc123/img/a%20b.png?v=2#x"), {
    token: "abc123",
    rel: "img/a b.png",
  });
});

test("rejects wrong scheme, empty path, NUL, dot-dot (even encoded), absolute", () => {
  assert.equal(parsePreviewUrl("https://abc123/index.html"), null);
  assert.equal(parsePreviewUrl("wspreview://abc123/"), null);
  assert.equal(parsePreviewUrl("wspreview://abc123/a%00b"), null);
  assert.equal(
    parsePreviewUrl("wspreview://abc123/..%2f..%2fetc/passwd"),
    null,
  );
  assert.equal(parsePreviewUrl("wspreview://abc123/a%2f..%2fb"), null);
  assert.equal(parsePreviewUrl("not a url"), null);
});

test("leading slashes never make the path absolute", () => {
  assert.deepEqual(parsePreviewUrl("wspreview://abc123/%2fetc%2fpasswd"), {
    token: "abc123",
    rel: "etc/passwd",
  });
});

test("MIME by extension, unknown → octet-stream", () => {
  assert.equal(previewMimeOf("a/B.HTML"), "text/html; charset=utf-8");
  assert.equal(previewMimeOf("x.mjs"), "text/javascript; charset=utf-8");
  assert.equal(previewMimeOf("x.woff2"), "font/woff2");
  assert.equal(previewMimeOf("x.svg"), "image/svg+xml");
  assert.equal(previewMimeOf("x.bin"), "application/octet-stream");
  assert.equal(previewMimeOf("noext"), "application/octet-stream");
});
