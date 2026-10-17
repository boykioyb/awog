// Lớp gọi mạng duy nhất của tính năng Slack threads: Web API + tải file/ảnh.
//
// Vì sao tự viết thay vì đi qua MCP Slack của nguồn: MCP chỉ có tool mức cao
// (đọc kênh, gửi tin) và trả text đã định dạng sẵn; tính năng thread cần payload
// thô (`reactions`, `files`, `edited`, `latest_reply`) và gọi nhiều lần mỗi phút
// khi poll. Dùng lại đúng user token mà nguồn đã OAuth (`getFreshToken`) nên
// không có thêm bí mật nào phải cất.
//
// Bảo mật (invariant 1 + 7):
// - Web API (`slack.com/api/*`) CHỈ gọi qua `callSlackApi`, URL dựng nội bộ từ
//   tên method đã qua regex. URL lấy từ payload Slack (`url_private`, `thumb_*`,
//   avatar, emoji…) là L1: một tin/file do người ngoài tạo có thể mang
//   `url_private = https://slack.com/api/conversations.invite?...` — nếu tải nó
//   kèm Bearer thì token của người dùng thành công cụ cho người ngoài. Vì vậy URL
//   payload đi qua `contentUrlAccess`: `files.slack.com` + path `/files-pri/` hoặc
//   `/files-tmb/` mới được gắn token; `files.slack.com` path khác và
//   `*.slack-edge.com` (CDN ảnh công khai) đi không token; mọi host khác — kể cả
//   `slack.com` — bị chặn.
// - `redirect: 'manual'` rồi tự theo tối đa MAX_REDIRECTS bước, mỗi bước áp lại
//   đúng luật trên (kể cả khi bước đầu là Web API). Để fetch tự theo redirect thì
//   một 302 trỏ ra ngoài sẽ mang luôn header Authorization đi theo.
// - Thông điệp lỗi chỉ chứa tên method + mã lỗi Slack, không bao giờ chứa token.
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Readable, Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { log } from '../util/logger.js'

const API_BASE = 'https://slack.com/api/'
const MAX_REDIRECTS = 3
const API_TIMEOUT_MS = 30_000
// Tải file lớn (≤200 MB) qua mạng chậm cần rộng tay; vẫn phải có trần để một
// kết nối treo không giữ RPC mãi.
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000
// Method ĐỌC được thử lại tối đa 2 lần khi bị 429. Method ghi không thử lại:
// `chat.postMessage` không idempotent, thử lại sau một lỗi mạng giữa chừng có
// thể đăng hai lần.
const MAX_READ_RETRIES = 2
// Retry-After lớn bất thường (Slack có lúc trả hàng phút) thì thôi chờ — để
// lượt poll sau làm, không giữ RPC lâu.
const MAX_RETRY_AFTER_S = 30

// Mã lỗi Slack (hoặc mã tự đặt cho lỗi mạng/HTTP) để caller rẽ nhánh, ví dụ
// `missing_scope`, `not_in_channel`, `thread_not_found`, `invalid_auth`,
// `token_expired`, `ratelimited`, `not_connected`, `network`, `http_500`.
export class SlackApiError extends Error {
  public readonly code: string

  public readonly needed: string | null

  constructor(code: string, message: string, needed: string | null = null) {
    super(message)
    this.name = 'SlackApiError'
    this.code = code
    this.needed = needed
  }
}

const AUTH_CODES = new Set([
  'not_authed',
  'invalid_auth',
  'token_expired',
  'token_revoked',
  'account_inactive',
  'not_connected',
])

export function isAuthErrorCode(code: string): boolean {
  return AUTH_CODES.has(code)
}

// Host nội dung (file, thumbnail, avatar, emoji) mà URL từ payload được phép trỏ
// tới. KHÔNG có `slack.com`: Web API chỉ đi qua `callSlackApi`.
const FILES_HOST = 'files.slack.com'
const CDN_SUFFIX = '.slack-edge.com'
// Path file riêng tư thật sự cần token (file gốc + thumbnail). Path khác trên
// `files.slack.com` không có lý do gì phải mang token. Khớp CẢ hình dạng segment đầu
// chứ không chỉ tiền tố: `/files-pri/T…-F…/…` (file gốc, `…/download/…`) và
// `/files-tmb/T…-F…-<hash>/…` (thumbnail có thêm hậu tố hash — đo trên payload thật).
// Tiền tố trần thì `/files-pri/x/../../api/…` dạng mã hoá vẫn có thể lọt.
const TOKEN_PATH_RE = /^\/files-(?:pri|tmb)\/T[A-Z0-9]+-F[A-Z0-9]+(?:-[a-z0-9]+)?\//
// Dấu `/`, `\`, `.` mã hoá trong path: Slack không bao giờ sinh ra, còn proxy/server
// phía sau có thể giải mã thành phân cách đường dẫn — có ⇒ không gắn token.
const ENCODED_SEPARATOR_RE = /%(?:2f|5c|2e)/i

export function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase()
  return h === FILES_HOST || h.endsWith(CDN_SUFFIX)
}

// 'token' = được gắn Bearer; 'anonymous' = gọi được nhưng không token; null = chặn.
export type UrlAccess = 'token' | 'anonymous'

export function contentUrlAccess(url: URL): UrlAccess | null {
  // Cổng lạ / user:pass trong URL không bao giờ có ở link Slack thật.
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  const h = url.hostname.toLowerCase()
  if (h === FILES_HOST) {
    // `new URL` đã chuẩn hoá `..`/`%2e%2e` nên `/files-pri/../api` không lọt qua; còn
    // lại `%2f`/`%5c`/`%2e` lẻ thì chặn token ở đây.
    const p = url.pathname
    return TOKEN_PATH_RE.test(p) && !ENCODED_SEPARATOR_RE.test(p) ? 'token' : 'anonymous'
  }
  if (h.endsWith(CDN_SUFFIX)) return 'anonymous'
  return null
}

export function parseAllowedUrl(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  return contentUrlAccess(url) ? url : null
}

type FetchInit = {
  method: 'GET' | 'POST'
  body?: URLSearchParams
  timeoutMs: number
  // true CHỈ khi `start` do `callSlackApi` dựng từ API_BASE. Bước đầu khi đó được
  // gắn token; mọi bước redirect sau vẫn áp luật URL nội dung.
  internalApi?: boolean
}

// fetch có kiểm host từng bước redirect. Trả response KHÔNG phải 3xx.
async function guardedFetch(start: URL, token: string | null, init: FetchInit): Promise<Response> {
  let url = start
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const access: UrlAccess | null = hop === 0 && init.internalApi ? 'token' : contentUrlAccess(url)
    if (!access) {
      throw new SlackApiError('blocked_host', `Refused to contact ${url.hostname}`)
    }
    const headers: Record<string, string> = {}
    if (token && access === 'token') headers.Authorization = `Bearer ${token}`
    if (init.body) headers['Content-Type'] = 'application/x-www-form-urlencoded'
    let res: Response
    try {
      // eslint-disable-next-line no-await-in-loop -- từng bước redirect phải tuần tự
      res = await fetch(url, {
        method: hop === 0 ? init.method : 'GET',
        headers,
        ...(init.body && hop === 0 ? { body: init.body } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(init.timeoutMs),
      })
    } catch (err) {
      throw new SlackApiError(
        'network',
        `Network error contacting ${url.hostname}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    if (res.status < 300 || res.status >= 400) return res
    const location = res.headers.get('location')
    // Bỏ body để socket được trả về pool.
    await res.body?.cancel().catch(() => undefined)
    if (!location) throw new SlackApiError(`http_${res.status}`, 'Redirect without location')
    let next: URL
    try {
      next = new URL(location, url)
    } catch {
      throw new SlackApiError('blocked_host', 'Redirect to an invalid URL')
    }
    if (!contentUrlAccess(next)) {
      log.warn('slack: refused redirect outside allowlist', { host: next.hostname })
      throw new SlackApiError('blocked_host', `Refused redirect to ${next.hostname}`)
    }
    url = next
  }
  throw new SlackApiError('too_many_redirects', 'Too many redirects')
}

export type ApiParamValue = string | number | boolean | undefined | null

export type ApiResult = {
  data: Record<string, unknown>
  // Header `x-oauth-scopes` (null nếu Slack không gửi) — nguồn duy nhất để biết
  // token đang thiếu scope nào mà không phải thử từng method.
  scopes: string[] | null
}

function toForm(params: Record<string, ApiParamValue>): URLSearchParams {
  const form = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    form.set(k, String(v))
  }
  return form
}

function retryAfterSeconds(res: Response): number {
  const raw = Number(res.headers.get('retry-after'))
  return Number.isFinite(raw) && raw > 0 ? raw : 1
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Gọi một method Web API. POST form-urlencoded dùng được cho mọi method (cả
// đọc lẫn ghi) nên không phải nhớ method nào GET-able.
export async function callSlackApi(
  token: string,
  method: string,
  params: Record<string, ApiParamValue>,
  opts: { write?: boolean } = {},
): Promise<ApiResult> {
  if (!/^[a-z]+(\.[a-zA-Z]+)+$/.test(method)) throw new Error(`Bad Slack method: ${method}`)
  const maxRetries = opts.write ? 0 : MAX_READ_RETRIES
  for (let attempt = 0; ; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop -- retry tuần tự theo Retry-After
    const res = await guardedFetch(new URL(method, API_BASE), token, {
      method: 'POST',
      body: toForm(params),
      timeoutMs: API_TIMEOUT_MS,
      internalApi: true,
    })
    if (res.status === 429) {
      const wait = retryAfterSeconds(res)
      await res.body?.cancel().catch(() => undefined)
      if (attempt >= maxRetries || wait > MAX_RETRY_AFTER_S) {
        throw new SlackApiError('ratelimited', `Slack ${method} rate limited (retry after ${wait}s)`)
      }
      log.info('slack: rate limited, backing off', { method, wait })
      // eslint-disable-next-line no-await-in-loop
      await sleep(wait * 1000)
      continue
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined)
      throw new SlackApiError(`http_${res.status}`, `Slack ${method} failed: HTTP ${res.status}`)
    }
    let body: unknown
    try {
      // eslint-disable-next-line no-await-in-loop
      body = await res.json()
    } catch {
      throw new SlackApiError('bad_response', `Slack ${method} returned invalid JSON`)
    }
    if (typeof body !== 'object' || body === null) {
      throw new SlackApiError('bad_response', `Slack ${method} returned a non-object`)
    }
    const data = body as Record<string, unknown>
    if (data.ok !== true) {
      const code = typeof data.error === 'string' ? data.error : 'unknown_error'
      const needed = typeof data.needed === 'string' ? data.needed : null
      throw new SlackApiError(code, `Slack ${method} failed: ${code}`, needed)
    }
    const header = res.headers.get('x-oauth-scopes')
    const scopes = header
      ? header
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : null
    return { data, scopes }
  }
}

export type FetchedBytes = { bytes: Buffer; contentType: string }

// Tải nhỏ (avatar, emoji, thumbnail) thẳng vào RAM, có trần byte. `rawUrl` đến
// từ payload Slack ⇒ áp `contentUrlAccess` (token chỉ cho file riêng tư).
export async function fetchSlackBytes(
  rawUrl: string,
  token: string | null,
  maxBytes: number,
): Promise<FetchedBytes> {
  const url = parseAllowedUrl(rawUrl)
  if (!url) throw new SlackApiError('blocked_host', 'URL is not on an allowed Slack host')
  const res = await guardedFetch(url, token, { method: 'GET', timeoutMs: API_TIMEOUT_MS })
  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => undefined)
    throw new SlackApiError(`http_${res.status}`, `Download failed: HTTP ${res.status}`)
  }
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body.cancel().catch(() => undefined)
    throw new SlackApiError('too_large', 'File exceeds size limit')
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of res.body) {
    const buf = Buffer.from(chunk as Uint8Array)
    total += buf.byteLength
    if (total > maxBytes) throw new SlackApiError('too_large', 'File exceeds size limit')
    chunks.push(buf)
  }
  return { bytes: Buffer.concat(chunks), contentType: res.headers.get('content-type') ?? '' }
}

// Đếm byte khi stream: Content-Length có thể vắng hoặc nói dối, nên trần 200 MB
// phải được giữ bằng chính số byte đã nhận chứ không chỉ bằng header.
class ByteLimit extends Transform {
  private seen = 0

  constructor(private readonly limit: number) {
    super()
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    this.seen += chunk.byteLength
    if (this.seen > this.limit) {
      cb(new SlackApiError('too_large', 'File exceeds size limit'))
      return
    }
    cb(null, chunk)
  }

  get bytes(): number {
    return this.seen
  }
}

// Tải file lớn thẳng xuống `dest` (đường dẫn `.part` do caller chọn). Lỗi giữa
// chừng thì xoá file dở để lần sau không nhận nhầm.
export async function downloadSlackFile(
  rawUrl: string,
  token: string,
  dest: string,
  maxBytes: number,
): Promise<number> {
  const url = parseAllowedUrl(rawUrl)
  if (!url) throw new SlackApiError('blocked_host', 'URL is not on an allowed Slack host')
  const res = await guardedFetch(url, token, { method: 'GET', timeoutMs: DOWNLOAD_TIMEOUT_MS })
  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => undefined)
    throw new SlackApiError(`http_${res.status}`, `Download failed: HTTP ${res.status}`)
  }
  // Slack trả trang HTML đăng nhập (200) thay vì file khi token không đủ quyền
  // đọc file — lưu trang đó thành "file" của người dùng là sai lặng lẽ.
  const type = res.headers.get('content-type') ?? ''
  if (type.startsWith('text/html') && url.hostname === 'files.slack.com') {
    await res.body.cancel().catch(() => undefined)
    throw new SlackApiError('no_access', 'Slack returned a login page instead of the file')
  }
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body.cancel().catch(() => undefined)
    throw new SlackApiError('too_large', 'File exceeds size limit')
  }
  const limiter = new ByteLimit(maxBytes)
  try {
    await pipeline(
      Readable.fromWeb(res.body as WebReadableStream<Uint8Array>),
      limiter,
      createWriteStream(dest, { mode: 0o600 }),
    )
  } catch (err) {
    await rm(dest, { force: true }).catch(() => undefined)
    if (err instanceof SlackApiError) throw err
    throw new SlackApiError(
      'network',
      `Download interrupted: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return limiter.bytes
}
