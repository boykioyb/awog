// Run: npx vitest run src/browser-profiles/__tests__/free-proxies.test.ts
import net from "node:net";
import tls from "node:tls";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const events = vi.hoisted(
  () => [] as { type: string; payload: Record<string, unknown> }[],
);
vi.mock("../../transport/stdio.js", () => ({
  emit: (type: string, payload: Record<string, unknown>) =>
    events.push({ type, payload }),
  hostRequest: async () => ({}),
}));

import {
  cancelProbe,
  fetchCatalog,
  filterCatalog,
  isPublicProxyHost,
  mergeCandidates,
  parseGeonode,
  parseProxyScrape,
  primeCatalog,
  probeProxy,
  startProbe,
  FreeProxyError,
  type FreeProxy,
} from "../free-proxies.js";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
      "utf8",
    ),
  );
const fixtureText = (name: string): string =>
  readFileSync(
    fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
    "utf8",
  );

// Chứng chỉ tự ký cho www.cloudflare.com + www.google.com (CHỈ dùng trong test). Truyền
// làm `ca` = upstream "thật"; không truyền = trông như proxy giải mã TLS (MITM).
const TLS_CERT = fixtureText("probe-tls.crt");
const TLS_KEY = fixtureText("probe-tls.key");
let upstreamPort = 0;
let upstream: tls.Server | null = null;
// Theo dõi ở tầng TCP (`connection`), không ở `secureConnection`: tunnel bị cắt giữa
// handshake không bao giờ tới callback TLS nhưng vẫn giữ `close()` chờ.
const upstreamConns = new Set<net.Socket>();
beforeAll(async () => {
  upstream = tls.createServer({ key: TLS_KEY, cert: TLS_CERT }, (s) =>
    s.on("error", () => {}),
  );
  upstream.on("connection", (s: net.Socket) => {
    upstreamConns.add(s);
    s.on("close", () => upstreamConns.delete(s));
  });
  upstream.on("tlsClientError", () => {});
  await new Promise<void>((r) => upstream!.listen(0, "127.0.0.1", r));
  upstreamPort = (upstream.address() as net.AddressInfo).port;
});
afterAll(async () => {
  // `close` chờ mọi kết nối đang mở — các tunnel đã pipe vào upstream phải bị cắt trước.
  for (const s of upstreamConns) s.destroy();
  await new Promise<void>((r) => upstream!.close(() => r()));
});

// Nối socket client của proxy giả vào upstream TLS (proxy "trung thực").
const pipeUpstream = (s: net.Socket): void => {
  const up = net.connect(upstreamPort, "127.0.0.1");
  up.on("error", () => s.destroy());
  s.pipe(up).pipe(s);
};

afterEach(() => {
  cancelProbe();
  primeCatalog(null);
  events.length = 0;
});

describe("parsers", () => {
  it("ProxyScrape: drops socks4, transparent, dead, private; keeps geo fields", () => {
    const out = parseProxyScrape(fixture("proxyscrape.json"));
    expect(out.map((c) => `${c.type}://${c.host}:${c.port}`)).toEqual([
      "socks5://45.74.31.46:7052",
      "http://143.20.37.32:8080",
    ]);
    expect(out[0]).toMatchObject({
      country: "NL",
      countryName: "The Netherlands",
      city: "Eygelshoven",
      anonymity: "elite",
      sourceLatencyMs: 3021.9,
      uptime: 20.2,
    });
  });

  it("Geonode: string port, per-protocol items, filters private/CGNAT/multicast/bad port/hostname", () => {
    const out = parseGeonode(fixture("geonode.json"));
    expect(out.map((c) => `${c.type}://${c.host}:${c.port}`)).toEqual([
      "http://143.20.37.32:8080",
      "socks5://88.135.36.246:1080",
    ]);
    expect(out[0]?.sourceLatencyMs).toBe(700); // responseTime ưu tiên hơn latency
  });

  it("isPublicProxyHost", () => {
    for (const h of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.5.5",
      "192.168.0.1",
      "169.254.1.1",
      "100.100.0.1",
      "224.1.1.1",
      "0.0.0.0",
      "255.255.255.255",
      "::1",
      "localhost",
      "a.b",
    ])
      expect(isPublicProxyHost(h), h).toBe(false);
    expect(isPublicProxyHost("8.8.8.8")).toBe(true);
  });
});

describe("merge + filter", () => {
  const merged = mergeCandidates([
    {
      name: "proxyscrape",
      items: parseProxyScrape(fixture("proxyscrape.json")),
    },
    { name: "geonode", items: parseGeonode(fixture("geonode.json")) },
  ]);

  it("dedupes by id, merges sources, min latency, max uptime", () => {
    expect(merged.map((m) => m.id).sort()).toEqual([
      "http://143.20.37.32:8080",
      "socks5://45.74.31.46:7052",
      "socks5://88.135.36.246:1080",
    ]);
    const de = merged.find((m) => m.id === "http://143.20.37.32:8080")!;
    expect(de.sources).toEqual(["proxyscrape", "geonode"]);
    expect(de.sourceLatencyMs).toBe(700);
    expect(de.uptime).toBe(99.5);
    expect(de.city).toBe("Berlin");
    expect(merged.find((m) => m.country === "IR")?.countryName).toBe("Iran");
  });

  it("filters by country/type, counts countries before country filter, sorts by uptime, limits", () => {
    const cat = { fetchedAt: 1, sources: [], items: merged };
    const all = filterCatalog(cat, {});
    expect(all.items.map((i) => i.id)).toEqual([
      "socks5://88.135.36.246:1080",
      "http://143.20.37.32:8080",
      "socks5://45.74.31.46:7052",
    ]);
    expect(all.countries.map((c) => c.code).sort()).toEqual(["DE", "IR", "NL"]);
    const de = filterCatalog(cat, { countries: ["de"] });
    expect(de.items).toHaveLength(1);
    expect(de.countries).toHaveLength(3);
    expect(
      filterCatalog(cat, { types: ["socks5"] }).items.every(
        (i) => i.type === "socks5",
      ),
    ).toBe(true);
    expect(filterCatalog(cat, { anonymity: ["anonymous"] }).items).toHaveLength(
      1,
    );
    expect(filterCatalog(cat, { limit: 1 }).items).toHaveLength(1);
  });
});

describe("fetchCatalog", () => {
  it("one failing source is reported, not fatal", async () => {
    const fetchFn = async (url: string): Promise<Response> => {
      if (url.includes("geonode")) throw new Error("boom");
      return new Response(JSON.stringify(fixture("proxyscrape.json")));
    };
    const cat = await fetchCatalog(fetchFn);
    expect(cat.sources).toEqual([
      { name: "proxyscrape", ok: true, count: 2 },
      { name: "geonode", ok: false, count: 0, error: "boom" },
    ]);
    expect(cat.items).toHaveLength(2);
  });

  it("HTTP error status is reported", async () => {
    const cat = await fetchCatalog(
      async () => new Response("x", { status: 503 }),
    );
    expect(cat.sources.every((s) => !s.ok && s.error === "HTTP 503")).toBe(
      true,
    );
  });
});

// ───── fake proxies ─────
type Fake = { port: number; close: () => Promise<void>; requests: Buffer[] };
async function listen(
  onConn: (s: net.Socket, requests: Buffer[]) => void,
): Promise<Fake> {
  const requests: Buffer[] = [];
  const conns = new Set<net.Socket>();
  const server = net.createServer((s) => {
    conns.add(s);
    s.on("close", () => conns.delete(s));
    s.on("error", () => undefined);
    onConn(s, requests);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    port: (server.address() as net.AddressInfo).port,
    requests,
    close: () =>
      new Promise<void>((r) => {
        for (const c of conns) c.destroy();
        server.close(() => r());
      }),
  };
}

// 200 ⇒ nối vào upstream TLS (`onTunnel` thay được: reset, MITM…).
const httpProxy = (
  status: string,
  onTunnel: (s: net.Socket) => void = pipeUpstream,
) =>
  listen((s, reqs) =>
    s.once("data", (d) => {
      reqs.push(d);
      s.write(`HTTP/1.1 ${status}\r\n\r\n`);
      if (status.startsWith("200")) onTunnel(s);
    }),
  );

const socksProxy = (rep: number, greet = 0x00): Promise<Fake> =>
  listen((s, reqs) => {
    let stage = 0;
    s.on("data", (d) => {
      reqs.push(d);
      if (stage === 0) {
        stage = 1;
        s.write(Buffer.from([0x05, greet]));
      } else if (stage === 1) {
        stage = 2;
        s.write(Buffer.from([0x05, rep, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        if (rep === 0) {
          s.removeAllListeners("data");
          pipeUpstream(s);
        }
      }
    });
  });

describe("probeProxy", () => {
  it("http CONNECT 200 → ok with latency, request is exactly the CONNECT", async () => {
    const f = await httpProxy("200 Connection established");
    const r = await probeProxy(
      { type: "http", host: "127.0.0.1", port: f.port },
      { ca: TLS_CERT },
    );
    expect(r.ok).toBe(true);
    expect(f.requests[0]?.toString()).toBe(
      "CONNECT www.cloudflare.com:443 HTTP/1.1\r\nHost: www.cloudflare.com:443\r\n\r\n",
    );
    await f.close();
  });

  it("tunnel 200 but TLS reset inside (censored network) → tls-reset", async () => {
    const f = await httpProxy("200 OK", (s) =>
      setTimeout(() => s.destroy(), 10),
    );
    expect(
      await probeProxy(
        { type: "http", host: "127.0.0.1", port: f.port },
        { ca: TLS_CERT },
      ),
    ).toEqual({ ok: false, error: "tls-reset" });
    await f.close();
  });

  it("certificate not trusted (proxy decrypting TLS) → tls-cert", async () => {
    const f = await httpProxy("200 OK");
    expect(
      await probeProxy({ type: "http", host: "127.0.0.1", port: f.port }),
    ).toEqual({
      ok: false,
      error: "tls-cert",
    });
    await f.close();
  });

  it("http 403 → error", async () => {
    const f = await httpProxy("403 Forbidden");
    expect(
      await probeProxy({ type: "http", host: "127.0.0.1", port: f.port }),
    ).toEqual({
      ok: false,
      error: "http 403",
    });
    await f.close();
  });

  it("http non-HTTP garbage → bad-response", async () => {
    const f = await listen((s) =>
      s.once("data", () => s.write("SSH-2.0-x\r\n")),
    );
    expect(
      await probeProxy({ type: "http", host: "127.0.0.1", port: f.port }),
    ).toEqual({
      ok: false,
      error: "bad-response",
    });
    await f.close();
  });

  it("socks5 success: greeting 05 01 00, CONNECT by domain", async () => {
    const f = await socksProxy(0x00);
    const r = await probeProxy(
      { type: "socks5", host: "127.0.0.1", port: f.port },
      { ca: TLS_CERT },
    );
    expect(r.ok).toBe(true);
    expect([...f.requests[0]!]).toEqual([5, 1, 0]);
    const req = f.requests[1]!;
    expect([...req.subarray(0, 5)]).toEqual([
      5,
      1,
      0,
      3,
      "www.cloudflare.com".length,
    ]);
    expect(req.subarray(5, -2).toString()).toBe("www.cloudflare.com");
    expect(req.readUInt16BE(req.length - 2)).toBe(443);
    await f.close();
  });

  it("socks5 refused by upstream (rep 5) and auth-required greeting", async () => {
    const a = await socksProxy(0x05);
    expect(
      await probeProxy({ type: "socks5", host: "127.0.0.1", port: a.port }),
    ).toEqual({
      ok: false,
      error: "socks-rep-5",
    });
    const b = await socksProxy(0x00, 0x02);
    expect(
      await probeProxy({ type: "socks5", host: "127.0.0.1", port: b.port }),
    ).toEqual({
      ok: false,
      error: "socks-auth-required",
    });
    await a.close();
    await b.close();
  });

  it("socks5 reply split across packets still works", async () => {
    const f = await listen((s) => {
      let stage = 0;
      s.on("data", () => {
        if (stage++ === 0) s.write(Buffer.from([0x05, 0x00]));
        else {
          s.removeAllListeners("data");
          s.write(Buffer.from([0x05]));
          setTimeout(() => {
            s.write(Buffer.from([0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            pipeUpstream(s);
          }, 20);
        }
      });
    });
    const r = await probeProxy(
      { type: "socks5", host: "127.0.0.1", port: f.port },
      { ca: TLS_CERT },
    );
    expect(r.ok).toBe(true);
    await f.close();
  });

  it("timeout when proxy never answers; connection refused", async () => {
    const f = await listen(() => undefined);
    const t0 = Date.now();
    expect(
      await probeProxy(
        { type: "http", host: "127.0.0.1", port: f.port },
        { timeoutMs: 150 },
      ),
    ).toEqual({ ok: false, error: "timeout" });
    expect(Date.now() - t0).toBeLessThan(1500);
    await f.close();
    const r = await probeProxy(
      { type: "http", host: "127.0.0.1", port: f.port },
      { timeoutMs: 1000 },
    );
    expect(r).toEqual({ ok: false, error: "ECONNREFUSED" });
  });

  it("abort destroys the socket", async () => {
    const f = await listen(() => undefined);
    const ac = new AbortController();
    const p = probeProxy(
      { type: "http", host: "127.0.0.1", port: f.port },
      { signal: ac.signal },
    );
    setTimeout(() => ac.abort(), 30);
    expect(await p).toEqual({ ok: false, error: "cancelled" });
    await f.close();
  });
});

describe("startProbe", () => {
  const item = (port: number, type: "http" | "socks5" = "http"): FreeProxy => ({
    id: `${type}://127.0.0.1:${port}`,
    type,
    host: "127.0.0.1",
    port,
    country: "DE",
    anonymity: "elite",
    sources: ["t"],
  });
  const waitFor = async (cond: () => boolean): Promise<void> => {
    for (let i = 0; i < 100 && !cond(); i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(cond()).toBe(true);
  };

  it("rejects unknown ids, empty and oversize lists — before any socket is opened", () => {
    primeCatalog({ fetchedAt: Date.now(), sources: [], items: [item(1)] });
    expect(() => startProbe(["http://9.9.9.9:80"])).toThrow(FreeProxyError);
    expect(() => startProbe([])).toThrow(FreeProxyError);
    expect(() =>
      startProbe(
        Array.from({ length: 61 }, (_, i) => `http://1.1.1.1:${i + 1}`),
      ),
    ).toThrow(FreeProxyError);
    expect(events).toHaveLength(0);
  });

  it("streams one event per proxy then probeDone", async () => {
    const good = await httpProxy("200 OK");
    const bad = await httpProxy("407 Proxy Authentication Required");
    primeCatalog({
      fetchedAt: Date.now(),
      sources: [],
      items: [item(good.port), item(bad.port)],
    });
    const { probeId } = startProbe([item(good.port).id, item(bad.port).id], {
      ca: TLS_CERT,
    });
    await waitFor(() => events.some((e) => e.type === "freeProxies.probeDone"));
    const probed = events
      .filter((e) => e.type === "freeProxies.probed")
      .map((e) => e.payload);
    expect(probed).toHaveLength(2);
    expect(probed.every((p) => p.probeId === probeId)).toBe(true);
    expect(probed.find((p) => p.id === item(good.port).id)).toMatchObject({
      ok: true,
      blocked: [],
    });
    expect(probed.find((p) => p.id === item(bad.port).id)).toMatchObject({
      ok: false,
      error: "http 407",
    });
    expect(events.at(-1)).toMatchObject({
      type: "freeProxies.probeDone",
      payload: { probeId },
    });
    await good.close();
    await bad.close();
  });

  it("flags a proxy that reaches cloudflare but not google as blocked", async () => {
    // Định tuyến theo đích của CONNECT: cloudflare ⇒ upstream thật, google ⇒ reset (GFW).
    const f = await listen((s) =>
      s.once("data", (d) => {
        s.write("HTTP/1.1 200 OK\r\n\r\n");
        if (d.toString().includes("www.google.com"))
          setTimeout(() => s.destroy(), 10);
        else pipeUpstream(s);
      }),
    );
    primeCatalog({ fetchedAt: Date.now(), sources: [], items: [item(f.port)] });
    startProbe([item(f.port).id], { ca: TLS_CERT });
    await waitFor(() => events.some((e) => e.type === "freeProxies.probeDone"));
    expect(
      events.find((e) => e.type === "freeProxies.probed")?.payload,
    ).toMatchObject({
      ok: true,
      blocked: ["google"],
    });
    await f.close();
  });

  it("a new probe cancels the running one (no events for the old id)", async () => {
    const hang = await listen(() => undefined);
    const ok = await httpProxy("200 OK");
    primeCatalog({
      fetchedAt: Date.now(),
      sources: [],
      items: [item(hang.port), item(ok.port)],
    });
    const first = startProbe([item(hang.port).id]);
    const second = startProbe([item(ok.port).id], { ca: TLS_CERT });
    await waitFor(() => events.some((e) => e.type === "freeProxies.probeDone"));
    await new Promise((r) => setTimeout(r, 100));
    expect(events.every((e) => e.payload.probeId === second.probeId)).toBe(
      true,
    );
    expect(first.probeId).not.toBe(second.probeId);
    await hang.close();
    await ok.close();
  });
});
