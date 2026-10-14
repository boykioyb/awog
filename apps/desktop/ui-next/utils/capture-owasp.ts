// Chấm OWASP Top 10 (2021) THỤ ĐỘNG trên traffic đã bắt — không gửi request nào.
// Bằng chứng đến từ `CaptureFinding` (capture-findings.ts) cộng 3 quét thụ động bổ sung:
// công nghệ có version qua fingerprint (A06), `<script src>` ngoài thiếu `integrity`
// (A08/SRI) và query param chứa URL tuyệt đối (A10 — SSRF/open-redirect). Category
// không kiểm được thụ động → status 'manual' + 1 evidence gợi ý
// `{ entryId: '', note: 'capture.sec.guide.<id>' }` — UI render note đó qua t().
// Với evidence từ finding: note = `finding.evidence`, hoặc khoá `capture.finding.<id>.title`
// khi finding không có evidence (UI cũng t() được vì note bắt đầu bằng 'capture.').

import type { CaptureEntry } from '../types/network-capture'
import type { CaptureFinding } from './capture-findings'
// @ts-expect-error đuôi `.ts` tường minh để `node --test` (Node không phân giải import trần) chạy được file này
import { fingerprintTech } from './capture-fingerprint.ts'
// @ts-expect-error đuôi `.ts` tường minh để `node --test` chạy được file này
import { queryParams } from './capture-export.ts'

export type OwaspStatus = 'clean' | 'suspect' | 'manual' // clean=đã kiểm không thấy, suspect=có bằng chứng, manual=chưa kiểm được
export type OwaspId = 'A01' | 'A02' | 'A03' | 'A04' | 'A05' | 'A06' | 'A07' | 'A08' | 'A09' | 'A10'
export type OwaspEvidence = { entryId: string; findingId?: string; note: string }
export type OwaspItem = { id: OwaspId; status: OwaspStatus; evidence: OwaspEvidence[] }

const OWASP_IDS: readonly OwaspId[] = [
  'A01',
  'A02',
  'A03',
  'A04',
  'A05',
  'A06',
  'A07',
  'A08',
  'A09',
  'A10',
]

/** Trần evidence mỗi mục — đủ để mở inspector kiểm tra, không phình payload. */
const EVIDENCE_CAP = 10

/** Giống SCAN_LIMIT của capture-findings — body lớn chỉ quét đầu 256 KB. */
const SCAN_LIMIT = 256 * 1024

/** URL tuyệt đối `https?://` hoặc protocol-relative `//` trong giá trị param. */
const ABS_URL_RE = /^(?:https?:)?\/\//i

/**
 * finding.id → OWASP category. Conservative: chỉ map khi finding là bằng chứng trực tiếp
 * của lỗi đó; `verboseError` xử lý riêng (luôn A05 + A09, thêm A03 nếu pattern là lỗi SQL).
 */
const FINDING_MAP: Record<string, OwaspId[]> = {
  // A02 Cryptographic Failures — cleartext, thiếu HSTS, credential lộ, cache nhạy cảm
  mixedContent: ['A02'],
  missingHsts: ['A02'],
  credentialsInUrl: ['A02'],
  userinfoInUrl: ['A02'],
  basicAuthOverHttp: ['A02'],
  cacheNoStore: ['A02'],
  // A05 Security Misconfiguration — thiếu header, CORS rộng, lộ phiên bản, listing
  missingCsp: ['A05'],
  missingXcto: ['A05'],
  missingFrameProtection: ['A05'],
  missingReferrerPolicy: ['A05'],
  corsWildcardCredentials: ['A05'],
  corsReflectOrigin: ['A05'],
  serverVersion: ['A05'],
  poweredBy: ['A05'],
  aspnetVersion: ['A05'],
  directoryListing: ['A05'],
  verboseError: ['A05'],
  // A07 Identification & Authentication Failures — JWT/cookie yếu
  jwtAlgNone: ['A07'],
  jwtExpired: ['A07'],
  cookieNoHttpOnly: ['A07'],
  cookieNoSecure: ['A07'],
  cookieSameSiteNoneInsecure: ['A07'],
  cookieNoSameSite: ['A07'],
}

/** Pattern `verboseError` là lỗi SQL → thêm bằng chứng cho A03 Injection. */
const SQL_ERROR_PATTERNS: Record<string, true> = { sqlstate: true, oracle: true }

/** Body text (không base64) để quét, giới hạn SCAN_LIMIT; null nếu không có. */
function bodyText(e: CaptureEntry): string | null {
  const b = e.responseBody
  if (!b || b.base64) return null
  return b.text.slice(0, SCAN_LIMIT)
}

function clip(s: string, max = 120): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max)}…` : one
}

/** A10: query param chứa URL tuyệt đối → bề mặt SSRF / open redirect cần kiểm tay. */
function ssrfEvidence(entries: CaptureEntry[]): OwaspEvidence[] {
  const out: OwaspEvidence[] = []
  for (const e of entries) {
    for (const [key, value] of queryParams(e.url)) {
      if (!ABS_URL_RE.test(value.trim())) continue
      out.push({ entryId: e.id, note: `${key} → ${clip(value, 100)}` })
      if (out.length >= EVIDENCE_CAP) return out
    }
  }
  return out
}

const SCRIPT_SRC_RE = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi

/** A08: `<script src>` tuyệt đối (CDN/bên ngoài) thiếu thuộc tính `integrity`. */
function sriEvidence(entries: CaptureEntry[]): OwaspEvidence[] {
  const out: OwaspEvidence[] = []
  for (const e of entries) {
    const text = bodyText(e)
    if (!text) continue
    for (const m of text.matchAll(SCRIPT_SRC_RE)) {
      const src = m[1] ?? ''
      if (!ABS_URL_RE.test(src.trim())) continue
      if (/\bintegrity\s*=/i.test(m[0])) continue
      out.push({ entryId: e.id, note: clip(src) })
      break // một script ngoài thiếu integrity đủ làm bằng chứng cho entry này
    }
    if (out.length >= EVIDENCE_CAP) break
  }
  return out
}

/**
 * Chấm đủ 10 mục OWASP cho traffic đã bắt. `findings` nên là kết quả `analyzeAll(entries)`
 * (dedupe theo host). Không mạng, không mutate input.
 */
export function evaluateOwasp(entries: CaptureEntry[], findings: CaptureFinding[]): OwaspItem[] {
  const ev: Record<OwaspId, OwaspEvidence[]> = {
    A01: [],
    A02: [],
    A03: [],
    A04: [],
    A05: [],
    A06: [],
    A07: [],
    A08: [],
    A09: [],
    A10: [],
  }

  for (const f of findings) {
    const note = f.evidence ?? f.title
    const push = (id: OwaspId): void => {
      ev[id].push({ entryId: f.entryId, findingId: f.id, note })
    }
    for (const id of FINDING_MAP[f.id] ?? []) push(id)
    if (f.id === 'verboseError') {
      push('A09') // leak lỗi chi tiết = dấu hiệu logging/monitoring chưa kiểm soát
      const pattern = f.params?.pattern
      if (pattern !== undefined && SQL_ERROR_PATTERNS[pattern]) push('A03')
    }
  }

  // A06 Vulnerable Components: tech CÓ version mới tra CVE được → suspect; tech không
  // version → manual (không đối chiếu được); không nhận diện gì → clean.
  const tech = fingerprintTech(entries)
  const versioned = tech.filter((h) => h.version !== null)
  for (const h of versioned) ev.A06.push({ entryId: h.entryId, note: `${h.name} ${h.version}` })

  for (const e of sriEvidence(entries)) ev.A08.push(e)
  for (const e of ssrfEvidence(entries)) ev.A10.push(e)

  const guide = (id: OwaspId): OwaspItem => ({
    id,
    status: 'manual',
    evidence: [{ entryId: '', note: `capture.sec.guide.${id}` }],
  })

  /** 'check': không có bằng chứng → clean; 'manual': không kiểm được thụ động → manual+guide. */
  const item = (id: OwaspId, empty: 'check' | 'manual'): OwaspItem => {
    const evidence = ev[id].slice(0, EVIDENCE_CAP)
    if (evidence.length > 0) return { id, status: 'suspect', evidence }
    return empty === 'check' ? { id, status: 'clean', evidence: [] } : guide(id)
  }

  const items: Record<OwaspId, OwaspItem> = {
    A01: guide('A01'), // Broken Access Control — cần thao tác tay (IDOR, leo quyền)
    A02: item('A02', 'check'),
    A03: item('A03', 'manual'), // injection chỉ lộ qua lỗi SQL trong body
    A04: guide('A04'), // Insecure Design — không đo được bằng traffic
    A05: item('A05', 'check'),
    A06:
      versioned.length > 0
        ? { id: 'A06', status: 'suspect', evidence: ev.A06.slice(0, EVIDENCE_CAP) }
        : tech.length > 0
          ? guide('A06')
          : { id: 'A06', status: 'clean', evidence: [] },
    A07: item('A07', 'check'),
    A08: item('A08', 'manual'),
    A09: item('A09', 'manual'), // logging/monitoring thực chất ở phía server
    A10: item('A10', 'manual'),
  }
  return OWASP_IDS.map((id) => items[id])
}
