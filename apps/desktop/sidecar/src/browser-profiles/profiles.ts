// Store profile trình duyệt nhúng: `~/.awog/browser/profiles.json`.
// Profile `default` luôn tồn tại, không xoá được, và ánh xạ vào partition cũ
// `persist:awog-browser` ở Electron (giữ nguyên đăng nhập/import sẵn có).
// Tài liệu: docs/features/browser-profiles-bookmarks.md

import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { awogHome, sanitizeChild } from "../util/path.js";
import { log } from "../util/logger.js";
import { readTextOrNull, serialized, writeJsonAtomic } from "./fs-util.js";
import type { StoredProxy } from "./proxy-config.js";

export const DEFAULT_PROFILE_ID = "default";
export const DEFAULT_PROFILE_NAME = "Mặc định";
export const MAX_PROFILES = 20;
const DEFAULT_COLOR = "#4f8cff";
const PALETTE = [
  "#4f8cff",
  "#34c38f",
  "#f1b44c",
  "#f46a6a",
  "#a77bf3",
  "#38c6d9",
  "#ef7fb0",
];

// Cùng regex với `partitionForProfile` ở Electron — id đi thẳng vào tên thư mục
// và tên partition nên chỉ chữ thường/số/gạch ngang, tối đa 32 ký tự.
const PROFILE_ID_RE = /^(default|[a-z0-9-]{1,32})$/;

export class BrowserProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserProfileError";
  }
}

export function assertProfileId(id: unknown): string {
  if (typeof id !== "string" || !PROFILE_ID_RE.test(id)) {
    throw new BrowserProfileError(`Invalid browser profile id: ${String(id)}`);
  }
  return sanitizeChild(id);
}

export interface BrowserProfile {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  // Proxy riêng của profile (không bí mật; credential ở keychain — proxy-auth.ts).
  proxy?: StoredProxy;
}

export interface BrowserProfilesFile {
  version: 1;
  defaultProfileId: string;
  profiles: BrowserProfile[];
}

const FileSchema = z.object({
  version: z.literal(1),
  defaultProfileId: z.string(),
  profiles: z.array(
    z.object({
      id: z.string().regex(PROFILE_ID_RE),
      name: z.string(),
      color: z.string(),
      createdAt: z.string(),
      proxy: z
        .object({
          type: z.enum(["http", "https", "socks5"]),
          host: z.string(),
          port: z.number().int().min(1).max(65535),
          bypass: z.string().optional(),
          hasAuth: z.boolean(),
        })
        .optional(),
    }),
  ),
});

export function browserDir(): string {
  return join(awogHome(), sanitizeChild("browser"));
}

function profilesFile(): string {
  return join(browserDir(), "profiles.json");
}

// Thư mục dữ liệu của một profile (bookmark…). id đã qua assertProfileId.
export function profileDir(id: string): string {
  return join(browserDir(), "profiles", assertProfileId(id));
}

function defaultProfile(): BrowserProfile {
  return {
    id: DEFAULT_PROFILE_ID,
    name: DEFAULT_PROFILE_NAME,
    color: DEFAULT_COLOR,
    createdAt: new Date(0).toISOString(),
  };
}

// Đọc + tự chữa: bảo đảm có `default` và `defaultProfileId` trỏ vào profile có thật.
async function readFileState(): Promise<BrowserProfilesFile> {
  let parsed: BrowserProfilesFile | null = null;
  const raw = await readTextOrNull(profilesFile());
  if (raw !== null) {
    try {
      const res = FileSchema.safeParse(JSON.parse(raw));
      if (res.success) parsed = res.data as BrowserProfilesFile;
      else
        log.warn("browser-profiles: invalid profiles.json, using defaults", {});
    } catch (err) {
      log.warn("browser-profiles: unreadable profiles.json, using defaults", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const profiles =
    parsed?.profiles.filter(
      (p, i, a) => a.findIndex((q) => q.id === p.id) === i,
    ) ?? [];
  if (!profiles.some((p) => p.id === DEFAULT_PROFILE_ID))
    profiles.unshift(defaultProfile());
  const wanted = parsed?.defaultProfileId ?? DEFAULT_PROFILE_ID;
  const defaultProfileId = profiles.some((p) => p.id === wanted)
    ? wanted
    : DEFAULT_PROFILE_ID;
  return { version: 1, defaultProfileId, profiles };
}

export async function listProfiles(): Promise<{
  defaultProfileId: string;
  profiles: BrowserProfile[];
}> {
  const { defaultProfileId, profiles } = await readFileState();
  return { defaultProfileId, profiles };
}

export async function profileExists(id: string): Promise<boolean> {
  const { profiles } = await readFileState();
  return profiles.some((p) => p.id === id);
}

function cleanName(name: string): string {
  const n = name.trim();
  if (n.length < 1 || n.length > 60)
    throw new BrowserProfileError("Profile name must be 1–60 characters");
  return n;
}

function cleanColor(color: string): string {
  const c = color.trim();
  if (c.length < 1 || c.length > 40)
    throw new BrowserProfileError("Profile color must be 1–40 characters");
  return c;
}

export function createProfile(input: {
  name: string;
  color?: string;
}): Promise<BrowserProfile> {
  return serialized(async () => {
    const state = await readFileState();
    if (state.profiles.length >= MAX_PROFILES) {
      throw new BrowserProfileError(`At most ${MAX_PROFILES} browser profiles`);
    }
    let id = "";
    do id = `p-${randomBytes(4).toString("hex")}`;
    while (state.profiles.some((p) => p.id === id));
    const profile: BrowserProfile = {
      id,
      name: cleanName(input.name),
      color:
        input.color !== undefined
          ? cleanColor(input.color)
          : (PALETTE[state.profiles.length % PALETTE.length] ?? DEFAULT_COLOR),
      createdAt: new Date().toISOString(),
    };
    state.profiles.push(profile);
    await writeJsonAtomic(profilesFile(), state);
    return profile;
  });
}

export function updateProfile(input: {
  id: string;
  name?: string;
  color?: string;
}): Promise<BrowserProfile> {
  return serialized(async () => {
    const id = assertProfileId(input.id);
    const state = await readFileState();
    const idx = state.profiles.findIndex((p) => p.id === id);
    const current = state.profiles[idx];
    if (!current)
      throw new BrowserProfileError(`Browser profile not found: ${id}`);
    const next: BrowserProfile = {
      ...current,
      ...(input.name !== undefined ? { name: cleanName(input.name) } : {}),
      ...(input.color !== undefined ? { color: cleanColor(input.color) } : {}),
    };
    state.profiles[idx] = next;
    await writeJsonAtomic(profilesFile(), state);
    return next;
  });
}

// Ghi (hoặc xoá, `null`) proxy của profile. Đã validate ở tầng gọi (proxy.ts).
export function setProfileProxyRecord(
  id: string,
  proxy: StoredProxy | null,
): Promise<BrowserProfile> {
  return serialized(async () => {
    const safe = assertProfileId(id);
    const state = await readFileState();
    const idx = state.profiles.findIndex((p) => p.id === safe);
    const current = state.profiles[idx];
    if (!current)
      throw new BrowserProfileError(`Browser profile not found: ${safe}`);
    const { proxy: _old, ...rest } = current;
    const next: BrowserProfile = proxy ? { ...rest, proxy } : rest;
    state.profiles[idx] = next;
    await writeJsonAtomic(profilesFile(), state);
    return next;
  });
}

export function setDefaultProfile(
  id: string,
): Promise<{ defaultProfileId: string }> {
  return serialized(async () => {
    const safe = assertProfileId(id);
    const state = await readFileState();
    if (!state.profiles.some((p) => p.id === safe)) {
      throw new BrowserProfileError(`Browser profile not found: ${safe}`);
    }
    state.defaultProfileId = safe;
    await writeJsonAtomic(profilesFile(), state);
    return { defaultProfileId: safe };
  });
}

// Xoá khỏi danh sách + xoá thư mục dữ liệu (bookmark). Việc gỡ tham chiếu ở
// phiên/project và xoá partition là của tầng gọi (resolve.ts) — store này
// không biết sessions/projects (SoC).
export function deleteProfile(
  id: string,
): Promise<{ defaultProfileId: string }> {
  return serialized(async () => {
    const safe = assertProfileId(id);
    if (safe === DEFAULT_PROFILE_ID)
      throw new BrowserProfileError("The default profile cannot be deleted");
    const state = await readFileState();
    if (!state.profiles.some((p) => p.id === safe)) {
      throw new BrowserProfileError(`Browser profile not found: ${safe}`);
    }
    state.profiles = state.profiles.filter((p) => p.id !== safe);
    if (state.defaultProfileId === safe)
      state.defaultProfileId = DEFAULT_PROFILE_ID;
    await writeJsonAtomic(profilesFile(), state);
    await rm(profileDir(safe), { recursive: true, force: true });
    return { defaultProfileId: state.defaultProfileId };
  });
}
