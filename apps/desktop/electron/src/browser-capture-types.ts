// Kiểu dữ liệu của bộ bắt request (Network capture) — main → renderer.
// Bản sao: `src/preload.ts` (khai lại vì preload sandbox không import được file khác
// lúc chạy) và `ui-next/types/network-capture.ts`. Sửa ở đâu phải sửa cả ba.

export type HeaderPair = [name: string, value: string];

export type CaptureState = {
  tabId: string;
  recording: boolean;
  count: number;
  dropped: number;
  bodyBytes: number;
};

export type CaptureSummary = {
  id: string;
  seq: number;
  tabId: string;
  startedAt: number;
  method: string;
  url: string;
  host: string;
  path: string;
  scheme: string;
  resourceType: string;
  status: number | null;
  statusText: string;
  mimeType: string;
  state: "pending" | "done" | "failed";
  error?: string;
  blockedReason?: string;
  encodedBytes: number | null;
  durationMs: number | null;
  fromCache: boolean;
  fromServiceWorker: boolean;
  isNavigation: boolean;
  hasRequestBody: boolean;
  hasResponseBody: boolean;
  redirectedTo?: string;
  /** Chỉ WebSocket: tổng số frame đã thấy (kể cả frame đã bị đẩy khỏi ring 500). */
  wsFrameCount?: number;
};

export type CaptureTiming = {
  blockedMs?: number;
  dnsMs?: number;
  connectMs?: number;
  sslMs?: number;
  sendMs?: number;
  waitMs?: number;
  receiveMs?: number;
  totalMs?: number;
};

export type CaptureSecurity = {
  protocol?: string;
  cipher?: string;
  keyExchange?: string;
  subjectName?: string;
  issuer?: string;
  validFrom?: number;
  validTo?: number;
  sanList?: string[];
  certificateTransparency?: string;
};

export type CaptureBody = {
  text: string;
  base64: boolean;
  truncated: boolean;
  size: number;
};

export type WsFrame = {
  dir: "sent" | "received";
  ts: number;
  opcode: number;
  payload: string;
  truncated: boolean;
};

export type CaptureEntry = CaptureSummary & {
  requestHeaders: HeaderPair[];
  responseHeaders: HeaderPair[];
  requestHeadersText?: string;
  responseHeadersText?: string;
  httpVersion?: string;
  remoteIP?: string;
  remotePort?: number;
  initiator?: {
    type: string;
    url?: string;
    lineNumber?: number;
    stack?: string[];
  };
  frameId?: string;
  documentUrl?: string;
  requestBody?: CaptureBody;
  responseBody?: CaptureBody;
  /** Body đã bị đẩy ra khỏi ngân sách bộ nhớ (256 MB toàn app). */
  bodyEvicted?: boolean;
  timing?: CaptureTiming;
  security?: CaptureSecurity;
  wsFrames?: WsFrame[];
  blockedCookies?: { name: string; reasons: string[] }[];
};

export type CaptureEvent =
  | { tabId: string; kind: "upsert"; entries: CaptureSummary[] }
  | { tabId: string; kind: "state"; state: CaptureState }
  | { tabId: string; kind: "cleared" };

export type ReplayRequest = {
  method: string;
  url: string;
  headers: HeaderPair[];
  body?: string;
  bodyBase64?: boolean;
  followRedirects?: boolean;
};

export type ReplayResult =
  | {
      ok: true;
      status: number;
      statusText: string;
      headers: HeaderPair[];
      body: CaptureBody;
      timeMs: number;
      url: string;
    }
  | { ok: false; error: string };

export type ExportHarResult = { path: string } | { cancelled: true };
