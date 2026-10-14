// Bài kiểm phần thuần của userscript: payload từ sidecar, chạy luật, wrapper, báo cáo.
//
//   npx tsc -p tsconfig.json && node --test dist/__tests__/browser-userscript-core.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWrapper,
  matchesRules,
  parseHostScripts,
  parseReport,
  syntaxProblem,
  type HostUserscript,
} from "../browser-userscript-core";

const TAG = "__awog_userscript_test__";

const script = (over: Partial<HostUserscript> = {}): HostUserscript => ({
  id: "us-0123abcd",
  enabled: true,
  meta: {
    name: "T",
    match: [],
    include: [],
    exclude: [],
    runAt: "document-end",
    noframes: false,
    grant: [],
    require: [],
  },
  rules: {
    include: [{ source: "^https://example\\.com/", flags: "" }],
    exclude: [],
  },
  source: "window.__x = 1",
  ...over,
});

test("parseHostScripts nhận payload đúng hình và từ chối payload sai", () => {
  const ok = parseHostScripts({ scripts: [script()] });
  assert.equal(ok.length, 1);
  assert.equal(ok[0]?.id, "us-0123abcd");
  assert.throws(() => parseHostScripts({}), /scripts list/);
  assert.throws(
    () => parseHostScripts({ scripts: [{ ...script(), id: "../x" }] }),
    /bad id/,
  );
  assert.throws(
    () =>
      parseHostScripts({
        scripts: [
          {
            ...script(),
            rules: { include: [{ source: "a", flags: "g" }], exclude: [] },
          },
        ],
      }),
    /flags/,
  );
  assert.throws(
    () =>
      parseHostScripts({
        scripts: [{ ...script(), meta: { ...script().meta, runAt: "now" } }],
      }),
    /runAt/,
  );
});

test("matchesRules: include ∧ ¬exclude, chỉ http(s)", () => {
  const r = {
    include: [{ source: "^https?://example\\.com/", flags: "" }],
    exclude: [{ source: "/private", flags: "" }],
  };
  assert.equal(matchesRules(r, "https://example.com/a"), true);
  assert.equal(matchesRules(r, "https://example.com/private"), false);
  assert.equal(matchesRules(r, "https://other.com/a"), false);
  assert.equal(
    matchesRules(
      { include: [{ source: ".*", flags: "" }], exclude: [] },
      "file:///etc/passwd",
    ),
    false,
  );
  assert.equal(matchesRules(r, "not a url"), false);
});

test("matchesRules: regex backtrack thảm hoạ bị ngắt, không treo main", () => {
  const evil = {
    include: [{ source: "^https://example\\.com/(a+)+$", flags: "" }],
    exclude: [],
  };
  const url = `https://example.com/${"a".repeat(40)}!`;
  const t0 = Date.now();
  assert.equal(matchesRules(evil, url), false);
  assert.ok(Date.now() - t0 < 1_000, "phải ngắt trong vài chục ms");
  // Sau một lần ngắt, bộ chạy vẫn dùng được.
  assert.equal(
    matchesRules(
      { include: [{ source: "example", flags: "" }], exclude: [] },
      "https://example.com/",
    ),
    true,
  );
});

test("buildWrapper cho script hợp lệ biên dịch được; nhúng U+2028 an toàn", () => {
  assert.equal(syntaxProblem(buildWrapper(script(), TAG)), null);
  const tricky = script({
    meta: { ...script().meta, name: "a\u2028b" },
    source: "// kết thúc bằng comment",
  });
  assert.equal(syntaxProblem(buildWrapper(tricky, TAG)), null);
});

test("lỗi cú pháp trong source được phát hiện", () => {
  const bad = buildWrapper(script({ source: "function (" }), TAG);
  assert.match(syntaxProblem(bad) ?? "", /SyntaxError/);
});

test("parseReport: chỉ nhận đúng tag + id + ev, cắt độ dài", () => {
  const ok = parseReport(
    `${TAG}${JSON.stringify({ id: "us-0123abcd", name: "N", ev: "error", msg: "x".repeat(900) })}`,
    TAG,
  );
  assert.equal(ok?.ev, "error");
  assert.equal(ok?.msg.length, 500);
  assert.equal(parseReport(`${TAG}{"id":"nope","ev":"ran"}`, TAG), null);
  assert.equal(
    parseReport(`${TAG}{"id":"us-0123abcd","ev":"boom"}`, TAG),
    null,
  );
  assert.equal(parseReport(`${TAG}not json`, TAG), null);
  assert.equal(parseReport("hello", TAG), null);
});
