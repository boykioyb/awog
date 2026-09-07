import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { updateTemplate, type TemplateUpdateResolution } from '../templates/update.js'
import { invalidateRulesCache } from '../rules/inject.js'
import { invalidateHookCache } from '../hooks/dispatcher.js'

// templates.update — cài đè bundle từ nguồn của nó, có kiểm soát (WP10).
// Entity đã sửa cục bộ mà nguồn cũng đổi/xoá là XUNG ĐỘT: không có `resolutions`
// tương ứng thì RPC trả `{ status: 'conflicts' }` và KHÔNG ghi gì cả.
// Ghi qua thư mục tạm + rename nên hỏng giữa chừng vẫn giữ nguyên bản cũ.
const Params = z.object({
  id: z.string().min(1).max(120),
  resolutions: z
    .array(
      z.object({
        kind: z.enum(['agent', 'skill', 'hook', 'rule', 'command']),
        id: z.string().min(1).max(256),
        choice: z.enum(['keepLocal', 'takeRemote']),
      }),
    )
    .max(1000)
    .default([]),
})

register('templates.update', async (raw) => {
  const p = Params.parse(raw)
  const result = await updateTemplate(p.id, p.resolutions as TemplateUpdateResolution[])
  // Bundle chỉ là nguồn để cài lại — nhưng rule/hook có thể đang được nạp từ bản
  // vừa đổi, nên làm mới cache cho chắc.
  if (result.status === 'updated') {
    if (result.applied.some((a) => a.kind === 'rule')) invalidateRulesCache()
    if (result.applied.some((a) => a.kind === 'hook')) invalidateHookCache()
  }
  return { result }
})
