// Store userscript của trình duyệt nhúng (GLOBAL — dùng cho mọi profile trình duyệt):
//   ~/.awog/browser/userscripts/<id>.user.js   — nguyên văn source (kèm header)
//   ~/.awog/browser/userscripts/index.json     — { version:1, scripts: [{id, enabled, createdAt, updatedAt}] }
// Metadata KHÔNG nằm trong index: nó suy ra từ header mỗi lần đọc (có cache theo
// `updatedAt`) nên sửa file bằng tay không làm lệch.
// Tài liệu: docs/features/browser-userscripts.md

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { log } from "../util/logger.js";
import { sanitizeChild } from "../util/path.js";
import { browserDir } from "../browser-profiles/profiles.js";
import {
  readTextOrNull,
  serialized,
  writeJsonAtomic,
} from "../browser-profiles/fs-util.js";
import {
  compileRules,
  parseUserscript,
  UserscriptError,
  type CompiledRules,
  type UserscriptMeta,
} from "./meta.js";

export const MAX_SOURCE_BYTES = 512 * 1024;
export const MAX_SCRIPTS = 200;

const ID_RE = /^us-[0-9a-f]{8}$/;

const IndexSchema = z.object({
  version: z.literal(1),
  scripts: z.array(
    z.object({
      id: z.string().regex(ID_RE),
      enabled: z.boolean(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
});
type IndexEntry = z.infer<typeof IndexSchema>["scripts"][number];

export type UserscriptItem = {
  id: string;
  enabled: boolean;
  meta: UserscriptMeta;
  warnings: string[];
  updatedAt: string;
};

// Bản đẩy sang Electron main: luật đã biên dịch + source (chỉ khi bật — script tắt
// không cần đi qua dây, main chỉ cần biết nó khớp trang nào để hiện trong menu).
export type HostUserscript = {
  id: string;
  enabled: boolean;
  meta: UserscriptMeta;
  rules: Pick<CompiledRules, "include" | "exclude">;
  source: string;
};

export function assertUserscriptId(id: unknown): string {
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new UserscriptError(`Invalid userscript id: ${String(id)}`);
  }
  return id;
}

function scriptsDir(): string {
  return join(browserDir(), sanitizeChild("userscripts"));
}

function indexFile(): string {
  return join(scriptsDir(), "index.json");
}

function sourceFile(id: string): string {
  return join(scriptsDir(), `${sanitizeChild(assertUserscriptId(id))}.user.js`);
}

async function readIndex(): Promise<IndexEntry[]> {
  const raw = await readTextOrNull(indexFile());
  if (raw === null) return [];
  try {
    const res = IndexSchema.safeParse(JSON.parse(raw));
    if (res.success) return res.data.scripts;
    log.warn("userscripts: invalid index.json, treating as empty", {});
  } catch (err) {
    log.warn("userscripts: unreadable index.json, treating as empty", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return [];
}

function writeIndex(scripts: IndexEntry[]): Promise<void> {
  return writeJsonAtomic(indexFile(), { version: 1, scripts });
}

async function writeSourceAtomic(id: string, source: string): Promise<void> {
  const file = sourceFile(id);
  await mkdir(scriptsDir(), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, source, { mode: 0o600 });
  await rename(tmp, file);
}

// Parse tốn I/O + regex: nhớ theo (id, updatedAt) cho tới khi script được lưu lại.
const parseCache = new Map<
  string,
  {
    updatedAt: string;
    source: string;
    meta: UserscriptMeta;
    warnings: string[];
  }
>();

async function loadParsed(entry: IndexEntry): Promise<{
  source: string;
  meta: UserscriptMeta;
  warnings: string[];
} | null> {
  const cached = parseCache.get(entry.id);
  if (cached && cached.updatedAt === entry.updatedAt) return cached;
  let source: string;
  try {
    source = await readFile(sourceFile(entry.id), "utf8");
  } catch (err) {
    log.warn("userscripts: source file unreadable, skipping", {
      id: entry.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  try {
    const { meta, warnings } = parseUserscript(source);
    const parsed = { updatedAt: entry.updatedAt, source, meta, warnings };
    parseCache.set(entry.id, parsed);
    return parsed;
  } catch (err) {
    // File bị sửa tay thành thứ không còn là userscript: bỏ khỏi danh sách thay vì
    // làm hỏng cả `list`.
    log.warn("userscripts: stored source no longer parses, skipping", {
      id: entry.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function listUserscripts(): Promise<UserscriptItem[]> {
  const out: UserscriptItem[] = [];
  for (const entry of await readIndex()) {
    const parsed = await loadParsed(entry);
    if (!parsed) continue;
    out.push({
      id: entry.id,
      enabled: entry.enabled,
      meta: parsed.meta,
      warnings: parsed.warnings,
      updatedAt: entry.updatedAt,
    });
  }
  return out;
}

export async function getUserscriptSource(id: string): Promise<string> {
  assertUserscriptId(id);
  const entry = (await readIndex()).find((e) => e.id === id);
  if (!entry) throw new UserscriptError(`Userscript not found: ${id}`);
  const parsed = await loadParsed(entry);
  if (!parsed)
    throw new UserscriptError(`Userscript source is unreadable: ${id}`);
  return parsed.source;
}

// Tập đẩy sang main: mọi script (kèm cờ bật); source chỉ có ở script đang bật.
export async function hostSnapshot(): Promise<HostUserscript[]> {
  const out: HostUserscript[] = [];
  for (const entry of await readIndex()) {
    const parsed = await loadParsed(entry);
    if (!parsed) continue;
    const rules = compileRules(parsed.meta);
    out.push({
      id: entry.id,
      enabled: entry.enabled,
      meta: parsed.meta,
      rules: { include: rules.include, exclude: rules.exclude },
      source: entry.enabled ? parsed.source : "",
    });
  }
  return out;
}

function checkSource(source: string): {
  meta: UserscriptMeta;
  warnings: string[];
} {
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
    throw new UserscriptError(
      `Script is larger than ${MAX_SOURCE_BYTES / 1024}KB`,
    );
  }
  return parseUserscript(source);
}

// Tạo (không `id`) hoặc cập nhật (có `id`). `enabled` khi tạo mặc định true.
export function saveUserscript(input: {
  id?: string;
  source: string;
  enabled?: boolean;
}): Promise<UserscriptItem> {
  return serialized(async () => {
    const { meta, warnings } = checkSource(input.source);
    const index = await readIndex();
    const now = new Date().toISOString();
    let entry: IndexEntry;
    if (input.id !== undefined) {
      assertUserscriptId(input.id);
      const found = index.find((e) => e.id === input.id);
      if (!found)
        throw new UserscriptError(`Userscript not found: ${input.id}`);
      found.updatedAt = now;
      if (input.enabled !== undefined) found.enabled = input.enabled;
      entry = found;
    } else {
      if (index.length >= MAX_SCRIPTS) {
        throw new UserscriptError(`At most ${MAX_SCRIPTS} userscripts`);
      }
      let id = "";
      do id = `us-${randomBytes(4).toString("hex")}`;
      while (index.some((e) => e.id === id));
      entry = {
        id,
        enabled: input.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      };
      index.push(entry);
    }
    await writeSourceAtomic(entry.id, input.source);
    await writeIndex(index);
    parseCache.set(entry.id, {
      updatedAt: entry.updatedAt,
      source: input.source,
      meta,
      warnings,
    });
    return {
      id: entry.id,
      enabled: entry.enabled,
      meta,
      warnings,
      updatedAt: entry.updatedAt,
    };
  });
}

// Cài lại từ URL: cùng `@namespace` + `@name` với script đã có ⇒ cập nhật tại chỗ
// (giữ cờ bật) thay vì sinh bản trùng — giống Tampermonkey.
export async function installUserscript(
  source: string,
): Promise<UserscriptItem> {
  const { meta } = checkSource(source);
  for (const existing of await listUserscripts()) {
    if (
      existing.meta.name === meta.name &&
      existing.meta.namespace === meta.namespace
    ) {
      return saveUserscript({ id: existing.id, source });
    }
  }
  return saveUserscript({ source });
}

export function setUserscriptEnabled(
  id: string,
  enabled: boolean,
): Promise<UserscriptItem> {
  return serialized(async () => {
    assertUserscriptId(id);
    const index = await readIndex();
    const entry = index.find((e) => e.id === id);
    if (!entry) throw new UserscriptError(`Userscript not found: ${id}`);
    entry.enabled = enabled;
    entry.updatedAt = new Date().toISOString();
    await writeIndex(index);
    const parsed = await loadParsed(entry);
    if (!parsed)
      throw new UserscriptError(`Userscript source is unreadable: ${id}`);
    return {
      id: entry.id,
      enabled,
      meta: parsed.meta,
      warnings: parsed.warnings,
      updatedAt: entry.updatedAt,
    };
  });
}

export function removeUserscript(id: string): Promise<void> {
  return serialized(async () => {
    assertUserscriptId(id);
    const index = await readIndex();
    const next = index.filter((e) => e.id !== id);
    if (next.length === index.length)
      throw new UserscriptError(`Userscript not found: ${id}`);
    await writeIndex(next);
    parseCache.delete(id);
    await rm(sourceFile(id), { force: true });
  });
}
