// Trang lỗi của tab trình duyệt nhúng.
//
//   npx tsc -p tsconfig.json && node --test dist/__tests__/browser-error-page.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { errorPageScript, renderErrorPage } from "../browser-error-page";

test("URL and error name are escaped, never raw HTML", () => {
  const html = renderErrorPage({
    code: -105,
    desc: "ERR_NAME_NOT_RESOLVED",
    url: 'https://x.test/"><img src=x onerror=alert(1)>',
    lang: "en",
  });
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(html.includes('href="https://x.test/&quot;&gt;'));
});

test("reason follows the Chromium error name; proxy line only when proxied", () => {
  const reset = renderErrorPage({
    code: -101,
    desc: "ERR_CONNECTION_RESET",
    url: "https://www.google.com/",
    lang: "vi",
    proxy: { type: "http", host: "1.2.3.4", port: 8080 },
  });
  assert.ok(reset.includes("Kết nối bị cắt giữa chừng"));
  assert.ok(reset.includes("HTTP 1.2.3.4:8080"));
  assert.ok(reset.includes("ERR_CONNECTION_RESET (-101)"));

  const direct = renderErrorPage({
    code: -130,
    desc: "ERR_PROXY_CONNECTION_FAILED",
    url: "https://a.test/",
    lang: "en",
  });
  assert.ok(direct.includes("connect through the proxy"));
  assert.ok(!direct.includes('class="px"'));
});

test("retry link only for http(s) URLs", () => {
  const ftp = renderErrorPage({
    code: -1,
    desc: "ERR_FAILED",
    url: "file:///etc/passwd",
    lang: "en",
  });
  assert.ok(!ftp.includes('class="btn"'));
});

test("inject script carries the HTML as a JSON string literal", () => {
  const s = errorPageScript('<p>"x"</p>\u2028');
  assert.equal(
    s,
    `document.documentElement.innerHTML = ${JSON.stringify('<p>"x"</p>\u2028')}; true`,
  );
});
