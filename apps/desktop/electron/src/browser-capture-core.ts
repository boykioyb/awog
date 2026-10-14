import type {
  CaptureBody,
  CaptureEntry,
  CaptureSecurity,
  CaptureState,
  CaptureSummary,
  CaptureTiming,
  HeaderPair,
  WsFrame,
} from "./browser-capture-types";

// Lõi THUẦN của bộ bắt request (docs/features/network-capture.md): sự kiện CDP `Network.*`
// → CaptureEntry, gộp ExtraInfo, chuỗi redirect, WebSocket, ring + ngân sách body, HAR 1.2.
// Không import `electron` để chạy được dưới `node --test`. Mọi I/O (getResponseBody,
// getRequestPostData) là việc của `browser-capture.ts`: core chỉ TRẢ VỀ "effect" cần làm.
//
// Dữ liệu ở đây chứa cookie/token thật — chỉ nằm trong bộ nhớ main, không log, không ghi đĩa
// (trừ HAR do người dùng chủ động lưu).

export const MAX_ENTRIES = 5000;
export const RESPONSE_BODY_CAP = 5 * 1024 * 1024;
export const REQUEST_BODY_CAP = 1024 * 1024;
export const BODY_BUDGET_BYTES = 256 * 1024 * 1024;
export const WS_MAX_FRAMES = 500;
export const WS_PAYLOAD_CAP = 64 * 1024;

// Việc I/O mà wrapper phải làm sau khi core xử lý một sự kiện.
export type CaptureEffect =
  | { kind: "responseBody"; id: string; requestId: string }
  | { kind: "postData"; id: string; requestId: string };

type BodyKind = "request" | "response";

// ── helpers ────────────────────────────────────────────────────────────────

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const round2 = (n: number): number => Math.round(n * 100) / 100;

// CDP gộp header trùng tên bằng '\n' (đặc biệt Set-Cookie) ⇒ tách lại thành từng dòng.
// Pseudo-header của h2 (`:authority`…) bỏ đi: không phải header HTTP.
export function toPairs(h: unknown): HeaderPair[] {
  const out: HeaderPair[] = [];
  for (const [name, value] of Object.entries(obj(h))) {
    if (name.startsWith(":")) continue;
    const text = typeof value === "string" ? value : String(value ?? "");
    for (const line of text.split("\n")) out.push([name, line]);
  }
  return out;
}

function splitUrl(raw: string): { host: string; path: string; scheme: string } {
  try {
    const u = new URL(raw);
    return {
      host: u.host,
      path: `${u.pathname}${u.search}`,
      scheme: u.protocol.replace(/:$/, ""),
    };
  } catch {
    return { host: "", path: raw, scheme: "" };
  }
}

const base64Size = (b64: string): number => {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
};

// Body "như nhận": utf8 text hoặc base64 khi nhị phân; cắt theo `cap` byte GỐC.
export function makeBody(
  text: string,
  base64: boolean,
  cap: number,
): CaptureBody {
  const size = base64 ? base64Size(text) : Buffer.byteLength(text, "utf8");
  if (size <= cap) return { text, base64, truncated: false, size };
  const cut = base64
    ? text.slice(0, Math.floor(cap / 3) * 4)
    : Buffer.from(text, "utf8").subarray(0, cap).toString("utf8");
  return { text: cut, base64, truncated: true, size };
}

const bodyBytes = (b: CaptureBody): number =>
  b.base64 ? b.text.length : Buffer.byteLength(b.text, "utf8");

// ── ngân sách body toàn app ───────────────────────────────────────────────

type BudgetItem = { store: CaptureStore; id: string; which: BodyKind };

// 256 MB cho MỌI tab cộng lại; vượt thì đẩy body CŨ NHẤT ra trước (entry vẫn còn, chỉ mất body).
export class BodyBudget {
  used = 0;
  private queue: BudgetItem[] = [];
  private compactAt = 10_000;

  constructor(readonly max: number = BODY_BUDGET_BYTES) {}

  register(
    store: CaptureStore,
    id: string,
    which: BodyKind,
    bytes: number,
  ): void {
    this.used += bytes;
    this.queue.push({ store, id, which });
    while (this.used > this.max && this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) item.store.evictBody(item.id, item.which);
    }
    if (this.queue.length > this.compactAt) {
      // Item "chết" (entry đã rớt khỏi ring / bị clear) không còn body ⇒ lọc bỏ.
      this.queue = this.queue.filter((i) => i.store.hasBody(i.id, i.which));
      this.compactAt = Math.max(10_000, this.queue.length * 2);
    }
  }

  release(bytes: number): void {
    this.used = Math.max(0, this.used - bytes);
  }
}

// ── store ──────────────────────────────────────────────────────────────────

type RawTiming = {
  requestTime: number;
  dnsStart: number;
  dnsEnd: number;
  connectStart: number;
  connectEnd: number;
  sslStart: number;
  sslEnd: number;
  sendStart: number;
  sendEnd: number;
  receiveHeadersEnd: number;
};

type ExtraReq = {
  headers: HeaderPair[];
  blocked: { name: string; reasons: string[] }[];
};
type ExtraRes = {
  headers: HeaderPair[];
  headersText?: string;
  blocked: { name: string; reasons: string[] }[];
};

type Meta = {
  monoStart: number;
  base: { req: HeaderPair[]; res: HeaderPair[] };
  extra: { req?: ExtraReq; res?: ExtraRes };
  timing?: RawTiming;
};

type Chain = {
  hops: string[]; // id từng hop theo thứ tự
  pendingReq: ExtraReq[];
  pendingRes: ExtraRes[];
};

const SUMMARY_KEYS: (keyof CaptureSummary)[] = [
  "id",
  "seq",
  "tabId",
  "startedAt",
  "method",
  "url",
  "host",
  "path",
  "scheme",
  "resourceType",
  "status",
  "statusText",
  "mimeType",
  "state",
  "error",
  "blockedReason",
  "encodedBytes",
  "durationMs",
  "fromCache",
  "fromServiceWorker",
  "isNavigation",
  "hasRequestBody",
  "hasResponseBody",
  "redirectedTo",
  "wsFrameCount",
];

export function toSummary(e: CaptureEntry): CaptureSummary {
  const out: Record<string, unknown> = {};
  const src = e as unknown as Record<string, unknown>;
  for (const k of SUMMARY_KEYS) if (src[k] !== undefined) out[k] = src[k];
  return out as unknown as CaptureSummary;
}

export class CaptureStore {
  recording = false;
  dropped = 0;
  bodyBytes = 0;

  private entries: CaptureEntry[] = [];
  private index = new Map<string, CaptureEntry>();
  private meta = new Map<string, Meta>();
  private chains = new Map<string, Chain>();
  private dirty = new Set<string>();
  private seq = 0;
  private mainFrameId: string | null = null;
  // wallTime − timestamp (giây): đổi mốc đơn điệu của CDP sang epoch.
  private wallOffset: number | null = null;

  constructor(
    readonly tabId: string,
    private readonly budget: BodyBudget = new BodyBudget(),
    private readonly maxEntries: number = MAX_ENTRIES,
  ) {}

  // ── điều khiển ──
  setMainFrame(frameId: string): void {
    this.mainFrameId = frameId;
  }

  state(): CaptureState {
    return {
      tabId: this.tabId,
      recording: this.recording,
      count: this.entries.length,
      dropped: this.dropped,
      bodyBytes: this.bodyBytes,
    };
  }

  clear(): void {
    for (const e of this.entries) this.releaseBodies(e);
    this.entries = [];
    this.index.clear();
    this.meta.clear();
    this.chains.clear();
    this.dirty.clear();
    this.dropped = 0;
    this.bodyBytes = 0;
  }

  list(sinceSeq?: number): CaptureSummary[] {
    const src =
      sinceSeq === undefined
        ? this.entries
        : this.entries.filter((e) => e.seq > sinceSeq);
    return src.map(toSummary);
  }

  get(id: string): CaptureEntry | null {
    return this.index.get(id) ?? null;
  }

  all(ids?: string[]): CaptureEntry[] {
    if (!ids) return [...this.entries];
    const want = new Set(ids);
    return this.entries.filter((e) => want.has(e.id));
  }

  get hasDirty(): boolean {
    return this.dirty.size > 0;
  }

  drainDirty(): CaptureSummary[] {
    const out: CaptureSummary[] = [];
    for (const id of this.dirty) {
      const e = this.index.get(id);
      if (e) out.push(toSummary(e));
    }
    this.dirty.clear();
    return out;
  }

  hasBody(id: string, which: BodyKind): boolean {
    const e = this.index.get(id);
    return !!e && (which === "request" ? !!e.requestBody : !!e.responseBody);
  }

  evictBody(id: string, which: BodyKind): void {
    const e = this.index.get(id);
    if (!e) return;
    const b = which === "request" ? e.requestBody : e.responseBody;
    if (!b) return;
    const bytes = bodyBytes(b);
    if (which === "request") {
      e.requestBody = undefined;
      e.hasRequestBody = false;
    } else {
      e.responseBody = undefined;
      e.hasResponseBody = false;
    }
    e.bodyEvicted = true;
    this.bodyBytes = Math.max(0, this.bodyBytes - bytes);
    this.budget.release(bytes);
    this.dirty.add(id);
  }

  // ── body do wrapper nạp ──
  setResponseBody(id: string, body: string, base64: boolean): void {
    const e = this.index.get(id);
    if (!e || e.responseBody) return;
    this.storeBody(e, "response", makeBody(body, base64, RESPONSE_BODY_CAP));
  }

  setRequestBody(id: string, body: string, base64: boolean): void {
    const e = this.index.get(id);
    if (!e || e.requestBody) return;
    this.storeBody(e, "request", makeBody(body, base64, REQUEST_BODY_CAP));
  }

  private storeBody(e: CaptureEntry, which: BodyKind, body: CaptureBody): void {
    if (which === "request") {
      e.requestBody = body;
      e.hasRequestBody = true;
    } else {
      e.responseBody = body;
      e.hasResponseBody = true;
    }
    const bytes = bodyBytes(body);
    this.bodyBytes += bytes;
    this.dirty.add(e.id);
    this.budget.register(this, e.id, which, bytes);
  }

  private releaseBodies(e: CaptureEntry): void {
    for (const b of [e.requestBody, e.responseBody])
      if (b) this.budget.release(bodyBytes(b));
  }

  // ── CDP ──
  handle(method: string, params: Record<string, unknown>): CaptureEffect[] {
    if (!this.recording) return [];
    const requestId = str(params.requestId);
    if (!requestId) return [];
    switch (method) {
      case "Network.requestWillBeSent":
        return this.onRequest(requestId, params);
      case "Network.requestWillBeSentExtraInfo":
        this.onRequestExtra(requestId, params);
        return [];
      case "Network.responseReceived":
        this.onResponse(requestId, params);
        return [];
      case "Network.responseReceivedExtraInfo":
        this.onResponseExtra(requestId, params);
        return [];
      case "Network.requestServedFromCache": {
        const e = this.current(requestId);
        if (e) {
          e.fromCache = true;
          this.dirty.add(e.id);
        }
        return [];
      }
      case "Network.loadingFinished":
        return this.onFinished(requestId, params);
      case "Network.loadingFailed":
        this.onFailed(requestId, params);
        return [];
      case "Network.webSocketCreated":
        this.onWsCreated(requestId, params);
        return [];
      case "Network.webSocketWillSendHandshakeRequest":
        this.onWsHandshakeRequest(requestId, params);
        return [];
      case "Network.webSocketHandshakeResponseReceived":
        this.onWsHandshakeResponse(requestId, params);
        return [];
      case "Network.webSocketFrameSent":
        this.onWsFrame(requestId, params, "sent");
        return [];
      case "Network.webSocketFrameReceived":
        this.onWsFrame(requestId, params, "received");
        return [];
      case "Network.webSocketFrameError": {
        const e = this.current(requestId);
        if (e) {
          e.error = str(params.errorMessage) || "websocket error";
          this.dirty.add(e.id);
        }
        return [];
      }
      case "Network.webSocketClosed":
        this.onWsClosed(requestId, params);
        return [];
      default:
        return [];
    }
  }

  private current(requestId: string): CaptureEntry | undefined {
    const chain = this.chains.get(requestId);
    const id = chain?.hops[chain.hops.length - 1];
    return id ? this.index.get(id) : undefined;
  }

  private toWall(ts: number | null): number {
    if (ts === null || this.wallOffset === null) return Date.now();
    return Math.round((ts + this.wallOffset) * 1000);
  }

  private create(
    requestId: string,
    init: Pick<
      CaptureEntry,
      "method" | "url" | "resourceType" | "startedAt"
    > & { mono: number },
  ): CaptureEntry {
    let chain = this.chains.get(requestId);
    if (!chain) {
      chain = { hops: [], pendingReq: [], pendingRes: [] };
      this.chains.set(requestId, chain);
    }
    const hop = chain.hops.length;
    const id = hop === 0 ? requestId : `${requestId}#${hop}`;
    const { host, path, scheme } = splitUrl(init.url);
    const entry: CaptureEntry = {
      id,
      seq: ++this.seq,
      tabId: this.tabId,
      startedAt: init.startedAt,
      method: init.method,
      url: init.url,
      host,
      path,
      scheme,
      resourceType: init.resourceType,
      status: null,
      statusText: "",
      mimeType: "",
      state: "pending",
      encodedBytes: null,
      durationMs: null,
      fromCache: false,
      fromServiceWorker: false,
      isNavigation: false,
      hasRequestBody: false,
      hasResponseBody: false,
      requestHeaders: [],
      responseHeaders: [],
    };
    this.entries.push(entry);
    this.index.set(id, entry);
    this.meta.set(id, {
      monoStart: init.mono,
      base: { req: [], res: [] },
      extra: {},
    });
    chain.hops.push(id);
    // ExtraInfo tới TRƯỚC sự kiện gốc đã được đệm theo requestId.
    const req = chain.pendingReq.shift();
    if (req) this.applyReqExtra(entry, req);
    const res = chain.pendingRes.shift();
    if (res) this.applyResExtra(entry, res);
    this.dirty.add(id);
    this.enforceRing();
    return entry;
  }

  private enforceRing(): void {
    while (this.entries.length > this.maxEntries) {
      const old = this.entries.shift();
      if (!old) break;
      this.releaseBodies(old);
      this.bodyBytes = Math.max(
        0,
        this.bodyBytes -
          (old.requestBody ? bodyBytes(old.requestBody) : 0) -
          (old.responseBody ? bodyBytes(old.responseBody) : 0),
      );
      this.index.delete(old.id);
      this.meta.delete(old.id);
      this.dirty.delete(old.id);
      this.dropped++;
      const requestId = old.id.split("#")[0] ?? old.id;
      const chain = this.chains.get(requestId);
      if (chain) {
        chain.hops = chain.hops.filter((h) => h !== old.id);
        if (chain.hops.length === 0) this.chains.delete(requestId);
      }
    }
  }

  private onRequest(
    requestId: string,
    p: Record<string, unknown>,
  ): CaptureEffect[] {
    const req = obj(p.request);
    const ts = num(p.timestamp);
    const wall = num(p.wallTime);
    if (ts !== null && wall !== null) this.wallOffset = wall - ts;
    const url = str(req.url);
    const type = str(p.type) || "Other";

    // Redirect: đóng hop trước (nó đã có đáp án 3xx) rồi mở hop mới.
    const prev = this.current(requestId);
    if (prev && p.redirectResponse) {
      const pm = this.meta.get(prev.id);
      this.applyResponse(prev, obj(p.redirectResponse));
      prev.redirectedTo = url;
      prev.state = "done";
      if (pm && ts !== null) this.finishTiming(prev, pm, ts);
      this.dirty.add(prev.id);
    }

    const entry = this.create(requestId, {
      method: str(req.method) || "GET",
      url,
      resourceType: type,
      startedAt: wall !== null ? Math.round(wall * 1000) : this.toWall(ts),
      mono: ts ?? 0,
    });
    const m = this.meta.get(entry.id);
    if (m) m.base.req = toPairs(req.headers);
    this.syncHeaders(entry);
    entry.frameId = str(p.frameId) || undefined;
    entry.documentUrl = str(p.documentURL) || undefined;
    entry.initiator = this.readInitiator(p.initiator);
    entry.isNavigation =
      type === "Document" &&
      str(p.loaderId) === requestId &&
      (this.mainFrameId === null || str(p.frameId) === this.mainFrameId);

    const effects: CaptureEffect[] = [];
    const post = typeof req.postData === "string" ? req.postData : "";
    if (post) {
      this.setRequestBody(entry.id, post, false);
    } else if (req.hasPostData === true) {
      entry.hasRequestBody = true;
      effects.push({ kind: "postData", id: entry.id, requestId });
    }
    return effects;
  }

  private readInitiator(raw: unknown): CaptureEntry["initiator"] {
    const i = obj(raw);
    const type = str(i.type);
    if (!type) return undefined;
    const out: NonNullable<CaptureEntry["initiator"]> = { type };
    const url = str(i.url);
    if (url) out.url = url;
    const line = num(i.lineNumber);
    if (line !== null) out.lineNumber = line;
    const frames = obj(i.stack).callFrames;
    if (Array.isArray(frames) && frames.length > 0) {
      out.stack = frames.slice(0, 10).map((f) => {
        const fr = obj(f);
        const fn = str(fr.functionName) || "(anonymous)";
        return `${fn} @ ${str(fr.url)}:${num(fr.lineNumber) ?? 0}`;
      });
      if (!out.url) {
        const first = obj(frames[0]);
        out.url = str(first.url) || undefined;
        out.lineNumber = num(first.lineNumber) ?? undefined;
      }
    }
    return out;
  }

  private syncHeaders(e: CaptureEntry): void {
    const m = this.meta.get(e.id);
    if (!m) return;
    e.requestHeaders = m.extra.req?.headers ?? m.base.req;
    e.responseHeaders = m.extra.res?.headers ?? m.base.res;
    this.dirty.add(e.id);
  }

  // Hop SỚM NHẤT còn thiếu ExtraInfo loại đó (ExtraInfo không mang url nên chỉ so được theo thứ tự).
  private firstMissing(
    requestId: string,
    which: "req" | "res",
  ): CaptureEntry | undefined {
    const chain = this.chains.get(requestId);
    if (!chain) return undefined;
    for (const id of chain.hops) {
      if (!this.meta.get(id)?.extra[which]) return this.index.get(id);
    }
    return undefined;
  }

  private onRequestExtra(requestId: string, p: Record<string, unknown>): void {
    const blocked: ExtraReq["blocked"] = [];
    if (Array.isArray(p.associatedCookies)) {
      for (const c of p.associatedCookies) {
        const o = obj(c);
        const reasons = Array.isArray(o.blockedReasons)
          ? o.blockedReasons.map(String)
          : [];
        if (reasons.length > 0)
          blocked.push({ name: str(obj(o.cookie).name), reasons });
      }
    }
    const extra: ExtraReq = { headers: toPairs(p.headers), blocked };
    const target = this.firstMissing(requestId, "req");
    if (target) this.applyReqExtra(target, extra);
    else this.pending(requestId).pendingReq.push(extra);
  }

  private onResponseExtra(requestId: string, p: Record<string, unknown>): void {
    const blocked: ExtraRes["blocked"] = [];
    if (Array.isArray(p.blockedCookies)) {
      for (const c of p.blockedCookies) {
        const o = obj(c);
        const reasons = Array.isArray(o.blockedReasons)
          ? o.blockedReasons.map(String)
          : [];
        if (reasons.length === 0) continue;
        const name =
          str(obj(o.cookie).name) ||
          str(o.cookieLine).split("=")[0]?.trim() ||
          "";
        blocked.push({ name, reasons });
      }
    }
    const extra: ExtraRes = {
      headers: toPairs(p.headers),
      headersText: str(p.headersText) || undefined,
      blocked,
    };
    const target = this.firstMissing(requestId, "res");
    if (target) this.applyResExtra(target, extra);
    else this.pending(requestId).pendingRes.push(extra);
  }

  private pending(requestId: string): Chain {
    let c = this.chains.get(requestId);
    if (!c) {
      c = { hops: [], pendingReq: [], pendingRes: [] };
      this.chains.set(requestId, c);
    }
    return c;
  }

  private mergeBlocked(
    e: CaptureEntry,
    list: { name: string; reasons: string[] }[],
  ): void {
    if (list.length === 0) return;
    e.blockedCookies = [...(e.blockedCookies ?? []), ...list];
  }

  private applyReqExtra(e: CaptureEntry, x: ExtraReq): void {
    const m = this.meta.get(e.id);
    if (!m) return;
    m.extra.req = x;
    this.mergeBlocked(e, x.blocked);
    this.syncHeaders(e);
  }

  private applyResExtra(e: CaptureEntry, x: ExtraRes): void {
    const m = this.meta.get(e.id);
    if (!m) return;
    m.extra.res = x;
    if (x.headersText) e.responseHeadersText = x.headersText;
    this.mergeBlocked(e, x.blocked);
    this.syncHeaders(e);
  }

  private applyResponse(e: CaptureEntry, r: Record<string, unknown>): void {
    const m = this.meta.get(e.id);
    if (!m) return;
    e.status = num(r.status);
    e.statusText = str(r.statusText);
    e.mimeType = str(r.mimeType);
    m.base.res = toPairs(r.headers);
    if (!m.base.req.length) m.base.req = toPairs(r.requestHeaders);
    const reqText = str(r.requestHeadersText);
    if (reqText) e.requestHeadersText = reqText;
    const resText = str(r.headersText);
    if (resText && !e.responseHeadersText) e.responseHeadersText = resText;
    const protocol = str(r.protocol);
    if (protocol) e.httpVersion = protocol;
    const ip = str(r.remoteIPAddress);
    if (ip) e.remoteIP = ip;
    const port = num(r.remotePort);
    if (port !== null) e.remotePort = port;
    if (r.fromDiskCache === true || r.fromPrefetchCache === true)
      e.fromCache = true;
    if (r.fromServiceWorker === true) e.fromServiceWorker = true;
    const t = obj(r.timing);
    if (num(t.requestTime) !== null) {
      const n = (k: string): number => num(t[k]) ?? -1;
      m.timing = {
        requestTime: n("requestTime"),
        dnsStart: n("dnsStart"),
        dnsEnd: n("dnsEnd"),
        connectStart: n("connectStart"),
        connectEnd: n("connectEnd"),
        sslStart: n("sslStart"),
        sslEnd: n("sslEnd"),
        sendStart: n("sendStart"),
        sendEnd: n("sendEnd"),
        receiveHeadersEnd: n("receiveHeadersEnd"),
      };
    }
    const sd = obj(r.securityDetails);
    if (Object.keys(sd).length > 0) e.security = this.readSecurity(sd);
    this.syncHeaders(e);
  }

  private readSecurity(sd: Record<string, unknown>): CaptureSecurity {
    const s: CaptureSecurity = {};
    const set = <K extends keyof CaptureSecurity>(
      k: K,
      v: CaptureSecurity[K] | undefined,
    ): void => {
      if (v !== undefined && v !== "") s[k] = v;
    };
    set("protocol", str(sd.protocol));
    set("cipher", str(sd.cipher));
    set("keyExchange", str(sd.keyExchange) || str(sd.keyExchangeGroup));
    set("subjectName", str(sd.subjectName));
    set("issuer", str(sd.issuer));
    const from = num(sd.validFrom);
    const to = num(sd.validTo);
    if (from !== null) s.validFrom = from * 1000;
    if (to !== null) s.validTo = to * 1000;
    if (Array.isArray(sd.sanList)) s.sanList = sd.sanList.map(String);
    set("certificateTransparency", str(sd.certificateTransparencyCompliance));
    return s;
  }

  private onResponse(requestId: string, p: Record<string, unknown>): void {
    const e = this.current(requestId);
    if (!e) return;
    this.applyResponse(e, obj(p.response));
    const type = str(p.type);
    if (type) e.resourceType = type;
    const f = str(p.frameId);
    if (f && !e.frameId) e.frameId = f;
  }

  private finishTiming(e: CaptureEntry, m: Meta, endTs: number): void {
    const total = Math.max(0, (endTs - m.monoStart) * 1000);
    const timing: CaptureTiming = { totalMs: round2(total) };
    const t = m.timing;
    if (t) {
      const span = (a: number, b: number): number | undefined =>
        a >= 0 && b >= 0 ? round2(Math.max(0, b - a)) : undefined;
      const starts = [t.dnsStart, t.connectStart, t.sendStart].filter(
        (x) => x >= 0,
      );
      const first = starts.length > 0 ? Math.min(...starts) : 0;
      timing.blockedMs = round2(
        Math.max(0, (t.requestTime - m.monoStart) * 1000 + first),
      );
      timing.dnsMs = span(t.dnsStart, t.dnsEnd);
      // connect GỒM SSL (như DevTools/HAR); `sslMs` là phần con.
      timing.connectMs = span(t.connectStart, t.connectEnd);
      timing.sslMs = span(t.sslStart, t.sslEnd);
      timing.sendMs = span(t.sendStart, t.sendEnd);
      if (t.sendEnd >= 0 && t.receiveHeadersEnd >= 0) {
        timing.waitMs = round2(Math.max(0, t.receiveHeadersEnd - t.sendEnd));
      }
      if (t.receiveHeadersEnd >= 0) {
        timing.receiveMs = round2(
          Math.max(0, (endTs - t.requestTime) * 1000 - t.receiveHeadersEnd),
        );
      }
      for (const k of Object.keys(timing) as (keyof CaptureTiming)[]) {
        if (timing[k] === undefined) delete timing[k];
      }
    }
    e.timing = timing;
    e.durationMs = timing.totalMs ?? null;
  }

  private onFinished(
    requestId: string,
    p: Record<string, unknown>,
  ): CaptureEffect[] {
    const e = this.current(requestId);
    const m = e ? this.meta.get(e.id) : undefined;
    if (!e || !m) return [];
    e.state = "done";
    e.encodedBytes = num(p.encodedDataLength);
    const ts = num(p.timestamp);
    if (ts !== null) this.finishTiming(e, m, ts);
    this.dirty.add(e.id);
    if (e.resourceType === "WebSocket" || e.responseBody) return [];
    return [{ kind: "responseBody", id: e.id, requestId }];
  }

  private onFailed(requestId: string, p: Record<string, unknown>): void {
    const e = this.current(requestId);
    const m = e ? this.meta.get(e.id) : undefined;
    if (!e || !m) return;
    e.state = "failed";
    e.error = str(p.errorText) || "failed";
    const blocked = str(p.blockedReason);
    if (blocked) e.blockedReason = blocked;
    const type = str(p.type);
    if (type) e.resourceType = type;
    const ts = num(p.timestamp);
    if (ts !== null) this.finishTiming(e, m, ts);
    this.dirty.add(e.id);
  }

  // ── WebSocket ──
  private onWsCreated(requestId: string, p: Record<string, unknown>): void {
    const e = this.create(requestId, {
      method: "GET",
      url: str(p.url),
      resourceType: "WebSocket",
      startedAt: Date.now(),
      mono: Number.NaN,
    });
    e.wsFrames = [];
    e.wsFrameCount = 0;
    e.initiator = this.readInitiator(p.initiator);
  }

  private onWsHandshakeRequest(
    requestId: string,
    p: Record<string, unknown>,
  ): void {
    const e = this.current(requestId);
    const m = e ? this.meta.get(e.id) : undefined;
    if (!e || !m) return;
    const ts = num(p.timestamp);
    const wall = num(p.wallTime);
    if (ts !== null && wall !== null) this.wallOffset = wall - ts;
    if (ts !== null) m.monoStart = ts;
    if (wall !== null) e.startedAt = Math.round(wall * 1000);
    m.base.req = toPairs(obj(p.request).headers);
    this.syncHeaders(e);
  }

  private onWsHandshakeResponse(
    requestId: string,
    p: Record<string, unknown>,
  ): void {
    const e = this.current(requestId);
    if (!e) return;
    this.applyResponse(e, obj(p.response));
  }

  private onWsFrame(
    requestId: string,
    p: Record<string, unknown>,
    dir: WsFrame["dir"],
  ): void {
    const e = this.current(requestId);
    if (!e) return;
    const r = obj(p.response);
    const payloadData = str(r.payloadData);
    const truncated = payloadData.length > WS_PAYLOAD_CAP;
    const frames = (e.wsFrames ??= []);
    frames.push({
      dir,
      ts: this.toWall(num(p.timestamp)),
      opcode: num(r.opcode) ?? 1,
      // opcode 2 (binary) ⇒ payload là base64; còn lại là text.
      payload: truncated ? payloadData.slice(0, WS_PAYLOAD_CAP) : payloadData,
      truncated,
    });
    if (frames.length > WS_MAX_FRAMES)
      frames.splice(0, frames.length - WS_MAX_FRAMES);
    e.wsFrameCount = (e.wsFrameCount ?? 0) + 1;
    this.dirty.add(e.id);
  }

  private onWsClosed(requestId: string, p: Record<string, unknown>): void {
    const e = this.current(requestId);
    const m = e ? this.meta.get(e.id) : undefined;
    if (!e || !m) return;
    e.state = "done";
    const ts = num(p.timestamp);
    if (ts !== null && Number.isFinite(m.monoStart)) {
      e.durationMs = round2(Math.max(0, (ts - m.monoStart) * 1000));
      e.timing = { totalMs: e.durationMs };
    }
    this.dirty.add(e.id);
  }
}

// ── cookie ─────────────────────────────────────────────────────────────────

type HarCookie = {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  expires?: string;
  httpOnly?: boolean;
  secure?: boolean;
  _sameSite?: string;
};

function parseCookieHeader(v: string): HarCookie[] {
  const out: HarCookie[] = [];
  for (const part of v.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (name) out.push({ name, value: part.slice(i + 1).trim() });
  }
  return out;
}

function parseSetCookie(line: string): HarCookie | null {
  const [first, ...attrs] = line.split(";");
  const i = (first ?? "").indexOf("=");
  if (i < 0) return null;
  const c: HarCookie = {
    name: first!.slice(0, i).trim(),
    value: first!.slice(i + 1).trim(),
  };
  if (!c.name) return null;
  for (const a of attrs) {
    const j = a.indexOf("=");
    const key = (j < 0 ? a : a.slice(0, j)).trim().toLowerCase();
    const val = j < 0 ? "" : a.slice(j + 1).trim();
    if (key === "path") c.path = val;
    else if (key === "domain") c.domain = val;
    else if (key === "expires") {
      const d = new Date(val);
      if (!Number.isNaN(d.getTime())) c.expires = d.toISOString();
    } else if (key === "max-age" && !c.expires) {
      const secs = Number(val);
      if (Number.isFinite(secs))
        c.expires = new Date(Date.now() + secs * 1000).toISOString();
    } else if (key === "httponly") c.httpOnly = true;
    else if (key === "secure") c.secure = true;
    else if (key === "samesite") c._sameSite = val;
  }
  return c;
}

// ── HAR 1.2 ────────────────────────────────────────────────────────────────

export type HarLog = {
  log: {
    version: "1.2";
    creator: { name: string; version: string };
    pages: never[];
    entries: Record<string, unknown>[];
  };
};

const harVersion = (v: string | undefined): string => {
  const x = (v ?? "").toLowerCase();
  if (x === "h2") return "HTTP/2.0";
  if (x === "h3" || x.startsWith("h3-")) return "HTTP/3.0";
  if (x === "http/1.0") return "HTTP/1.0";
  return "HTTP/1.1";
};

const pairsToHar = (h: HeaderPair[]): { name: string; value: string }[] =>
  h.map(([name, value]) => ({ name, value }));

const headerValue = (h: HeaderPair[], name: string): string | undefined =>
  h.find(([n]) => n.toLowerCase() === name)?.[1];

export function buildHar(
  entries: CaptureEntry[],
  creator: { name: string; version: string },
): HarLog {
  return {
    log: {
      version: "1.2",
      creator,
      pages: [],
      entries: entries.map(harEntry),
    },
  };
}

function harEntry(e: CaptureEntry): Record<string, unknown> {
  let queryString: { name: string; value: string }[] = [];
  try {
    queryString = [...new URL(e.url).searchParams].map(([name, value]) => ({
      name,
      value,
    }));
  } catch {
    /* URL không parse được ⇒ không có query */
  }
  const cookieHeader = headerValue(e.requestHeaders, "cookie");
  const reqCookies = cookieHeader ? parseCookieHeader(cookieHeader) : [];
  const resCookies = e.responseHeaders
    .filter(([n]) => n.toLowerCase() === "set-cookie")
    .map(([, v]) => parseSetCookie(v))
    .filter((c): c is HarCookie => c !== null);

  const t = e.timing;
  const total = t?.totalMs ?? e.durationMs ?? 0;
  const timings = {
    blocked: t?.blockedMs ?? -1,
    dns: t?.dnsMs ?? -1,
    connect: t?.connectMs ?? -1,
    // ssl nằm TRONG connect (HAR 1.2) nên không cộng vào `time`.
    ssl: t?.sslMs ?? -1,
    send: t?.sendMs ?? 0,
    wait:
      t?.waitMs ??
      (t?.sendMs === undefined && t?.receiveMs === undefined ? total : 0),
    receive: t?.receiveMs ?? 0,
  };
  const time = [
    timings.blocked,
    timings.dns,
    timings.connect,
    timings.send,
    timings.wait,
    timings.receive,
  ]
    .filter((x) => x >= 0)
    .reduce((a, b) => a + b, 0);

  const post = e.requestBody;
  const contentType = headerValue(e.requestHeaders, "content-type") ?? "";
  const body = e.responseBody;
  const content: Record<string, unknown> = {
    size: body?.size ?? 0,
    mimeType: e.mimeType,
  };
  if (body) {
    content.text = body.text;
    if (body.base64) content.encoding = "base64";
  }

  const hasResponse = e.status !== null;
  const harEntry: Record<string, unknown> = {
    startedDateTime: new Date(e.startedAt).toISOString(),
    time: round2(time),
    request: {
      method: e.method,
      url: e.url,
      httpVersion: harVersion(e.httpVersion),
      cookies: reqCookies,
      headers: pairsToHar(e.requestHeaders),
      queryString,
      ...(post
        ? {
            postData: {
              mimeType: contentType,
              text: post.text,
              ...(post.base64 ? { _base64: true } : {}),
            },
          }
        : {}),
      headersSize: -1,
      bodySize: post ? post.size : 0,
    },
    response: {
      status: hasResponse ? e.status : 0,
      statusText: e.statusText,
      httpVersion: harVersion(e.httpVersion),
      cookies: resCookies,
      headers: pairsToHar(e.responseHeaders),
      content,
      redirectURL: headerValue(e.responseHeaders, "location") ?? "",
      headersSize: -1,
      bodySize: e.encodedBytes ?? -1,
    },
    cache: {},
    timings,
    _resourceType: e.resourceType,
  };
  if (e.remoteIP) harEntry.serverIPAddress = e.remoteIP;
  if (e.error) (harEntry.response as Record<string, unknown>)._error = e.error;
  if (e.resourceType === "WebSocket" && e.wsFrames) {
    harEntry._webSocketMessages = e.wsFrames.map((f) => ({
      type: f.dir === "sent" ? "send" : "receive",
      time: f.ts / 1000,
      opcode: f.opcode,
      data: f.payload,
    }));
  }
  return harEntry;
}
