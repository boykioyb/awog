// Run: npx vitest run src/browser-profiles/__tests__/bookmarks.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addBookmark,
  addBookmarkFolder,
  importPins,
  listBookmarks,
  MAX_BOOKMARKS,
  MAX_TITLE,
  removeBookmark,
  updateBookmark,
  type BookmarkNode,
} from "../bookmarks.js";
import { createProfile } from "../profiles.js";
import { useTempHome } from "./helpers.js";

let cleanup: () => Promise<void>;
beforeEach(async () => {
  cleanup = await useTempHome();
});
afterEach(async () => {
  await cleanup();
});

const P = "default";
const titles = (items: BookmarkNode[]): string[] => items.map((i) => i.title);

describe("bookmarks store", () => {
  it("lists empty, adds, persists", async () => {
    expect((await listBookmarks(P)).items).toEqual([]);
    const { node } = await addBookmark({
      profileId: P,
      url: "https://a.test/x",
      title: "A",
    });
    expect(node).toMatchObject({
      kind: "url",
      title: "A",
      url: "https://a.test/x",
    });
    expect((await listBookmarks(P)).items).toHaveLength(1);
  });

  it("falls back to the URL when the title is blank", async () => {
    const { node } = await addBookmark({
      profileId: P,
      url: "https://a.test/",
      title: "  ",
    });
    expect(node?.title).toBe("https://a.test/");
  });

  it("validates URL scheme and length, title length", async () => {
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,x",
      "nope",
      "",
    ]) {
      await expect(
        addBookmark({ profileId: P, url, title: "t" }),
      ).rejects.toThrow();
    }
    await expect(
      addBookmark({
        profileId: P,
        url: `https://a.test/${"x".repeat(2100)}`,
        title: "t",
      }),
    ).rejects.toThrow(/URL/);
    await expect(
      addBookmark({
        profileId: P,
        url: "https://a.test",
        title: "x".repeat(MAX_TITLE + 1),
      }),
    ).rejects.toThrow(/title/);
    expect((await listBookmarks(P)).items).toEqual([]);
  });

  it("supports one level of folders and adds into a folder", async () => {
    const { node: f } = await addBookmarkFolder({
      profileId: P,
      title: "Docs",
    });
    const { node: b } = await addBookmark({
      profileId: P,
      url: "https://a.test",
      title: "A",
      folderId: f!.id,
    });
    const { items } = await listBookmarks(P);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "folder" });
    expect(
      (items[0] as Extract<BookmarkNode, { kind: "folder" }>).children[0]?.id,
    ).toBe(b!.id);
    await expect(
      addBookmark({
        profileId: P,
        url: "https://b.test",
        title: "B",
        folderId: b!.id,
      }),
    ).rejects.toThrow(/folder not found/);
    await expect(
      addBookmark({
        profileId: P,
        url: "https://b.test",
        title: "B",
        folderId: "nope",
      }),
    ).rejects.toThrow(/folder not found/);
  });

  it("forbids a folder inside a folder, and a folder has no URL", async () => {
    const { node: f1 } = await addBookmarkFolder({ profileId: P, title: "F1" });
    const { node: f2 } = await addBookmarkFolder({ profileId: P, title: "F2" });
    await expect(
      updateBookmark({ profileId: P, id: f2!.id, folderId: f1!.id }),
    ).rejects.toThrow(/nested/);
    await expect(
      updateBookmark({ profileId: P, id: f1!.id, url: "https://a.test" }),
    ).rejects.toThrow(/no URL/);
    expect(titles((await listBookmarks(P)).items)).toEqual(["F1", "F2"]);
  });

  it("moves between root and folder, reorders, edits", async () => {
    const { node: f } = await addBookmarkFolder({ profileId: P, title: "F" });
    const { node: a } = await addBookmark({
      profileId: P,
      url: "https://a.test",
      title: "A",
    });
    const { node: b } = await addBookmark({
      profileId: P,
      url: "https://b.test",
      title: "B",
    });

    await updateBookmark({ profileId: P, id: a!.id, folderId: f!.id });
    let items = (await listBookmarks(P)).items;
    expect(titles(items)).toEqual(["F", "B"]);
    expect(
      (items[0] as Extract<BookmarkNode, { kind: "folder" }>).children.map(
        (c) => c.id,
      ),
    ).toEqual([a!.id]);

    await updateBookmark({ profileId: P, id: a!.id, folderId: null, index: 0 });
    items = (await listBookmarks(P)).items;
    expect(titles(items)).toEqual(["A", "F", "B"]);

    await updateBookmark({ profileId: P, id: b!.id, index: 0 }); // reorder in place
    expect(titles((await listBookmarks(P)).items)).toEqual(["B", "A", "F"]);

    const { node } = await updateBookmark({
      profileId: P,
      id: a!.id,
      title: "A2",
      url: "https://a2.test",
    });
    expect(node).toMatchObject({ title: "A2", url: "https://a2.test" });
    await expect(
      updateBookmark({ profileId: P, id: a!.id, url: "javascript:1" }),
    ).rejects.toThrow();
    await expect(
      updateBookmark({ profileId: P, id: "missing", title: "x" }),
    ).rejects.toThrow(/not found/);
    // a failed move must not lose the node
    await expect(
      updateBookmark({ profileId: P, id: a!.id, folderId: "nope" }),
    ).rejects.toThrow();
    expect(titles((await listBookmarks(P)).items)).toContain("A2");
  });

  it("removes bookmarks and folders (with children)", async () => {
    const { node: f } = await addBookmarkFolder({ profileId: P, title: "F" });
    const { node: a } = await addBookmark({
      profileId: P,
      url: "https://a.test",
      title: "A",
      folderId: f!.id,
    });
    await removeBookmark({ profileId: P, id: a!.id });
    expect((await listBookmarks(P)).items).toHaveLength(1);
    await removeBookmark({ profileId: P, id: f!.id });
    expect((await listBookmarks(P)).items).toEqual([]);
    await expect(removeBookmark({ profileId: P, id: f!.id })).rejects.toThrow(
      /not found/,
    );
  });

  it("enforces the item cap (folders + children count)", async () => {
    const pins = Array.from({ length: MAX_BOOKMARKS }, (_, i) => ({
      url: `https://a.test/${i}`,
      title: `t${i}`,
    }));
    // importPins only takes what fits; use it to fill quickly.
    const { added } = await importPins({ profileId: P, pins });
    expect(added).toBe(MAX_BOOKMARKS);
    await expect(
      addBookmark({ profileId: P, url: "https://z.test", title: "z" }),
    ).rejects.toThrow(/At most/);
    await expect(
      addBookmarkFolder({ profileId: P, title: "f" }),
    ).rejects.toThrow(/At most/);
    expect(
      (
        await importPins({
          profileId: P,
          pins: [{ url: "https://z.test", title: "z" }],
        })
      ).added,
    ).toBe(0);
  });

  it("importPins is idempotent by URL and skips invalid pins", async () => {
    const pins = [
      { url: "https://a.test", title: "A" },
      { url: "https://a.test", title: "A dup" },
      { url: "javascript:alert(1)", title: "bad" },
      { url: "https://b.test", title: "" },
    ];
    const first = await importPins({ profileId: P, pins });
    expect(first.added).toBe(2);
    expect(titles(first.items)).toEqual(["A", "https://b.test"]);
    const second = await importPins({ profileId: P, pins });
    expect(second.added).toBe(0);
    expect((await listBookmarks(P)).items).toHaveLength(2);
  });

  it("importPins skips URLs already inside a folder", async () => {
    const { node: f } = await addBookmarkFolder({ profileId: P, title: "F" });
    await addBookmark({
      profileId: P,
      url: "https://a.test",
      title: "A",
      folderId: f!.id,
    });
    const res = await importPins({
      profileId: P,
      pins: [{ url: "https://a.test", title: "A" }],
    });
    expect(res.added).toBe(0);
  });

  it("keeps bookmarks per profile and rejects unknown / traversal profile ids", async () => {
    const other = await createProfile({ name: "Other" });
    await addBookmark({ profileId: P, url: "https://a.test", title: "A" });
    expect((await listBookmarks(other.id)).items).toEqual([]);
    await expect(listBookmarks("p-deadbeef")).rejects.toThrow(/not found/);
    for (const bad of ["../x", "..", "a/b", "", "."]) {
      await expect(listBookmarks(bad)).rejects.toThrow(
        /Invalid browser profile id/,
      );
      await expect(
        addBookmark({ profileId: bad, url: "https://a.test", title: "A" }),
      ).rejects.toThrow(/Invalid browser profile id/);
    }
  });
});
