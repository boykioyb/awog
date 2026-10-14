// Chính sách tự nén của CLI → env (ADR 0099). Con số 13_000 / [100k, 1M] là thứ ĐO
// được trên CLI 0.3.296 (xem chú thích autoCompactEnv) — test này khoá cách ánh xạ
// "nén ở ~N token" sang cửa sổ hiệu dụng, không khoá hành vi của CLI.
//
// Run: `npx vitest run src/runtime/claude-sdk/__tests__/auto-compact-env.test.ts`
import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPACT_AT_TOKENS,
  autoCompactEnv,
  autoCompactFromContext,
  buildSdkEnv,
} from "../shared.js";

describe("autoCompactEnv", () => {
  it("mặc định (vắng cấu hình): bật, ~300k ⇒ window = 300k + 13k dự trữ", () => {
    expect(autoCompactEnv(autoCompactFromContext(undefined))).toEqual({
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: String(
        DEFAULT_COMPACT_AT_TOKENS + 13_000,
      ),
    });
  });

  it("tắt ⇒ chỉ DISABLE_AUTO_COMPACT, không đặt window", () => {
    expect(autoCompactEnv({ enabled: false, atTokens: 200_000 })).toEqual({
      DISABLE_AUTO_COMPACT: "1",
    });
  });

  it("0 = mặc định của CLI ⇒ không đặt biến nào", () => {
    expect(autoCompactEnv({ atTokens: 0 })).toEqual({});
  });

  it("kẹp vào [100k, 1M] như CLI (dưới sàn không có nghĩa)", () => {
    expect(autoCompactEnv({ atTokens: 20_000 })).toEqual({
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: "100000",
    });
    expect(autoCompactEnv({ atTokens: 5_000_000 })).toEqual({
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: "1000000",
    });
  });
});

describe("buildSdkEnv — autoCompact", () => {
  const cred = { kind: "apikey" as const, apiKey: "k" };

  it("không truyền autoCompact ⇒ không đụng env tự nén (đường CLI PTY của người dùng)", () => {
    const env = buildSdkEnv(cred, undefined, { PATH: "/bin" });
    expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined();
    expect(env.DISABLE_AUTO_COMPACT).toBeUndefined();
  });

  it("chính sách của AWOG thắng biến lỡ nằm trong env gốc", () => {
    const env = buildSdkEnv(
      cred,
      undefined,
      { DISABLE_AUTO_COMPACT: "1", CLAUDE_CODE_AUTO_COMPACT_WINDOW: "123456" },
      { atTokens: 150_000 },
    );
    expect(env.DISABLE_AUTO_COMPACT).toBeUndefined();
    expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("163000");
  });
});
