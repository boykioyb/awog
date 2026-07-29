// Small pure helpers. No DOM secure-context APIs (the PWA is served over plain
// HTTP on the tailnet IP, so crypto.randomUUID / crypto.subtle are unavailable —
// only crypto.getRandomValues works in an insecure context).

// 32-hex-char id used for client-generated messageIds (the assistant turn id the
// gateway/sidecar echoes back on session.chunk/step/done events).
export function randomId(): string {
  const buf = new Uint8Array(16)
  const c = globalThis.crypto
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(buf)
  } else {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256)
  }
  let out = ''
  for (const b of buf) out += b.toString(16).padStart(2, '0')
  return out
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  return 'Đã xảy ra lỗi'
}

export type DevicePlatform = 'ios' | 'android' | 'web'

export function detectPlatform(): DevicePlatform {
  const ua = navigator.userAgent
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  if (/android/i.test(ua)) return 'android'
  return 'web'
}

// A short human label for the paired device row (Settings → Devices on desktop).
export function deviceLabel(): string {
  const ua = navigator.userAgent
  let os = 'Web'
  if (/iphone/i.test(ua)) os = 'iPhone'
  else if (/ipad/i.test(ua)) os = 'iPad'
  else if (/android/i.test(ua)) os = 'Android'
  else if (/macintosh|mac os x/i.test(ua)) os = 'Mac'
  else if (/windows/i.test(ua)) os = 'Windows'
  let browser = 'browser'
  if (/edg\//i.test(ua)) browser = 'Edge'
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome'
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox'
  else if (/safari/i.test(ua)) browser = 'Safari'
  return `${os} · ${browser}`
}

// Read `#pair=<code>` from the current URL hash (the desktop QR opens the PWA with
// this fragment). Returns the code or null.
export function hashPairCode(): string | null {
  const h = location.hash.replace(/^#/, '')
  const params = new URLSearchParams(h)
  const code = params.get('pair')
  return code && code.trim() ? code.trim() : null
}

export function clearHash(): void {
  history.replaceState(null, '', location.pathname + location.search)
}

// Compact relative time for list rows ("vừa xong", "5m", "3h", "2d").
export function relTime(iso?: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  if (diff < 60_000) return 'vừa xong'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}
