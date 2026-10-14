// Quét CHỦ ĐỘNG cho Network Capture: danh mục kịch bản, lập probe (request clone
// rồi mutate đúng MỘT ô) và phân tích phản hồi. File THUẦN — KHÔNG gửi request;
// runner (composables/useCaptureScanner.ts) đi qua `browser.capture.replay` của
// main (đã có allowlist host, timeout, redirect manual). Chỉ `import type` +
// cú pháp "erasable" để `node --test` chạy thẳng file TS.
//
// scenarioId là khoá i18n `capture.sec.scenario.<id>` — UI sở hữu nhãn/mô tả,
// ScanFinding chỉ chứa chuỗi thường (evidence render verbatim).

import type {
  CaptureEntry,
  HeaderPair,
  ReplayRequest,
  ReplayResult,
} from '../types/network-capture'
import type { OwaspId } from './capture-owasp'
// @ts-expect-error đuôi `.ts` tường minh để `node --test` (Node không phân giải import trần) chạy được file này
import { parseCookieHeader, queryParams } from './capture-export.ts'

// ---- Kiểu công khai (hợp đồng với UI) ----

export type ScanLocation = 'query' | 'body' | 'header' | 'path' | 'cookie'
export type ScanSeverity = 'high' | 'medium' | 'low' | 'info'

export type ScanFinding = {
  /** `${scenarioId}:${entryId}:${param}` — ổn định để UI dedupe/ghi chú. */
  id: string
  scenarioId: string
  owasp: OwaspId
  severity: ScanSeverity
  /** URL của probe đã mutate — trỏ thẳng request gây finding. */
  url: string
  param: string
  location: ScanLocation
  payload: string
  /** Trích đoạn bằng chứng ≤160 ký tự (chuỗi thường, không phải khoá i18n). */
  evidence: string
  entryId: string
  /** timeMs của baseline cùng entry (0 nếu không có baseline). */
  baselineMs: number
  /** `result.timeMs - baselineMs` — âm = probe nhanh hơn baseline. */
  deltaMs: number
}

export type ScanProbe = {
  /** 'baseline' cho request mốc; còn lại là id trong SCAN_SCENARIOS. */
  scenarioId: string
  entryId: string
  /** Request đã clone + mutate đúng MỘT ô (param/header/body/path segment). */
  request: ReplayRequest
  param: string
  location: ScanLocation
  payload: string
  /** Request mốc KHÔNG mutate — mỗi chữ ký request một lần, so timing cho mọi scenario. */
  baseline?: boolean
}

export type ScanReport = {
  scannedAt: number
  hosts: string[]
  probes: number
  findings: ScanFinding[]
  errors: string[]
  /** Một dòng cho MỌI probe đã gửi — bảng "request nào / kịch bản nào / ra sao". */
  details: ScanProbeResult[]
  /** true khi quét dừng sớm vì transport fail liên tiếp (WAF/CDN chặn, mất mạng…). */
  blocked: boolean
}

/** Kết quả của một lượt bắn probe — hàng trong bảng scan của UI. */
export type ScanProbeResult = {
  /** `${scenarioId}:${entryId}:${param}:${payloadIndex}` — ổn định trong một lượt chạy. */
  id: string
  scenarioId: string
  entryId: string
  method: string
  url: string
  param: string
  location: ScanLocation
  payload: string
  /** Request đã gửi (để UI dựng lại đúng thứ đã bắn — gồm cả mutate). */
  request: ReplayRequest
  status: number | null
  timeMs: number
  /** Byte response (0 khi lỗi transport). */
  size: number
  error: string | null
  /** true = request mốc không mutate. */
  baseline: boolean
  /** Severity của detector khi có hit; vắng = sạch. */
  hit?: ScanSeverity
}

// ---- Giới hạn quét ----

/** Trần lập kế hoạch: chống bùng nổ request trên trang nhiều param/entry. */
export const SCAN_LIMITS = {
  /** Param tối đa mỗi entry (mỗi scenario). */
  paramsPerEntry: 8,
  /** Mutation probe tối đa mỗi entry (không tính baseline). */
  probesPerEntry: 40,
  /** Tổng probe toàn lượt (gồm baseline). */
  totalProbes: 300,
} as const

/** Body quá lớn không đọc khi mutate/parse JSON; khớp SCAN_LIMIT của capture-findings. */
const BODY_SCAN_LIMIT = 256 * 1024

/** Host redirect mục tiêu cho open-redirect + Origin độc cho cors-reflect. */
const REDIRECT_HOST = 'awog-scan.invalid'
const EVIL_ORIGIN = 'https://awog-evil.invalid'
const EVIL_HOST = 'awog-evil.invalid'

/** Ngưỡng time-based: ≥2.5s = high (payload sleep 3s); 1.5–2.5s = low "possible". */
const TIME_HIGH_MS = 2500
const TIME_LOW_MS = 1500

/** Method không replay. */
const SKIP_METHODS: Record<string, true> = { CONNECT: true, TRACE: true }

// ---- Tiện ích chung ----

function clip(s: string, max = 150): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function headerValue(headers: HeaderPair[], name: string): string | undefined {
  const low = name.toLowerCase()
  return headers.find(([n]) => n.toLowerCase() === low)?.[1]
}

function safeParseUrl(u: string): URL | null {
  try {
    return new URL(u)
  } catch {
    return null
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Body response dạng text (bỏ base64), cắt 256 KB. */
function responseText(result: OkResult): string {
  const b = result.body
  if (!b || b.base64) return ''
  return b.text.slice(0, BODY_SCAN_LIMIT)
}

/** Body request dạng text để mutate; null nếu nhị phân/rỗng. */
function requestBodyText(e: CaptureEntry): string | null {
  const b = e.requestBody
  if (!b || b.base64 || b.text === '') return null
  return b.text.slice(0, BODY_SCAN_LIMIT)
}

/** Trích đoạn quanh match đầu tiên (dọn whitespace, ≤150 ký tự). */
function matchSnippet(body: string, re: RegExp): string {
  const m = re.exec(body)
  if (!m) return ''
  return clip(body.slice(Math.max(0, m.index - 40), m.index + m[0].length + 80))
}

// ---- Clone request + mutate ----

const STRIP_HEADERS: Record<string, true> = {
  host: true,
  'content-length': true,
  'accept-encoding': true,
  connection: true,
  'keep-alive': true,
  'proxy-authorization': true,
  'proxy-connection': true,
  'if-none-match': true,
  'if-modified-since': true,
  'if-range': true,
  upgrade: true,
  'sec-websocket-key': true,
  'sec-websocket-version': true,
  'sec-websocket-extensions': true,
  te: true,
  trailer: true,
}

/** Tên header hợp lệ theo RFC 7230 token — Chromium từ chối request chứa header lạ. */
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

/** Ký tự điều khiển trong giá trị header làm Chromium phá request (ERR_INVALID_ARGUMENT). */
// eslint-disable-next-line no-control-regex -- cố ý lọc control char trong header value
const HEADER_BAD_CHAR_RE = /[\x00-\x08\x0a-\x1f\x7f]/g

/** Làm sạch một cặp header bắt được: bỏ tên không hợp lệ, xoá control char trong value. */
function cleanHeader([name, value]: HeaderPair): HeaderPair | null {
  if (!HEADER_NAME_RE.test(name) || name.startsWith(':')) return null
  const v = value.replace(HEADER_BAD_CHAR_RE, '')
  if (v === '') return null
  return [name, v]
}

/** Request gốc của entry → ReplayRequest (giữ cookie/auth, bỏ header transport). */
function baseRequest(e: CaptureEntry): ReplayRequest {
  const headers = e.requestHeaders
    .filter(([n]) => {
      const low = n.toLowerCase()
      // sec-fetch-* + x-client-data do CHROMIUM tự quản theo fetch context — replay
      // giữ nguyên `Sec-Fetch-Mode` làm net.request phá request (ERR_INVALID_ARGUMENT;
      // kèm Origin thành ERR_FAILED). Đo trên Electron 33 + vtvshop.netacom.vn.
      if (low.startsWith('sec-fetch-') || low === 'x-client-data') return false
      return !n.startsWith(':') && !STRIP_HEADERS[low]
    })
    .map(cleanHeader)
    .filter((h): h is HeaderPair => h !== null)
  const body = requestBodyText(e)
  return {
    method: e.method || 'GET',
    url: e.url,
    headers,
    ...(body !== null ? { body, bodyBase64: false } : {}),
    followRedirects: false,
  }
}

/** Chữ ký của một request gốc — entry trùng (cùng method+url+body+cookie) chỉ quét 1 lần. */
function requestSig(r: ReplayRequest): string {
  const ck = headerValue(r.headers, 'cookie') ?? ''
  return `${r.method}|${r.url}|${r.body ?? ''}|${ck}`
}

/** Thay giá trị của `name` trong chuỗi query `a=1&b=2` bằng `value` NGUYÊN VĂN (đã encode). */
function setRawPair(qs: string, name: string, value: string): string {
  const out = qs.split('&')
  for (let i = 0; i < out.length; i++) {
    const s = out[i]!
    const eq = s.indexOf('=')
    const n = eq < 0 ? s : s.slice(0, eq)
    if (safeDecode(n) === name) out[i] = `${encodeURIComponent(name)}=${value}`
  }
  return out.join('&')
}

function setQueryParam(req: ReplayRequest, name: string, value: string, raw?: boolean): void {
  const u = safeParseUrl(req.url)
  if (!u) return
  if (!raw) {
    u.searchParams.set(name, value)
    req.url = u.toString()
    return
  }
  const hash = req.url.indexOf('#')
  const head = hash < 0 ? req.url : req.url.slice(0, hash)
  const tail = hash < 0 ? '' : req.url.slice(hash)
  const q = head.indexOf('?')
  if (q < 0) return
  req.url = head.slice(0, q + 1) + setRawPair(head.slice(q + 1), name, value) + tail
}

function setFormParam(req: ReplayRequest, name: string, value: string, raw?: boolean): void {
  if (req.body === undefined) return
  if (!raw) {
    const sp = new URLSearchParams(req.body)
    sp.set(name, value)
    req.body = sp.toString()
    return
  }
  req.body = setRawPair(req.body, name, value)
}

/** Mutate key top-level của body JSON (chỉ key đã có giá trị string/number). */
function setJsonParam(req: ReplayRequest, name: string, value: string): void {
  if (req.body === undefined) return
  try {
    const parsed: unknown = JSON.parse(req.body)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return
    const obj = parsed as Record<string, unknown>
    if (!(name in obj)) return
    obj[name] = value
    req.body = JSON.stringify(obj)
  } catch {
    // body không parse được — bodyTargets không sinh target json thì không tới đây.
  }
}

function setCookieParam(req: ReplayRequest, name: string, value: string): void {
  const i = req.headers.findIndex(([n]) => n.toLowerCase() === 'cookie')
  if (i < 0) return
  const pairs = parseCookieHeader(req.headers[i]![1])
  const next = pairs.map((p) => `${p.name}=${p.name === name ? value : p.value}`)
  req.headers[i] = [req.headers[i]![0], next.join('; ')]
}

function setHeader(req: ReplayRequest, name: string, value: string): void {
  const low = name.toLowerCase()
  req.headers = req.headers.filter(([n]) => n.toLowerCase() !== low)
  req.headers.push([name, value])
}

/** Thay segment path cuối (dùng cho LFI kiểu `/files/report.pdf` → `/files/../../etc/passwd`). */
function mutateLastSegment(req: ReplayRequest, value: string): void {
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)([^?#]*)([?#].*)?$/i.exec(req.url)
  if (!m) return
  const path = m[2] ?? '/'
  const i = path.lastIndexOf('/')
  if (i < 0) return
  req.url = `${m[1]}${path.slice(0, i + 1)}${value}${m[3] ?? ''}`
}

// ---- Thu thập param ----

/** 'header'/'replaceBody' là pseudo-kind cho scenario theo-entry (cors, xxe). */
type TargetKind = 'query' | 'form' | 'json' | 'cookie' | 'path' | 'header' | 'replaceBody'

type ParamTarget = { name: string; kind: TargetKind }

const LOC_OF: Record<TargetKind, ScanLocation> = {
  query: 'query',
  form: 'body',
  json: 'body',
  cookie: 'cookie',
  path: 'path',
  header: 'header',
  replaceBody: 'body',
}

/** Trông giống `a=1&b=2` (cho phép value rỗng). */
const FORM_RE = /^[^\s&=]+=[^&]*(?:&[^\s&=]+=[^&]*)*$/

/** Segment cuối trông như file (`report.pdf`, `avatar.png`) — ứng viên LFI qua path. */
const FILE_SEG_RE = /\.[a-z0-9]{1,8}$/i

/** Segment cuối path là id số/uuid/hex — target của IDOR (và probe path nói chung). */
const ID_SEG_RE = /^\d+$|^[0-9a-f][0-9a-f-]{7,}$/i

/** Param trong body: urlencoded → 'form', object JSON top-level → 'json'. */
function bodyTargets(e: CaptureEntry): ParamTarget[] {
  const text = requestBodyText(e)
  if (text === null) return []
  const ct = (headerValue(e.requestHeaders, 'content-type') ?? '').toLowerCase()
  const t = text.trimStart()
  if (ct.includes('json') || t.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return []
      return Object.entries(parsed as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
        .map(([k]): ParamTarget => ({ name: k, kind: 'json' }))
    } catch {
      return []
    }
  }
  if (ct.includes('x-www-form-urlencoded') || FORM_RE.test(t)) {
    return [...new URLSearchParams(text).keys()].map(
      (n): ParamTarget => ({ name: n, kind: 'form' }),
    )
  }
  return []
}

/** Body trông như XML — điều kiện chạy scenario xxe. */
function looksXml(e: CaptureEntry): boolean {
  const t = requestBodyText(e)?.trimStart() ?? ''
  if (t === '') return false
  const ct = (headerValue(e.requestHeaders, 'content-type') ?? '').toLowerCase()
  return ct.includes('xml') || t.startsWith('<?xml') || /^<[a-zA-Z!?]/.test(t)
}

// ---- Kịch bản ----

type PayloadDef = {
  value: string
  /** Đã percent-encode sẵn → chèn NGUYÊN VĂN vào query/form (không encode lại). */
  raw?: boolean
}

type OkResult = Extract<ReplayResult, { ok: true }>

export type DetectCtx = {
  probe: ScanProbe
  result: OkResult
  /** Response body text của probe (đã cắt 256 KB). */
  body: string
  /** Body baseline; null nếu baseline lỗi/không có. */
  baseBody: string | null
  /** timeMs baseline; 0 khi không có. */
  baseMs: number
  /** result.timeMs − baseMs. */
  deltaMs: number
}

type Detection = { severity: ScanSeverity; evidence: string }

export type ScanScenario = {
  id: string
  owasp: OwaspId
  /** Nguồn param để inject; 'header'/'replaceBody' = probe theo entry. */
  sources: readonly TargetKind[]
  /** Tên header khi sources chứa 'header' (cors-reflect → 'Origin'). */
  headerName?: string
  /** Bỏ entry không thoả (vd xxe chỉ chạy trên body XML). */
  when?: (e: CaptureEntry) => boolean
  /** Bỏ target không thoả (vd open-redirect chỉ chạy param tên next/url/…). */
  targetFilter?: (name: string, kind: TargetKind) => boolean
  /** Payload cho mỗi param — là hàm để canary xss khác nhau mỗi entry. */
  payloads: (e: CaptureEntry) => readonly PayloadDef[]
  /** Detector: nhìn response probe (so với baseline) → finding hay null. */
  detect: (c: DetectCtx) => Detection | null
}

// -- Pattern lỗi SQL (mở rộng ý tưởng VERBOSE_ERROR_PATTERNS của capture-findings) --

const SQLI_ERRORS: { name: string; re: RegExp }[] = [
  { name: 'SQLSTATE', re: /SQLSTATE\[\w+\]/i },
  { name: 'ORA', re: /ORA-\d{4,5}/ },
  {
    name: 'mysql',
    re: /You have an error in your SQL syntax|check the manual that corresponds to your (?:MySQL|MariaDB) server version|mysql_(?:fetch|num_rows|query|result)/i,
  },
  {
    name: 'pgsql',
    re: /pg_(?:query|exec|send_query)|PSQLException|PostgreSQL.{0,40}\bERROR\b|unterminated quoted string at or near/i,
  },
  {
    name: 'sqlite',
    re: /sqlite3?\.OperationalError|SQLite3?::|SQL logic error|unrecognized token:|near "[^"]*": syntax error/i,
  },
  {
    name: 'mssql',
    re: /Unclosed quotation mark|Incorrect syntax near|Microsoft OLE DB Provider|ODBC SQL Server Driver|SqlException/i,
  },
  { name: 'db2', re: /DB2 SQL error|SQLCODE=-?\d+/i },
  { name: 'php-db-warning', re: /Warning:\s*(?:mysql|mysqli|pg_|sqlite3?|oci8|sqlsrv)_\w+/i },
]

const XXE_ERRORS: { name: string; re: RegExp }[] = [
  {
    name: 'external-entity',
    re: /external (?:general )?entity|entity.{0,30}not (?:defined|declared)/i,
  },
  { name: 'xml-parser', re: /SimpleXMLElement|XML_PARSE_ENTITY|libxml|xmlParseEntityRef/i },
]

const PASSWD_RE = /root:[x*]:0:0:/
const WININI_RE = /\[fonts\]|\[extensions\]|for 16-bit app support/i
const CMD_ID_RE = /uid=\d+\([^()\n]{0,40}\)\s*gid=\d+\([^()\n]{0,40}\)/
const CMD_ID_LOOSE_RE = /uid=\d+\([^()\n]{0,40}\)/

function matchAny(
  body: string,
  pats: { name: string; re: RegExp }[],
): { name: string; re: RegExp } | null {
  for (const p of pats) if (p.re.test(body)) return p
  return null
}

/** Tên param hay nhận URL chuyển hướng — open-redirect chỉ inject các tên này. */
const REDIRECT_PARAM_RE =
  /url|redirect|redir|return|goto|callback|continue|next|dest|target|forward|to$|^to|out|link|ref|view|path|goto|^r$|^u$/i

// Param hay mang object-id — IDOR chỉ inject vào tên này để không spam mọi tham số.
const IDOR_PARAM_RE =
  /^(id|uid|user_?id|account_?id|acct|order_?(id|no)|doc_?id|file_?id|num|seq|ref|rid|oid|pid|gid|cid|key)$/i

// Payload IDOR: giá trị gốc thường đã là id của chính user → thử 0/1 và "gốc+1".
// '__IDOR_PLUS1__' là placeholder — planner thay bằng <gốc+1> khi param là số.
const IDOR_PAYLOADS: readonly PayloadDef[] = [
  { value: '0' },
  { value: '1' },
  { value: '__IDOR_PLUS1__' },
]

// -- Payloads --

const SQLI_ERROR_PAYLOADS: readonly PayloadDef[] = [{ value: `'` }, { value: `"` }]

const SQLI_TIME_PAYLOADS: readonly PayloadDef[] = [
  { value: `' OR SLEEP(3)-- -` },
  { value: `'; SELECT pg_sleep(3)-- -` },
]

const SSTI_PAYLOADS: readonly PayloadDef[] = [
  // Jinja2/Twig/ERB nhân chuỗi → '7777777' (marker mạnh, hiếm trùng).
  { value: `{{7*'7'}}` },
  { value: `<%= 7*'7' %>` },
  // EL/Mako/… tính số → '49' (yếu, cần so baseline + biên không-phải-số).
  { value: '${7*7}' },
]

const LFI_PAYLOADS: readonly PayloadDef[] = [
  // raw=true để chèn NGUYÊN VĂN: URL parser chuẩn hoá `../` ra khỏi path trước khi
  // gửi (đo trên Electron 33: /files/../../etc/passwd → /etc/passwd — payload chết
  // ngay ở client), còn `%2e%2e`/`%2f` sống tới origin.
  { value: '../../../../etc/passwd', raw: true },
  { value: '..%2f..%2f..%2fetc%2fpasswd', raw: true },
  { value: '....//....//....//etc/passwd', raw: true },
  { value: '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd', raw: true },
  { value: '..\\..\\..\\windows\\win.ini', raw: true },
  { value: '%2e%2e%5c%2e%2e%5cwindows%5cwin.ini', raw: true },
]

const REDIRECT_PAYLOADS: readonly PayloadDef[] = [
  { value: `https://${REDIRECT_HOST}/` },
  { value: `//${REDIRECT_HOST}/` },
]

const CMDI_PAYLOADS: readonly PayloadDef[] = [
  { value: ';id' },
  { value: '|id' },
  { value: '$(id)' },
  { value: '`id`' },
]

const CRLF_PAYLOADS: readonly PayloadDef[] = [
  { value: '%0d%0aX-Awog-Scan:injected', raw: true },
  { value: '%0d%0a%0d%0aaw0gcrlf', raw: true },
]

const XXE_PAYLOADS: readonly PayloadDef[] = [
  {
    value:
      '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE r [<!ENTITY awog SYSTEM "file:///etc/passwd">]><r>&awog;</r>',
  },
]

// -- Danh mục scenario (thứ tự = thứ tự round-robin khi lập probe) --

export const SCAN_SCENARIOS: readonly ScanScenario[] = [
  {
    id: 'sqli-error',
    owasp: 'A03',
    sources: ['query', 'form', 'json', 'cookie'],
    payloads: () => SQLI_ERROR_PAYLOADS,
    detect(c) {
      const m = matchAny(c.body, SQLI_ERRORS)
      if (!m) return null
      const ev = `${m.name}: ${matchSnippet(c.body, m.re)}`
      if (c.baseBody !== null && matchAny(c.baseBody, SQLI_ERRORS))
        return { severity: 'low', evidence: `${ev} (baseline already shows SQL errors)` }
      return { severity: 'high', evidence: ev }
    },
  },
  {
    id: 'sqli-time',
    owasp: 'A03',
    sources: ['query', 'form', 'json'],
    payloads: () => SQLI_TIME_PAYLOADS,
    detect(c) {
      if (c.baseMs <= 0) return null // cần baseline để so — runner cũng skip khi baseline fail
      const d = Math.round(c.deltaMs)
      if (d >= TIME_HIGH_MS)
        return {
          severity: 'high',
          evidence: `response +${d}ms vs baseline (${Math.round(c.result.timeMs)}ms vs ${Math.round(c.baseMs)}ms)`,
        }
      if (d >= TIME_LOW_MS)
        return { severity: 'low', evidence: `possible delay: +${d}ms vs baseline` }
      return null
    },
  },
  {
    id: 'xss-reflected',
    owasp: 'A03',
    sources: ['query', 'form', 'json'],
    payloads() {
      const tok = `aw0g${Math.random().toString(36).slice(2, 8)}`
      // Breaker `"><` phản chiếu NGUYÊN VĂN = thoát được attribute/dangerous context;
      // canary trần chỉ chứng minh input được reflect (info).
      return [{ value: tok }, { value: `"><${tok}` }]
    },
    detect(c) {
      const i = c.body.indexOf(c.probe.payload)
      if (i < 0) return null
      const ev = `reflected: ${clip(c.body.slice(Math.max(0, i - 40), i + c.probe.payload.length + 60))}`
      return c.probe.payload.startsWith('"><')
        ? { severity: 'high', evidence: ev }
        : { severity: 'info', evidence: ev }
    },
  },
  {
    id: 'ssti',
    owasp: 'A03',
    sources: ['query', 'form', 'json'],
    payloads: () => SSTI_PAYLOADS,
    detect(c) {
      if (c.body.includes('7777777') && !(c.baseBody?.includes('7777777') ?? false))
        return {
          severity: 'high',
          evidence: `template evaluated: ${matchSnippet(c.body, /7777777/)}`,
        }
      const m49 = /(^|[^\d])49([^\d]|$)/
      if (m49.test(c.body) && !(c.baseBody !== null && m49.test(c.baseBody)))
        return {
          severity: 'medium',
          evidence: `arithmetic result reflected: ${matchSnippet(c.body, /49/)}`,
        }
      return null
    },
  },
  {
    id: 'lfi',
    owasp: 'A01',
    sources: ['query', 'form', 'json', 'cookie', 'path'],
    payloads: () => LFI_PAYLOADS,
    detect(c) {
      const re = PASSWD_RE.test(c.body) ? PASSWD_RE : WININI_RE.test(c.body) ? WININI_RE : null
      if (!re) return null
      if (c.baseBody !== null && re.test(c.baseBody)) return null // marker có sẵn — không quy được
      return { severity: 'high', evidence: matchSnippet(c.body, re) }
    },
  },
  {
    id: 'open-redirect',
    owasp: 'A01',
    sources: ['query'],
    targetFilter: (name) => REDIRECT_PARAM_RE.test(name),
    payloads: () => REDIRECT_PAYLOADS,
    detect(c) {
      const loc = headerValue(c.result.headers, 'location')
      if (!loc || !loc.toLowerCase().includes(REDIRECT_HOST)) return null
      return { severity: 'medium', evidence: `Location: ${clip(loc)}` }
    },
  },

  // -- IDOR (Broken Access Control) --
  // Đổi giá trị id trong query/path/cookie/json sang một giá trị khác (0/1/+1)
  // và so body + status với baseline: 200 + body khác = response chứa object của
  // "ai đó" — nghi IDOR. Heuristic (cần 2 tài khoản để chứng minh đầy đủ) nên
  // severity 'medium' và evidence nói rõ là suy đoán.
  {
    id: 'idor',
    owasp: 'A01',
    sources: ['query', 'form', 'json', 'cookie', 'path'],
    // path: name chính là segment cuối — nhận khi segment là id số.
    targetFilter: (name, kind) => (kind === 'path' ? /^\d+$/.test(name) : IDOR_PARAM_RE.test(name)),
    payloads: () => IDOR_PAYLOADS,
    detect(c) {
      if (c.result.status !== 200) return null
      if (c.baseBody === null) return null
      // Body giống hệt baseline ⇒ server trả cùng dữ liệu (id đổi nhưng response
      // không đổi) hoặc probe trả trang lỗi — cả hai đều không phải dấu IDOR.
      if (c.body === c.baseBody) return null
      const delta = c.body.length - c.baseBody.length
      return {
        severity: 'medium',
        evidence: `200 + body khác baseline (Δ${delta > 0 ? '+' : ''}${delta}B) — id đổi có thể trả object của người khác`,
      }
    },
  },
  {
    id: 'cmdi',
    owasp: 'A03',
    sources: ['query', 'form', 'json'],
    payloads: () => CMDI_PAYLOADS,
    detect(c) {
      const m = CMD_ID_RE.exec(c.body) ?? CMD_ID_LOOSE_RE.exec(c.body)
      if (!m) return null
      if (c.baseBody !== null && CMD_ID_LOOSE_RE.test(c.baseBody)) return null
      return { severity: 'high', evidence: clip(m[0]) }
    },
  },
  {
    id: 'crlf',
    owasp: 'A03',
    sources: ['query', 'form', 'json'],
    payloads: () => CRLF_PAYLOADS,
    detect(c) {
      const v = headerValue(c.result.headers, 'x-awog-scan')
      if (v !== undefined) return { severity: 'high', evidence: `X-Awog-Scan: ${clip(v)}` }
      if (c.body.includes('aw0gcrlf') && !(c.baseBody?.includes('aw0gcrlf') ?? false))
        return { severity: 'low', evidence: 'CRLF marker reached response body' }
      return null
    },
  },
  {
    id: 'xxe',
    owasp: 'A05',
    sources: ['replaceBody'],
    when: looksXml,
    payloads: () => XXE_PAYLOADS,
    detect(c) {
      if (PASSWD_RE.test(c.body) && !(c.baseBody !== null && PASSWD_RE.test(c.baseBody)))
        return { severity: 'high', evidence: matchSnippet(c.body, PASSWD_RE) }
      const m = matchAny(c.body, XXE_ERRORS)
      if (m && !(c.baseBody !== null && matchAny(c.baseBody, XXE_ERRORS)))
        return { severity: 'low', evidence: `${m.name}: ${matchSnippet(c.body, m.re)}` }
      return null
    },
  },
  {
    id: 'cors-reflect',
    owasp: 'A05',
    sources: ['header'],
    headerName: 'Origin',
    payloads: () => [{ value: EVIL_ORIGIN }],
    detect(c) {
      const acao = headerValue(c.result.headers, 'access-control-allow-origin')
      if (!acao) return null
      const acac =
        (headerValue(c.result.headers, 'access-control-allow-credentials') ?? '').toLowerCase() ===
        'true'
      const ev = `Access-Control-Allow-Origin: ${acao}${acac ? ' · Access-Control-Allow-Credentials: true' : ''}`
      if (acao.includes(EVIL_HOST)) return { severity: acac ? 'high' : 'medium', evidence: ev }
      if (acao.trim() === '*') return { severity: acac ? 'medium' : 'low', evidence: ev }
      return null
    },
  },
]

// ---- Lập kế hoạch probe ----

function scannable(e: CaptureEntry): boolean {
  return (e.scheme === 'http' || e.scheme === 'https') && !SKIP_METHODS[e.method.toUpperCase()]
}

/** Param của entry theo `sources` của scenario (trần paramsPerEntry). */
function collectTargets(e: CaptureEntry, sc: ScanScenario): ParamTarget[] {
  const out: ParamTarget[] = []
  const seen = new Set<string>()
  const push = (name: string, kind: TargetKind): void => {
    const k = `${kind}:${name}`
    if (seen.has(k) || out.length >= SCAN_LIMITS.paramsPerEntry) return
    seen.add(k)
    out.push({ name, kind })
  }
  for (const src of sc.sources) {
    if (src === 'query') {
      for (const [n] of queryParams(e.url)) push(n, 'query')
    } else if (src === 'form' || src === 'json') {
      for (const t of bodyTargets(e)) if (t.kind === src) push(t.name, t.kind)
    } else if (src === 'cookie') {
      const ck = headerValue(e.requestHeaders, 'cookie')
      if (ck) for (const p of parseCookieHeader(ck)) push(p.name, 'cookie')
    } else if (src === 'path') {
      const pm = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+([^?#]*)/i.exec(e.url)
      const pi = (pm?.[1] ?? '').lastIndexOf('/')
      const seg = pi < 0 ? '' : safeDecode((pm?.[1] ?? '').slice(pi + 1))
      // Path target = segment "có thể đổi": tên file (LFI) HOẶC id số/uuid (IDOR).
      if (seg && (FILE_SEG_RE.test(seg) || ID_SEG_RE.test(seg))) push(seg, 'path')
    } else if (src === 'header') {
      push(sc.headerName ?? '', 'header')
    } else if (src === 'replaceBody') {
      push('', 'replaceBody')
    }
  }
  return out
}

function applyMutation(req: ReplayRequest, t: ParamTarget, p: PayloadDef): void {
  switch (t.kind) {
    case 'query':
      setQueryParam(req, t.name, p.value, p.raw)
      break
    case 'form':
      setFormParam(req, t.name, p.value, p.raw)
      break
    case 'json':
      setJsonParam(req, t.name, p.value)
      break
    case 'cookie':
      setCookieParam(req, t.name, p.value)
      break
    case 'path':
      mutateLastSegment(req, p.value)
      break
    case 'header':
      setHeader(req, t.name, p.value)
      break
    case 'replaceBody':
      req.body = p.value
      req.bodyBase64 = false
      break
  }
}

/** Giá trị gốc của target trong request — để tính '__IDOR_PLUS1__' (gốc+1 nếu số). */
function originalParamValue(req: ReplayRequest, t: ParamTarget): string {
  try {
    if (t.kind === 'query') return new URL(req.url).searchParams.get(t.name) ?? ''
    if (t.kind === 'cookie') {
      const ck = req.headers.find(([n]) => n.toLowerCase() === 'cookie')?.[1] ?? ''
      return parseCookieHeader(ck).find((p) => p.name === t.name)?.value ?? ''
    }
    if (t.kind === 'json') {
      const o: unknown = JSON.parse(req.body ?? '')
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        const v = (o as Record<string, unknown>)[t.name]
        return typeof v === 'string' || typeof v === 'number' ? String(v) : ''
      }
      return ''
    }
    if (t.kind === 'form') {
      return new URLSearchParams(req.body ?? '').get(t.name) ?? ''
    }
    if (t.kind === 'path') {
      const path = new URL(req.url).pathname
      return path.slice(path.lastIndexOf('/') + 1)
    }
  } catch {
    return ''
  }
  return ''
}

/** '__IDOR_PLUS1__' → giá trị gốc+1 khi param là số; không thì '2' (id thử khác). */
function resolveIdorPayload(req: ReplayRequest, t: ParamTarget, value: string): string {
  if (value !== '__IDOR_PLUS1__') return value
  const v = originalParamValue(req, t)
  return /^-?\d+$/.test(v) ? String(Number(v) + 1) : '2'
}

/**
 * Lập danh sách probe cho các entry: 1 baseline (không mutate, followRedirects:false)
 * cho mỗi chữ ký request, rồi mutation probe xen kẽ giữa các scenario. Trần:
 * paramsPerEntry param/scenario · probesPerEntry mutation/entry · totalProbes tổng.
 * Dedupe theo `request-signature + scenario + location + param + payload` — hai entry
 * giống hệt nhau (cùng method/url/body/cookie) chỉ bị bắn 1 lần.
 */
export function planProbes(
  entries: CaptureEntry[],
  opts?: { scenarioIds?: string[] },
): ScanProbe[] {
  const wanted = new Set(opts?.scenarioIds ?? SCAN_SCENARIOS.map((s) => s.id))
  const dedupe = new Set<string>()
  const seenSig = new Set<string>()
  // Entry nào KHÔNG có mutation nào (asset tĩnh, không param/body/cookie…) thì
  // bỏ luôn cả baseline — trước đây baseline chiếm gần hết quota vì _nuxt/*.js.
  const groups: { entryId: string; req: ReplayRequest; sig: string; mutations: ScanProbe[] }[] = []

  for (const e of entries) {
    if (!scannable(e)) continue
    const req = baseRequest(e)
    const sig = requestSig(req)
    if (seenSig.has(sig)) continue
    seenSig.add(sig)
    const plain = JSON.stringify(req)
    const mutations: ScanProbe[] = []
    for (const sc of SCAN_SCENARIOS) {
      if (!wanted.has(sc.id)) continue
      if (sc.when && !sc.when(e)) continue
      const payloads = sc.payloads(e)
      for (const t of collectTargets(e, sc)) {
        if (sc.targetFilter && !sc.targetFilter(t.name, t.kind)) continue
        for (const [pi, p] of payloads.entries()) {
          // Dedupe theo INDEX payload, không phải giá trị — canary xss ngẫu nhiên
          // mỗi entry nên payload.value khác nhau làm hai entry giống hệt không dedupe.
          const key = `${sig}|${sc.id}|${t.kind}|${t.name}|${pi}`
          if (dedupe.has(key)) continue
          dedupe.add(key)
          const mutated = baseRequest(e)
          applyMutation(mutated, t, { ...p, value: resolveIdorPayload(req, t, p.value) })
          // Mutation không đổi gì (param đã biến mất khỏi URL, segment không nhận,
          // payload trùng giá trị gốc…) → bắn đi chỉ tốn một request trùng baseline.
          // Serialize ĐẦY ĐỦ (kể cả mọi header) — requestSig bỏ qua header lạ nên
          // mutation header (cors Origin…) vẫn được giữ.
          if (JSON.stringify(mutated) === plain) continue
          mutations.push({
            scenarioId: sc.id,
            entryId: e.id,
            request: mutated,
            param: t.name,
            location: LOC_OF[t.kind],
            payload: resolveIdorPayload(req, t, p.value),
          })
        }
      }
    }
    if (mutations.length > 0) groups.push({ entryId: e.id, req, sig, mutations })
  }

  // Emit: baseline của từng signature CÓ mutation, rồi mutation round-robin THEO
  // ENTRY (mỗi vòng lấy 1 probe của từng entry, xen scenario trong entry đó) —
  // tránh entry đầu nuốt hết totalProbes, entry cuối (mang param id) trắng.
  const out: ScanProbe[] = []
  for (const g of groups) {
    if (out.length >= SCAN_LIMITS.totalProbes) break
    out.push({
      scenarioId: 'baseline',
      entryId: g.entryId,
      request: g.req,
      param: '',
      location: 'body', // vô nghĩa với baseline — flag `baseline` mới là điểm phân biệt
      payload: '',
      baseline: true,
    })
  }
  // Round-robin scenario trong từng entry trước…
  const entryQueues: ScanProbe[][] = groups.map((g) => {
    const byScenario = new Map<string, ScanProbe[]>()
    for (const m of g.mutations) {
      const q = byScenario.get(m.scenarioId) ?? []
      q.push(m)
      byScenario.set(m.scenarioId, q)
    }
    const queues = [...byScenario.values()]
    const merged: ScanProbe[] = []
    let progressed = true
    while (progressed) {
      progressed = false
      for (const q of queues) {
        const p = q.shift()
        if (p) {
          merged.push(p)
          progressed = true
        }
      }
    }
    return merged
  })
  // …rồi round-robin GIỮA các entry: vòng i lấy probe thứ i của mỗi entry.
  const perEntry = new Array(groups.length).fill(0)
  let progressed2 = true
  while (progressed2 && out.length < SCAN_LIMITS.totalProbes) {
    progressed2 = false
    for (let i = 0; i < entryQueues.length; i++) {
      if (out.length >= SCAN_LIMITS.totalProbes) break
      if (perEntry[i] >= SCAN_LIMITS.probesPerEntry) continue
      const p = entryQueues[i]?.shift()
      if (p) {
        out.push(p)
        perEntry[i]++
        progressed2 = true
      }
    }
  }
  return out
}

// ---- Phân tích phản hồi ----

/**
 * Chạy detector của `probe.scenarioId`. `baseline` = kết quả baseline cùng entry
 * (null nếu không có/lỗi). Trả ScanFinding hoặc null; baseline probe không bao giờ
 * sinh finding.
 */
export function analyzeProbe(
  probe: ScanProbe,
  baseline: ReplayResult | null,
  result: ReplayResult,
): ScanFinding | null {
  if (probe.baseline === true || !result.ok) return null
  const sc = SCAN_SCENARIOS.find((s) => s.id === probe.scenarioId)
  if (!sc) return null
  const baseOk = baseline !== null && baseline.ok ? baseline : null
  const ctx: DetectCtx = {
    probe,
    result,
    body: responseText(result),
    baseBody: baseOk !== null ? responseText(baseOk) : null,
    baseMs: baseOk?.timeMs ?? 0,
    deltaMs: result.timeMs - (baseOk?.timeMs ?? 0),
  }
  const d = sc.detect(ctx)
  if (!d) return null
  return {
    id: `${probe.scenarioId}:${probe.entryId}:${probe.param}`,
    scenarioId: probe.scenarioId,
    owasp: sc.owasp,
    severity: d.severity,
    url: probe.request.url,
    param: probe.param,
    location: probe.location,
    payload: probe.payload,
    evidence: d.evidence.slice(0, 160),
    entryId: probe.entryId,
    baselineMs: Math.round(ctx.baseMs),
    deltaMs: Math.round(ctx.deltaMs),
  }
}

// ---- Báo cáo Markdown ----

export type ScanReportI18n = {
  /** i18n `capture.sec.scenario.<id>` → tên người đọc (baseline → tự truyền). */
  scenarioName: (id: string) => string
  /** `capture.severity.<sev>` → nhãn severity đã dịch. */
  severityName: (sev: ScanSeverity) => string
}

/**
 * Dựng báo cáo Markdown từ ScanReport — độc lập khỏi IPC/đĩa nên test được.
 * Bố cục: metadata · findings theo severity (kèm payload/bằng chứng) · bảng mọi
 * probe đã bắn (mutation trước, baseline cuối) · lỗi transport (khi có).
 */
export function buildScanReportMd(report: ScanReport, i18n: ScanReportI18n): string {
  const when = new Date(report.scannedAt).toLocaleString()
  const hits = report.details.filter((d) => d.hit).length
  const errs = report.details.filter((d) => d.error).length
  const lines: string[] = [
    '# Pentest Report',
    '',
    `- Hosts: ${report.hosts.join(', ')}`,
    `- Scanned: ${when}`,
    `- Probes: ${report.probes} · Hits: ${hits} · Transport errors: ${errs}${report.blocked ? ' · stopped early (blocked)' : ''}`,
    '',
  ]
  const bySeverity = new Map<ScanSeverity, ScanFinding[]>()
  for (const f of report.findings) {
    const g = bySeverity.get(f.severity) ?? []
    g.push(f)
    bySeverity.set(f.severity, g)
  }
  lines.push('## Findings')
  lines.push('')
  if (report.findings.length === 0) {
    lines.push('_No active findings._')
  } else {
    for (const sev of ['high', 'medium', 'low', 'info'] as const) {
      const fs = bySeverity.get(sev)
      if (!fs?.length) continue
      lines.push(`### ${i18n.severityName(sev)} (${fs.length})`)
      for (const f of fs) {
        lines.push(
          `- **[${f.owasp}] ${i18n.scenarioName(f.scenarioId)}** — \`${f.location}\` \`${f.param}\` @ ${f.url}`,
        )
        lines.push(`  - payload: \`${f.payload.replace(/`/g, "'")}\``)
        if (f.evidence) lines.push(`  - evidence: ${f.evidence}`)
        if (f.deltaMs)
          lines.push(
            `  - timing delta: ${Math.round(f.deltaMs)}ms (baseline ${Math.round(f.baselineMs)}ms)`,
          )
      }
    }
  }
  lines.push('')
  lines.push('## Probe log')
  lines.push('')
  lines.push('| # | Scenario | Request | Param | Payload | Status | ms | Bytes | Result |')
  lines.push('|---|---|---|---|---|---|---|---|---|')
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
  let i = 0
  for (const d of report.details) {
    i++
    const sc = d.baseline
      ? '_baseline_'
      : `${SCAN_SCENARIOS.find((s) => s.id === d.scenarioId)?.owasp ?? ''} ${i18n.scenarioName(d.scenarioId)}`.trim()
    const result = d.hit
      ? i18n.severityName(d.hit)
      : d.error
        ? `error: ${cell(d.error.slice(0, 80))}`
        : 'clean'
    lines.push(
      `| ${i} | ${cell(sc)} | ${d.method} ${d.url} | ${cell(d.baseline ? '—' : d.param)} | ${cell(d.baseline ? '—' : d.payload.slice(0, 60))} | ${d.status ?? '—'} | ${Math.round(d.timeMs)} | ${d.size} | ${result} |`,
    )
  }
  lines.push('')
  if (report.errors.length) {
    lines.push('## Transport errors')
    for (const e of report.errors) lines.push(`- ${e}`)
    lines.push('')
  }
  return lines.join('\n')
}
