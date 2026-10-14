// Store bookmark của trình duyệt nhúng — mỗi profile một file
// `~/.awog/browser/profiles/<id>/bookmarks.json`. Một cấp thư mục (thư mục không
// chứa thư mục), URL chỉ http/https, trần 500 mục tính cả thư mục lẫn bookmark.
// Thay thế cơ chế "pin" cũ (localStorage ở renderer).

import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { log } from "../util/logger.js";
import { readTextOrNull, serialized, writeJsonAtomic } from "./fs-util.js";
import {
  assertProfileId,
  BrowserProfileError,
  profileDir,
  profileExists,
} from "./profiles.js";

export const MAX_BOOKMARKS = 500;
export const MAX_TITLE = 200;
export const MAX_URL = 2048;

export interface UrlBookmark {
  id: string;
  kind: "url";
  title: string;
  url: string;
  createdAt: string;
}
export interface FolderBookmark {
  id: string;
  kind: "folder";
  title: string;
  createdAt: string;
  children: UrlBookmark[];
}
export type BookmarkNode = UrlBookmark | FolderBookmark;

const UrlSchema: z.ZodType<UrlBookmark> = z.object({
  id: z.string(),
  kind: z.literal("url"),
  title: z.string(),
  url: z.string(),
  createdAt: z.string(),
});
const FileSchema = z.object({
  version: z.literal(1),
  items: z.array(
    z.union([
      UrlSchema,
      z.object({
        id: z.string(),
        kind: z.literal("folder"),
        title: z.string(),
        createdAt: z.string(),
        children: z.array(UrlSchema),
      }),
    ]),
  ),
});

function bookmarksFile(profileId: string): string {
  return join(profileDir(profileId), "bookmarks.json");
}

function countAll(items: BookmarkNode[]): number {
  return items.reduce(
    (n, it) => n + 1 + (it.kind === "folder" ? it.children.length : 0),
    0,
  );
}

// http/https thôi: `javascript:`/`file:`/`data:` mở từ thanh bookmark là bề mặt
// tấn công (L1 — URL do UI/agent gửi tới).
export function normalizeBookmarkUrl(raw: string): string {
  const text = raw.trim();
  if (text.length < 1 || text.length > MAX_URL) {
    throw new BrowserProfileError(
      `Bookmark URL must be 1–${MAX_URL} characters`,
    );
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new BrowserProfileError(`Invalid bookmark URL: ${text.slice(0, 80)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BrowserProfileError("Bookmark URL must be http or https");
  }
  return text;
}

function cleanTitle(raw: string, fallback: string): string {
  const t = raw.trim();
  if (t.length > MAX_TITLE)
    throw new BrowserProfileError(
      `Bookmark title must be ≤ ${MAX_TITLE} characters`,
    );
  return t.length > 0 ? t : fallback.slice(0, MAX_TITLE);
}

function newId(): string {
  return `bm-${randomBytes(6).toString("hex")}`;
}

async function requireProfile(profileId: string): Promise<string> {
  const id = assertProfileId(profileId);
  if (!(await profileExists(id)))
    throw new BrowserProfileError(`Browser profile not found: ${id}`);
  return id;
}

async function load(profileId: string): Promise<BookmarkNode[]> {
  const raw = await readTextOrNull(bookmarksFile(profileId));
  if (raw === null) return [];
  try {
    const res = FileSchema.safeParse(JSON.parse(raw));
    if (res.success) return res.data.items;
    log.warn("bookmarks: invalid bookmarks.json, treating as empty", {
      profileId,
    });
  } catch (err) {
    log.warn("bookmarks: unreadable bookmarks.json, treating as empty", {
      profileId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return [];
}

async function save(profileId: string, items: BookmarkNode[]): Promise<void> {
  await writeJsonAtomic(bookmarksFile(profileId), { version: 1, items });
}

// Đọc-sửa-ghi tuần tự trên một profile. `fn` trả `node` (nếu có) để UI chọn dòng vừa đổi.
async function mutate(
  profileId: string,
  fn: (items: BookmarkNode[]) => BookmarkNode | undefined,
): Promise<{ items: BookmarkNode[]; node?: BookmarkNode }> {
  return serialized(async () => {
    const id = await requireProfile(profileId);
    const items = await load(id);
    const node = fn(items);
    await save(id, items);
    return node ? { items, node } : { items };
  });
}

function requireFolder(
  items: BookmarkNode[],
  folderId: string,
): FolderBookmark {
  const f = items.find((it) => it.id === folderId);
  if (!f || f.kind !== "folder")
    throw new BrowserProfileError(`Bookmark folder not found: ${folderId}`);
  return f;
}

function assertRoom(items: BookmarkNode[], extra: number): void {
  if (countAll(items) + extra > MAX_BOOKMARKS) {
    throw new BrowserProfileError(`At most ${MAX_BOOKMARKS} bookmarks`);
  }
}

export async function listBookmarks(
  profileId: string,
): Promise<{ items: BookmarkNode[] }> {
  const id = await requireProfile(profileId);
  return { items: await load(id) };
}

export function addBookmark(input: {
  profileId: string;
  url: string;
  title: string;
  folderId?: string | undefined;
}): Promise<{ items: BookmarkNode[]; node?: BookmarkNode }> {
  return mutate(input.profileId, (items) => {
    const url = normalizeBookmarkUrl(input.url);
    const node: UrlBookmark = {
      id: newId(),
      kind: "url",
      title: cleanTitle(input.title, url),
      url,
      createdAt: new Date().toISOString(),
    };
    assertRoom(items, 1);
    if (input.folderId !== undefined)
      requireFolder(items, input.folderId).children.push(node);
    else items.push(node);
    return node;
  });
}

export function addBookmarkFolder(input: {
  profileId: string;
  title: string;
}): Promise<{ items: BookmarkNode[]; node?: BookmarkNode }> {
  return mutate(input.profileId, (items) => {
    const title = cleanTitle(input.title, "");
    if (title.length === 0)
      throw new BrowserProfileError("Folder title is required");
    const node: FolderBookmark = {
      id: newId(),
      kind: "folder",
      title,
      createdAt: new Date().toISOString(),
      children: [],
    };
    assertRoom(items, 1);
    items.push(node);
    return node;
  });
}

interface Located {
  container: BookmarkNode[];
  index: number;
  node: BookmarkNode;
  parent: FolderBookmark | null;
}

function locate(items: BookmarkNode[], id: string): Located | null {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it) continue;
    if (it.id === id)
      return { container: items, index: i, node: it, parent: null };
    if (it.kind === "folder") {
      const j = it.children.findIndex((c) => c.id === id);
      const child = it.children[j];
      if (child)
        return { container: it.children, index: j, node: child, parent: it };
    }
  }
  return null;
}

// `folderId`: undefined = không di chuyển · null = về gốc · string = vào thư mục.
// `index`: vị trí trong container đích (kẹp vào [0, length]).
export function updateBookmark(input: {
  profileId: string;
  id: string;
  title?: string | undefined;
  url?: string | undefined;
  folderId?: string | null | undefined;
  index?: number | undefined;
}): Promise<{ items: BookmarkNode[]; node?: BookmarkNode }> {
  return mutate(input.profileId, (items) => {
    const at = locate(items, input.id);
    if (!at) throw new BrowserProfileError(`Bookmark not found: ${input.id}`);
    const node = at.node;
    if (input.title !== undefined) {
      node.title = cleanTitle(
        input.title,
        node.kind === "url" ? node.url : node.title,
      );
    }
    if (input.url !== undefined) {
      if (node.kind !== "url")
        throw new BrowserProfileError("A folder has no URL");
      node.url = normalizeBookmarkUrl(input.url);
    }
    if (input.folderId === undefined && input.index === undefined) return node;

    // Chọn container đích TRƯỚC khi gỡ khỏi nguồn để lỗi không làm mất node.
    let dest: BookmarkNode[];
    if (input.folderId === undefined) {
      dest = at.container;
    } else if (input.folderId === null) {
      dest = items;
    } else {
      if (node.kind === "folder")
        throw new BrowserProfileError("Folders cannot be nested");
      if (input.folderId === node.id)
        throw new BrowserProfileError("Cannot move into itself");
      dest = requireFolder(items, input.folderId).children;
    }
    at.container.splice(at.index, 1);
    const idx = Math.max(0, Math.min(input.index ?? dest.length, dest.length));
    // `dest` là mảng children (chỉ url) khi vào thư mục; kiểu kết quả an toàn vì node.kind==='url'.
    (dest as BookmarkNode[]).splice(idx, 0, node);
    return node;
  });
}

export function removeBookmark(input: {
  profileId: string;
  id: string;
}): Promise<{ items: BookmarkNode[]; node?: BookmarkNode }> {
  return mutate(input.profileId, (items) => {
    const at = locate(items, input.id);
    if (!at) throw new BrowserProfileError(`Bookmark not found: ${input.id}`);
    at.container.splice(at.index, 1);
    return undefined;
  });
}

// Nhập các "pin" cũ (localStorage) một lần. Idempotent theo URL: URL đã có ở gốc
// hoặc trong thư mục nào thì bỏ qua; pin sai URL bị bỏ; dừng khi chạm trần.
export function importPins(input: {
  profileId: string;
  pins: { url: string; title: string }[];
}): Promise<{ items: BookmarkNode[]; added: number }> {
  return serialized(async () => {
    const id = await requireProfile(input.profileId);
    const items = await load(id);
    const seen = new Set<string>();
    for (const it of items) {
      if (it.kind === "url") seen.add(it.url);
      else for (const c of it.children) seen.add(c.url);
    }
    let added = 0;
    for (const pin of input.pins) {
      let url: string;
      try {
        url = normalizeBookmarkUrl(pin.url);
      } catch {
        continue;
      }
      if (seen.has(url)) continue;
      if (countAll(items) >= MAX_BOOKMARKS) break;
      let title: string;
      try {
        title = cleanTitle(pin.title, url);
      } catch {
        title = url.slice(0, MAX_TITLE);
      }
      items.push({
        id: newId(),
        kind: "url",
        title,
        url,
        createdAt: new Date().toISOString(),
      });
      seen.add(url);
      added += 1;
    }
    if (added > 0) await save(id, items);
    return { items, added };
  });
}
