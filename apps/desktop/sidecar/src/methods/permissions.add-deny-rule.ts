// Viết MỘT luật DENY do người dùng tự gõ (F3 của audit lần 4).
//
// ── Vì sao file này được nhận văn bản luật từ UI, còn accept-suggestion thì không ──
//
// `permissions.acceptSuggestion` cố ý KHÔNG nhận nội dung luật: nhận thì một payload
// dựng tay ghi thẳng `Bash(*)` vào `~/.awog/permission-rules.json` là **cấp thêm
// quyền** — đúng lỗ hổng ADR 0080 mục 5 vá. Ràng buộc đó bảo vệ một CHIỀU, và chỉ
// một chiều: chiều ALLOW.
//
// Chiều DENY thì không có gì để leo thang. Luật cấm chỉ lấy bớt năng lực; kịch bản
// xấu nhất của một payload dựng tay ở đây là `Bash(*)` action `deny` — tức tự khoá
// chân mình, thấy ngay ở Settings → Permissions và xoá được bằng một nút. Nên
// `action` KHÔNG nằm trong payload: nó là hằng `'deny'` viết trong file này. Không có
// cờ nào, không có nhánh nào lật nó sang `allow`.
//
// ── Vì sao cần đường này ──
//
// Trước nó, cả trang Settings → Permissions chỉ có hai thao tác: chấp nhận một gợi ý
// (luôn ra `allow`) và xoá. Nghĩa là người dùng KHÔNG có cách nào tắt hẳn một tool:
// `disabledTools` là per-session và mặc định rỗng, nên một tool bật theo mặc định thì
// bật ở mọi phiên chat và không có công tắc nào ở tầng bền vững. `Artifact` là ca làm
// lộ ra chuyện đó, nhưng lỗ hổng là CHUNG cho mọi tool — nên bản vá cũng chung, không
// phải một công tắc riêng cho một tool (thêm khoá settings song song chỉ tạo hai
// nguồn sự thật cho cùng một câu hỏi).
//
// Luật DENY đã có sẵn đủ đường ở tầng dưới: `evaluatePermissionRules` đọc nó, và cổng
// quyền cho nó thắng MỌI nới lỏng — execute mode, auto-approve, accept-edits, và cả
// một lời duyệt vừa bấm. Việc còn thiếu chỉ là một đường ghi.
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'
import { parsePermissionRule, persistRule } from '../sessions/permission-rules.js'
import { log } from '../util/logger.js'

const Params = z.object({
  // Cùng trần với `parsePermissionRule` (nó tự từ chối cái dài hơn); giới hạn ở
  // đây để payload dị dạng chết ngay tại biên RPC, ồn ào, thay vì lặng lẽ ra `null`.
  rule: z.string().min(1).max(1024),
  // Hai tầng bền vững, y như acceptSuggestion. Tầng session thuộc về thẻ xin quyền.
  scope: z.enum(['project', 'user']),
  projectId: z.string().min(1).max(200).optional(),
})

register('permissions.addDenyRule', async (raw) => {
  const params = Params.parse(raw)
  // Parse với action GHIM CỨNG. Văn bản không đọc được thì từ chối — không lưu một
  // chuỗi mà lúc đọc lại sẽ thành vô hiệu, vì luật cấm vô hiệu là luật cấm nói dối.
  const rule = parsePermissionRule(params.rule, 'deny')
  if (!rule) throw new RpcError(-32602, `Not a valid permission rule: ${params.rule}`)

  let projectPath: string | null = null
  if (params.scope === 'project') {
    if (!params.projectId) throw new RpcError(-32602, 'projectId is required for project scope')
    const project = await loadProject(params.projectId)
    if (!project) throw new RpcError(-32602, `Unknown project: ${params.projectId}`)
    projectPath = project.path
  }

  const scope = await persistRule(params.scope, rule, { projectPath })
  log.info('permissions.addDenyRule', { rule: rule.text, scope })
  return { rule: rule.text, action: 'deny', scope }
})
