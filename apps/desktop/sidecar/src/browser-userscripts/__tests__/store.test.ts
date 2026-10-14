// Run: npx vitest run src/browser-userscripts/__tests__/store.test.ts
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTempHome } from "../../browser-profiles/__tests__/helpers.js";
import { browserDir } from "../../browser-profiles/profiles.js";
import {
  getUserscriptSource,
  hostSnapshot,
  installUserscript,
  listUserscripts,
  MAX_SCRIPTS,
  removeUserscript,
  saveUserscript,
  setUserscriptEnabled,
} from "../store.js";

let cleanup: () => Promise<void>;
beforeEach(async () => {
  cleanup = await useTempHome();
});
afterEach(async () => {
  await cleanup();
});

const script = (
  name: string,
  extra: string[] = ["@match https://example.com/*"],
): string =>
  `// ==UserScript==\n// @name ${name}\n${extra.map((l) => `// ${l}`).join("\n")}\n// ==/UserScript==\nconsole.log('${name}')\n`;

const dir = (): string => join(browserDir(), "userscripts");
const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false,
  );

describe("userscript store", () => {
  it("rỗng khi chưa có gì", async () => {
    expect(await listUserscripts()).toEqual([]);
    expect(await hostSnapshot()).toEqual([]);
  });

  it("tạo → ghi file .user.js + index.json, id us-<8hex>, mặc định bật", async () => {
    const src = script("One");
    const item = await saveUserscript({ source: src });
    expect(item.id).toMatch(/^us-[0-9a-f]{8}$/);
    expect(item.enabled).toBe(true);
    expect(item.meta.name).toBe("One");
    expect(await readFile(join(dir(), `${item.id}.user.js`), "utf8")).toBe(src);
    const index = JSON.parse(await readFile(join(dir(), "index.json"), "utf8"));
    expect(index.version).toBe(1);
    expect(index.scripts).toHaveLength(1);
    expect(index.scripts[0]).toMatchObject({ id: item.id, enabled: true });
    expect(await getUserscriptSource(item.id)).toBe(src);
    expect((await listUserscripts()).map((s) => s.id)).toEqual([item.id]);
  });

  it("cập nhật giữ id + createdAt, đổi metadata", async () => {
    const a = await saveUserscript({ source: script("Old") });
    const b = await saveUserscript({ id: a.id, source: script("New") });
    expect(b.id).toBe(a.id);
    expect(b.meta.name).toBe("New");
    const index = JSON.parse(await readFile(join(dir(), "index.json"), "utf8"));
    expect(index.scripts).toHaveLength(1);
    expect((await listUserscripts())[0]?.meta.name).toBe("New");
  });

  it("source hỏng bị từ chối và không ghi gì", async () => {
    await expect(saveUserscript({ source: "console.log(1)" })).rejects.toThrow(
      /header/,
    );
    await expect(
      saveUserscript({ source: script("X").replace("@name X", "") }),
    ).rejects.toThrow(/@name/);
    await expect(
      saveUserscript({ id: "us-00000000", source: script("X") }),
    ).rejects.toThrow(/not found/);
    expect(await exists(join(dir(), "index.json"))).toBe(false);
  });

  it("quá 512KB bị từ chối", async () => {
    const big = `${script("Big")}//${"x".repeat(512 * 1024)}\n`;
    await expect(saveUserscript({ source: big })).rejects.toThrow(/512KB/);
  });

  it("tối đa 200 script", async () => {
    for (let i = 0; i < MAX_SCRIPTS; i += 1)
      await saveUserscript({ source: script(`S${i}`) });
    await expect(saveUserscript({ source: script("over") })).rejects.toThrow(
      /At most 200/,
    );
  }, 30_000);

  it("setEnabled + hostSnapshot: script tắt không mang source", async () => {
    const a = await saveUserscript({ source: script("A") });
    const b = await saveUserscript({ source: script("B") });
    const off = await setUserscriptEnabled(b.id, false);
    expect(off.enabled).toBe(false);
    const snap = await hostSnapshot();
    expect(snap.map((s) => [s.id, s.enabled, s.source !== ""])).toEqual([
      [a.id, true, true],
      [b.id, false, false],
    ]);
    expect(snap[0]?.rules.include).toHaveLength(1);
    await setUserscriptEnabled(b.id, true);
    expect((await hostSnapshot())[1]?.source).toContain("console.log('B')");
  });

  it("xoá bỏ file + dòng index; xoá lại → lỗi", async () => {
    const a = await saveUserscript({ source: script("A") });
    await removeUserscript(a.id);
    expect(await exists(join(dir(), `${a.id}.user.js`))).toBe(false);
    expect(await listUserscripts()).toEqual([]);
    await expect(removeUserscript(a.id)).rejects.toThrow(/not found/);
  });

  it("id sai định dạng bị chặn (không chạm đường dẫn)", async () => {
    await expect(getUserscriptSource("../../etc/passwd")).rejects.toThrow(
      /Invalid userscript id/,
    );
    await expect(removeUserscript("us-ZZZZZZZZ")).rejects.toThrow(
      /Invalid userscript id/,
    );
  });

  it("installUserscript: cùng namespace+name → cập nhật tại chỗ, giữ cờ tắt", async () => {
    const first = await installUserscript(
      script("Dup", ["@namespace n", "@match <all_urls>"]),
    );
    await setUserscriptEnabled(first.id, false);
    const again = await installUserscript(
      script("Dup", ["@namespace n", "@version 2", "@match <all_urls>"]),
    );
    expect(again.id).toBe(first.id);
    expect(again.enabled).toBe(false);
    expect(again.meta.version).toBe("2");
    const other = await installUserscript(
      script("Dup", ["@namespace other", "@match <all_urls>"]),
    );
    expect(other.id).not.toBe(first.id);
    expect(await listUserscripts()).toHaveLength(2);
  });

  it("file bị sửa tay thành thứ không phải userscript bị bỏ khỏi list", async () => {
    const a = await saveUserscript({ source: script("A") });
    const b = await saveUserscript({ source: script("B") });
    await writeFile(join(dir(), `${a.id}.user.js`), "nothing here");
    // Cache theo updatedAt nên ép đọc lại bằng cách đổi updatedAt (setEnabled).
    await expect(setUserscriptEnabled(a.id, true)).rejects.toThrow(
      /unreadable/,
    );
    expect((await listUserscripts()).map((s) => s.id)).toEqual([b.id]);
  });
});
