// Proxy theo profile: ghi cấu hình (profiles.json) + credential (keychain) rồi đẩy
// sang Electron main (`browser.setProfileProxy`) — nơi áp vào partition của profile.
// Tài liệu: docs/features/browser-profiles-bookmarks.md (mục Proxy), ADR 0103.

import { hostRequest } from "../transport/stdio.js";
import { log } from "../util/logger.js";
import { clearProxyAuth, loadProxyAuth, saveProxyAuth } from "./proxy-auth.js";
import {
  assertAuthSupported,
  validateProxyAuth,
  validateProxyConfig,
  type ProxyAuth,
  type ProxyConfig,
} from "./proxy-config.js";
import {
  assertProfileId,
  BrowserProfileError,
  listProfiles,
  setProfileProxyRecord,
  type BrowserProfile,
} from "./profiles.js";

export type SetProxyInput = {
  id: string;
  proxy: {
    type: string;
    host: string;
    port: number;
    bypass?: string | undefined;
  } | null;
  // `undefined` = giữ credential hiện có; `null` = xoá; object = đặt mới.
  auth?: ProxyAuth | null | undefined;
};

// Đẩy trạng thái proxy của một profile sang main. Lỗi ném lên: setProxy phải cho
// người dùng biết nếu main không nhận (syncAllProxies tự bắt lỗi từng profile).
async function pushToMain(
  profileId: string,
  proxy: ProxyConfig | null,
  auth: ProxyAuth | null,
): Promise<void> {
  await hostRequest("browser.setProfileProxy", {
    profile: profileId,
    proxy,
    ...(auth ? { auth } : {}),
  });
}

function toConfig(p: NonNullable<BrowserProfile["proxy"]>): ProxyConfig {
  return {
    type: p.type,
    host: p.host,
    port: p.port,
    ...(p.bypass !== undefined ? { bypass: p.bypass } : {}),
  };
}

export async function setProfileProxy(
  input: SetProxyInput,
): Promise<BrowserProfile> {
  const id = assertProfileId(input.id);
  const { profiles } = await listProfiles();
  const current = profiles.find((p) => p.id === id);
  if (!current)
    throw new BrowserProfileError(`Browser profile not found: ${id}`);

  if (input.proxy === null) {
    if (input.auth)
      throw new BrowserProfileError("Credentials need a proxy to belong to");
    const updated = await setProfileProxyRecord(id, null);
    await clearProxyAuth(id);
    await pushToMain(id, null, null);
    return updated;
  }

  const config = validateProxyConfig(input.proxy);
  // Credential sau cùng: mới (validate) > giữ nguyên (đã có hasAuth) > xoá.
  let nextAuth: ProxyAuth | null | "keep";
  if (input.auth === undefined) nextAuth = "keep";
  else if (input.auth === null) nextAuth = null;
  else nextAuth = validateProxyAuth(input.auth);

  const willHaveAuth =
    nextAuth === "keep" ? current.proxy?.hasAuth === true : nextAuth !== null;
  assertAuthSupported(config.type, willHaveAuth);

  // Keychain TRƯỚC file: không lưu cấu hình hứa "có auth" mà credential không ghi được.
  if (nextAuth === null) await clearProxyAuth(id);
  else if (nextAuth !== "keep") await saveProxyAuth(id, nextAuth);

  const updated = await setProfileProxyRecord(id, {
    ...config,
    hasAuth: willHaveAuth,
  });
  const auth = willHaveAuth
    ? nextAuth === "keep"
      ? await loadProxyAuth(id)
      : nextAuth
    : null;
  await pushToMain(id, config, auth);
  return updated;
}

// Main hỏi (khởi động / engine restart / profiles-changed): đẩy lại TRẠNG THÁI CỦA MỌI
// profile — kể cả `null` — để main biết chắc profile nào đi thẳng, nhờ vậy partition
// chưa được báo thì main có thể chặn thay vì để lọt ra mạng trực tiếp.
export async function syncAllProxies(): Promise<{ synced: number }> {
  const { profiles } = await listProfiles();
  for (const p of profiles) {
    try {
      if (!p.proxy) {
        await pushToMain(p.id, null, null);
        continue;
      }
      const auth = p.proxy.hasAuth ? await loadProxyAuth(p.id) : null;
      if (p.proxy.hasAuth && !auth) {
        log.warn("browser-proxy: credential missing in keychain", {
          profile: p.id,
        });
      }
      await pushToMain(p.id, toConfig(p.proxy), auth);
    } catch (err) {
      log.warn("browser-proxy: push failed", {
        profile: p.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { synced: profiles.length };
}

// Xoá profile: bỏ credential khỏi keychain. Gọi từ removeProfile.
export async function dropProfileProxy(
  id: string,
  hadProxy: boolean,
): Promise<void> {
  await clearProxyAuth(id);
  if (!hadProxy) return;
  try {
    await pushToMain(id, null, null);
  } catch (err) {
    log.warn("browser-proxy: clearing proxy on main failed", {
      profile: id,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
