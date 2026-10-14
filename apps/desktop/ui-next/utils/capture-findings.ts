// Phát hiện bảo mật thụ động trên request đã bắt (header, cookie, URL, JWT, body). Hàm thuần —
// KHÔNG gửi request nào, chỉ đọc dữ liệu đã có. `title`/`detail` là KHOÁ i18n
// `capture.finding.<id>.title|detail` + `params`; UI dịch (xem docs/features/network-capture.md).

import type { CaptureEntry, HeaderPair } from '../types/network-capture'
// @ts-expect-error đuôi `.ts` tường minh để `node --test` (Node không phân giải import trần) chạy được file này
import { decodeJwt, findJwts, parseSetCookie, queryParams } from './capture-export.ts'

export type CaptureFinding = {
  id: string
  severity: 'high' | 'medium' | 'low' | 'info'
  title: string
  detail: string
  entryId: string
  evidence?: string
  params?: Record<string, string>
}

const SEVERITY_ORDER: Record<CaptureFinding['severity'], number> = {
  high: 0,
  medium: 1,
  low: 2,
  info: 3,
}

/** Body quá lớn không quét regex (tránh treo UI); 256 KB đầu là đủ cho stack trace/JWT. */
const SCAN_LIMIT = 256 * 1024

const CRED_KEY_RE =
  /(^|[_.-])(token|access_token|api_key|apikey|key|secret|password|session|sig|signature)($|[_.-])/i

const VERBOSE_ERROR_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'python-traceback', re: /Traceback \(most recent call last\)/ },
  { name: 'java-stack', re: /\bat java\./ },
  { name: 'java-thread', re: /Exception in thread/ },
  { name: 'sqlstate', re: /SQLSTATE/ },
  { name: 'oracle', re: /ORA-\d{5}/ },
]

function headerValues(headers: HeaderPair[], name: string): string[] {
  const n = name.toLowerCase()
  return headers.filter(([k]) => k.toLowerCase() === n).map(([, v]) => v)
}

/** Set-Cookie: CDP có thể gộp nhiều dòng thành một giá trị ngăn bởi `\n` → tách lại. */
function setCookies(e: CaptureEntry): string[] {
  return headerValues(e.responseHeaders, 'set-cookie').flatMap((v) =>
    v.split('\n').filter((s) => s.trim() !== ''),
  )
}

/** Body dạng text (không base64) để quét; null nếu không có. */
function scanText(body: CaptureEntry['responseBody']): string | null {
  if (!body || body.base64) return null
  return body.text.slice(0, SCAN_LIMIT)
}

function snippet(s: string, max = 120): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}

export function analyzeEntry(e: CaptureEntry, ctx: { pageScheme?: string }): CaptureFinding[] {
  const out: CaptureFinding[] = []
  const add = (
    id: string,
    severity: CaptureFinding['severity'],
    extra?: { evidence?: string; params?: Record<string, string> },
  ) => {
    out.push({
      id,
      severity,
      title: `capture.finding.${id}.title`,
      detail: `capture.finding.${id}.detail`,
      entryId: e.id,
      ...(extra?.evidence !== undefined ? { evidence: extra.evidence } : {}),
      params: { host: e.host, ...extra?.params },
    })
  }

  const resp = e.responseHeaders
  const req = e.requestHeaders
  const isHttps = e.scheme === 'https' || e.scheme === 'wss'
  const okStatus = e.status !== null && e.status >= 200 && e.status < 300

  // ---- Cookie ----
  for (const raw of setCookies(e)) {
    const c = parseSetCookie(raw)
    const p = { name: c.name }
    const sameSite = typeof c.attrs.samesite === 'string' ? c.attrs.samesite.toLowerCase() : ''
    if (!c.attrs.httponly) add('cookieNoHttpOnly', 'medium', { evidence: c.name, params: p })
    if (!c.attrs.secure && isHttps) add('cookieNoSecure', 'medium', { evidence: c.name, params: p })
    if (sameSite === 'none' && !c.attrs.secure) {
      add('cookieSameSiteNoneInsecure', 'high', { evidence: c.name, params: p })
    } else if (sameSite === '') {
      add('cookieNoSameSite', 'low', { evidence: c.name, params: p })
    }
  }

  // ---- Header bảo mật của tài liệu HTML ----
  const mime = e.mimeType.toLowerCase()
  if (e.resourceType === 'Document' && okStatus && (mime === '' || mime.includes('html'))) {
    const csp = headerValues(resp, 'content-security-policy').join('; ')
    if (!csp) add('missingCsp', 'medium')
    if (isHttps && headerValues(resp, 'strict-transport-security').length === 0) {
      add('missingHsts', 'medium')
    }
    if (headerValues(resp, 'x-content-type-options').length === 0) add('missingXcto', 'low')
    const framed = headerValues(resp, 'x-frame-options').length > 0 || /frame-ancestors/i.test(csp)
    if (!framed) add('missingFrameProtection', 'low')
    if (headerValues(resp, 'referrer-policy').length === 0) add('missingReferrerPolicy', 'info')
  }

  // ---- CORS ----
  const acao = headerValues(resp, 'access-control-allow-origin')[0]?.trim()
  if (acao !== undefined) {
    const creds = headerValues(resp, 'access-control-allow-credentials')[0]?.trim().toLowerCase()
    const withCreds = creds === 'true'
    const origin = headerValues(req, 'origin')[0]?.trim()
    if (acao === '*' && withCreds) {
      add('corsWildcardCredentials', 'high', { evidence: 'Access-Control-Allow-Origin: *' })
    } else if (origin && acao === origin && origin !== `${e.scheme}://${e.host}`) {
      add('corsReflectOrigin', withCreds ? 'high' : 'low', {
        evidence: `Origin: ${origin}`,
        params: { origin, credentials: String(withCreds) },
      })
    }
  }

  // ---- Mixed content ----
  if (ctx.pageScheme === 'https' && (e.scheme === 'http' || e.scheme === 'ws') && !e.isNavigation) {
    const active = ['Script', 'Stylesheet', 'XHR', 'Fetch', 'WebSocket', 'Document'].includes(
      e.resourceType,
    )
    add('mixedContent', active ? 'high' : 'medium', {
      evidence: e.url,
      params: { type: e.resourceType },
    })
  }

  // ---- Thông tin xác thực trong URL ----
  for (const [key, value] of queryParams(e.url)) {
    if (value !== '' && CRED_KEY_RE.test(key)) {
      add('credentialsInUrl', 'medium', { evidence: key, params: { key } })
    }
  }
  try {
    const u = new URL(e.url)
    if (u.username || u.password) {
      add('userinfoInUrl', 'high', { evidence: u.username, params: { user: u.username } })
    }
  } catch {
    // URL không parse được: bỏ qua rule userinfo.
  }

  // ---- JWT (URL, header, body) ----
  const jwtSources: string[] = [
    e.url,
    ...req.map(([, v]) => v),
    ...resp.map(([, v]) => v),
    scanText(e.requestBody) ?? '',
    scanText(e.responseBody) ?? '',
  ]
  const seen: Record<string, true> = {}
  for (const token of jwtSources.flatMap((s) => (s ? findJwts(s) : []))) {
    if (seen[token]) continue
    seen[token] = true
    const jwt = decodeJwt(token)
    if (!jwt) continue
    const header = jwt.header as Record<string, unknown>
    const alg = typeof header.alg === 'string' ? header.alg : ''
    const evidence = `${token.slice(0, 24)}…`
    if (alg.toLowerCase() === 'none') add('jwtAlgNone', 'high', { evidence, params: { alg } })
    if (jwt.expired) add('jwtExpired', 'low', { evidence })
  }

  // ---- Basic auth qua http ----
  const authz = headerValues(req, 'authorization')[0] ?? ''
  if (/^basic\s/i.test(authz) && (e.scheme === 'http' || e.scheme === 'ws')) {
    add('basicAuthOverHttp', 'high')
  }

  // ---- Lộ phiên bản server ----
  const server = headerValues(resp, 'server')[0]
  if (server && /\d/.test(server))
    add('serverVersion', 'low', { evidence: server, params: { value: server } })
  const powered = headerValues(resp, 'x-powered-by')[0]
  if (powered) add('poweredBy', 'low', { evidence: powered, params: { value: powered } })
  const aspnet =
    headerValues(resp, 'x-aspnet-version')[0] ?? headerValues(resp, 'x-aspnetmvc-version')[0]
  if (aspnet) add('aspnetVersion', 'low', { evidence: aspnet, params: { value: aspnet } })

  // ---- Body: lỗi chi tiết + directory listing ----
  const text = scanText(e.responseBody)
  if (text) {
    for (const { name, re } of VERBOSE_ERROR_PATTERNS) {
      const m = re.exec(text)
      if (m) {
        add('verboseError', 'medium', {
          evidence: snippet(text.slice(m.index)),
          params: { pattern: name },
        })
        break
      }
    }
    if (/<title>\s*Index of \//i.test(text)) add('directoryListing', 'medium')
  }

  // ---- Cache ----
  const sensitive = setCookies(e).length > 0 || authz !== ''
  if (sensitive && okStatus) {
    const cc = headerValues(resp, 'cache-control').join(',').toLowerCase()
    if (!cc.includes('no-store')) add('cacheNoStore', 'low', { evidence: cc || undefined })
  }

  return out
}

/** Phân tích mọi entry; `pageScheme` suy từ request điều hướng gần nhất (theo seq) của cùng tab. */
export function analyzeAll(entries: CaptureEntry[]): CaptureFinding[] {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq)
  const pageScheme: Record<string, string> = {}
  const dedupe: Record<string, true> = {}
  const out: CaptureFinding[] = []
  for (const e of sorted) {
    if (e.isNavigation) pageScheme[e.tabId] = e.scheme
    for (const f of analyzeEntry(e, { pageScheme: pageScheme[e.tabId] })) {
      const key = `${f.id}\u0000${e.host}`
      if (dedupe[key]) continue
      dedupe[key] = true
      out.push(f)
    }
  }
  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}
