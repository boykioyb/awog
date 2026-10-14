// Bài kiểm luật host của trình duyệt agent: chặn loopback/private mặc định, và
// ngoại lệ DUY NHẤT cho cổng dev server đang chạy của đúng phiên (invariant #7).
//
//   npx tsc -p tsconfig.json && node --test dist/__tests__/browser-host-policy.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearDevServerPorts,
  evaluateHost,
  setDevServerPorts,
} from "../browser-host-policy";

const anySite = (): boolean => true;
const S = "session-a";
const blocked = (
  url: string,
  ...scope: [string | undefined] | []
): string | null => evaluateHost(url, scope.length ? scope[0] : S, anySite);

beforeEach(() => clearDevServerPorts());

test("mặc định chặn mọi loopback, kể cả [::1] (URL.hostname có ngoặc)", () => {
  for (const u of [
    "http://localhost:5199",
    "http://127.0.0.1:5199/x",
    "http://[::1]:5199",
    "http://localhost",
    "http://127.0.0.2:5199",
    "http://[::ffff:127.0.0.1]:5199",
    "http://[::]:5199",
    "http://0.0.0.0:5199",
  ]) {
    assert.ok(blocked(u), `${u} phải bị chặn`);
  }
});

test("lý do chặn loopback nói cách mở khoá", () => {
  assert.match(blocked("http://localhost:5199") ?? "", /dev-servers\.json/);
});

test("cổng đang chạy của đúng phiên ⇒ qua", () => {
  setDevServerPorts(S, [5199]);
  assert.equal(blocked("http://localhost:5199/app"), null);
  assert.equal(blocked("https://localhost:5199/app"), null);
});

test("cùng host, cổng khác ⇒ vẫn chặn; không có cổng (80) ⇒ chặn", () => {
  setDevServerPorts(S, [5199]);
  assert.ok(blocked("http://localhost:5200"));
  assert.ok(blocked("http://localhost"));
  assert.ok(blocked("http://localhost:51990"));
});

test("127.0.0.1 / localhost / [::1] đối xử như nhau trên cùng cổng", () => {
  setDevServerPorts(S, [5199]);
  assert.equal(blocked("http://localhost:5199"), null);
  assert.equal(blocked("http://127.0.0.1:5199"), null);
  assert.equal(blocked("http://[::1]:5199"), null);
  // …nhưng KHÔNG mở rộng ra loopback khác.
  assert.ok(blocked("http://127.0.0.2:5199"));
  assert.ok(blocked("http://[::ffff:7f00:1]:5199"));
});

test("server đã dừng (thu hồi cổng) ⇒ chặn lại", () => {
  setDevServerPorts(S, [5199]);
  assert.equal(blocked("http://localhost:5199"), null);
  setDevServerPorts(S, []);
  assert.ok(blocked("http://localhost:5199"));
});

test("redirect/điều hướng từ cổng được phép sang cổng loopback khác ⇒ chặn", () => {
  setDevServerPorts(S, [5199]);
  // will-redirect đi qua cùng evaluateHost với scope của tab.
  assert.equal(blocked("http://localhost:5199/login"), null);
  assert.ok(blocked("http://localhost:11434/api/tags"));
  assert.ok(blocked("http://127.0.0.1:22"));
});

test("ngoại lệ gắn theo scope: phiên khác, pool global, task đều bị chặn", () => {
  setDevServerPorts(S, [5199]);
  assert.ok(blocked("http://localhost:5199", "session-b"));
  assert.ok(blocked("http://localhost:5199", undefined));
  assert.ok(blocked("http://localhost:5199", "task:t1:n1"));
});

test("private IP / link-local / ULA không bị ảnh hưởng bởi ngoại lệ", () => {
  setDevServerPorts(S, [5199, 80, 443]);
  for (const u of [
    "http://10.0.0.5:5199",
    "http://192.168.1.10:5199",
    "http://172.16.0.1:5199",
    "http://169.254.169.254/latest/meta-data",
    "http://[fd00::1]:5199",
    "http://[fe80::1]:5199",
  ]) {
    assert.ok(blocked(u), `${u} phải bị chặn`);
  }
  assert.equal(blocked("https://example.com"), null);
});

test("scheme ngoài http/https bị chặn, kể cả trên cổng được phép", () => {
  setDevServerPorts(S, [5199]);
  assert.ok(blocked("file:///etc/passwd"));
  assert.ok(blocked("ftp://localhost:5199"));
});

test("allowlist site của người dùng vẫn áp cho loopback được phép", () => {
  setDevServerPorts(S, [5199]);
  assert.match(
    evaluateHost("http://localhost:5199", S, () => false) ?? "",
    /allowed-sites/,
  );
});

test("setDevServerPorts từ chối cổng sai", () => {
  assert.throws(() => setDevServerPorts(S, [0]));
  assert.throws(() => setDevServerPorts(S, [70000]));
  assert.throws(() => setDevServerPorts(S, [1.5]));
  assert.throws(() => setDevServerPorts("", [5199]));
});
