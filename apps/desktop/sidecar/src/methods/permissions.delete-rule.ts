// Thu hồi MỘT luật quyền (ADR 0080 — F10). Mặt GHI của trang quản lý luật.
//
// Hai điều phải giữ:
//   1. Đường dẫn file KHÔNG BAO GIỜ đến từ payload UI — chỉ có `projectId`, và
//      đường dẫn được giải ra từ store project rồi băm (invariant 2: mọi I/O
//      filesystem đi qua một đường dẫn do sidecar tự dựng).
//   2. Xoá là rewrite atomic GIỮ NGUYÊN VĂN các entry còn lại; file hỏng toàn
//      phần thì ném lỗi chứ không ghi đè (đúng tinh thần F2 — không được phép
//      xoá hộ người dùng những luật DENY họ đã viết).
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'
import {
  deleteRuleFromFile,
  projectRuleFile,
  removeSessionRule,
  userRuleFile,
} from '../sessions/permission-rules.js'
import { log } from '../util/logger.js'

const Params = z.object({
  scope: z.enum(['session', 'project', 'user']),
  // Nguyên văn chuỗi luật như `permissions.listRules` trả về. So khớp là so
  // chuỗi tuyệt đối, không glob — không có đường nào để một lời gọi xoá lan sang
  // luật khác.
  rule: z.string().min(1).max(1024),
  action: z.enum(['allow', 'deny']),
  projectId: z.string().min(1).max(200).optional(),
  sessionId: z.string().min(1).max(200).optional(),
})

register('permissions.deleteRule', async (raw) => {
  const params = Params.parse(raw)
  const target = { rule: params.rule, action: params.action }

  if (params.scope === 'session') {
    if (!params.sessionId) throw new RpcError(-32602, 'sessionId is required for session scope')
    const removed = removeSessionRule(params.sessionId, params.rule, params.action)
    log.info('permissions.deleteRule', { scope: 'session', removed })
    return { removed }
  }

  let file: string
  if (params.scope === 'user') {
    file = userRuleFile()
  } else {
    if (!params.projectId) throw new RpcError(-32602, 'projectId is required for project scope')
    const project = await loadProject(params.projectId)
    if (!project) throw new RpcError(-32602, `Unknown project: ${params.projectId}`)
    const resolved = projectRuleFile(project.path)
    if (!resolved) throw new RpcError(-32602, 'Project has no absolute path')
    file = resolved
  }

  const { removed } = await deleteRuleFromFile(file, target)
  log.info('permissions.deleteRule', { scope: params.scope, removed })
  return { removed }
})
