// `code.index` — dựng / làm mới chỉ mục mã nguồn của một workspace.
//
// Tool `code_index` tự dựng lười khi model gọi lần đầu, nên method này KHÔNG bắt
// buộc cho luồng chat. Nó tồn tại để UI (hoặc người dùng) chủ động làm mới và
// nhìn thấy số đo thật — chỉ mục im lặng là chỉ mục không ai tin.
import { z } from 'zod'
import { isAbsolute } from 'node:path'
import { register, RpcError } from '../transport/rpc.js'
import { ensureIndex, indexStats } from '../codeindex/build.js'
import type { CodeIndexStats } from '../codeindex/types.js'

const Params = z.object({
  workspaceRoot: z.string().min(1),
  // Bỏ qua cả bộ nhớ đệm RAM lẫn bản trên đĩa và parse lại từ đầu.
  force: z.boolean().optional(),
})

interface CodeIndexResponse {
  stats: CodeIndexStats
  parsed: number
  reused: number
  durationMs: number
  deadlineHit: boolean
}

register('code.index', async (raw): Promise<CodeIndexResponse> => {
  const params = Params.parse(raw)
  if (!isAbsolute(params.workspaceRoot)) {
    throw new RpcError(-32602, 'workspaceRoot must be absolute')
  }
  const { index, result } = await ensureIndex(params.workspaceRoot, {
    force: params.force === true,
  })
  return {
    stats: await indexStats(index),
    parsed: result.parsed,
    reused: result.reused,
    durationMs: result.durationMs,
    deadlineHit: result.deadlineHit,
  }
})
