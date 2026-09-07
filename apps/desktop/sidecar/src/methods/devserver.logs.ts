import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { DevServerError, readDevServerLog } from '../devserver/registry.js'
import { MAX_LINES } from '../devserver/log-filter.js'
import { resolveProjectRoot } from '../devserver/project.js'

// Đuôi log của một dev server, có lọc theo mức lỗi / chuỗi con.
//
// KHÔNG khử bí mật ở đây, cố ý: người nhận là chính người dùng trên máy của họ
// (họ vốn nhìn thấy log này trong terminal). Việc khử chỉ bắt buộc ở đường ĐI RA
// NGOÀI MÁY — tool `dev_server` của model, nơi log được `redactString()` trước khi
// tới nhà cung cấp. Cùng lập trường với `sessions.backgroundRead`.
const Params = z.object({
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  name: z.string().min(1).max(64),
  lines: z.number().int().min(1).max(MAX_LINES).optional(),
  contains: z.string().max(200).optional(),
  level: z.enum(['all', 'warn', 'error']).optional(),
})

register('devserver.logs', async (raw) => {
  const { projectId, sessionId, name, lines, contains, level } = Params.parse(raw)
  const projectRoot = await resolveProjectRoot(projectId)
  try {
    return await readDevServerLog({
      projectRoot,
      sessionId,
      name,
      filter: { lines, contains, level },
    })
  } catch (err) {
    if (err instanceof DevServerError) throw new RpcError(-32602, err.message)
    throw err
  }
})
