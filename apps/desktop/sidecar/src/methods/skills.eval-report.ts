// Đọc bộ ca kiểm + lịch sử chạy đã lưu của một skill. Không gọi model.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { loadEvalRecord } from '../skills/eval-store.js'
import { evalBudget } from '../skills/eval.js'
import type { SkillSource } from '../types/shared.js'

const SourceSchema: z.ZodType<SkillSource> = z.enum(['global', 'project'])

const Params = z.object({
  id: z.string().min(1).max(64),
  source: SourceSchema,
  projectId: z.string().min(1).max(64).optional(),
})

register('skills.evalReport', async (raw) => {
  const params = Params.parse(raw ?? {})
  const record = await loadEvalRecord(params.id, params.source, params.projectId)
  // Trần đi kèm để UI nói rõ "tối đa N lượt / $X / Y phút" trước khi người dùng bấm chạy.
  return { record, budget: evalBudget() }
})
