// Run: npx vitest run src/browser-userscripts/__tests__/fetch.test.ts
// Chỉ các nhánh bị chặn TRƯỚC khi mở kết nối (không cần mạng).
import { describe, expect, it } from "vitest";
import { fetchUserscriptSource } from "../fetch.js";

describe("fetchUserscriptSource — cổng chặn", () => {
  it("chặn loopback / IP nội bộ / localhost", async () => {
    await expect(
      fetchUserscriptSource("https://127.0.0.1/a.user.js"),
    ).rejects.toThrow(/blocked URL/);
    await expect(
      fetchUserscriptSource("https://10.0.0.5/a.user.js"),
    ).rejects.toThrow(/blocked URL/);
    await expect(
      fetchUserscriptSource("https://localhost/a.user.js"),
    ).rejects.toThrow(/blocked URL/);
  });

  it("chỉ https", async () => {
    await expect(
      fetchUserscriptSource("http://1.2.3.4/a.user.js"),
    ).rejects.toThrow(/https/);
  });

  it("scheme lạ và URL hỏng", async () => {
    await expect(fetchUserscriptSource("file:///etc/passwd")).rejects.toThrow(
      /blocked URL/,
    );
    await expect(fetchUserscriptSource("not a url")).rejects.toThrow(
      /blocked URL/,
    );
  });
});
