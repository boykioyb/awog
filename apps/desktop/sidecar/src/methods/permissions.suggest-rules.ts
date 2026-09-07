// Gợi ý luật từ lịch sử (#40 của lượt infosec).
//
// Người bị hỏi đi hỏi lại cùng một lệnh sẽ bấm bừa, mà nút bấm bừa ở đây là nút
// cấp quyền — nên "hỏi ít lại" là một yêu cầu BẢO MẬT. RPC này quét transcript
// đã lưu, đếm lệnh nào chạy đi chạy lại rồi ĐỀ XUẤT một luật nguyên văn.
//
// Nó KHÔNG ghi gì cả. Muốn thành luật thì người dùng phải bấm, và lượt bấm đó đi
// qua `permissions.acceptSuggestion` với id đã park — nội dung luật không bao
// giờ đến từ payload UI (ADR 0080 mục 5).
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listProjects } from '../projects/store.js'
import { suggestRulesFromHistory, SUGGESTION_MIN_COUNT } from '../sessions/permission-rules.js'

const Params = z.object({
  // Số lần một lệnh phải xuất hiện mới được đề xuất. Chặn dưới ở 2: ngưỡng 1 sẽ
  // biến mọi lệnh từng chạy một lần thành lời mời cấp quyền.
  minCount: z.number().int().min(2).max(50).optional(),
  limit: z.number().int().min(1).max(50).optional(),
})

register('permissions.suggestRules', async (raw) => {
  const params = Params.parse(raw ?? {})
  const projects = await listProjects()
  const projectPaths: Record<string, string> = {}
  const projectNames: Record<string, string> = {}
  for (const project of projects) {
    if (project.path) projectPaths[project.id] = project.path
    projectNames[project.id] = project.name
  }
  const { suggestions, report } = await suggestRulesFromHistory({
    projectPaths,
    minCount: params.minCount ?? SUGGESTION_MIN_COUNT,
    ...(params.limit !== undefined ? { limit: params.limit } : {}),
  })
  return {
    suggestions: suggestions.map((s) => ({
      ...s,
      projects: s.projectIds.map((id) => ({ id, name: projectNames[id] ?? id })),
    })),
    report,
  }
})
