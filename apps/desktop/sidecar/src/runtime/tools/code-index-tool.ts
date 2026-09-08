// `code_index` AgentTool — thay grep mù bằng chỉ mục symbol + đồ thị import.
//
// Vì sao cần: `Grep` trả về DÒNG KHỚP CHUỖI, không phải symbol. Hỏi "hàm này gọi
// từ đâu" thì nó trả cả trăm dòng trùng tên (biến cục bộ, chuỗi trong prompt,
// tên khác trùng một phần), và nó KHÔNG lần được `./store.js` → `store.ts`,
// `~/composables/x` → file thật, hay component Nuxt auto-import (không có câu
// lệnh import nào để tìm). Tệ hơn: ripgrep gặp một byte NUL thì coi cả file là
// nhị phân rồi bỏ qua IM LẶNG — đã xảy ra ngay trong repo này.
//
// Tool cố ý nói rõ chỗ mù của mình trong description: parser là regex + đếm
// ngoặc, không phải TypeScript compiler API. Một công cụ giấu giới hạn sẽ bị tin
// quá mức, và ở đây tin quá mức nghĩa là kết luận "không ai gọi hàm này" rồi xoá.

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { ensureIndex, indexStats } from '../../codeindex/build.js'
import {
  blastRadius,
  findDefinitions,
  findReferences,
  resolveIndexedPath,
  MAX_BLAST_DEPTH,
} from '../../codeindex/query.js'
import { clampForLlm } from './output-budget.js'

const MAX_TOTAL_CHARS = 24 * 1024
const DEFAULT_BLAST_DEPTH = 2
const MAX_LISTED_PER_GROUP = 60

// Tên server MCP in-process bắc tool này sang nhánh Claude SDK, và danh sách tool
// nó mang. Đặt Ở ĐÂY chứ không trong file SDK: `sessions/step-mapper.ts` cần hai
// hằng này để gấp tên bắc cầu, mà nó chạy trên CẢ HAI nhánh — import từ file SDK
// là kéo `@anthropic-ai/claude-agent-sdk` vào cả đường Pi.
//
// SERVER RIÊNG chứ không đi nhờ `awogsurfaces`: tên server hiện ra trong luật quyền
// và trong `disabledTools`, nên nó phải nói đúng tool là gì. `code_index` cùng họ
// với Grep/Glob — một NGUỒN ĐỌC mã nguồn — chứ không phải một thứ model đặt vào
// transcript. Gộp chung thì tắt "surfaces" sẽ vô tình tắt luôn khả năng tra mã.
export const CODE_INDEX_MCP_SERVER = 'awogcode'
export const CODE_INDEX_TOOL_NAMES = ['code_index'] as const

// Mọi chuỗi model ĐỌC về tool này, ở đúng một chỗ — nhánh Pi dựng schema TypeBox
// từ đây, nhánh Claude SDK dựng schema zod từ đây (claude-sdk/code-index-sdk-server.ts).
export const CODE_INDEX_TEXT = {
  description:
    'Look up code by SYMBOL instead of by text. Answers three questions Grep cannot: where is this declared (define), everywhere it is called or used (refs), and which files break if I change this file (blast). ' +
    'It follows import edges, so it resolves NodeNext ".js" specifiers to the real ".ts" file, "~/" and "@/" aliases, and re-exports; for Nuxt auto-imports (a composable or component used with no import statement) blast still finds the users through the symbol name. ' +
    'Results are path:line plus one short line of context — never whole files. ' +
    'Reach for this FIRST when the question is about relationships ("who calls X", "what depends on Y", "is this still used"), and use Grep when the question is really about text (a log string, a comment, a config value). ' +
    'LIMITS, state them if they matter: the index is built by a lightweight parser (regex + brace counting), NOT the TypeScript compiler. It sees top-level functions/classes/interfaces/types/enums/consts and class methods, but NOT symbols created by destructuring (`const { a } = x`), object-literal methods, or anything generated at runtime. It matches names EXACTLY and cannot tell two same-named symbols apart. So "refs found nothing" means "the index has no record", not "nothing calls it" — confirm with Grep before deleting anything.',
  action:
    'define = where a symbol is declared; refs = every place that calls/uses it; blast = which files break if you change a given file; status = index coverage and freshness.',
  symbol:
    'Exact, case-sensitive symbol name for define/refs (e.g. "createAwogToolDefinitions"). Not a pattern.',
  path: 'For blast: the file to change (repo-relative, absolute, or a unique path suffix like "sessions/runner.ts"). For define/refs: optional substring filter on the file path.',
  depth: `For blast: how many import hops to follow (default ${DEFAULT_BLAST_DEPTH}, max ${MAX_BLAST_DEPTH}).`,
} as const

const Params = Type.Object({
  action: Type.Union(
    [
      Type.Literal('define'),
      Type.Literal('refs'),
      Type.Literal('blast'),
      Type.Literal('status'),
    ],
    { description: CODE_INDEX_TEXT.action },
  ),
  symbol: Type.Optional(Type.String({ description: CODE_INDEX_TEXT.symbol })),
  path: Type.Optional(Type.String({ description: CODE_INDEX_TEXT.path })),
  depth: Type.Optional(Type.Number({ description: CODE_INDEX_TEXT.depth })),
})

interface CodeIndexDetails {
  action: string
  matches: number
  isError?: true
}

// Kết quả một lần tra, ở dạng KHÔNG phụ thuộc runtime.
export interface CodeIndexRunResult {
  text: string
  action: string
  matches: number
  isError?: true
}

// Tham số đã narrow, dùng chung cho cả hai vỏ.
export interface CodeIndexRunParams {
  action: 'define' | 'refs' | 'blast' | 'status'
  symbol?: string | undefined
  path?: string | undefined
  depth?: number | undefined
}

function fail(action: string, text: string): CodeIndexRunResult {
  return { text, action, matches: 0, isError: true }
}

function ok(action: string, matches: number, text: string): CodeIndexRunResult {
  return { text, action, matches }
}

function group(label: string, paths: string[]): string[] {
  if (paths.length === 0) return []
  const shown = paths.slice(0, MAX_LISTED_PER_GROUP)
  const more = paths.length - shown.length
  return [
    `${label} (${paths.length}):`,
    ...shown.map((p) => `  ${p}`),
    ...(more > 0 ? [`  …and ${more} more`] : []),
  ]
}

// Phần thân dùng chung cho cả hai runtime — nhánh Pi gọi qua AgentTool, nhánh
// Claude SDK gọi qua in-process MCP server. Một bản duy nhất, nên mọi cap
// (MAX_TOTAL_CHARS, MAX_LISTED_PER_GROUP) và mọi lời cảnh báo về giới hạn của
// parser không thể trôi khỏi nhau giữa hai nhánh.
export async function runCodeIndex(
  cwd: string,
  params: CodeIndexRunParams,
): Promise<CodeIndexRunResult> {
  const action = params.action
  let built
  try {
    built = await ensureIndex(cwd)
  } catch (err) {
    return fail(action, `Could not index this workspace: ${err instanceof Error ? err.message : String(err)}`)
  }
  const { index, result } = built

  const caveats: string[] = []
  if (index.truncated) {
    caveats.push('The repository is larger than the index cap, so some files are NOT covered.')
  }
  if (result.deadlineHit) {
    caveats.push('Indexing hit its time budget; part of the tree is from a previous pass.')
  }
  if (index.source === 'walk') {
    caveats.push('This root is not a git repository, so .gitignore was not applied.')
  }
  const withCaveats = (text: string): string =>
    caveats.length > 0 ? `${text}\n\nNote: ${caveats.join(' ')}` : text

  if (action === 'status') {
    const stats = await indexStats(index)
    const ageSec = Math.max(0, Math.round((Date.now() - stats.builtAt) / 1000))
    const lines = [
      `Code index for ${index.root}`,
      `${stats.files} source files · ${stats.decls} declarations · ${stats.refNames} indexed names`,
      `${stats.internalEdges} resolved internal import edges (${stats.unresolvedInternal} unresolved), ${stats.skipped} files skipped`,
      `listed via ${index.source}, refreshed ${ageSec}s ago, ${(stats.bytesOnDisk / 1024 / 1024).toFixed(2)} MB on disk`,
    ]
    return ok(action, stats.files, withCaveats(lines.join('\n')))
  }

  if (action === 'blast') {
    if (!params.path) return fail(action, 'blast needs `path` — the file you intend to change.')
    const target = resolveIndexedPath(index, params.path)
    if (!target) {
      return fail(
        action,
        `No indexed file matches "${params.path}". Pass a repo-relative path, or a suffix that is unique.`,
      )
    }
    const radius = blastRadius(index, target, params.depth ?? DEFAULT_BLAST_DEPTH)
    const total = radius.direct.length + radius.transitive.length + radius.symbolUsers.length
    if (total === 0) {
      return ok(
        action,
        0,
        withCaveats(
          `Nothing in the index imports or references ${target}. It may be an entry point, dead code, or reached only dynamically.`,
        ),
      )
    }
    const lines = [
      `Changing ${target} can affect ${total} file(s) (import depth ${radius.depth}):`,
      ...group('imported directly by', radius.direct),
      ...group(`reachable through further imports (depth 2..${radius.depth})`, radius.transitive),
      ...group(
        'reference a symbol it exports without importing it (auto-import / same-name)',
        radius.symbolUsers,
      ),
    ]
    if (radius.truncated) lines.push('…blast radius hit its file cap; the real reach is larger.')
    const clamped = clampForLlm(lines, {
      maxTotalChars: MAX_TOTAL_CHARS,
      hint: 'lower `depth`',
    })
    return ok(action, total, withCaveats(clamped.text))
  }

  if (!params.symbol) return fail(action, `${action} needs \`symbol\` — an exact symbol name.`)
  const symbol = params.symbol.trim()
  const pathFilter = params.path?.trim() || undefined

  if (action === 'define') {
    const res = await findDefinitions(index, symbol, { pathFilter })
    if (res.hits.length === 0) {
      const hint =
        res.suggestions.length > 0
          ? ` Similar indexed names: ${res.suggestions.join(', ')}.`
          : ' It may be created by destructuring, generated, or come from a dependency — try Grep.'
      return ok(action, 0, withCaveats(`No indexed declaration of "${symbol}".${hint}`))
    }
    const lines = res.hits.map((h) => {
      const tags = [h.exported ? 'exported' : 'local', h.kind, h.container ? `in ${h.container}` : '']
        .filter((t) => t !== '')
        .join(' ')
      return `${h.path}:${h.line}  [${tags}]  ${h.excerpt}`
    })
    const head = `${res.total} declaration(s) named "${symbol}"${res.total > res.hits.length ? ` (showing ${res.hits.length})` : ''}:`
    const clamped = clampForLlm([head, ...lines], {
      maxTotalChars: MAX_TOTAL_CHARS,
      hint: 'pass `path` to narrow by directory',
    })
    return ok(action, res.total, withCaveats(clamped.text))
  }

  const res = await findReferences(index, symbol, { pathFilter })
  if (res.total === 0) {
    const defined =
      res.definedAt.length > 0
        ? ` It IS declared at ${res.definedAt.join(', ')}, so it may be unused — or used in a way the index does not see (destructured, re-exported under another name, called through a variable).`
        : ' The index has no declaration of it either — check the spelling, or use Grep.'
    return ok(action, 0, withCaveats(`No indexed reference to "${symbol}".${defined}`))
  }
  const head = `${res.total} reference(s) to "${symbol}" across ${res.files} file(s)${res.total > res.hits.length ? ` (showing ${res.hits.length})` : ''}${res.definedAt.length > 0 ? `; declared at ${res.definedAt.join(', ')}` : ''}:`
  const lines = res.hits.map((h) => `${h.path}:${h.line}  ${h.excerpt}`)
  const clamped = clampForLlm([head, ...lines], {
    maxTotalChars: MAX_TOTAL_CHARS,
    hint: 'pass `path` to narrow by directory',
  })
  return ok(action, res.total, withCaveats(clamped.text))
}

// Vỏ AgentTool của nhánh Pi.
export function createCodeIndexTool(cwd: string): AgentTool<typeof Params, CodeIndexDetails> {
  return {
    name: 'code_index',
    label: 'Code index',
    description: CODE_INDEX_TEXT.description,
    parameters: Params,
    async execute(_id, params): Promise<AgentToolResult<CodeIndexDetails>> {
      const r = await runCodeIndex(cwd, params)
      return {
        content: [{ type: 'text', text: r.text }],
        details: {
          action: r.action,
          matches: r.matches,
          ...(r.isError ? { isError: true as const } : {}),
        },
      }
    },
  }
}
