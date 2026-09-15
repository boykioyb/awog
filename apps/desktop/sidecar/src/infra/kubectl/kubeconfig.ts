// Parser `~/.kube/config` — allowlist-key (ADR 0088 §7, việc 19 / 8.3).
//
// Vì sao phải tự viết: repo cấm thêm dependency, mà một kubeconfig lại chứa
// credential thật (`token`, `client-key-data`, `exec.command` chạy được lệnh).
// Parser ở đây vì thế KHÔNG phải "parse hết rồi lọc sau": nó chỉ CẮT RA giá trị
// của những khoá nằm trong allowlist (tên context/cluster/namespace/user + URL
// API server), còn mọi khoá khác bị bỏ NGAY trong vòng lặp — giá trị của chúng
// không bao giờ trở thành một chuỗi có tên trong bộ nhớ (invariant #1). Một
// `log.info(entry)` vì thế không thể in ra token, và không có đường nào để
// credential đi lên IPC, lên nhật ký hay vào context của model.
//
// Đường dẫn là allowlist cứng: `KUBECONFIG` của chính tiến trình (L4 — tin được,
// và là cách kubectl chính thức đổi vị trí file) hoặc `~/.kube/config`. Không
// tham số nào nhận path từ UI hay từ model. Cờ `--kubeconfig` bị `infra.run.ts`
// từ chối, nên không có đường vòng vào file khác.
//
// Không store, không cache: danh sách derive mỗi lần gọi (ADR 0088 §2).

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { log } from '../../util/logger.js'

/** Một context của kubeconfig. Chỉ tên + URL công khai — không credential. */
export type KubeContext = {
  /** Tên context — giá trị DUY NHẤT được phép đi vào `--context`. */
  name: string
  /** Tên cluster mà context trỏ tới ('' khi kubeconfig không khai). */
  cluster: string
  /** Namespace khai sẵn cho context; '' = không khai (kubectl dùng `default`). */
  namespace: string
  /** Tên user — chỉ để hiển thị; credential của nó KHÔNG bao giờ được đọc. */
  user: string
  /** URL API server của cluster. */
  server: string
  /** Context này là `current-context` của file đầu tiên khai nó. */
  current: boolean
}

type Section = 'clusters' | 'contexts' | 'users'

// Allowlist THEO TỪNG SECTION. Khoá không có trong đây bị bỏ tại chỗ — kể cả
// `certificate-authority-data` (không phải secret nhưng không cần), `token`,
// `client-key-data`, `exec`, `auth-provider`. Thêm một khoá vào đây là một
// quyết định có chủ đích: chỉ metadata trỏ tới danh tính, không bao giờ là
// danh tính.
const ALLOWED_KEYS: Record<Section, ReadonlySet<string>> = {
  clusters: new Set(['name', 'server']),
  contexts: new Set(['name', 'cluster', 'namespace', 'user']),
  users: new Set(['name']),
}

// Khoá bọc (không mang giá trị): đi vào trong chúng mới thấy dữ liệu cần.
// `- cluster:` / `- context:` / `- user:` là dạng kubectl tự ghi.
const TRANSPARENT_KEYS: ReadonlySet<string> = new Set([
  'cluster',
  'context',
  'user',
  'clusters',
  'contexts',
  'users',
  'preferences',
])

const SECTION_KEYS: Record<string, Section> = {
  clusters: 'clusters',
  contexts: 'contexts',
  users: 'users',
}

type Entry = Map<string, string>

export type ParsedKubeConfig = {
  currentContext: string
  clusters: Entry[]
  contexts: Entry[]
  users: Entry[]
}

/**
 * Bỏ comment CUỐI DÒNG nhưng tôn trọng dấu nháy — URL (`https://…#`) và tên
 * chứa `#` không được cắt oan.
 */
function stripComment(line: string): string {
  let quote: string | null = null
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quote !== null) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
      return line.slice(0, i)
    }
  }
  return line
}

function parseScalar(raw: string): string {
  const v = raw.trim()
  if (v.length >= 2) {
    const first = v[0]
    const last = v[v.length - 1]
    if (first === last && (first === '"' || first === "'")) return v.slice(1, -1)
  }
  return v
}

function indentOf(line: string): number {
  let n = 0
  while (n < line.length && line[n] === ' ') n += 1
  return n
}

/**
 * Quét kubeconfig theo từng dòng. Trả về entry THÔ đã lọc allowlist.
 *
 * Xuất ra `export` để test bảng được phần parse tách khỏi phần đọc đĩa — cùng
 * khuôn với `parseAwsIni()`.
 */
export function parseKubeConfig(text: string): ParsedKubeConfig {
  const out: ParsedKubeConfig = { currentContext: '', clusters: [], contexts: [], users: [] }
  const entries: Record<Section, Entry[]> = { clusters: [], contexts: [], users: [] }
  let section: Section | null = null
  let current: Entry | null = null
  // > -1 nghĩa là đang bỏ qua cả một khối con (khoá lạ có block, vd `exec:`).
  let skipIndent = -1

  for (const rawLine of text.split('\n')) {
    const line = stripComment(rawLine.replace(/\r$/, ''))
    if (line.trim().length === 0) continue
    const indent = indentOf(line)
    const content = line.trim()

    if (skipIndent >= 0) {
      if (indent > skipIndent) continue
      skipIndent = -1
    }

    const isItem = content === '-' || content.startsWith('- ')
    const body = isItem ? content.slice(1).trim() : content

    if (isItem) {
      if (section === null) continue
      current = new Map()
      entries[section].push(current)
      if (body.length === 0) continue
    } else if (indent === 0) {
      // Khoá cấp cao nhất: hoặc là header của một section, hoặc `current-context`
      // (giá trị duy nhất ở cấp này mà ta dùng), hoặc thứ không liên quan
      // (`apiVersion`, `kind`) ⇒ đóng section đang mở.
      const colon = content.indexOf(':')
      if (colon > 0) {
        const topKey = content.slice(0, colon).trim()
        const topValue = parseScalar(content.slice(colon + 1))
        const next = SECTION_KEYS[topKey]
        if (next && topValue === '') {
          section = next
          current = null
          continue
        }
        if (topKey === 'current-context' && topValue !== '' && out.currentContext === '') {
          out.currentContext = topValue
        }
        section = null
        current = null
        continue
      }
      section = null
      current = null
      continue
    }

    if (current === null || section === null) continue

    const colon = body.indexOf(':')
    if (colon < 0) continue
    const key = body.slice(0, colon).trim()
    const valueRaw = body.slice(colon + 1).trim()

    // ALLOWLIST TRƯỚC, cấu trúc sau. `cluster` vừa là TÊN KHOÁ dữ liệu (trong
    // `contexts[].context.cluster`), vừa là khoá BỌC (trong `clusters[].cluster`),
    // nên không thể phân biệt bằng tên khoá — phải hỏi "khoá này có mang giá trị
    // ở section đang xét không". Ở `contexts`, `cluster: dev` có giá trị ⇒ lấy; ở
    // `clusters`, `- cluster:` rỗng ⇒ chỉ là vỏ, đi tiếp vào trong.
    if (ALLOWED_KEYS[section].has(key)) {
      const value = parseScalar(valueRaw)
      if (value !== '') current.set(key, value)
      continue
    }
    if (valueRaw !== '') continue // khoá lạ có giá trị: bỏ, không materialize
    // Khoá lạ mở một block: `context:`/`user:` là vỏ bọc đi tiếp; `exec:`/
    // `extensions:` thì bỏ luôn cả khối con — bên trong đó là lệnh chạy được và
    // tham số của nó.
    if (TRANSPARENT_KEYS.has(key)) continue
    skipIndent = indent
  }

  out.clusters = entries.clusters
  out.contexts = entries.contexts
  out.users = entries.users
  return out
}

/** Danh sách file kubeconfig mà kubectl sẽ đọc, theo đúng thứ tự ưu tiên. */
export function kubeConfigPaths(): string[] {
  const fromEnv = process.env.KUBECONFIG?.trim()
  if (fromEnv) {
    return fromEnv
      .split(delimiter)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .map((p) => resolve(expandHome(p)))
  }
  return [join(homedir(), '.kube', 'config')]
}

function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2))
  return p
}

/**
 * Gộp các file theo luật của kubectl: **file đầu tiên thắng** cho mỗi khoá. File
 * thiếu/không đọc được bị bỏ qua (một máy chưa cài kubectl là trạng thái hợp lệ,
 * không phải lỗi) — nhưng lỗi thật (quyền) thì warn, không nuốt im lặng.
 */
export async function listKubeContexts(): Promise<{
  contexts: KubeContext[]
  paths: string[]
}> {
  const paths = kubeConfigPaths()
  const contexts = new Map<string, KubeContext>()
  const clusters = new Map<string, string>()
  const read: string[] = []
  let currentContext = ''

  for (const path of paths) {
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        log.warn('kubeconfig: cannot read file', { path })
      }
      continue
    }
    read.push(path)
    const parsed = parseKubeConfig(text)
    if (!currentContext && parsed.currentContext) currentContext = parsed.currentContext
    for (const cluster of parsed.clusters) {
      const name = cluster.get('name')
      if (name && !clusters.has(name)) clusters.set(name, cluster.get('server') ?? '')
    }
    for (const ctx of parsed.contexts) {
      const name = ctx.get('name')
      if (!name || contexts.has(name)) continue
      const clusterName = ctx.get('cluster') ?? ''
      contexts.set(name, {
        name,
        cluster: clusterName,
        namespace: ctx.get('namespace') ?? '',
        user: ctx.get('user') ?? '',
        server: clusters.get(clusterName) ?? '',
        current: false,
      })
    }
  }

  // `current` chỉ chắc chắn sau khi biết cả file: context có thể khai ở file sau.
  const list = [...contexts.values()].map((c) => ({
    ...c,
    current: currentContext !== '' && c.name === currentContext,
  }))
  return { contexts: list, paths: read }
}
