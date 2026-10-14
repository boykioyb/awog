// Hàm thuần cho trình kiểm tra Network capture: xuất (cURL/fetch/raw HTTP), parse (cookie/JWT/raw
// request) và định dạng body để HIỂN THỊ. Mọi đầu ra là CHUỖI THUẦN — không bao giờ sinh markup
// (UI render bằng text node, không `v-html`). Chỉ dùng `import type` + cú pháp "erasable" để
// `node --test` chạy thẳng file TS (xem utils/__tests__/capture-export.test.mjs).

import type { CaptureBody, CaptureEntry, HeaderPair } from '../types/network-capture'

// ---- Tiện ích nội bộ ----

const utf8 = new TextDecoder('utf-8')

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Body → chuỗi utf8 (giải base64 nếu cần). Byte không hợp lệ thành U+FFFD. */
function bodyToText(body: CaptureBody): string {
  if (!body.base64) return body.text
  try {
    return utf8.decode(b64ToBytes(body.text))
  } catch {
    return ''
  }
}

function lower(s: string): string {
  return s.toLowerCase()
}

/** Header giả HTTP/2 (`:authority`, `:method`…) — không phải header thật trên dây HTTP/1. */
function pseudo(headers: HeaderPair[], name: string): string | undefined {
  return headers.find(([n]) => lower(n) === name)?.[1]
}

function headerValue(headers: HeaderPair[], name: string): string | undefined {
  const n = lower(name)
  return headers.find(([k]) => lower(k) === n)?.[1]
}

function safeUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** `/path?query` của URL; rơi về `e.path` khi URL không parse được. */
function requestTarget(e: CaptureEntry): string {
  const u = safeUrl(e.url)
  if (u) return `${u.pathname}${u.search}` || '/'
  return e.path || '/'
}

function authorityOf(e: CaptureEntry): string {
  const u = safeUrl(e.url)
  return pseudo(e.requestHeaders, ':authority') ?? u?.host ?? e.host
}

function realHeaders(headers: HeaderPair[]): HeaderPair[] {
  return headers.filter(([n]) => !n.startsWith(':'))
}

// ---- Quoting ----

/** bash: bọc nháy đơn, `'` → `'\''`. Xuống dòng/unicode giữ nguyên (nháy đơn bash là literal). */
function quoteBash(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * cmd.exe (kiểu Chrome "copy as cURL (cmd)"): `\` → `\\`, `"` → `\"`, rồi chèn `^` trước ký tự
 * đặc biệt của cmd; xuống dòng → `^` + 2 LF; bọc `^"…^"`.
 */
function quoteCmd(s: string): string {
  const body = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[&|<>^"%]/g, '^$&')
    .replace(/\r?\n/g, '^\n\n')
  return `^"${body}^"`
}

// ---- cURL ----

export function toCurl(e: CaptureEntry, opts?: { shell?: 'bash' | 'cmd' }): string {
  const cmd = opts?.shell === 'cmd'
  const q = cmd ? quoteCmd : quoteBash
  const sep = cmd ? ' ^\n  ' : ' \\\n  '
  const headers = realHeaders(e.requestHeaders)
  const compressed = headers.some(([n]) => lower(n) === 'accept-encoding')
  const u = safeUrl(e.url)
  const method = e.method.toUpperCase()

  const body = e.requestBody
  const hasBody = !!body && body.size > 0 && (body.text.length > 0 || body.size > 0)
  const binary = !!body && body.base64

  const parts: string[] = [`curl ${q(e.url)}`]
  // -X chỉ khi curl không tự suy ra được: GET mặc định, POST suy ra từ --data*.
  if (!(method === 'GET' && !hasBody) && !(method === 'POST' && hasBody)) {
    parts.push(method === 'HEAD' ? '-I' : `-X ${q(method)}`)
  }
  for (const [name, value] of headers) {
    const n = lower(name)
    if (n === 'content-length') continue // curl tự tính theo body
    if (n === 'accept-encoding') continue // thay bằng --compressed
    if (n === 'host' && u && lower(value) === lower(u.host)) continue
    parts.push(`-H ${q(`${name}: ${value}`)}`)
  }
  if (hasBody && body) {
    parts.push(binary ? '--data-binary @-' : `--data-raw ${q(body.text)}`)
  }
  if (compressed) parts.push('--compressed')

  const line = parts.join(sep)
  if (!(hasBody && binary && body)) return line
  // Body nhị phân: không nhét được vào đối số → đẩy qua stdin.
  if (cmd) {
    return `REM body nhị phân (base64): ghi ra body.bin rồi dùng --data-binary @body.bin\nREM ${body.text}\n${line.replace('--data-binary @-', '--data-binary @body.bin')}`
  }
  return `printf %s ${quoteBash(body.text)} | base64 -d | ${line}`
}

// ---- fetch() ----

// Header trình duyệt cấm đặt từ JS (forbidden header names) — liệt kê bằng comment thay vì đưa vào.
const FETCH_FORBIDDEN: Record<string, true> = {
  cookie: true,
  host: true,
  'content-length': true,
  'accept-encoding': true,
  connection: true,
  'user-agent': true,
  origin: true,
  referer: true,
  'sec-fetch-dest': true,
  'sec-fetch-mode': true,
  'sec-fetch-site': true,
  'sec-fetch-user': true,
}

export function toFetch(e: CaptureEntry): string {
  const headers = realHeaders(e.requestHeaders)
  const kept = headers.filter(([n]) => {
    const k = lower(n)
    return !FETCH_FORBIDDEN[k] && !k.startsWith('sec-ch-')
  })
  const dropped = headers.filter(([n]) => !kept.some(([k]) => k === n))
  const lines: string[] = []
  lines.push(
    "// credentials: 'include' gửi kèm cookie của trình duyệt hiện tại (không phải Cookie header đã bắt).",
  )
  if (dropped.length > 0) {
    lines.push(
      `// Header trình duyệt tự đặt / cấm đặt từ JS, đã bỏ: ${dropped.map(([n]) => n).join(', ')}`,
    )
  }
  lines.push(`fetch(${JSON.stringify(e.url)}, {`)
  // Mảng cặp để giữ đúng thứ tự + header trùng tên (object literal sẽ gộp mất).
  lines.push(`  headers: ${JSON.stringify(kept)},`)
  const method = e.method.toUpperCase()
  const body = e.requestBody
  if (body && body.size > 0 && method !== 'GET' && method !== 'HEAD') {
    if (body.base64) {
      lines.push(
        `  body: Uint8Array.from(atob(${JSON.stringify(body.text)}), (c) => c.charCodeAt(0)),`,
      )
    } else {
      lines.push(`  body: ${JSON.stringify(body.text)},`)
    }
  }
  lines.push(`  method: ${JSON.stringify(method)},`)
  lines.push(`  credentials: 'include',`)
  lines.push('})')
  return lines.join('\n')
}

// ---- Raw HTTP ----

function httpVersionLabel(v: string | undefined): string {
  const s = (v ?? '').toLowerCase()
  if (s === 'h2' || s === 'http/2' || s === 'http/2.0') return 'HTTP/2'
  if (s === 'h3' || s === 'http/3') return 'HTTP/3'
  if (s === 'http/1.0') return 'HTTP/1.0'
  return 'HTTP/1.1'
}

export function toRawRequest(e: CaptureEntry): string {
  const headers = realHeaders(e.requestHeaders)
  const method = (pseudo(e.requestHeaders, ':method') ?? e.method).toUpperCase()
  const path = pseudo(e.requestHeaders, ':path') ?? requestTarget(e)
  const lines = [`${method} ${path} HTTP/1.1`]
  // HTTP/2 mang host trong `:authority` → dựng lại `Host:` (đặt đầu, như client HTTP/1.1 thật).
  if (!headers.some(([n]) => lower(n) === 'host')) lines.push(`Host: ${authorityOf(e)}`)
  for (const [n, v] of headers) lines.push(`${n}: ${v}`)
  return `${lines.join('\r\n')}\r\n\r\n${e.requestBody ? bodyToText(e.requestBody) : ''}`
}

export function toRawResponse(e: CaptureEntry): string {
  const headers = realHeaders(e.responseHeaders)
  const status = e.status ?? 0
  const pseudoStatus = pseudo(e.responseHeaders, ':status')
  const code = pseudoStatus ?? String(status)
  const first = `${httpVersionLabel(e.httpVersion)} ${code}${e.statusText ? ` ${e.statusText}` : ''}`
  const lines = [first, ...headers.map(([n, v]) => `${n}: ${v}`)]
  const body = e.responseBody ? bodyToText(e.responseBody) : ''
  return `${lines.join('\r\n')}\r\n\r\n${body}`
}

/** Parse raw request do người dùng sửa trong repeater. Chịu `\n` lẫn `\r\n`, absolute-form, thiếu Host. */
export function parseRawRequest(
  raw: string,
  base: { scheme: string; host: string },
): { method: string; url: string; headers: HeaderPair[]; body: string } {
  const m = /\r?\n\r?\n/.exec(raw)
  const head = m ? raw.slice(0, m.index) : raw
  const body = m ? raw.slice(m.index + m[0].length) : ''
  const lines = head.split(/\r?\n/)
  // Bỏ dòng trống đầu (người dùng dán thừa xuống dòng).
  while (lines.length > 0 && lines[0]!.trim() === '') lines.shift()
  const reqLine = (lines.shift() ?? '').trim()
  const rm = /^(\S+)(?:\s+(\S+))?(?:\s+HTTP\/\S+)?$/i.exec(reqLine)
  const method = (rm?.[1] ?? 'GET').toUpperCase()
  const target = rm?.[2] ?? '/'

  const headers: HeaderPair[] = []
  for (const line of lines) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()])
  }

  let url: string
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
    url = target // absolute-form
  } else {
    const host = headerValue(headers, 'host') || base.host
    const path = target.startsWith('/') ? target : `/${target === '*' ? '' : target}`
    url = `${base.scheme}://${host}${path}`
  }
  return { method, url, headers, body }
}

// ---- JWT ----

function b64urlDecode(s: string): string {
  let b = s.replace(/-/g, '+').replace(/_/g, '/')
  while (b.length % 4 !== 0) b += '='
  return utf8.decode(b64ToBytes(b))
}

export function decodeJwt(
  token: string,
): { header: unknown; payload: unknown; signature: string; expired?: boolean } | null {
  const parts = token.trim().split('.')
  if (parts.length !== 3) return null
  const [h, p, signature] = parts as [string, string, string]
  if (!h || !p) return null
  try {
    const header: unknown = JSON.parse(b64urlDecode(h))
    const payload: unknown = JSON.parse(b64urlDecode(p))
    if (typeof header !== 'object' || header === null || Array.isArray(header)) return null
    const out: { header: unknown; payload: unknown; signature: string; expired?: boolean } = {
      header,
      payload,
      signature,
    }
    const exp =
      typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>).exp
        : undefined
    if (typeof exp === 'number' && Number.isFinite(exp)) out.expired = exp * 1000 < Date.now()
    return out
  } catch {
    return null
  }
}

const JWT_RE = /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g

/** Mọi chuỗi trông như JWT (và giải mã được) trong `text`, không trùng lặp. */
export function findJwts(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(JWT_RE)) {
    if (decodeJwt(m[0])) out.add(m[0])
  }
  return [...out]
}

// ---- Cookie ----

export function parseCookieHeader(v: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = []
  for (const part of v.split(';')) {
    const s = part.trim()
    if (!s) continue
    const i = s.indexOf('=')
    if (i < 0) out.push({ name: s, value: '' })
    else out.push({ name: s.slice(0, i).trim(), value: s.slice(i + 1).trim() })
  }
  return out
}

/** Thuộc tính viết thường (`max-age`, `expires`, `samesite`, `secure`, `httponly`, `partitioned`…). */
export function parseSetCookie(v: string): {
  name: string
  value: string
  attrs: Record<string, string | true>
} {
  const [first = '', ...rest] = v.split(';')
  const i = first.indexOf('=')
  const name = (i < 0 ? first : first.slice(0, i)).trim()
  const value = i < 0 ? '' : first.slice(i + 1).trim()
  const attrs: Record<string, string | true> = {}
  for (const part of rest) {
    const s = part.trim()
    if (!s) continue
    const j = s.indexOf('=')
    if (j < 0) attrs[lower(s)] = true
    else attrs[lower(s.slice(0, j).trim())] = s.slice(j + 1).trim()
  }
  return { name, value, attrs }
}

// ---- Query ----

export function queryParams(url: string): HeaderPair[] {
  const u = safeUrl(url)
  if (u) return [...u.searchParams.entries()]
  const q = url.split('#')[0]!.split('?')[1]
  if (!q) return []
  return q
    .split('&')
    .filter(Boolean)
    .map((kv): HeaderPair => {
      const i = kv.indexOf('=')
      return i < 0 ? [kv, ''] : [kv.slice(0, i), kv.slice(i + 1)]
    })
}

// ---- Body hiển thị ----

const RASTER_MIME: Record<string, true> = {
  'image/png': true,
  'image/jpeg': true,
  'image/jpg': true,
  'image/gif': true,
  'image/webp': true,
  'image/bmp': true,
  'image/x-icon': true,
  'image/vnd.microsoft.icon': true,
}

function hexDump(bytes: Uint8Array, limit = 4096): string {
  const n = Math.min(bytes.length, limit)
  const rows: string[] = []
  for (let i = 0; i < n; i += 16) {
    const slice = bytes.subarray(i, Math.min(i + 16, n))
    const hex = [...slice].map((b) => b.toString(16).padStart(2, '0')).join(' ')
    const ascii = [...slice]
      .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'))
      .join('')
    rows.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`)
  }
  if (bytes.length > n) rows.push(`… (${bytes.length - n} byte nữa)`)
  return rows.join('\n')
}

function isTextMime(m: string): boolean {
  return (
    m.startsWith('text/') ||
    m.includes('json') ||
    m.includes('xml') ||
    m.includes('javascript') ||
    m.includes('x-www-form-urlencoded') ||
    m.includes('yaml') ||
    m.includes('graphql')
  )
}

function safeDecodeURIComponent(s: string): string {
  const t = s.replace(/\+/g, ' ')
  try {
    return decodeURIComponent(t)
  } catch {
    return t
  }
}

export function prettyBody(
  body: CaptureBody,
  mimeType: string,
): {
  kind: 'json' | 'html' | 'xml' | 'form' | 'text' | 'image' | 'binary'
  text: string
} {
  const mime = lower(mimeType.split(';')[0]!.trim())

  // Ảnh raster → data URL (chỉ loại raster; svg là văn bản, KHÔNG bao giờ thành ảnh để tránh script).
  if (RASTER_MIME[mime] && body.base64) {
    return { kind: 'image', text: `data:${mime};base64,${body.text}` }
  }

  let text: string
  if (body.base64) {
    let bytes: Uint8Array
    try {
      bytes = b64ToBytes(body.text)
    } catch {
      return { kind: 'binary', text: '' }
    }
    if (!isTextMime(mime) && mime !== '') return { kind: 'binary', text: hexDump(bytes) }
    text = utf8.decode(bytes)
    // mime rỗng: coi là nhị phân nếu có byte NUL.
    if (mime === '' && text.includes('\u0000')) return { kind: 'binary', text: hexDump(bytes) }
  } else {
    text = body.text
  }

  if (mime.includes('json') || (mime === '' && /^\s*[[{]/.test(text))) {
    try {
      return { kind: 'json', text: JSON.stringify(JSON.parse(text), null, 2) }
    } catch {
      return { kind: 'text', text }
    }
  }
  if (mime === 'application/x-www-form-urlencoded') {
    const lines = text
      .split('&')
      .filter(Boolean)
      .map((kv) => {
        const i = kv.indexOf('=')
        const k = safeDecodeURIComponent(i < 0 ? kv : kv.slice(0, i))
        const v = i < 0 ? '' : safeDecodeURIComponent(kv.slice(i + 1))
        return `${k} = ${v}`
      })
    return { kind: 'form', text: lines.join('\n') }
  }
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return { kind: 'html', text }
  if (mime.includes('xml')) return { kind: 'xml', text }
  return { kind: 'text', text }
}
