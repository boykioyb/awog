// Chẩn đoán tĩnh một skill. KHÔNG gọi model ⇒ không tốn tiền, gọi bao nhiêu lần
// cũng được (UI chạy ngay khi mở bảng Kiểm tra).

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listSkills } from '../skills/store.js'
import { diagnoseSkill, type SkillSibling } from '../skills/doctor.js'
import { awaitKindMigration } from '../migration/claude-home.js'
import type { SkillSource } from '../types/shared.js'

const SourceSchema: z.ZodType<SkillSource> = z.enum(['global', 'project'])

const Params = z.object({
  // Cố ý KHÔNG ép regex id ở đây: một id sai hình dạng chính là thứ doctor phải
  // báo (`invalid-id`). Chặn traversal là việc của sanitizeChild trong store.
  id: z.string().min(1).max(64),
  source: SourceSchema,
  projectId: z.string().min(1).max(64).optional(),
  // Tier project cần quét để bắt trùng id/tên giữa hai tier.
  projectIds: z.array(z.string().min(1).max(64)).max(50).optional(),
})

register('skills.doctor', async (raw) => {
  const params = Params.parse(raw ?? {})
  await awaitKindMigration('skills')

  const scopes = params.projectIds ?? (params.projectId ? [params.projectId] : [])
  const { skills } = await listSkills(scopes)
  const siblings: SkillSibling[] = skills.map((s) => ({
    id: s.id,
    source: s.source,
    projectId: s.projectId,
    name: s.name,
  }))

  const report = await diagnoseSkill(
    { id: params.id, source: params.source, projectId: params.projectId },
    { siblings },
  )
  return { report }
})
