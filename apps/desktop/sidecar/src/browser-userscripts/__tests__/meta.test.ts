// Run: npx vitest run src/browser-userscripts/__tests__/meta.test.ts
import { describe, expect, it } from "vitest";
import {
  compileMatchPattern,
  matchesUserscript,
  parseUserscript,
  UserscriptError,
} from "../meta.js";

const header = (lines: string[]): string =>
  `// ==UserScript==\n${lines.map((l) => `// ${l}`).join("\n")}\n// ==/UserScript==\nconsole.log(1)\n`;

describe("parseUserscript", () => {
  it("đọc đủ metadata + mặc định", () => {
    const { meta, warnings } = parseUserscript(
      header([
        "@name         Hello",
        "@namespace    https://example.com/ns",
        "@version      1.2.3",
        "@description  Một script",
        "@match        *://*.github.com/*",
        "@match        https://example.com/path*",
        "@include      /^https:\\/\\/a\\.test\\//i",
        "@exclude      *://*.github.com/settings*",
        "@grant        GM_addStyle",
        "@grant        unsafeWindow",
      ]),
    );
    expect(meta).toEqual({
      name: "Hello",
      namespace: "https://example.com/ns",
      version: "1.2.3",
      description: "Một script",
      match: ["*://*.github.com/*", "https://example.com/path*"],
      include: ["/^https:\\/\\/a\\.test\\//i"],
      exclude: ["*://*.github.com/settings*"],
      runAt: "document-end",
      noframes: false,
      grant: ["GM_addStyle", "unsafeWindow"],
      require: [],
    });
    expect(warnings).toEqual([]);
  });

  it("run-at, noframes, CRLF; `@run-at document_start` được chuẩn hoá", () => {
    const src = header([
      "@name A",
      "@match <all_urls>",
      "@run-at document_start",
      "@noframes",
    ]).replace(/\n/g, "\r\n");
    const { meta } = parseUserscript(src);
    expect(meta.runAt).toBe("document-start");
    expect(meta.noframes).toBe(true);
  });

  it("run-at lạ → document-end + cảnh báo", () => {
    const { meta, warnings } = parseUserscript(
      header(["@name A", "@match <all_urls>", "@run-at later"]),
    );
    expect(meta.runAt).toBe("document-end");
    expect(warnings.join("\n")).toMatch(/Unsupported @run-at "later"/);
  });

  it("grant ngoài danh sách và @require chỉ cảnh báo, vẫn parse được", () => {
    const { meta, warnings } = parseUserscript(
      header([
        "@name A",
        "@match <all_urls>",
        "@grant GM_xmlhttpRequest",
        "@grant none",
        "@require https://cdn.example.com/lib.js",
      ]),
    );
    expect(meta.grant).toEqual(["GM_xmlhttpRequest", "none"]);
    expect(meta.require).toEqual(["https://cdn.example.com/lib.js"]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/GM_xmlhttpRequest/);
    expect(warnings[1]).toMatch(/@require/);
  });

  it("không có @match/@include → cảnh báo sẽ không bao giờ chạy", () => {
    const { warnings } = parseUserscript(header(["@name A"]));
    expect(warnings.join("\n")).toMatch(/never run/);
  });

  it("pattern hỏng bị bỏ qua + cảnh báo, pattern tốt vẫn giữ", () => {
    const { warnings } = parseUserscript(
      header([
        "@name A",
        "@match ftp://x.com/*",
        "@match https://ok.com/*",
        "@include /(/",
      ]),
    );
    expect(
      warnings.some((w) => w.includes("@match ignored: ftp://x.com/*")),
    ).toBe(true);
    expect(warnings.some((w) => w.includes("@include ignored: /(/"))).toBe(
      true,
    );
    expect(warnings.some((w) => /never run/.test(w))).toBe(false);
  });

  it("thiếu header hoặc @name → UserscriptError", () => {
    expect(() => parseUserscript("console.log(1)")).toThrow(UserscriptError);
    expect(() => parseUserscript(header(["@match <all_urls>"]))).toThrow(
      /@name/,
    );
  });

  it("bỏ qua @name:vi và khoá lạ", () => {
    const { meta } = parseUserscript(
      header(["@name:vi Tên", "@name Real", "@icon x", "@match <all_urls>"]),
    );
    expect(meta.name).toBe("Real");
  });
});

describe("matchesUserscript", () => {
  const m = (
    match: string[],
    url: string,
    extra: { include?: string[]; exclude?: string[] } = {},
  ) =>
    matchesUserscript(
      { match, include: extra.include ?? [], exclude: extra.exclude ?? [] },
      url,
    );

  it("*://*.github.com/* khớp github.com và subdomain, http lẫn https", () => {
    const p = ["*://*.github.com/*"];
    expect(m(p, "https://github.com/")).toBe(true);
    expect(m(p, "http://gist.github.com/a/b?x=1#h")).toBe(true);
    expect(m(p, "https://a.b.github.com/x")).toBe(true);
    expect(m(p, "https://notgithub.com/")).toBe(false);
    expect(m(p, "https://github.com.evil.com/")).toBe(false);
    expect(m(p, "https://evil.com/?u=github.com/")).toBe(false);
    expect(m(p, "https://github.com:8443/x")).toBe(true);
  });

  it("https://example.com/path* — scheme + path glob", () => {
    const p = ["https://example.com/path*"];
    expect(m(p, "https://example.com/path")).toBe(true);
    expect(m(p, "https://example.com/path/deeper?q=1")).toBe(true);
    expect(m(p, "https://example.com/pathology")).toBe(true);
    expect(m(p, "https://example.com/other")).toBe(false);
    expect(m(p, "http://example.com/path")).toBe(false);
    expect(
      m(["https://example.com/path"], "https://example.com/path#frag"),
    ).toBe(true);
    expect(m(["https://example.com/path"], "https://example.com/path/")).toBe(
      false,
    );
  });

  it("<all_urls> khớp mọi http(s), không khớp scheme khác", () => {
    expect(m(["<all_urls>"], "https://anything.test:3000/a?b#c")).toBe(true);
    expect(m(["<all_urls>"], "http://localhost/")).toBe(true);
    expect(m(["<all_urls>"], "file:///etc/passwd")).toBe(false);
    expect(m(["<all_urls>"], "about:blank")).toBe(false);
    expect(m(["<all_urls>"], "wspreview://x/y")).toBe(false);
  });

  it("host có port: có port thì phải đúng, không port thì mọi port", () => {
    expect(m(["http://localhost:3000/*"], "http://localhost:3000/a")).toBe(
      true,
    );
    expect(m(["http://localhost:3000/*"], "http://localhost:4000/a")).toBe(
      false,
    );
    expect(m(["http://localhost/*"], "http://localhost:4000/a")).toBe(true);
  });

  it("@include glob (không phân biệt hoa/thường) và regex", () => {
    expect(
      m([], "https://Example.com/Foo", {
        include: ["https://example.com/foo*"],
      }),
    ).toBe(true);
    expect(
      m([], "https://example.com/bar", {
        include: ["https://example.com/foo*"],
      }),
    ).toBe(false);
    expect(
      m([], "https://a.test/x", { include: ["/^https:\\/\\/a\\.test\\/x$/"] }),
    ).toBe(true);
    expect(
      m([], "https://a.test/y", { include: ["/^https:\\/\\/a\\.test\\/x$/"] }),
    ).toBe(false);
    expect(
      m([], "https://a.test/X", { include: ["/^https:\\/\\/a\\.test\\/x$/i"] }),
    ).toBe(true);
    // `g` bị bỏ để test() không có trạng thái.
    const re = { include: ["/a\\.test/g"] };
    expect(m([], "https://a.test/", re)).toBe(true);
    expect(m([], "https://a.test/", re)).toBe(true);
  });

  it("@exclude luôn thắng", () => {
    const ex = { exclude: ["*://github.com/settings*"] };
    expect(m(["*://*.github.com/*"], "https://github.com/foo", ex)).toBe(true);
    expect(
      m(["*://*.github.com/*"], "https://github.com/settings/profile", ex),
    ).toBe(false);
    expect(
      m(["<all_urls>"], "https://x.com/a", { exclude: ["/x\\.com/"] }),
    ).toBe(false);
  });

  it("pattern không hợp lệ bị bỏ qua, không ném", () => {
    expect(m(["nonsense", "https://ok.com/*"], "https://ok.com/a")).toBe(true);
    expect(m(["nonsense"], "https://ok.com/a")).toBe(false);
    expect(typeof compileMatchPattern("https://*.*.com/*")).toBe("string");
    expect(typeof compileMatchPattern("file:///*")).toBe("string");
  });

  it("URL không parse được → false", () => {
    expect(m(["<all_urls>"], "not a url")).toBe(false);
  });
});
