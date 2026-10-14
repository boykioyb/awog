// Luật host của trình duyệt agent (invariant #7, SSRF) — tách khỏi browser.ts để
// kiểm bằng `node:test` mà không kéo Electron vào.
//
// Mặc định chặn MỌI loopback / private / link-local. Ngoại lệ DUY NHẤT: cổng của
// một dev server mà sidecar xác nhận là (a) khai trong `.awog/dev-servers.json`
// của dự án VÀ (b) đang chạy trong registry của phiên (docs/features/dev-server.md).
// Sidecar đẩy tập cổng đó sang đây theo TỪNG scope (scope = engineId phiên chat),
// nên dev server của phiên A không mở được cho tab của phiên B, và tab pool global
// / task node (scope không phải phiên) không bao giờ có ngoại lệ.
//
// Khớp là CẶP (loopback-host, cổng) chính xác: `localhost`, `127.0.0.1`, `[::1]`
// coi như MỘT máy (cùng cổng thì cùng dịch vụ — dev server có thể chỉ bind một
// họ địa chỉ), nhưng KHÔNG có wildcard, không có `127.0.0.2`, không có cổng khác,
// không có https↔http suy diễn (cổng mặc định tính theo scheme).

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
];

// `URL.hostname` của IPv6 LUÔN có ngoặc vuông (`[::1]`) — bản cũ so với `::1`
// trần nên không bao giờ khớp. Chuẩn hoá bỏ ngoặc trước khi so.
function bareHost(hostname: string): string {
  const h = hostname.toLowerCase();
  return h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
}

function isLoopbackName(h: string): boolean {
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "0:0:0:0:0:0:0:1"
  );
}

const MAX_PORTS_PER_SCOPE = 32;
const MAX_SCOPES = 256;
const portsByScope = new Map<string, ReadonlySet<number>>();

// Thay thế toàn bộ tập cổng của một scope. Rỗng ⇒ xoá scope. Cổng sai ⇒ ném —
// sidecar là nguồn tin cậy nhưng đây vẫn là biên IPC.
export function setDevServerPorts(
  scope: string,
  ports: readonly number[],
): void {
  if (!scope) throw new Error("scope is required");
  const next = new Set<number>();
  for (const p of ports) {
    if (!Number.isInteger(p) || p < 1 || p > 65535)
      throw new Error(`invalid port: ${String(p)}`);
    next.add(p);
  }
  if (next.size > MAX_PORTS_PER_SCOPE)
    throw new Error("too many dev-server ports");
  if (next.size === 0) {
    portsByScope.delete(scope);
    return;
  }
  if (!portsByScope.has(scope) && portsByScope.size >= MAX_SCOPES) {
    throw new Error("too many scopes with dev-server ports");
  }
  portsByScope.set(scope, next);
}

// Sidecar chết/khởi động lại ⇒ mọi khẳng định "đang chạy" hết căn cứ.
export function clearDevServerPorts(): void {
  portsByScope.clear();
}

export function devServerPortsFor(
  scope: string | undefined,
): ReadonlySet<number> | undefined {
  return scope ? portsByScope.get(scope) : undefined;
}

// Cổng hiệu lực của URL (rỗng = cổng mặc định của scheme).
function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === "https:" ? 443 : 80;
}

const HOW_TO_ALLOW_LOCAL =
  'to browse a local dev server, declare it in .awog/dev-servers.json (with its "port") and start it with the dev_server tool — only running, declared ports are reachable';

// Trả lý do từ chối cho host literal (không DNS), hoặc null nếu cho phép.
// `scope` = chủ tab (xem devServerPortsFor); `siteAllowed` = allowlist site của
// người dùng (browser-sites.ts), áp SAU guard nên không bao giờ nới được nó —
// và cũng áp cho cả loopback được phép: người dùng đã giới hạn site thì dev
// server cục bộ không phải ngoại lệ trong đó.
export function evaluateHost(
  rawUrl: string,
  scope: string | undefined,
  siteAllowed: (hostname: string) => boolean,
): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "invalid URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `protocol ${url.protocol} not allowed (http/https only)`;
  }
  const h = bareHost(url.hostname);
  if (isLoopbackName(h)) {
    const port = effectivePort(url);
    if (!devServerPortsFor(scope)?.has(port)) {
      return `loopback host ${h}:${port} not allowed — ${HOW_TO_ALLOW_LOCAL}`;
    }
    // Ngoại lệ cho đúng cặp này; bỏ qua các guard private bên dưới (127.0.0.1
    // sẽ khớp /^127\./) nhưng vẫn đi qua allowlist site.
  } else {
    for (const p of PRIVATE_IP_PATTERNS) {
      if (p.test(h)) return `private/loopback IP ${h} not allowed`;
    }
    if (h.includes(":")) {
      // IPv4-mapped (`::ffff:7f00:1` sau chuẩn hoá của URL) và `::` lách được
      // regex IPv4 ở trên ⇒ chặn cả họ.
      if (h === "::" || /^::ffff:/i.test(h))
        return `IPv6 loopback/mapped ${h} not allowed`;
      if (/^f[cd][0-9a-f]{2}:/i.test(h) || /^fe80:/i.test(h)) {
        return `IPv6 private ${h} not allowed`;
      }
    }
  }
  if (!siteAllowed(url.hostname))
    return `host ${h} is not in the allowed-sites list`;
  return null;
}
