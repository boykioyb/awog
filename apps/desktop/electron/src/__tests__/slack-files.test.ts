// Bài kiểm phần thuần của lớp Electron cho Slack threads: threadId (L1 vào URL query),
// tên gợi ý "Save as…" (tên do người khác đặt trên Slack), và allowlist loại file được mở.
//
//   npx tsc -p tsconfig.json && node --test dist/__tests__/slack-files.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isValidThreadId,
  markDownloadedFromInternet,
  openRefusal,
  quarantineValue,
  safeFileName,
  ZONE_IDENTIFIER,
} from "../slack-files";

test("accepts a well-formed thread id", () => {
  assert.equal(isValidThreadId("T01ABCDEF:C02XYZ123:1712345678.123456"), true);
  assert.equal(isValidThreadId("T01ABCDEF:D02XYZ123:1712345678.123456"), true);
});

test("rejects malformed / injected thread ids", () => {
  for (const bad of [
    undefined,
    42,
    "",
    "T01ABCDEF:C02XYZ123",
    "t01abcdef:c02xyz123:1712345678.123456",
    "T01ABCDEF:X02XYZ123:1712345678.123456",
    "T01ABCDEF:C02XYZ123:1712345678.123456&path=../../x",
    "T01ABCDEF:C02XYZ123:1712345678.12345",
  ]) {
    assert.equal(isValidThreadId(bad), false, String(bad));
  }
});

test("safeFileName strips separators, traversal, control chars and leading dots", () => {
  assert.equal(safeFileName("report.pdf"), "report.pdf");
  assert.equal(safeFileName("../../etc/passwd"), "_._etc_passwd");
  assert.equal(safeFileName("a\\b/c\u0000d.txt"), "a_b_c_d.txt");
  assert.equal(safeFileName(".bashrc"), "bashrc");
  assert.equal(safeFileName("..."), "file");
  assert.equal(safeFileName(undefined), "file");
  assert.equal(safeFileName("x".repeat(300)).length, 120);
});

test("openRefusal only opens view-only types", () => {
  for (const ok of ["/a/doc.pdf", "/a/IMG.PNG", "/a/report.docx", "/a/clip.mov", "/a/notes.txt"]) {
    assert.equal(openRefusal(ok, 0o644, "darwin"), null, ok);
  }
  for (const bad of [
    "/a/bundle.zip",
    "/a/installer.dmg",
    "/a/link.webloc",
    "/a/macro.docm",
    "/a/macro.xlsm",
    "/a/page.html",
    "/a/logo.svg",
    "/a/run.command",
    "/a/SETUP.EXE",
    "/a/noext",
  ]) {
    assert.equal(openRefusal(bad, 0o644, "darwin"), "type", bad);
  }
});

test("openRefusal refuses exec-bit files on POSIX only", () => {
  assert.equal(openRefusal("/a/doc.pdf", 0o755, "darwin"), "executable");
  assert.equal(openRefusal("/a/doc.pdf", 0o755, "linux"), "executable");
  assert.equal(openRefusal("/a/doc.pdf", 0o755, "win32"), null);
});

test("quarantineValue matches the sidecar format (0081;hex epoch;AWOG;)", () => {
  assert.equal(quarantineValue(0x6a000000 * 1000 + 999), "0081;6a000000;AWOG;");
  assert.equal(ZONE_IDENTIFIER, "[ZoneTransfer]\r\nZoneId=3\r\n");
});

test("markDownloadedFromInternet is a no-op on Linux", async () => {
  // Đường dẫn không tồn tại: nếu hàm chạm filesystem thì sẽ ném.
  await markDownloadedFromInternet("/nonexistent/awog-test-file", "linux");
});

test("markDownloadedFromInternet re-applies com.apple.quarantine after a copy (macOS)", async (t) => {
  if (process.platform !== "darwin") return t.skip("macOS only");
  const dir = mkdtempSync(join(tmpdir(), "awog-slack-q-"));
  try {
    const file = join(dir, "report.pdf");
    writeFileSync(file, "x");
    await markDownloadedFromInternet(file, "darwin", 0x6a000000 * 1000);
    const got = execFileSync("xattr", ["-p", "com.apple.quarantine", file], { encoding: "utf8" }).trim();
    assert.equal(got, "0081;6a000000;AWOG;");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
