// Proxy theo profile trình duyệt ("VPN" của profile): kiểu dữ liệu + validate ở biên.
// Module thuần (không I/O) để test thẳng. Tài liệu: docs/features/browser-profiles-bookmarks.md
//
// Cấu hình proxy chỉ do NGƯỜI DÙNG đặt (RPC `browserProfiles.setProxy` từ Settings) —
// không có tool nào của agent chạm tới. Host loopback/private được phép: client proxy
// cục bộ (127.0.0.1:1080) là ca phổ biến nhất và đó là cấu hình của người dùng.

import { BrowserProfileError } from "./profiles.js";

export const PROXY_TYPES = ["http", "https", "socks5"] as const;
export type ProxyType = (typeof PROXY_TYPES)[number];

// Phần KHÔNG bí mật — an toàn để lưu profiles.json và trả cho renderer.
export type ProxyConfig = {
  type: ProxyType;
  host: string;
  port: number;
  bypass?: string;
};

export type StoredProxy = ProxyConfig & { hasAuth: boolean };

export type ProxyAuth = { username: string; password: string };

const MAX_HOST = 253;
const MAX_BYPASS = 500;
const MAX_CRED = 256;

// Hostname (nhãn chữ/số/gạch ngang/gạch dưới, cho phép IPv4) hoặc IPv6 trong ngoặc vuông.
const HOSTNAME_RE = /^[A-Za-z0-9_]([A-Za-z0-9_.-]*[A-Za-z0-9_])?$/;
const IPV6_RE = /^\[[0-9A-Fa-f:.]+\]$/;
// Cú pháp proxyBypassRules của Chromium: host, `*.x.com`, `.x.com`, CIDR, `[::1]`,
// `host:port`, `<local>`, `<-loopback>`; phân cách bằng dấu phẩy/chấm phẩy/khoảng trắng.
const BYPASS_RE = /^[A-Za-z0-9.*_\-:/[\]<>,; ]*$/;

export function validateProxyConfig(raw: {
  type: string;
  host: string;
  port: number;
  bypass?: string | undefined;
}): ProxyConfig {
  if (!(PROXY_TYPES as readonly string[]).includes(raw.type)) {
    throw new BrowserProfileError(
      `Proxy type must be one of ${PROXY_TYPES.join(", ")}`,
    );
  }
  const host = raw.host.trim();
  if (host.length < 1 || host.length > MAX_HOST) {
    throw new BrowserProfileError(
      `Proxy host must be 1–${MAX_HOST} characters`,
    );
  }
  if (!HOSTNAME_RE.test(host) && !IPV6_RE.test(host)) {
    throw new BrowserProfileError(
      "Proxy host must be a hostname, IPv4 address or [IPv6] — no scheme, path or whitespace",
    );
  }
  if (!Number.isInteger(raw.port) || raw.port < 1 || raw.port > 65535) {
    throw new BrowserProfileError("Proxy port must be an integer 1–65535");
  }
  const out: ProxyConfig = {
    type: raw.type as ProxyType,
    host,
    port: raw.port,
  };
  const bypass = raw.bypass?.trim();
  if (bypass) {
    if (bypass.length > MAX_BYPASS) {
      throw new BrowserProfileError(
        `Proxy bypass list must be at most ${MAX_BYPASS} characters`,
      );
    }
    if (!BYPASS_RE.test(bypass)) {
      throw new BrowserProfileError(
        "Proxy bypass list contains unsupported characters",
      );
    }
    out.bypass = bypass;
  }
  return out;
}

export function validateProxyAuth(raw: ProxyAuth): ProxyAuth {
  if (raw.username.length < 1 || raw.username.length > MAX_CRED) {
    throw new BrowserProfileError(
      `Proxy username must be 1–${MAX_CRED} characters`,
    );
  }
  if (raw.password.length > MAX_CRED) {
    throw new BrowserProfileError(
      `Proxy password must be at most ${MAX_CRED} characters`,
    );
  }
  return { username: raw.username, password: raw.password };
}

// Chromium không làm được SOCKS5 username/password ⇒ từ chối ngay ở biên thay vì
// lưu một cấu hình sẽ lặng lẽ chạy không xác thực.
export function assertAuthSupported(type: ProxyType, hasAuth: boolean): void {
  if (type === "socks5" && hasAuth) {
    throw new BrowserProfileError(
      "SOCKS5 proxy with username/password is not supported by Chromium — use an HTTP/HTTPS proxy, or a SOCKS5 proxy without authentication",
    );
  }
}
