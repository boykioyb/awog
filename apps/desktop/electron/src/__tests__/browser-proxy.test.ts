// Bài kiểm builder proxyRules/bypass + kiểm tra payload + khớp thử thách xác thực.
//
//   npx tsc -p tsconfig.json && node --test dist/__tests__/browser-proxy.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildProxyBypass,
  buildProxyRules,
  buildSessionProxy,
  parseProxyConfig,
  parseProxyCredentials,
  parseTrace,
  proxyAuthMatches,
} from "../browser-proxy";

test("rules use the proxy scheme; socks5 stays socks5 (remote DNS)", () => {
  assert.equal(
    buildProxyRules({ type: "http", host: "127.0.0.1", port: 8080 }),
    "http://127.0.0.1:8080",
  );
  assert.equal(
    buildProxyRules({ type: "https", host: "p.example.com", port: 443 }),
    "https://p.example.com:443",
  );
  assert.equal(
    buildProxyRules({ type: "socks5", host: "[::1]", port: 1080 }),
    "socks5://[::1]:1080",
  );
});

test("bypass always ends with <local>", () => {
  assert.equal(
    buildProxyBypass({ type: "http", host: "h", port: 1 }),
    "<local>",
  );
  assert.equal(
    buildProxyBypass({
      type: "http",
      host: "h",
      port: 1,
      bypass: "*.corp.com;10.0.0.0/8",
    }),
    "*.corp.com;10.0.0.0/8,<local>",
  );
  assert.deepEqual(
    buildSessionProxy({ type: "http", host: "h", port: 2, bypass: "a.com" }),
    {
      mode: "fixed_servers",
      proxyRules: "http://h:2",
      proxyBypassRules: "a.com,<local>",
    },
  );
});

test("parseProxyConfig re-validates the host request payload", () => {
  assert.deepEqual(
    parseProxyConfig({ type: "http", host: "x.io", port: 3128, bypass: "" }),
    {
      type: "http",
      host: "x.io",
      port: 3128,
    },
  );
  for (const bad of [
    null,
    { type: "ftp", host: "x", port: 1 },
    { type: "http", host: "http://x", port: 1 },
    { type: "http", host: "a b", port: 1 },
    { type: "http", host: "x", port: 0 },
    { type: "http", host: "x", port: 70000 },
    { type: "http", host: "x", port: "80" },
    { type: "http", host: "x", port: 1, bypass: "a$(b)" },
    { type: "http", host: "x", port: 1, bypass: "a".repeat(501) },
  ]) {
    assert.throws(() => parseProxyConfig(bad), Error, JSON.stringify(bad));
  }
});

test("parseProxyCredentials", () => {
  assert.deepEqual(parseProxyCredentials({ username: "u", password: "" }), {
    username: "u",
    password: "",
  });
  assert.throws(() => parseProxyCredentials({ username: "", password: "p" }));
  assert.throws(() => parseProxyCredentials({ username: "u" }));
});

test("auth only matches the configured proxy challenge", () => {
  const cfg = { type: "http" as const, host: "Proxy.Example.com", port: 8080 };
  assert.ok(
    proxyAuthMatches(
      { isProxy: true, host: "proxy.example.com", port: 8080 },
      cfg,
    ),
  );
  assert.ok(
    !proxyAuthMatches(
      { isProxy: false, host: "proxy.example.com", port: 8080 },
      cfg,
    ),
  );
  assert.ok(
    !proxyAuthMatches(
      { isProxy: true, host: "evil.example.com", port: 8080 },
      cfg,
    ),
  );
  assert.ok(
    !proxyAuthMatches(
      { isProxy: true, host: "proxy.example.com", port: 8081 },
      cfg,
    ),
  );
  assert.ok(
    proxyAuthMatches(
      { isProxy: true, host: "::1", port: 1 },
      { type: "http", host: "[::1]", port: 1 },
    ),
  );
});

test("parseTrace extracts ip and loc", () => {
  assert.deepEqual(parseTrace("fl=1\nip=203.0.113.7\nloc=VN\nts=1\n"), {
    ip: "203.0.113.7",
    loc: "VN",
  });
  assert.deepEqual(parseTrace("garbage"), {});
});
