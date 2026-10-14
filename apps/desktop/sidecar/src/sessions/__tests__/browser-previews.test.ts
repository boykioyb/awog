// Thẻ xem trước trang của browser_tool: các cạnh thật của kho ảnh + phiếu tool_use.
//
// Cái cần khoá: (1) id lạ không bao giờ thành đường dẫn thoát khỏi thư mục thumbs,
// (2) sessionId độc không đi tới đĩa, (3) thiếu ảnh/thiếu meta là trạng thái bình
// thường chứ không phải lỗi, (4) phiếu theo scope không rò sang phiên khác.
//
// Run: `npx vitest run src/sessions/__tests__/browser-previews.test.ts`
import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_THUMB_BYTES,
  claimBrowserToolUse,
  noteBrowserToolUse,
  readBrowserPreview,
  saveBrowserPreview,
  thumbKey,
} from "../browser-previews.js";

const META = {
  url: "https://example.com/",
  title: "Example Domain",
  tabId: "tab_1",
};
const JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

let home: string;
let prevHome: string | undefined;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "awog-thumbs-"));
  prevHome = process.env.HOME;
  process.env.HOME = home;
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  await rm(home, { recursive: true, force: true });
});

describe("thumbKey", () => {
  it("giữ nguyên tool_use id hợp lệ", () => {
    expect(thumbKey("toolu_01AbC-x")).toBe("toolu_01AbC-x");
  });

  it("băm id có ký tự đường dẫn — không còn / \\ .. trong khoá", () => {
    for (const evil of [
      "../../etc/passwd",
      "a/b",
      "a\\b",
      "call_1|fc_2",
      "..",
      "x".repeat(65),
    ]) {
      const key = thumbKey(evil);
      expect(key).toMatch(/^h-[0-9a-f]{24}$/);
    }
  });
});

describe("save / read", () => {
  it("khứ hồi: ghi rồi đọc ra data URL + meta", async () => {
    await saveBrowserPreview("sess-1", "toolu_a", META, JPEG_B64);
    const got = await readBrowserPreview("sess-1", "toolu_a");
    expect(got).toMatchObject({ ...META, hasThumb: true });
    expect(got?.thumbDataUrl).toBe(`data:image/jpeg;base64,${JPEG_B64}`);
  });

  it("chụp lỗi (không ảnh): vẫn có meta, thumbDataUrl = null", async () => {
    await saveBrowserPreview("sess-1", "toolu_b", META, null);
    const got = await readBrowserPreview("sess-1", "toolu_b");
    expect(got).toMatchObject({ ...META, hasThumb: false, thumbDataUrl: null });
  });

  it("ảnh vượt cap bị bỏ, thẻ vẫn còn", async () => {
    const huge = Buffer.alloc(MAX_THUMB_BYTES + 1, 1).toString("base64");
    await saveBrowserPreview("sess-1", "toolu_c", META, huge);
    const got = await readBrowserPreview("sess-1", "toolu_c");
    expect(got?.hasThumb).toBe(false);
    expect(got?.thumbDataUrl).toBeNull();
  });

  it("chưa lưu gì cho step này ⇒ null (không ném)", async () => {
    expect(await readBrowserPreview("sess-1", "toolu_missing")).toBeNull();
  });

  it("ảnh bị xoá sau khi ghi meta ⇒ thẻ vẫn đọc được, không ảnh", async () => {
    await saveBrowserPreview("sess-1", "toolu_d", META, JPEG_B64);
    await rm(
      join(home, ".awog", "sessions", "sess-1", "thumbs", "toolu_d.jpg"),
    );
    const got = await readBrowserPreview("sess-1", "toolu_d");
    expect(got?.title).toBe(META.title);
    expect(got?.thumbDataUrl).toBeNull();
  });

  it("file ảnh bị thay bằng symlink ⇒ không đọc (lstat từ chối)", async () => {
    await saveBrowserPreview("sess-1", "toolu_e", META, JPEG_B64);
    const jpg = join(
      home,
      ".awog",
      "sessions",
      "sess-1",
      "thumbs",
      "toolu_e.jpg",
    );
    const secret = join(home, "secret.txt");
    await writeFile(secret, "TOP SECRET");
    await rm(jpg);
    await symlink(secret, jpg);
    const got = await readBrowserPreview("sess-1", "toolu_e");
    expect(got?.thumbDataUrl).toBeNull();
  });

  it("meta hỏng ⇒ null", async () => {
    await saveBrowserPreview("sess-1", "toolu_f", META, null);
    await writeFile(
      join(home, ".awog", "sessions", "sess-1", "thumbs", "toolu_f.json"),
      "{nope",
    );
    expect(await readBrowserPreview("sess-1", "toolu_f")).toBeNull();
  });
});

describe("path guard", () => {
  it("sessionId có traversal bị từ chối, không tạo gì trên đĩa", async () => {
    for (const evil of ["..", ".", "../x", "a/b", "a\\b", ""]) {
      await expect(
        saveBrowserPreview(evil, "toolu_a", META, JPEG_B64),
      ).rejects.toThrow();
      await expect(readBrowserPreview(evil, "toolu_a")).rejects.toThrow();
    }
    const entries = await readdir(home);
    expect(entries).not.toContain(".awog");
  });

  it("stepId độc được băm — file nằm trong thumbs/ của đúng session", async () => {
    await saveBrowserPreview("sess-1", "../../../escape", META, JPEG_B64);
    const files = await readdir(
      join(home, ".awog", "sessions", "sess-1", "thumbs"),
    );
    expect(files.every((f) => f.startsWith("h-"))).toBe(true);
    expect(
      (await readBrowserPreview("sess-1", "../../../escape"))?.thumbDataUrl,
    ).not.toBeNull();
  });
});

describe("phiếu tool_use", () => {
  const nav = { action: "navigate", url: "https://example.com/" };

  it("khớp theo dấu vân tay và chỉ dùng được một lần", () => {
    noteBrowserToolUse("s1", "toolu_1", nav);
    expect(claimBrowserToolUse("s1", nav)).toBe("toolu_1");
    expect(claimBrowserToolUse("s1", nav)).toBeUndefined();
  });

  it("không rò sang scope khác", () => {
    noteBrowserToolUse("s1", "toolu_2", nav);
    expect(claimBrowserToolUse("s2", nav)).toBeUndefined();
    expect(claimBrowserToolUse("s1", nav)).toBe("toolu_2");
  });

  it("hai lời gọi trùng nhau nhận theo thứ tự", () => {
    noteBrowserToolUse("s1", "toolu_3", nav);
    noteBrowserToolUse("s1", "toolu_4", nav);
    expect(claimBrowserToolUse("s1", nav)).toBe("toolu_3");
    expect(claimBrowserToolUse("s1", nav)).toBe("toolu_4");
  });

  it("action không mang thẻ (snapshot, navigate không url) không tạo phiếu", () => {
    noteBrowserToolUse("s1", "toolu_5", { action: "snapshot" });
    noteBrowserToolUse("s1", "toolu_6", { action: "navigate" });
    expect(claimBrowserToolUse("s1", { action: "snapshot" })).toBeUndefined();
    expect(claimBrowserToolUse("s1", { action: "navigate" })).toBeUndefined();
  });
});
