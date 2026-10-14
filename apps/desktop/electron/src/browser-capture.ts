import { writeFile } from "node:fs/promises";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  session,
  type WebContents,
} from "electron";
import {
  BodyBudget,
  buildHar,
  CaptureStore,
  makeBody,
  RESPONSE_BODY_CAP,
  type CaptureEffect,
} from "./browser-capture-core";
import type {
  CaptureBody,
  CaptureEntry,
  CaptureEvent,
  CaptureState,
  ExportHarResult,
  HeaderPair,
  ReplayRequest,
  ReplayResult,
} from "./browser-capture-types";
import { partitionForProfile } from "./browser-profile";
import { log } from "./logger";
import { preloadPath } from "./paths";
import {
  applyNavigationGuards,
  loadAppRoute,
  WINDOW_BACKGROUND,
} from "./window";

// Bộ bắt request cho NGƯỜI DÙNG (infosec) — docs/features/network-capture.md.
//
// Tách hẳn khỏi `tab.network` của browser_tool: ring này giữ header THÔ (Cookie/Set-Cookie…),
// body, frame WebSocket, nên agent/sidecar KHÔNG BAO GIỜ thấy nó — không có tool, không có method
// hostRequest nào trỏ vào đây. Dữ liệu chỉ nằm trong bộ nhớ main + renderer của cửa sổ inspector;
// không log, không ghi đĩa trừ file HAR do người dùng chọn ở hộp thoại lưu.
//
// browser.ts chỉ có 2 móc nhỏ (`captureOnCdp`, `captureDropTab`); phần còn lại ở đây, và module
// này KHÔNG import browser.ts (tránh vòng) — ipc.ts nối hai bên qua `CaptureHost`.

export type CaptureTarget = {
  id: string;
  wc: WebContents;
  scope?: string;
  profileId: string;
  debuggerOk: boolean;
};

// Cổng vào browser.ts: `target` đi qua đúng cổng sở hữu `this.tab(tabId, scope)`.
export type CaptureHost = {
  target: (tabId: string, scope: string | undefined) => CaptureTarget;
  // `hostBlocked` của điều hướng — replay phải theo cùng luật SSRF/allowlist.
  blocked: (url: string, scope: string | undefined) => string | null;
  ready: (profileId: string) => Promise<void>;
};

const CHANNEL = "browser:capture:event";
const FLUSH_MS = 150;
const BODY_FETCH_CONCURRENCY = 6;
const REPLAY_TIMEOUT_MS = 30_000;
const REPLAY_MAX_HOPS = 10;

type TabCapture = {
  store: CaptureStore;
  wc: WebContents;
  timer: ReturnType<typeof setTimeout> | null;
  running: number;
  queue: (() => Promise<void>)[];
};

const budget = new BodyBudget();
const captures = new Map<string, TabCapture>();
const inspectors = new Map<string, BrowserWindow>();

// Test seam: thay hộp thoại lưu bằng một hàm trả đường dẫn (harness không bấm được dialog).
let savePathOverride: ((suggested: string) => string | null) | null = null;
export function setHarSavePathOverride(
  fn: ((suggested: string) => string | null) | null,
): void {
  savePathOverride = fn;
}

function broadcast(ev: CaptureEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed())
      win.webContents.send(CHANNEL, ev);
  }
}

function ensure(t: CaptureTarget): TabCapture {
  let c = captures.get(t.id);
  if (!c) {
    c = {
      store: new CaptureStore(t.id, budget),
      wc: t.wc,
      timer: null,
      running: 0,
      queue: [],
    };
    captures.set(t.id, c);
  }
  return c;
}

function flush(c: TabCapture): void {
  const entries = c.store.drainDirty();
  if (entries.length === 0) return;
  broadcast({ tabId: c.store.tabId, kind: "upsert", entries });
  broadcast({ tabId: c.store.tabId, kind: "state", state: c.store.state() });
}

function schedule(c: TabCapture): void {
  if (c.timer) return;
  c.timer = setTimeout(() => {
    c.timer = null;
    flush(c);
  }, FLUSH_MS);
}

function pump(c: TabCapture): void {
  while (c.running < BODY_FETCH_CONCURRENCY) {
    const job = c.queue.shift();
    if (!job) return;
    c.running++;
    void job().finally(() => {
      c.running--;
      pump(c);
    });
  }
}

async function runEffect(c: TabCapture, fx: CaptureEffect): Promise<void> {
  try {
    if (c.wc.isDestroyed()) return;
    if (fx.kind === "responseBody") {
      const r = (await c.wc.debugger.sendCommand("Network.getResponseBody", {
        requestId: fx.requestId,
      })) as { body?: string; base64Encoded?: boolean };
      if (typeof r.body === "string")
        c.store.setResponseBody(fx.id, r.body, r.base64Encoded === true);
    } else {
      const r = (await c.wc.debugger.sendCommand("Network.getRequestPostData", {
        requestId: fx.requestId,
      })) as { postData?: string; base64Encoded?: boolean };
      if (typeof r.postData === "string")
        c.store.setRequestBody(fx.id, r.postData, r.base64Encoded === true);
    }
    schedule(c);
  } catch {
    // Nhiều response không có body để lấy (redirect, 204, WebSocket, Chromium đã bỏ buffer):
    // entry vẫn đủ header/timing, chỉ `hasResponseBody` giữ false.
  }
}

// Móc duy nhất trên đường nóng của browser.ts: tab không ghi ⇒ một lượt tra Map rồi thoát.
export function captureOnCdp(
  tabId: string,
  method: string,
  params: Record<string, unknown>,
): void {
  const c = captures.get(tabId);
  if (!c || !c.store.recording) return;
  const effects = c.store.handle(method, params);
  for (const fx of effects) c.queue.push(() => runEffect(c, fx));
  if (effects.length > 0) pump(c);
  if (c.store.hasDirty) schedule(c);
}

// Tab bị huỷ ⇒ bỏ capture + đóng inspector của nó.
export function captureDropTab(tabId: string): void {
  const c = captures.get(tabId);
  if (c) {
    clearTimeout(c.timer ?? undefined);
    c.store.clear();
    captures.delete(tabId);
    broadcast({ tabId, kind: "cleared" });
  }
  const win = inspectors.get(tabId);
  inspectors.delete(tabId);
  if (win && !win.isDestroyed()) win.close();
}

const stateOf = (t: CaptureTarget): CaptureState =>
  captures.get(t.id)?.store.state() ?? {
    tabId: t.id,
    recording: false,
    count: 0,
    dropped: 0,
    bodyBytes: 0,
  };

async function startCapture(t: CaptureTarget): Promise<CaptureState> {
  if (!t.debuggerOk)
    throw new Error("network capture is not available on this tab");
  const c = ensure(t);
  c.store.recording = true;
  // Hỏi frame chính để đánh dấu request điều hướng. CÓ HẠN CHÓT: tab chưa từng điều
  // hướng (tab mới trống) thì CDP giữ lệnh tới lúc điều hướng đầu bắt đầu — đo trong
  // harness Electron 33: `start` treo vô hạn, nút ghi kẹt. Hết giờ ⇒ heuristic bên dưới.
  const FRAME_TREE_TIMEOUT_MS = 1_000;
  try {
    const tree = (await Promise.race([
      t.wc.debugger.sendCommand("Page.getFrameTree"),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("getFrameTree timeout")),
          FRAME_TREE_TIMEOUT_MS,
        ),
      ),
    ])) as { frameTree?: { frame?: { id?: string } } };
    const id = tree.frameTree?.frame?.id;
    if (id) c.store.setMainFrame(id);
  } catch {
    // Không biết frame chính ⇒ isNavigation rơi về heuristic loaderId === requestId.
  }
  const state = c.store.state();
  broadcast({ tabId: t.id, kind: "state", state });
  return state;
}

function stopCapture(t: CaptureTarget): CaptureState {
  const c = captures.get(t.id);
  if (!c) return stateOf(t);
  c.store.recording = false;
  flush(c);
  const state = c.store.state();
  broadcast({ tabId: t.id, kind: "state", state });
  return state;
}

function clearCapture(t: CaptureTarget): CaptureState {
  const c = captures.get(t.id);
  if (!c) return stateOf(t);
  clearTimeout(c.timer ?? undefined);
  c.timer = null;
  c.store.clear();
  broadcast({ tabId: t.id, kind: "cleared" });
  const state = c.store.state();
  broadcast({ tabId: t.id, kind: "state", state });
  return state;
}

// ── HAR ────────────────────────────────────────────────────────────────────

const safeName = (s: string): string =>
  s.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60) || "capture";

async function exportHar(
  t: CaptureTarget,
  ids: string[] | undefined,
  parent: BrowserWindow | null,
): Promise<ExportHarResult> {
  const entries: CaptureEntry[] = captures.get(t.id)?.store.all(ids) ?? [];
  let host = "";
  try {
    host = new URL(t.wc.getURL()).host;
  } catch {
    /* tab trống */
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const suggested = `${safeName(host || "network")}-${stamp}.har`;
  let path: string | null;
  if (savePathOverride) {
    path = savePathOverride(suggested);
  } else {
    const opts = {
      title: "Export HAR",
      defaultPath: suggested,
      filters: [{ name: "HAR", extensions: ["har", "json"] }],
    };
    const res = parent
      ? await dialog.showSaveDialog(parent, opts)
      : await dialog.showSaveDialog(opts);
    path = res.canceled || !res.filePath ? null : res.filePath;
  }
  if (!path) return { cancelled: true };
  const har = buildHar(entries, { name: "AWOG", version: app.getVersion() });
  // 0o600: file chứa cookie/token thật.
  await writeFile(path, JSON.stringify(har, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  log.info("network capture HAR exported", { entries: entries.length });
  return { path };
}

// ── Replay ─────────────────────────────────────────────────────────────────

// Các header trình duyệt/Chromium tự quản — gửi thủ công chỉ gây lỗi framing.
const REPLAY_SKIP_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
]);

function decodeBody(
  buf: Buffer,
  truncated: boolean,
  fullSize: number,
): CaptureBody {
  let text: string;
  let base64 = false;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = buf.toString("base64");
    base64 = true;
  }
  const body = makeBody(text, base64, Number.MAX_SAFE_INTEGER);
  return { ...body, truncated, size: truncated ? fullSize : body.size };
}

function replay(
  host: CaptureHost,
  t: CaptureTarget,
  req: ReplayRequest,
): Promise<ReplayResult> {
  const startedAt = Date.now();
  return new Promise<ReplayResult>((resolve) => {
    const fail = (error: string): void => resolve({ ok: false, error });
    let current = req.url;
    const blocked = host.blocked(current, t.scope);
    if (blocked) return fail(`blocked URL — ${blocked}`);
    void host.ready(t.profileId).then(() => {
      const headers = new Map<string, { name: string; value: string }>();
      for (const [name, value] of req.headers) {
        const key = name.toLowerCase();
        if (REPLAY_SKIP_HEADERS.has(key)) continue;
        const prev = headers.get(key);
        // setHeader chỉ giữ một giá trị mỗi tên ⇒ gộp trùng như HTTP cho phép.
        headers.set(key, {
          name: prev?.name ?? name,
          value: prev
            ? `${prev.value}${key === "cookie" ? "; " : ", "}${value}`
            : value,
        });
      }
      let request: Electron.ClientRequest;
      try {
        request = net.request({
          method: req.method,
          url: current,
          session: session.fromPartition(partitionForProfile(t.profileId)),
          // Cookie chỉ lấy từ header người dùng đã sửa — không tự thêm từ jar.
          credentials: "omit",
          useSessionCookies: false,
          redirect: "manual",
        });
        for (const { name, value } of headers.values())
          request.setHeader(name, value);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }

      let settled = false;
      const done = (r: ReplayResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };
      const timer = setTimeout(() => {
        done({
          ok: false,
          error: `timed out after ${REPLAY_TIMEOUT_MS / 1000}s`,
        });
        request.abort();
      }, REPLAY_TIMEOUT_MS);

      let hops = 0;
      request.on(
        "redirect",
        (statusCode, _method, redirectUrl, responseHeaders) => {
          if (req.followRedirects) {
            hops++;
            const reason = host.blocked(redirectUrl, t.scope);
            if (reason) {
              done({
                ok: false,
                error: `redirect to ${redirectUrl} blocked — ${reason}`,
              });
              request.abort();
              return;
            }
            if (hops > REPLAY_MAX_HOPS) {
              done({ ok: false, error: "too many redirects" });
              request.abort();
              return;
            }
            current = redirectUrl;
            request.followRedirect();
            return;
          }
          // Không theo: trả luôn đáp án 3xx (header dạng record ⇒ mất thứ tự, chấp nhận).
          const pairs: HeaderPair[] = [];
          for (const [name, values] of Object.entries(responseHeaders)) {
            for (const v of values) pairs.push([name, v]);
          }
          done({
            ok: true,
            status: statusCode,
            statusText: "",
            headers: pairs,
            body: { text: "", base64: false, truncated: false, size: 0 },
            timeMs: Date.now() - startedAt,
            url: current,
          });
          request.abort();
        },
      );
      request.on("response", (res) => {
        const chunks: Buffer[] = [];
        let got = 0;
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          if (settled) return;
          got += chunk.length;
          const room = RESPONSE_BODY_CAP - (got - chunk.length);
          if (room > 0)
            chunks.push(room < chunk.length ? chunk.subarray(0, room) : chunk);
          if (got > RESPONSE_BODY_CAP) truncated = true;
        });
        const finish = (): void => {
          const pairs: HeaderPair[] = [];
          const raw = res.rawHeaders;
          for (let i = 0; i + 1 < raw.length; i += 2)
            pairs.push([raw[i] ?? "", raw[i + 1] ?? ""]);
          done({
            ok: true,
            status: res.statusCode,
            statusText: res.statusMessage,
            headers: pairs,
            body: decodeBody(Buffer.concat(chunks), truncated, got),
            timeMs: Date.now() - startedAt,
            url: current,
          });
        };
        res.on("end", finish);
        res.on("error", (err: Error) =>
          done({ ok: false, error: err.message }),
        );
      });
      request.on("error", (err) => done({ ok: false, error: err.message }));
      if (req.body) {
        request.write(
          Buffer.from(req.body, req.bodyBase64 ? "base64" : "utf8"),
        );
      }
      request.end();
    });
  });
}

// ── cửa sổ inspector ───────────────────────────────────────────────────────

const INSPECTOR_WIDTH = 1180;
const INSPECTOR_HEIGHT = 780;

function openInspector(t: CaptureTarget): void {
  const existing = inspectors.get(t.id);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return;
  }
  let host = "";
  try {
    host = new URL(t.wc.getURL()).host;
  } catch {
    /* tab trống */
  }
  // Như preview/session window: preload chuẩn + contextIsolation + sandbox, và cùng luật điều hướng.
  const win = new BrowserWindow({
    width: INSPECTOR_WIDTH,
    height: INSPECTOR_HEIGHT,
    minWidth: 720,
    minHeight: 420,
    title: `Network · ${host || t.id}`,
    backgroundColor: WINDOW_BACKGROUND,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  applyNavigationGuards(win);
  inspectors.set(t.id, win);
  win.on("closed", () => {
    if (inspectors.get(t.id) === win) inspectors.delete(t.id);
  });
  const query = new URLSearchParams({ tabId: t.id });
  if (t.scope) query.set("scope", t.scope);
  loadAppRoute(win, `network-capture?${query.toString()}`);
}

// ── IPC ────────────────────────────────────────────────────────────────────

const METHOD_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const pickStr = (p: unknown, key: string): string | undefined => {
  const v =
    p && typeof p === "object"
      ? (p as Record<string, unknown>)[key]
      : undefined;
  return typeof v === "string" && v ? v : undefined;
};

// Renderer là L1: tự kiểm lại payload replay thay vì tin kiểu TS của preload.
function parseReplay(raw: unknown): ReplayRequest {
  const r =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const method =
    typeof r.method === "string" ? r.method.trim().toUpperCase() : "";
  if (!METHOD_RE.test(method) || method === "CONNECT")
    throw new Error("invalid replay method");
  const url = typeof r.url === "string" ? r.url : "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("invalid replay URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("replay only supports http(s) URLs");
  }
  const headers: HeaderPair[] = [];
  if (!Array.isArray(r.headers)) throw new Error("invalid replay headers");
  for (const h of r.headers) {
    if (
      !Array.isArray(h) ||
      typeof h[0] !== "string" ||
      typeof h[1] !== "string"
    ) {
      throw new Error("invalid replay headers");
    }
    headers.push([h[0], h[1]]);
  }
  return {
    method,
    url,
    headers,
    body: typeof r.body === "string" ? r.body : undefined,
    bodyBase64: r.bodyBase64 === true,
    followRedirects: r.followRedirects === true,
  };
}

export function registerCaptureIpc(host: CaptureHost): void {
  const resolve = (p: unknown): CaptureTarget => {
    const tabId = pickStr(p, "tabId");
    if (!tabId) throw new Error("capture: tabId required");
    return host.target(tabId, pickStr(p, "scope"));
  };

  ipcMain.handle("browser:capture:start", async (_e, p) =>
    startCapture(resolve(p)),
  );
  ipcMain.handle("browser:capture:stop", async (_e, p) =>
    stopCapture(resolve(p)),
  );
  ipcMain.handle("browser:capture:clear", async (_e, p) =>
    clearCapture(resolve(p)),
  );
  ipcMain.handle("browser:capture:state", async (_e, p) => stateOf(resolve(p)));
  ipcMain.handle("browser:capture:list", async (_e, p) => {
    const t = resolve(p);
    const since =
      p && typeof p === "object"
        ? (p as Record<string, unknown>).sinceSeq
        : undefined;
    const c = captures.get(t.id);
    return {
      state: stateOf(t),
      entries: c
        ? c.store.list(
            typeof since === "number" && Number.isFinite(since)
              ? since
              : undefined,
          )
        : [],
    };
  });
  ipcMain.handle("browser:capture:get", async (_e, p) => {
    const t = resolve(p);
    const id = pickStr(p, "id");
    return (id && captures.get(t.id)?.store.get(id)) || null;
  });
  ipcMain.handle(
    "browser:capture:exportHar",
    async (e, p): Promise<ExportHarResult> => {
      const t = resolve(p);
      const raw =
        p && typeof p === "object"
          ? (p as Record<string, unknown>).ids
          : undefined;
      const ids = Array.isArray(raw)
        ? raw.filter((x): x is string => typeof x === "string")
        : undefined;
      return exportHar(t, ids, BrowserWindow.fromWebContents(e.sender));
    },
  );
  ipcMain.handle(
    "browser:capture:replay",
    async (_e, p): Promise<ReplayResult> => {
      const t = resolve(p);
      try {
        const req = parseReplay(
          p && typeof p === "object"
            ? (p as Record<string, unknown>).request
            : null,
        );
        return await replay(host, t, req);
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
  ipcMain.handle("browser:capture:openWindow", async (_e, p): Promise<void> => {
    const t = resolve(p);
    openInspector(t);
  });
}
