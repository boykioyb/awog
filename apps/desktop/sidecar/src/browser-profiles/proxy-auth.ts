// Credential proxy của profile trình duyệt — CHỈ nằm trong OS keychain
// (service `awog-browser-proxy`, account = profile id). Không bao giờ vào file,
// RPC result hay event gửi lên renderer; chỉ đi sidecar → Electron main qua
// host request `browser.setProfileProxy` và main giữ trong RAM.

import {
  deleteKeychainValue,
  getKeychainValue,
  setKeychainValue,
} from "../credentials/keychain.js";
import { log } from "../util/logger.js";
import type { ProxyAuth } from "./proxy-config.js";

const SERVICE = "awog-browser-proxy";

export async function saveProxyAuth(
  profileId: string,
  auth: ProxyAuth,
): Promise<void> {
  await setKeychainValue(SERVICE, profileId, JSON.stringify(auth));
}

export async function loadProxyAuth(
  profileId: string,
): Promise<ProxyAuth | null> {
  const raw = await getKeychainValue(SERVICE, profileId);
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (
      typeof v === "object" &&
      v !== null &&
      typeof (v as ProxyAuth).username === "string" &&
      typeof (v as ProxyAuth).password === "string"
    ) {
      return {
        username: (v as ProxyAuth).username,
        password: (v as ProxyAuth).password,
      };
    }
  } catch {
    // rơi xuống cảnh báo bên dưới
  }
  log.warn("browser-proxy: malformed keychain entry ignored", {
    profile: profileId,
  });
  return null;
}

export async function clearProxyAuth(profileId: string): Promise<void> {
  await deleteKeychainValue(SERVICE, profileId);
}
