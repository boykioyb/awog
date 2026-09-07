// Gợi ý MCP server theo ngữ cảnh project đang mở (gói #38).
//
// Nguyên tắc: **giải thích được, và không bịa**. Mỗi gợi ý mang theo bằng chứng
// cụ thể đọc được từ đĩa ("có `@sentry/node` trong package.json", "git remote trỏ
// github.com") chứ không phải một điểm số mờ. Không tìm thấy tín hiệu nào ⇒ trả
// mảng rỗng, UI không hiện gì. Thà im lặng còn hơn đề xuất bừa.
//
// Chỉ ĐỌC: readdir mức 1 của thư mục project + đúng hai file có tên cố định
// (package.json, .git/config). Không có tên file nào ghép từ payload UI, không
// ghi, không spawn. Đầu ra là metadata hiển thị — việc cài vẫn phải đi qua
// source.discoverPreset rồi người dùng bấm Save.

import { readdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listPresetMetas } from '../sources/preset-catalog.js'
import { loadCatalog, type RegistryEntry } from '../sources/registry.js'
import { listSources } from '../sources/store.js'
import type { SourceType } from '../types/shared.js'

const Params = z.object({
  projectPath: z.string().max(4096).optional(),
})

const MAX_DIR_ENTRIES = 500
const MAX_PACKAGE_JSON_BYTES = 512 * 1024
const MAX_GIT_CONFIG_BYTES = 256 * 1024
const MAX_SUGGESTIONS = 6

// Vì sao một gợi ý xuất hiện. `evidence` là chuỗi người dùng đọc được (tên file,
// tên package, host remote); UI dịch `code` thành câu và chèn evidence vào.
export type SuggestionReasonCode = 'file' | 'dependency' | 'gitRemote'

export interface SourceSuggestion {
  id: string
  kind: 'preset' | 'registry'
  name: string
  tagline: string
  type: SourceType
  reason: { code: SuggestionReasonCode; keyword: string; evidence: string }
}

// ─── Bảng tín hiệu ──────────────────────────────────────────────────────────

// Tên file/thư mục ở mức 1 ⇒ từ khoá. Chỉ giữ tín hiệu trỏ tới một DỊCH VỤ cụ
// thể. Cố tình KHÔNG suy từ ngôn ngữ (go.mod, Cargo.toml…): "có go.mod nên đây
// là một server Go ngẫu nhiên" là gợi ý vô nghĩa.
const FILE_SIGNALS: Record<string, string> = {
  dockerfile: 'docker',
  'docker-compose.yml': 'docker',
  'docker-compose.yaml': 'docker',
  'compose.yaml': 'docker',
  'vercel.json': 'vercel',
  supabase: 'supabase',
  prisma: 'postgres',
  terraform: 'terraform',
  'playwright.config.ts': 'playwright',
  'playwright.config.js': 'playwright',
}

// Tiền tố tên dependency trong package.json ⇒ từ khoá.
const DEPENDENCY_SIGNALS: [prefix: string, keyword: string][] = [
  ['@sentry/', 'sentry'],
  ['@supabase/', 'supabase'],
  ['@prisma/client', 'postgres'],
  ['@octokit/', 'github'],
  ['@notionhq/', 'notion'],
  ['@slack/', 'slack'],
  ['@linear/', 'linear'],
  ['@aws-sdk/', 'aws'],
  ['@playwright/', 'playwright'],
  ['stripe', 'stripe'],
  ['mongoose', 'mongodb'],
  ['mongodb', 'mongodb'],
  ['ioredis', 'redis'],
  ['firebase', 'firebase'],
]

const GIT_HOST_SIGNALS: [host: string, keyword: string][] = [
  ['github.com', 'github'],
  ['gitlab.com', 'gitlab'],
]

interface Signal {
  keyword: string
  code: SuggestionReasonCode
  evidence: string
}

// ─── Đọc đĩa (chịu lỗi: thiếu file ⇒ không có tín hiệu, không phải lỗi) ──────

async function scanTopLevel(root: string): Promise<Signal[]> {
  let names: string[]
  try {
    const entries = await readdir(root, { withFileTypes: true })
    names = entries.slice(0, MAX_DIR_ENTRIES).map((e) => e.name)
  } catch {
    return []
  }
  const out: Signal[] = []
  for (const name of names) {
    const keyword = FILE_SIGNALS[name.toLowerCase()]
    if (keyword) out.push({ keyword, code: 'file', evidence: name })
    else if (name.endsWith('.tf')) out.push({ keyword: 'terraform', code: 'file', evidence: name })
  }
  return out
}

async function scanPackageJson(root: string): Promise<Signal[]> {
  let body: string
  try {
    body = await readFile(join(root, 'package.json'), 'utf8')
  } catch {
    return []
  }
  if (body.length > MAX_PACKAGE_JSON_BYTES) return []
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return []
  }
  const parsed = z
    .object({
      dependencies: z.record(z.unknown()).optional(),
      devDependencies: z.record(z.unknown()).optional(),
    })
    .safeParse(json)
  if (!parsed.success) return []
  const deps = [
    ...Object.keys(parsed.data.dependencies ?? {}),
    ...Object.keys(parsed.data.devDependencies ?? {}),
  ]
  const out: Signal[] = []
  for (const dep of deps.slice(0, MAX_DIR_ENTRIES)) {
    const hit = DEPENDENCY_SIGNALS.find(([prefix]) => dep.startsWith(prefix))
    if (hit) out.push({ keyword: hit[1], code: 'dependency', evidence: dep })
  }
  return out
}

async function scanGitRemote(root: string): Promise<Signal[]> {
  let body: string
  try {
    body = await readFile(join(root, '.git', 'config'), 'utf8')
  } catch {
    return []
  }
  if (body.length > MAX_GIT_CONFIG_BYTES) return []
  const out: Signal[] = []
  for (const [host, keyword] of GIT_HOST_SIGNALS) {
    if (body.includes(host)) out.push({ keyword, code: 'gitRemote', evidence: host })
  }
  return out
}

// ─── Ghép tín hiệu ⇒ gợi ý ─────────────────────────────────────────────────

// Chỉ nhận entry cài được VÀ có từ khoá ngay trong tên/tiêu đề. Cố tình KHÔNG
// khớp vào `description`: thử rồi và nó đẻ ra rác ("stripe" khớp một server dựng
// website vì mô tả có nhắc Stripe Checkout). Không có ứng viên sạch ⇒ trả null và
// từ khoá đó không sinh gợi ý nào — thà im lặng còn hơn đề xuất bừa.
function pickRegistryEntry(entries: RegistryEntry[], keyword: string): RegistryEntry | null {
  const installable = entries.filter((e) => e.install.kind !== 'unsupported')
  return (
    installable.find((e) => e.name.toLowerCase().includes(keyword)) ??
    installable.find((e) => e.title.toLowerCase().includes(keyword)) ??
    null
  )
}

register('source.suggestSources', async (raw) => {
  const { projectPath } = Params.parse(raw ?? {})
  if (!projectPath || !isAbsolute(projectPath) || projectPath.includes('\0')) {
    return { suggestions: [] }
  }
  const root = resolve(projectPath)

  const [fileSignals, depSignals, gitSignals] = await Promise.all([
    scanTopLevel(root),
    scanPackageJson(root),
    scanGitRemote(root),
  ])
  // Một từ khoá chỉ giữ bằng chứng ĐẦU TIÊN: gợi ý cần một lý do rõ, không phải
  // một danh sách lý do.
  const byKeyword = new Map<string, Signal>()
  for (const s of [...gitSignals, ...depSignals, ...fileSignals]) {
    if (!byKeyword.has(s.keyword)) byKeyword.set(s.keyword, s)
  }
  if (byKeyword.size === 0) return { suggestions: [] }

  // Đã cài rồi thì đừng gợi ý lại.
  const installed = new Set((await listSources()).map((s) => s.provider.toLowerCase()))
  const presets = listPresetMetas()
  const catalog = await loadCatalog()

  const suggestions: SourceSuggestion[] = []
  const usedIds = new Set<string>()
  for (const signal of byKeyword.values()) {
    if (suggestions.length >= MAX_SUGGESTIONS) break
    if (installed.has(signal.keyword)) continue

    const preset = presets.find(
      (p) => p.provider.toLowerCase() === signal.keyword || p.id === signal.keyword,
    )
    if (preset && !usedIds.has(preset.id)) {
      usedIds.add(preset.id)
      suggestions.push({
        id: preset.id,
        kind: 'preset',
        name: preset.name,
        tagline: preset.tagline,
        type: preset.type,
        reason: { code: signal.code, keyword: signal.keyword, evidence: signal.evidence },
      })
      continue
    }
    const entry = pickRegistryEntry(catalog.entries, signal.keyword)
    if (!entry || usedIds.has(entry.id)) continue
    usedIds.add(entry.id)
    suggestions.push({
      id: entry.id,
      kind: 'registry',
      name: entry.title,
      tagline: entry.description.slice(0, 200),
      type: 'mcp',
      reason: { code: signal.code, keyword: signal.keyword, evidence: signal.evidence },
    })
  }

  return { suggestions }
})
