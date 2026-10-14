// Bộ lọc + sắp xếp danh sách request của Network Capture (docs/features/network-capture.md).
// Thuần hàm — không đụng DOM/IPC để test được và để composable chỉ còn việc nối state.

import type { CaptureSummary } from '~/types/network-capture'

export const TYPE_CHIPS = [
  'doc',
  'fetch',
  'js',
  'css',
  'img',
  'media',
  'font',
  'ws',
  'other',
] as const
export type TypeChip = (typeof TYPE_CHIPS)[number]

export const STATUS_CHIPS = ['2xx', '3xx', '4xx', '5xx', 'failed'] as const
export type StatusChip = (typeof STATUS_CHIPS)[number]

export const CAPTURE_SORT_KEYS = [
  'seq',
  'method',
  'status',
  'host',
  'path',
  'type',
  'size',
  'time',
  'started',
] as const
export type CaptureSortKey = (typeof CAPTURE_SORT_KEYS)[number]
export type CaptureSortState = { key: CaptureSortKey; dir: 'asc' | 'desc' }

export type CaptureFilter = {
  text: string
  types: ReadonlySet<TypeChip>
  statuses: ReadonlySet<StatusChip>
  method: string // '' = mọi method
  siteHost: string // '' = không giới hạn; ngược lại là registrable host của trang
}

/** Nhóm chip của một request, theo `resourceType` CDP. */
export function typeChipOf(s: Pick<CaptureSummary, 'resourceType'>): TypeChip {
  switch (s.resourceType) {
    case 'Document':
      return 'doc'
    case 'XHR':
    case 'Fetch':
      return 'fetch'
    case 'Script':
      return 'js'
    case 'Stylesheet':
      return 'css'
    case 'Image':
      return 'img'
    case 'Media':
      return 'media'
    case 'Font':
      return 'font'
    case 'WebSocket':
      return 'ws'
    default:
      return 'other'
  }
}

export function statusChipOf(s: Pick<CaptureSummary, 'status' | 'state'>): StatusChip | null {
  if (s.state === 'failed') return 'failed'
  if (s.status === null) return null
  if (s.status >= 200 && s.status < 300) return '2xx'
  if (s.status >= 300 && s.status < 400) return '3xx'
  if (s.status >= 400 && s.status < 500) return '4xx'
  if (s.status >= 500 && s.status < 600) return '5xx'
  return null
}

// Hậu tố hai tầng phổ biến — không có Public Suffix List trong app, nên chỉ phủ các
// trường hợp hay gặp; sai ở đây chỉ làm bộ lọc "chỉ site này" rộng/hẹp hơn một chút.
const SECOND_LEVEL: Record<string, true> = {
  co: true,
  com: true,
  net: true,
  org: true,
  gov: true,
  edu: true,
  ac: true,
}

/** Host "đăng ký được" (example.co.uk, app.example.com → example.com). IP/localhost giữ nguyên. */
export function registrableHost(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '')
  if (!h || h.includes(':') || /^\d+(\.\d+){3}$/.test(h)) return h
  const parts = h.split('.')
  if (parts.length <= 2) return h
  const tld = parts[parts.length - 1] ?? ''
  const sld = parts[parts.length - 2] ?? ''
  const keep = tld.length === 2 && SECOND_LEVEL[sld] ? 3 : 2
  return parts.slice(-keep).join('.')
}

export type TextMatcher = { test: (haystack: string) => boolean }

/**
 * Dựng bộ khớp từ ô lọc. `regex:<pattern>` = RegExp không phân biệt hoa/thường,
 * còn lại = chứa chuỗi con (không phân biệt hoa/thường). Regex hỏng → `error`, và
 * lúc đó không lọc gì (người dùng đang gõ dở không bị danh sách nháy trống).
 */
export function buildTextMatcher(text: string): { matcher: TextMatcher | null; error: boolean } {
  const q = text.trim()
  if (!q) return { matcher: null, error: false }
  if (q.toLowerCase().startsWith('regex:')) {
    const pattern = q.slice(6)
    if (!pattern) return { matcher: null, error: false }
    try {
      const re = new RegExp(pattern, 'i')
      return { matcher: { test: (h) => re.test(h) }, error: false }
    } catch {
      return { matcher: null, error: true }
    }
  }
  const needle = q.toLowerCase()
  return { matcher: { test: (h) => h.toLowerCase().includes(needle) }, error: false }
}

/** Chuỗi để khớp ô lọc trên một dòng (không gồm body). */
export function summaryHaystack(s: CaptureSummary): string {
  return `${s.method} ${s.url} ${s.status ?? ''} ${s.mimeType} ${s.resourceType}`
}

export function matchesStructure(s: CaptureSummary, f: CaptureFilter): boolean {
  if (f.types.size > 0 && !f.types.has(typeChipOf(s))) return false
  if (f.statuses.size > 0) {
    const sc = statusChipOf(s)
    if (!sc || !f.statuses.has(sc)) return false
  }
  if (f.method && s.method !== f.method) return false
  if (f.siteHost && registrableHost(s.host) !== f.siteHost) return false
  return true
}

const cmp = (a: number | string, b: number | string): number =>
  typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))

function sortValue(s: CaptureSummary, key: CaptureSortKey): number | string {
  switch (key) {
    case 'seq':
      return s.seq
    case 'method':
      return s.method
    case 'status':
      return s.status ?? -1
    case 'host':
      return s.host
    case 'path':
      return s.path
    case 'type':
      return s.resourceType
    case 'size':
      return s.encodedBytes ?? -1
    case 'time':
      return s.durationMs ?? -1
    case 'started':
      return s.startedAt
  }
}

export function sortSummaries(rows: CaptureSummary[], sort: CaptureSortState): CaptureSummary[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  return rows.sort(
    (a, b) => sign * cmp(sortValue(a, sort.key), sortValue(b, sort.key)) || a.seq - b.seq,
  )
}
