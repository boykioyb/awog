// Danh mục proxy công cộng miễn phí + đo tunnel thật. Tài liệu: docs/features/browser-profiles-bookmarks.md
//
// Bảo mật:
//  - Hai URL nguồn là HẰNG SỐ (L3) — không có URL nào do UI/người dùng truyền vào.
//  - Gọi mạng ra ngoài (2 host danh sách + handshake tới proxy trong danh mục) CHỈ xảy ra
//    khi người dùng bấm "Tìm & đo" (RPC `freeProxies.*`); agent không có tool nào chạm tới.
//  - Host loopback/private/link-local/CGNAT/multicast bị loại; chỉ nhận IPv4 literal
//    (hostname có thể resolve về IP nội bộ — fail-safe là bỏ).
//  - `probe` chỉ nhận id nằm trong danh mục hiện tại: UI không thể bắt sidecar kết nối tới host tuỳ ý.
//  - Probe mở tunnel (CONNECT / SOCKS5) rồi làm TLS handshake thật qua tunnel, kiểm chứng
//    chỉ mục; không gửi credential hay payload ứng dụng nào.

import net from "node:net";
import tls from "node:tls";
import { emit } from "../transport/stdio.js";
import { blockedHostReason } from "../mcp/http-client.js";
import { log } from "../util/logger.js";
import { validateProxyConfig } from "./proxy-config.js";

export type FreeProxyType = "http" | "socks5";
export type FreeProxyAnonymity = "elite" | "anonymous";

export type FreeProxy = {
  id: string;
  type: FreeProxyType;
  host: string;
  port: number;
  country: string;
  countryName?: string | undefined;
  city?: string | undefined;
  anonymity: FreeProxyAnonymity;
  sourceLatencyMs?: number | undefined;
  uptime?: number | undefined;
  isp?: string | undefined;
  sources: string[];
};

export type SourceStatus = {
  name: string;
  ok: boolean;
  count: number;
  error?: string;
};
export type CountryCount = { code: string; name: string; count: number };
export type FreeProxyCatalog = {
  fetchedAt: number;
  sources: SourceStatus[];
  items: FreeProxy[];
};

export type ListParams = {
  countries?: string[] | undefined;
  types?: FreeProxyType[] | undefined;
  anonymity?: FreeProxyAnonymity[] | undefined;
  limit?: number | undefined;
  refresh?: boolean | undefined;
};

export type ListResult = {
  fetchedAt: number;
  sources: SourceStatus[];
  countries: CountryCount[];
  items: FreeProxy[];
};

const PROXYSCRAPE_URL =
  "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&format=json&protocol=http,socks5&anonymity=elite,anonymous&limit=1000";
const GEONODE_URL =
  "https://proxylist.geonode.com/api/proxy-list?limit=500&page=1&protocols=http,socks5&sort_by=lastChecked&sort_type=desc";

const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 10 * 60_000;
const DEFAULT_LIMIT = 300;
const MAX_PROBE_IDS = 60;
const PROBE_TIMEOUT_MS = 5_000;
const PROBE_CONCURRENCY = 12;
// Đích đo: tunnel + TLS tới cloudflare = proxy dùng được; thêm google để phát hiện proxy
// đặt sau mạng kiểm duyệt (đo thật 2026-10-13: proxy lối ra Trung Quốc qua CONNECT 200
// tới cloudflare nhưng TLS tới www.google.com.hk bị reset ⇒ trang lỗi
// ERR_CONNECTION_RESET). Chỉ tunnel 200 KHÔNG đủ: GFW/proxy MITM vẫn trả 200.
const PROBE_TARGET_HOST = "www.cloudflare.com";
const OPEN_WEB_TARGET_HOST = "www.google.com";
const PROBE_TARGET_PORT = 443;

// Lỗi xác thực chứng chỉ ⇒ có kẻ đứng giữa giải mã TLS (proxy MITM) — tệ hơn một proxy chết.
const CERT_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_SIGNATURE_FAILURE",
  "CERT_UNTRUSTED",
]);

export class FreeProxyError extends Error {}

// ───────────────────────── Chuẩn hoá nguồn ─────────────────────────

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// Host công cộng hợp lệ: IPv4 literal, không thuộc dải nội bộ. Dùng lại SSRF helper của MCP
// (loopback/private/link-local) rồi bù CGNAT, multicast, reserved mà helper đó không phủ.
export function isPublicProxyHost(host: string): boolean {
  const m = IPV4_RE.exec(host);
  if (!m) return false;
  const o = m.slice(1).map(Number) as [number, number, number, number];
  if (o.some((n) => n > 255)) return false;
  if (blockedHostReason(host) !== null) return false;
  const [a, b] = o;
  if (a === 0 || a >= 224) return false; // 0/8, multicast 224/4, reserved 240/4, broadcast
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64/10
  if (a === 192 && b === 0 && o[2] === 0) return false; // 192.0.0/24 IETF
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmark 198.18/15
  return true;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
function nameForCountry(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

type Candidate = Omit<FreeProxy, "id" | "sources">;

// Một ứng viên thô đã chuẩn hoá hình dạng; trả null nếu không dùng được.
function finalize(c: Candidate): Candidate | null {
  const country = c.country.toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return null;
  if (!isPublicProxyHost(c.host)) return null;
  try {
    validateProxyConfig({ type: c.type, host: c.host, port: c.port });
  } catch {
    return null;
  }
  return { ...c, country };
}

function pickAnonymity(v: unknown): FreeProxyAnonymity | null {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  // `transparent` làm lộ IP thật ⇒ loại ngay từ ingest.
  return s === "elite" || s === "anonymous" ? s : null;
}

function pickType(v: unknown): FreeProxyType | null {
  const s = typeof v === "string" ? v.toLowerCase() : "";
  // socks4 bị bỏ vì ProxyType của profile không có socks4.
  return s === "http" || s === "socks5" ? s : null;
}

export function parseProxyScrape(json: unknown): Candidate[] {
  const root = asRecord(json);
  const list = Array.isArray(root?.proxies) ? (root.proxies as unknown[]) : [];
  const out: Candidate[] = [];
  for (const raw of list) {
    const p = asRecord(raw);
    if (!p || p.alive === false) continue;
    const type = pickType(p.protocol);
    const anonymity = pickAnonymity(p.anonymity);
    const host = str(p.ip);
    const port = num(p.port);
    const geo = asRecord(p.ip_data);
    const country = str(geo?.countryCode);
    if (!type || !anonymity || !host || port === undefined || !country)
      continue;
    const c = finalize({
      type,
      host,
      port,
      country,
      countryName: str(geo?.country),
      city: str(geo?.city),
      anonymity,
      sourceLatencyMs: num(p.average_timeout),
      uptime: num(p.uptime),
      isp: str(geo?.isp),
    });
    if (c) out.push(c);
  }
  return out;
}

export function parseGeonode(json: unknown): Candidate[] {
  const root = asRecord(json);
  const list = Array.isArray(root?.data) ? (root.data as unknown[]) : [];
  const out: Candidate[] = [];
  for (const raw of list) {
    const p = asRecord(raw);
    if (!p) continue;
    const anonymity = pickAnonymity(p.anonymityLevel);
    const host = str(p.ip);
    const port = num(p.port);
    const country = str(p.country);
    const protocols = Array.isArray(p.protocols) ? p.protocols : [];
    if (!anonymity || !host || port === undefined || !country) continue;
    // Một proxy có thể khai nhiều giao thức ⇒ mỗi giao thức một mục.
    for (const proto of protocols) {
      const type = pickType(proto);
      if (!type) continue;
      const c = finalize({
        type,
        host,
        port,
        country,
        city: str(p.city),
        anonymity,
        sourceLatencyMs: num(p.responseTime) ?? num(p.latency),
        uptime: num(p.upTime),
        isp: str(p.isp),
      });
      if (c) out.push(c);
    }
  }
  return out;
}

// Gộp theo id; trường trống lấy từ nguồn sau, độ trễ lấy min, uptime lấy max.
export function mergeCandidates(
  groups: { name: string; items: Candidate[] }[],
): FreeProxy[] {
  const map = new Map<string, FreeProxy>();
  for (const g of groups) {
    for (const c of g.items) {
      const id = `${c.type}://${c.host}:${c.port}`;
      const cur = map.get(id);
      if (!cur) {
        map.set(id, {
          id,
          ...c,
          countryName: c.countryName ?? nameForCountry(c.country),
          sources: [g.name],
        });
        continue;
      }
      if (!cur.sources.includes(g.name)) cur.sources.push(g.name);
      cur.city ??= c.city;
      cur.isp ??= c.isp;
      if (c.sourceLatencyMs !== undefined) {
        cur.sourceLatencyMs =
          cur.sourceLatencyMs === undefined
            ? c.sourceLatencyMs
            : Math.min(cur.sourceLatencyMs, c.sourceLatencyMs);
      }
      if (c.uptime !== undefined) {
        cur.uptime =
          cur.uptime === undefined ? c.uptime : Math.max(cur.uptime, c.uptime);
      }
    }
  }
  return [...map.values()];
}

// ───────────────────────── Fetch + cache ─────────────────────────

type FetchFn = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<Response>;

const SOURCES: {
  name: string;
  url: string;
  parse: (json: unknown) => Candidate[];
}[] = [
  { name: "proxyscrape", url: PROXYSCRAPE_URL, parse: parseProxyScrape },
  { name: "geonode", url: GEONODE_URL, parse: parseGeonode },
];

export async function fetchCatalog(
  fetchFn: FetchFn = fetch,
): Promise<FreeProxyCatalog> {
  const results = await Promise.all(
    SOURCES.map(async (s) => {
      try {
        const res = await fetchFn(s.url, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const items = s.parse(await res.json());
        return {
          name: s.name,
          items,
          status: { name: s.name, ok: true, count: items.length },
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        log.warn(`free-proxies: source ${s.name} failed: ${error}`);
        return {
          name: s.name,
          items: [] as Candidate[],
          status: {
            name: s.name,
            ok: false,
            count: 0,
            error,
          } satisfies SourceStatus,
        };
      }
    }),
  );
  return {
    fetchedAt: Date.now(),
    sources: results.map((r) => r.status),
    items: mergeCandidates(results),
  };
}

let cached: FreeProxyCatalog | null = null;
let inflight: Promise<FreeProxyCatalog> | null = null;

async function getCatalog(refresh: boolean): Promise<FreeProxyCatalog> {
  if (!refresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS)
    return cached;
  inflight ??= fetchCatalog().then(
    (c) => {
      // Cả hai nguồn chết ⇒ không ghi đè cache cũ bằng danh mục rỗng.
      if (c.sources.some((s) => s.ok) || !cached) cached = c;
      inflight = null;
      return cached ?? c;
    },
    (err: unknown) => {
      inflight = null;
      throw err;
    },
  );
  return inflight;
}

// Dành cho test: đặt/xoá danh mục trong RAM.
export function primeCatalog(catalog: FreeProxyCatalog | null): void {
  cached = catalog;
  inflight = null;
}

// ───────────────────────── list ─────────────────────────

export function filterCatalog(
  catalog: FreeProxyCatalog,
  p: ListParams,
): ListResult {
  const types = new Set<FreeProxyType>(
    p.types?.length ? p.types : ["http", "socks5"],
  );
  const anon = new Set<FreeProxyAnonymity>(
    p.anonymity?.length ? p.anonymity : ["elite", "anonymous"],
  );
  const wanted = p.countries?.length
    ? new Set(p.countries.map((c) => c.toUpperCase()))
    : null;
  const base = catalog.items.filter(
    (i) => types.has(i.type) && anon.has(i.anonymity),
  );

  const counts = new Map<string, CountryCount>();
  for (const i of base) {
    const e = counts.get(i.country);
    if (e) e.count++;
    else
      counts.set(i.country, {
        code: i.country,
        name: i.countryName ?? i.country,
        count: 1,
      });
  }
  const countries = [...counts.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );

  // Ứng viên tốt nhất trước: uptime cao, rồi độ trễ nguồn thấp (thiếu ⇒ cuối).
  const items = base
    .filter((i) => !wanted || wanted.has(i.country))
    .sort(
      (a, b) =>
        (b.uptime ?? -1) - (a.uptime ?? -1) ||
        (a.sourceLatencyMs ?? Infinity) - (b.sourceLatencyMs ?? Infinity),
    )
    .slice(0, p.limit ?? DEFAULT_LIMIT);
  return {
    fetchedAt: catalog.fetchedAt,
    sources: catalog.sources,
    countries,
    items,
  };
}

export async function listFreeProxies(p: ListParams): Promise<ListResult> {
  return filterCatalog(await getCatalog(p.refresh === true), p);
}

// ───────────────────────── probe ─────────────────────────

export type ProbeOutcome =
  | { ok: true; latencyMs: number }
  | { ok: false; error: string };

export type ProbeOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  targetHost?: string;
  targetPort?: number;
  /** Test seam: CA tin cậy thay cho bộ CA hệ thống. */
  ca?: string | Buffer;
};

// Độ dài trọn gói reply SOCKS5 CONNECT (VER REP RSV ATYP BND.ADDR BND.PORT); null = chưa đủ byte.
function socksReplyLength(buf: Buffer): number | null {
  if (buf.length < 5) return null;
  const atyp = buf[3];
  if (atyp === 0x01) return 4 + 4 + 2;
  if (atyp === 0x04) return 4 + 16 + 2;
  if (atyp === 0x03) return 4 + 1 + (buf[4] ?? 0) + 2;
  return -1;
}

// Đo THẬT: mở tunnel (http → CONNECT, socks5 → greeting + CONNECT theo domain) rồi làm
// TLS handshake qua tunnel với xác thực chứng chỉ + SNI đúng đích. Tunnel 200 mà TLS bị
// reset (mạng kiểm duyệt) ⇒ `tls-reset`; chứng chỉ sai (proxy giải mã TLS) ⇒ `tls-cert`.
// latency = tới lúc TLS xong. Socket luôn bị destroy khi xong/timeout/huỷ.
export function probeProxy(
  proxy: { type: FreeProxyType; host: string; port: number },
  opts: ProbeOptions = {},
): Promise<ProbeOutcome> {
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const targetHost = opts.targetHost ?? PROBE_TARGET_HOST;
  const targetPort = opts.targetPort ?? PROBE_TARGET_PORT;
  return new Promise((resolve) => {
    const started = performance.now();
    const socket = new net.Socket();
    let secure: tls.TLSSocket | null = null;
    let buf = Buffer.alloc(0);
    let stage: "http" | "greet" | "connect" | "tls" =
      proxy.type === "http" ? "http" : "greet";
    let settled = false;

    const finish = (r: ProbeOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      secure?.destroy();
      socket.destroy();
      resolve(r);
    };
    const fail = (error: string): void => finish({ ok: false, error });
    const onAbort = (): void => fail("cancelled");
    const timer = setTimeout(
      () => fail(stage === "tls" ? "tls-timeout" : "timeout"),
      timeoutMs,
    );
    if (opts.signal?.aborted) {
      onAbort();
      return;
    }
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    const tunnelUp = (): void => {
      stage = "tls";
      socket.removeAllListeners("data");
      secure = tls.connect({
        socket,
        servername: targetHost,
        ...(opts.ca ? { ca: opts.ca } : {}),
      });
      secure.once("secureConnect", () =>
        finish({
          ok: true,
          latencyMs: Math.round(performance.now() - started),
        }),
      );
      secure.once("error", (err: NodeJS.ErrnoException) => {
        const code = err.code ?? err.message;
        fail(CERT_ERROR_CODES.has(code) ? "tls-cert" : "tls-reset");
      });
      secure.once("close", () => fail("tls-reset"));
    };

    socket.on("error", (err: NodeJS.ErrnoException) =>
      fail(stage === "tls" ? "tls-reset" : (err.code ?? err.message)),
    );
    socket.on("close", () => fail(stage === "tls" ? "tls-reset" : "closed"));
    socket.on("connect", () => {
      if (stage === "http") {
        socket.write(
          `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`,
        );
      } else {
        socket.write(Buffer.from([0x05, 0x01, 0x00]));
      }
    });
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === "http") {
        const eol = buf.indexOf("\r\n");
        if (eol < 0) {
          if (buf.length > 2048) fail("bad-response");
          return;
        }
        const line = buf.subarray(0, eol).toString("latin1");
        if (!/^HTTP\/1\.[01] 200\b/.test(line)) {
          const code = /^HTTP\/1\.[01] (\d{3})/.exec(line)?.[1];
          return fail(code ? `http ${code}` : "bad-response");
        }
        // Chờ hết header rồi mới bắt đầu TLS — byte header thừa mà lọt vào TLS là hỏng.
        const end = buf.indexOf("\r\n\r\n");
        if (end < 0) {
          if (buf.length > 8192) fail("bad-response");
          return;
        }
        if (buf.length > end + 4) return fail("bad-response");
        return tunnelUp();
      }
      if (stage === "greet") {
        if (buf.length < 2) return;
        if (buf[0] !== 0x05 || buf[1] !== 0x00)
          return fail("socks-auth-required");
        buf = buf.subarray(2);
        stage = "connect";
        const domain = Buffer.from(targetHost, "ascii");
        socket.write(
          Buffer.concat([
            Buffer.from([0x05, 0x01, 0x00, 0x03, domain.length]),
            domain,
            Buffer.from([targetPort >> 8, targetPort & 0xff]),
          ]),
        );
        if (buf.length === 0) return;
      }
      if (buf.length < 2) return;
      if (buf[0] !== 0x05) return fail("bad-response");
      if (buf[1] !== 0x00) return fail(`socks-rep-${buf[1]}`);
      const need = socksReplyLength(buf);
      if (need === -1) return fail("bad-response");
      if (need === null || buf.length < need) return;
      if (buf.length > need) return fail("bad-response");
      tunnelUp();
    });
    socket.connect({ host: proxy.host, port: proxy.port });
  });
}

type ActiveProbe = { probeId: string; controller: AbortController };
let activeProbe: ActiveProbe | null = null;
let probeSeq = 0;

// Trả probeId ngay; kết quả stream qua event. Id lạ ⇒ ném FreeProxyError (không bao giờ dò host tuỳ ý).
// Mỗi proxy đo HAI đích song song: cloudflare quyết định sống/chết + độ trễ; google chỉ để
// gắn cờ `blocked: ['google']` (mạng kiểm duyệt) — proxy vẫn "ok" vì nhiều trang khác vẫn vào được.
export function startProbe(
  ids: string[],
  seam: Pick<ProbeOptions, "ca"> = {},
): { probeId: string } {
  if (ids.length === 0) throw new FreeProxyError("ids must not be empty");
  if (ids.length > MAX_PROBE_IDS)
    throw new FreeProxyError(`At most ${MAX_PROBE_IDS} ids per probe`);
  const byId = new Map((cached?.items ?? []).map((i) => [i.id, i]));
  const targets: FreeProxy[] = [];
  for (const id of new Set(ids)) {
    const item = byId.get(id);
    if (!item) throw new FreeProxyError(`Unknown proxy id: ${id}`);
    targets.push(item);
  }

  activeProbe?.controller.abort();
  const probeId = `probe-${Date.now().toString(36)}-${++probeSeq}`;
  const controller = new AbortController();
  activeProbe = { probeId, controller };

  void (async () => {
    let next = 0;
    const worker = async (): Promise<void> => {
      while (!controller.signal.aborted && next < targets.length) {
        const t = targets[next++]!;
        const base = { signal: controller.signal, ...seam };
        const [r, open] = await Promise.all([
          probeProxy(t, base),
          probeProxy(t, { ...base, targetHost: OPEN_WEB_TARGET_HOST }),
        ]);
        if (controller.signal.aborted) return; // bị probe mới thay: không phát gì nữa
        emit(
          "freeProxies.probed",
          r.ok
            ? {
                probeId,
                id: t.id,
                ok: true,
                latencyMs: r.latencyMs,
                blocked: open.ok ? [] : ["google"],
              }
            : { probeId, id: t.id, ok: false, error: r.error },
        );
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(PROBE_CONCURRENCY, targets.length) },
        worker,
      ),
    );
    if (controller.signal.aborted) return;
    if (activeProbe?.probeId === probeId) activeProbe = null;
    emit("freeProxies.probeDone", { probeId });
  })();

  return { probeId };
}

// Dùng khi sidecar tắt / test dọn dẹp.
export function cancelProbe(): void {
  activeProbe?.controller.abort();
  activeProbe = null;
}
