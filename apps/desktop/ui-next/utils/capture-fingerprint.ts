// Nhận diện công nghệ phía server THỤ ĐỘNG từ header (Server, X-Powered-By,
// X-AspNet-Version, X-Generator, X-Drupal-*/X-CF-*/…), tên cookie (PHPSESSID,
// JSESSIONID, laravel_session…) và marker trong HTML (`<meta generator>`, đường
// asset /wp-content/, /_next/…). Không gửi request nào — chỉ đọc dữ liệu đã bắt.
// `evidence` là chuỗi thuần hiển thị nguồn hit (vd `Server: nginx/1.18`), `entryId`
// trỏ entry đầu tiên chứa bằng chứng — UI dùng để nhảy tới request trong inspector.

import type { CaptureEntry, HeaderPair } from '../types/network-capture'
// @ts-expect-error đuôi `.ts` tường minh để `node --test` (Node không phân giải import trần) chạy được file này
import { parseCookieHeader, parseSetCookie } from './capture-export.ts'

export type TechHit = { name: string; version: string | null; evidence: string; entryId: string }

/** Giống SCAN_LIMIT của capture-findings — body lớn chỉ quét đầu 256 KB. */
const SCAN_LIMIT = 256 * 1024

/** Token `Name/version` trong Server/X-Powered-By → tên hiển thị chuẩn. */
const CANON: Record<string, string> = {
  nginx: 'nginx',
  'apache-coyote': 'Apache Tomcat',
  'apache tomcat': 'Tomcat',
  tomcat: 'Tomcat',
  apache: 'Apache httpd',
  'microsoft-iis': 'Microsoft IIS',
  iis: 'Microsoft IIS',
  litespeed: 'LiteSpeed',
  openresty: 'OpenResty',
  caddy: 'Caddy',
  cloudflare: 'Cloudflare',
  gunicorn: 'Gunicorn',
  uvicorn: 'Uvicorn',
  werkzeug: 'Werkzeug',
  jetty: 'Jetty',
  envoy: 'Envoy',
  php: 'PHP',
  'php-fpm': 'PHP-FPM',
  express: 'Express',
  'next.js': 'Next.js',
  nuxt: 'Nuxt',
  django: 'Django',
  rails: 'Rails',
  aspnet: 'ASP.NET',
  'asp.net': 'ASP.NET',
  kestrel: 'Kestrel',
  wordpress: 'WordPress',
  drupal: 'Drupal',
  joomla: 'Joomla',
  servlet: 'Java Servlet',
  varnish: 'Varnish',
  squid: 'Squid',
  'arr/3.0': 'IIS ARR',
  'asp.net core': 'ASP.NET Core',
}

/** Header chứa danh sách sản phẩm `Token/x.y` → nhận diện từng token. */
const PRODUCT_HEADERS = ['server', 'x-powered-by', 'x-generator']

/** Header mang sẵn version (giá trị là version, không phải tên). */
const FIXED_HEADERS: { name: string; header: string }[] = [
  { name: 'ASP.NET', header: 'x-aspnet-version' },
  { name: 'ASP.NET MVC', header: 'x-aspnetmvc-version' },
  { name: 'Akamai', header: 'x-akamai-transformed' },
  { name: 'CloudFront', header: 'x-amz-cf-id' },
  { name: 'Fastly', header: 'x-served-by' },
  { name: 'LiteSpeed', header: 'x-litespeed-cache' },
  { name: 'Shopify', header: 'x-shopify-stage' },
  { name: 'Vercel', header: 'x-vercel-id' },
  { name: 'WordPress', header: 'x-pingback' },
]

/** Tên cookie → framework (xét cả Set-Cookie lẫn Cookie request gửi lên). */
const COOKIE_TECH: Record<string, string> = {
  phpsessid: 'PHP',
  jsessionid: 'Java Servlet',
  'asp.net_sessionid': 'ASP.NET',
  aspnet_sessionid: 'ASP.NET',
  'connect.sid': 'Express',
  laravel_session: 'Laravel',
  _session_id: 'Rails',
  csrftoken: 'Django',
  wordpress_logged_in: 'WordPress',
  wp_woocommerce_session: 'WordPress',
  cakephp: 'CakePHP',
  cf_clearance: 'Cloudflare',
  __cf_bm: 'Cloudflare',
}

/** Marker trong HTML/text body (đầy đủ chứ không chỉ Document — API có thể trả lỗi HTML). */
const BODY_RULES: { name: string; re: RegExp; version?: RegExp }[] = [
  { name: 'Drupal', re: /<meta\s[^>]*name=["']generator["'][^>]*content=["'][^"']*drupal/i },
  { name: 'WordPress', re: /<meta\s[^>]*name=["']generator["'][^>]*content=["'][^"']*wordpress/i },
  { name: 'WordPress', re: /\bwp-content\/|\/wp-includes\/|wp\.emoji/i },
  { name: 'Drupal', re: /Drupal\.settings|\/sites\/default\/files\//i },
  { name: 'Next.js', re: /window\.__NEXT_DATA__|\/_next\/static\//i },
  { name: 'Nuxt', re: /window\.__NUXT__|\/_nuxt\//i },
  { name: 'React', re: /data-reactroot|data-reactid|react-dom\./i },
  {
    name: 'jQuery',
    re: /jquery[^\s"']*\.min\.js|jquery-\d+\.\d+/i,
    version: /jquery-(\d+\.\d+[\w.-]*)\.min\.js|jquery(?:\.min)?\.js[^"']*\?v(?:er)?=([\w.]+)/i,
  },
  {
    name: 'Bootstrap',
    re: /bootstrap[^\s"']*\.(?:min\.)?(?:js|css)/i,
    version: /bootstrap[@/-](\d+\.\d+[\w.-]*)/i,
  },
  { name: 'Angular', re: /ng-version=|\bng-app\b|angular(?:\.min)?\.js/i },
  { name: 'Vue.js', re: /\bvue(?:\.global)?(?:\.prod)?\.js\b|data-v-app|__VUE__/i },
  { name: 'Ember', re: /\bember(?:\.min)?\.js\b/i },
  { name: 'Backbone.js', re: /\bbackbone(?:\.min)?\.js\b/i },
]

const META_GENERATOR_RE = /<meta\s[^>]*name=["']generator["'][^>]*content=["']([^"']+)["']/i

function headerValues(headers: HeaderPair[], name: string): string[] {
  const n = name.toLowerCase()
  return headers.filter(([k]) => k.toLowerCase() === n).map(([, v]) => v)
}

function canonName(raw: string): string {
  const key = raw.trim().toLowerCase()
  return CANON[key] ?? raw.trim()
}

/**
 * Tách `Name/x.y.z` từ giá trị header sản phẩm. Bỏ qua token vô nghĩa
 * ((Ubuntu), Unix, comment ngoặc). Trả [name, version|null].
 */
function products(value: string): { name: string; version: string | null }[] {
  const out: { name: string; version: string | null }[] = []
  // tách theo khoảng trắng; token như "PHP/8.1.27" hoặc "Express" đơn
  for (const tok of value.split(/\s+/)) {
    const t = tok.replace(/[()]/g, '')
    if (!t || t === 'with') continue
    const m = /^([^/\s]+)\/([^\s]*)$/.exec(t)
    if (m) {
      const name = canonName(m[1] ?? '')
      if (name) out.push({ name, version: m[2] || null })
    } else {
      const name = canonName(t)
      // token trần chỉ nhận nếu có trong canon (tránh rác "Unix", "mod_fcgid")
      if (CANON[t.toLowerCase()]) out.push({ name, version: null })
    }
  }
  // token liền nhau theo dấu phẩy (Một số server ghi "Apache, PHP/8.1")
  if (out.length === 0 && value.includes(',')) {
    for (const part of value.split(',')) {
      const m = /^\s*([^/\s]+)\s*(?:\/\s*([^\s]+))?\s*$/.exec(part)
      if (!m) continue
      const name = canonName(m[1] ?? '')
      if (name) out.push({ name, version: m[2] ?? null })
    }
  }
  return out
}

/** Cookie names của một entry: request `Cookie:` + response `Set-Cookie:` (có thể gộp `\n`). */
function cookieNames(e: CaptureEntry): string[] {
  const names: string[] = []
  for (const v of headerValues(e.requestHeaders, 'cookie')) {
    for (const c of parseCookieHeader(v)) names.push(c.name)
  }
  for (const v of headerValues(e.responseHeaders, 'set-cookie')) {
    for (const line of v.split('\n')) {
      const name = parseSetCookie(line).name
      if (name) names.push(name)
    }
  }
  return names
}

/**
 * Nhận diện công nghệ trên toàn bộ traffic. Dedupe theo (name, version) —
 * hit đầu tiên làm bằng chứng; phiên bản đủ version được ưu tiên hơn hit
 * không version của cùng tech (lọc cuối).
 */
export function fingerprintTech(entries: CaptureEntry[]): TechHit[] {
  const hits: TechHit[] = []
  const seen = new Set<string>()
  const add = (name: string, version: string | null, evidence: string, entryId: string): void => {
    const n = name.trim()
    if (!n) return
    const key = `${n.toLowerCase()}\0${version ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    hits.push({ name: n, version, evidence, entryId })
  }

  for (const e of entries) {
    // ---- Header sản phẩm ----
    for (const h of PRODUCT_HEADERS) {
      for (const v of headerValues(e.responseHeaders, h)) {
        const label =
          h === 'server' ? 'Server' : h === 'x-powered-by' ? 'X-Powered-By' : 'X-Generator'
        // X-Generator thường dạng "WordPress 6.5" (tên + version bằng khoảng trắng) →
        // thử parse đó trước, sau đó mới token hoá `Name/x.y` kiểu Server/X-Powered-By.
        const gen =
          h === 'x-generator' ? /^([A-Za-z][\w.+#-]*)\s+([0-9][\w.-]*)$/.exec(v.trim()) : null
        const prods = products(v)
        if (gen) {
          add(canonName(gen[1] ?? ''), gen[2] ?? null, `${label}: ${v}`, e.id)
        } else if (prods.length > 0) {
          for (const p of prods) add(p.name, p.version, `${label}: ${v}`, e.id)
        } else if (h === 'x-generator') {
          add(v.trim(), null, `${label}: ${v}`, e.id)
        }
      }
    }

    // ---- Header cố định / vendor ----
    for (const { name, header } of FIXED_HEADERS) {
      for (const v of headerValues(e.responseHeaders, header)) {
        const isVersion = header === 'x-aspnet-version' || header === 'x-aspnetmvc-version'
        add(name, isVersion ? v.trim() || null : null, `${header}: ${v}`, e.id)
      }
    }
    if (headerValues(e.responseHeaders, 'x-drupal-cache').length > 0) {
      add('Drupal', null, 'X-Drupal-Cache', e.id)
    }
    if (headerValues(e.responseHeaders, 'x-drupal-dynamic-cache').length > 0) {
      add('Drupal', null, 'X-Drupal-Dynamic-Cache', e.id)
    }
    if (headerValues(e.responseHeaders, 'x-cf-powered-by').length > 0) {
      add('Cloudflare', null, 'X-CF-Powered-By', e.id)
    }
    // Header `Via: 1.1 varnish`, `1.0 squid` …
    for (const v of headerValues(e.responseHeaders, 'via')) {
      const m = /\b(varnish|squid)\b/i.exec(v)
      if (m) add(canonName((m[1] ?? '').toLowerCase()), null, `Via: ${v}`, e.id)
    }

    // ---- Cookie names ----
    for (const name of cookieNames(e)) {
      const tech = COOKIE_TECH[name.toLowerCase()]
      if (tech) add(tech, null, `Cookie: ${name}`, e.id)
    }

    // ---- Marker body (text, cap SCAN_LIMIT) ----
    const body = e.responseBody
    if (!body || body.base64) continue
    const text = body.text.slice(0, SCAN_LIMIT)
    const gen = META_GENERATOR_RE.exec(text)
    if (gen) {
      const content = (gen[1] ?? '').trim()
      const m = /^([A-Za-z][\w.+#-]*)\s+([0-9][\w.-]*)$/.exec(content)
      if (m) add(canonName(m[1] ?? ''), m[2] ?? null, `meta generator: ${content}`, e.id)
      else add(content, null, `meta generator: ${content}`, e.id)
    }
    for (const { name, re, version } of BODY_RULES) {
      if (!re.test(text)) continue
      let ver: string | null = null
      if (version) {
        const vm = version.exec(text)
        ver = vm?.[1] ?? vm?.[2] ?? null
      }
      const src = /<\s*(?:script|link)\b[^>]{0,200}/i.exec(text)
      add(
        name,
        ver,
        src ? `${name} marker: ${src[0].replace(/\s+/g, ' ').trim()}` : `${name} marker`,
        e.id,
      )
    }
  }

  // Hit có version thắng hit không version của cùng tech (vd jQuery vs jQuery 3.6).
  const versioned = new Set(hits.filter((h) => h.version !== null).map((h) => h.name.toLowerCase()))
  return hits.filter((h) => h.version !== null || !versioned.has(h.name.toLowerCase()))
}
