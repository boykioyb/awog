// Biến MỘT gợi ý thành luật thật (#40). Người dùng phải bấm — không có đường nào
// để lượt quét tự tạo luật.
//
// Payload chỉ mang `id` của gợi ý đã park + tầng đích. Nội dung luật lấy từ bản
// park trong sidecar, y hệt ràng buộc của `sessions.permission` (ADR 0080 mục
// 5): nếu nhận văn bản luật từ UI thì một payload dựng tay có thể ghi thẳng
// `Bash(*)` vào `~/.awog/permission-rules.json` — đúng lỗ hổng mà ADR đang vá.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'
import { getParkedRuleSuggestion, persistRule } from '../sessions/permission-rules.js'
import { log } from '../util/logger.js'

const Params = z.object({
  id: z.string().min(1).max(64),
  // Trang cấu hình chỉ ghi được hai tầng bền vững; tầng session thuộc về thẻ xin
  // quyền trong phiên.
  scope: z.enum(['project', 'user']),
  projectId: z.string().min(1).max(200).optional(),
})

register('permissions.acceptSuggestion', async (raw) => {
  const params = Params.parse(raw)
  const rule = getParkedRuleSuggestion(params.id)
  // Hết hạn (lượt quét mới đã thay danh sách) ⇒ bắt người dùng quét lại rồi đọc
  // lại luật, thay vì đoán ra một luật họ chưa nhìn thấy.
  if (!rule) throw new RpcError(-32602, 'Suggestion is no longer available, rescan first')

  let projectPath: string | null = null
  if (params.scope === 'project') {
    if (!params.projectId) throw new RpcError(-32602, 'projectId is required for project scope')
    const project = await loadProject(params.projectId)
    if (!project) throw new RpcError(-32602, `Unknown project: ${params.projectId}`)
    projectPath = project.path
  }

  const scope = await persistRule(params.scope, rule, { projectPath })
  log.info('permissions.acceptSuggestion', { rule: rule.text, scope })
  return { rule: rule.text, scope }
})
