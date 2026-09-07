// `code.query` — hỏi chỉ mục mã nguồn: định nghĩa ở đâu / ai gọi / sửa thì vỡ gì.
//
// Trả DỮ LIỆU CÓ CẤU TRÚC (path + line + đoạn trích), không phải văn bản đã render:
// việc diễn đạt cho model nằm ở runtime/tools/code-index-tool.ts, còn UI sẽ muốn
// dựng danh sách bấm được. Cùng một nguồn sự thật, hai bề mặt.
import { z } from 'zod'
import { isAbsolute } from 'node:path'
import { register, RpcError } from '../transport/rpc.js'
import { ensureIndex } from '../codeindex/build.js'
import {
  blastRadius,
  findDefinitions,
  findReferences,
  resolveIndexedPath,
  MAX_BLAST_DEPTH,
  type BlastResult,
  type DefResult,
  type RefResult,
} from '../codeindex/query.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  action: z.enum(['define', 'refs', 'blast']),
  symbol: z.string().min(1).max(200).optional(),
  path: z.string().min(1).max(1000).optional(),
  depth: z.number().int().positive().max(MAX_BLAST_DEPTH).optional(),
})

type CodeQueryResponse =
  | { action: 'define'; result: DefResult }
  | { action: 'refs'; result: RefResult }
  | { action: 'blast'; result: BlastResult }

register('code.query', async (raw): Promise<CodeQueryResponse> => {
  const params = Params.parse(raw)
  if (!isAbsolute(params.workspaceRoot)) {
    throw new RpcError(-32602, 'workspaceRoot must be absolute')
  }
  const { index } = await ensureIndex(params.workspaceRoot)
  const pathFilter = params.path?.trim() || undefined

  if (params.action === 'blast') {
    if (!params.path) throw new RpcError(-32602, 'blast requires `path`')
    const target = resolveIndexedPath(index, params.path)
    if (!target) throw new RpcError(-32602, `no indexed file matches "${params.path}"`)
    return { action: 'blast', result: blastRadius(index, target, params.depth ?? 2) }
  }

  if (!params.symbol) throw new RpcError(-32602, `${params.action} requires \`symbol\``)
  if (params.action === 'define') {
    return { action: 'define', result: await findDefinitions(index, params.symbol, { pathFilter }) }
  }
  return { action: 'refs', result: await findReferences(index, params.symbol, { pathFilter }) }
})
