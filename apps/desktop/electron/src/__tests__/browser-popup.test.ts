// Luật window.open của trình duyệt nhúng (browser-popup.ts): popup đăng nhập phải
// thành CỬA SỔ thật giữ opener, link target=_blank vẫn là tab.
//
//   npx tsc -p tsconfig.json && node --test dist/__tests__/browser-popup.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyWindowOpen } from "../browser-popup";

test("window.open có features (popup OAuth) → cửa sổ popup", () => {
  assert.equal(
    classifyWindowOpen({
      url: "https://accounts.google.com/o/oauth2/auth?x=1",
      disposition: "new-window",
      features: "width=500,height=600",
    }),
    "popup",
  );
  assert.equal(classifyWindowOpen({ url: "https://github.com/login/oauth", features: "popup" }), "popup");
});

test("mở about:blank / rỗng để ghi rồi điều hướng → cửa sổ popup", () => {
  assert.equal(classifyWindowOpen({ url: "" }), "popup");
  assert.equal(classifyWindowOpen({ url: "about:blank", disposition: "foreground-tab" }), "popup");
});

test("link target=_blank / window.open không features → tab", () => {
  assert.equal(
    classifyWindowOpen({ url: "https://example.com", disposition: "foreground-tab", features: "" }),
    "tab",
  );
  assert.equal(classifyWindowOpen({ url: "https://example.com", disposition: "background-tab" }), "tab");
});
