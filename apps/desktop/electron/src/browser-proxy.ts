// Proxy theo profile trình duyệt (partition). Module thuần (không import `electron`)
// để test bằng `node --test`. Sidecar là nơi validate chính (browser-profiles/
// proxy-config.ts) nhưng main vẫn là biên tin cậy: payload host request được
// kiểm lại ở đây trước khi chạm vào `session.setProxy`.

export const PROXY_TYPES = ["http", "https", "socks5"] as const;
export type ProxyType = (typeof PROXY_TYPES)[number];

export type ProxyConfig = {
  type: ProxyType;
  host: string;
  port: number;
  bypass?: string;
};
export type ProxyCredentials = { username: string; password: string };

// Tham số `session.setProxy` (rút gọn): luôn có đủ hai trường cho một proxy cụ thể.
export type ProxySessionConfig = {
  mode: "fixed_servers";
  proxyRules: string;
  proxyBypassRules: string;
};

const HOSTNAME_RE = /^[A-Za-z0-9_]([A-Za-z0-9_.-]*[A-Za-z0-9_])?$/;
const IPV6_RE = /^\[[0-9A-Fa-f:.]+\]$/;
const BYPASS_RE = /^[A-Za-z0-9.*_\-:/[\]<>,; ]*$/;

export function parseProxyConfig(raw: unknown): ProxyConfig {
  if (typeof raw !== "object" || raw === null)
    throw new Error("proxy must be an object");
  const o = raw as Record<string, unknown>;
  const { type, host, port, bypass } = o;
  if (
    typeof type !== "string" ||
    !(PROXY_TYPES as readonly string[]).includes(type)
  ) {
    throw new Error("proxy.type must be http, https or socks5");
  }
  if (typeof host !== "string" || host.length < 1 || host.length > 253) {
    throw new Error("proxy.host invalid");
  }
  if (!HOSTNAME_RE.test(host) && !IPV6_RE.test(host))
    throw new Error("proxy.host invalid");
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error("proxy.port invalid");
  }
  const out: ProxyConfig = { type: type as ProxyType, host, port };
  if (bypass !== undefined && bypass !== null && bypass !== "") {
    if (
      typeof bypass !== "string" ||
      bypass.length > 500 ||
      !BYPASS_RE.test(bypass)
    ) {
      throw new Error("proxy.bypass invalid");
    }
    out.bypass = bypass;
  }
  return out;
}

export function parseProxyCredentials(raw: unknown): ProxyCredentials {
  if (typeof raw !== "object" || raw === null)
    throw new Error("auth must be an object");
  const { username, password } = raw as Record<string, unknown>;
  if (
    typeof username !== "string" ||
    username.length < 1 ||
    username.length > 256
  ) {
    throw new Error("auth.username invalid");
  }
  if (typeof password !== "string" || password.length > 256)
    throw new Error("auth.password invalid");
  return { username, password };
}

// `socks5://` ⇒ Chromium dùng socks5 với DNS phía proxy (socks5h) — tên miền KHÔNG
// được phân giải cục bộ nên không lộ DNS ra ngoài đường hầm.
export function buildProxyRules(p: ProxyConfig): string {
  return `${p.type}://${p.host}:${p.port}`;
}

// `<local>` luôn được nối thêm: tên máy không có dấu chấm (intranet, dev server
// `localhost`) đi thẳng, không vòng qua proxy từ xa.
export function buildProxyBypass(p: ProxyConfig): string {
  return p.bypass ? `${p.bypass},<local>` : "<local>";
}

export function buildSessionProxy(p: ProxyConfig): ProxySessionConfig {
  return {
    mode: "fixed_servers",
    proxyRules: buildProxyRules(p),
    proxyBypassRules: buildProxyBypass(p),
  };
}

// Chỉ trả lời thử thách xác thực của CHÍNH proxy đã cấu hình: phải là thử thách
// proxy (không phải 401 của một trang), cùng host:port. Host so không phân biệt hoa/
// thường; IPv6 trong cấu hình có ngoặc vuông còn `authInfo.host` thì không.
export function proxyAuthMatches(
  authInfo: { isProxy: boolean; host: string; port: number },
  cfg: ProxyConfig,
): boolean {
  if (!authInfo.isProxy) return false;
  if (authInfo.port !== cfg.port) return false;
  const strip = (h: string): string => h.replace(/^\[|\]$/g, "").toLowerCase();
  return strip(authInfo.host) === strip(cfg.host);
}

// Phân tích `https://www.cloudflare.com/cdn-cgi/trace` (key=value từng dòng).
export function parseTrace(text: string): { ip?: string; loc?: string } {
  const out: { ip?: string; loc?: string } = {};
  for (const line of text.split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === "ip" && value) out.ip = value;
    else if (key === "loc" && value) out.loc = value;
  }
  return out;
}
