// Chạy một lần kiểm định kích hoạt cho một skill (có gọi model — CÓ TRẦN).
//
// Mỗi ca kiểm là một lượt one-shot qua `completePi` (cùng đường với
// skills.generate / projects.generateDescription), chạy TUẦN TỰ để trần chi phí
// kịp bấm phanh giữa chừng. Trần + cách chấm nằm ở skills/eval.ts.

import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { listSkills } from '../skills/store.js'
import { awaitKindMigration } from '../migration/claude-home.js'
import { ANTHROPIC_MODELS } from '../providers/anthropic/models-map.js'
import { evalBudget, runSkillEval, MAX_CASES_PER_RUN, SkillEvalCaseSchema } from '../skills/eval.js'
import { saveEvalRun } from '../skills/eval-store.js'
import { log } from '../util/logger.js'
import type { SkillSource } from '../types/shared.js'

const SourceSchema: z.ZodType<SkillSource> = z.enum(['global', 'project'])

const Params = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  source: SourceSchema,
  projectId: z.string().min(1).max(64).optional(),
  projectIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  cases: z.array(SkillEvalCaseSchema).min(1).max(MAX_CASES_PER_RUN),
  accountId: z.string().min(1).max(120).optional(),
  modelId: z.enum(ANTHROPIC_MODELS).optional(),
})

register('skills.eval', async (raw) => {
  const params = Params.parse(raw)
  await awaitKindMigration('skills')

  const scopes = params.projectIds ?? (params.projectId ? [params.projectId] : [])
  const { skills } = await listSkills(scopes)
  const target = skills.find(
    (s) =>
      s.id === params.id &&
      s.source === params.source &&
      (s.projectId ?? undefined) === (params.projectId ?? undefined),
  )
  if (!target) {
    // Skill thiếu name/description không lọt vào danh mục ⇒ model không bao giờ
    // thấy nó ⇒ eval vô nghĩa. Chạy doctor trước.
    throw new RpcError(-32602, `Skill not in the live catalogue: ${params.id} (run skills.doctor)`)
  }

  // Haiku là mặc định rẻ — đây là bài toán phân loại một dòng, không cần Opus.
  const modelId = params.modelId ?? 'claude-haiku-4-5'
  log.info('skills.eval', { skill: params.id, cases: params.cases.length, model: modelId })

  const run = await runSkillEval({
    skillId: params.id,
    cases: params.cases,
    catalogueSkills: skills,
    modelId,
    accountId: params.accountId,
    runId: `ev-${randomBytes(6).toString('hex')}`,
  })

  const record = await saveEvalRun(
    { id: params.id, source: params.source, projectId: params.projectId },
    params.cases,
    run,
  )
  return { run, record, budget: evalBudget() }
})
