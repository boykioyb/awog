// Kiểm định KÍCH HOẠT của một skill: với vài prompt mẫu, model có chọn đúng skill
// này không?
//
// Doctor (doctor.ts) trả lời "skill có viết đúng hình dạng không" mà không tốn
// tiền. Phần này trả lời câu đắt hơn: "trong danh mục skill hiện có, mô tả của
// skill này có đủ phân biệt để model gọi tới đúng lúc — và KHÔNG gọi khi không
// nên". Mỗi ca kiểm là MỘT lượt one-shot không tool, đi qua đúng đường
// `completePi` mà 4 method *.generate đang dùng (ADR 0029 C2) — không dựng
// runtime thứ hai.
//
// TRẦN CHI PHÍ (bắt buộc — `.claude/rules/security.md`, sink "Loop gọi model").
// Cùng khuôn ba chiều với tasks/budget.ts và schedules/runner.ts:
//   • calls     — số lượt gọi model của MỘT lần chạy (chiều cứng nhất, luôn có
//                 hiệu lực kể cả khi không tra được bảng giá).
//   • cost      — USD: cửa TRƯỚC mỗi lượt là ước lượng (không thể biết trước khi
//                 tiêu), nhưng tổng ĐÃ TIÊU được cộng bằng usage thật provider trả
//                 về sau mỗi lượt — chỉ rơi về ước lượng khi model không có giá,
//                 tính từ số ký tự prompt theo bảng giá catalog. Vượt trần thì
//                 các ca còn lại bị bỏ, không chạy tiếp.
//   • wallclock — tổng thời gian một lần chạy.
// Chiều nào chạm trần trước thì dừng; các ca chưa chạy trả về status 'skipped'
// kèm `stoppedBy` để UI nói rõ vì sao dừng.

import { z } from 'zod'
import { cost, getEffectivePricing } from '../pricing/catalog.js'
import { completePiWithUsage } from '../runtime/complete.js'
import { log } from '../util/logger.js'
import type { Skill, SkillSource } from '../types/shared.js'

// Trần cứng ở BIÊN (số ca một lần gửi, độ dài một prompt). Khác với ba chiều
// dừng-giữa-chừng bên dưới — đây là thứ zod từ chối ngay ở biên IPC.
export const MAX_CASES_PER_RUN = 20
export const MAX_CASE_PROMPT_CHARS = 1_000

// Schema + type ---------------------------------------------------------------

export const SkillEvalExpectationSchema = z.enum(['activate', 'skip'])
export type SkillEvalExpectation = z.infer<typeof SkillEvalExpectationSchema>

export const SkillEvalCaseSchema = z.object({
  id: z.string().min(1).max(64),
  prompt: z.string().min(1).max(MAX_CASE_PROMPT_CHARS),
  expect: SkillEvalExpectationSchema,
})
export type SkillEvalCase = z.infer<typeof SkillEvalCaseSchema>

export const SkillEvalCaseResultSchema = z.object({
  caseId: z.string().max(64),
  prompt: z.string().max(4_000),
  expect: SkillEvalExpectationSchema,
  // Skill id model đã chọn; null = model bảo "không skill nào".
  chosen: z.string().max(64).nullable(),
  pass: z.boolean(),
  reason: z.string().max(400),
  status: z.enum(['scored', 'skipped', 'error']),
  errorMessage: z.string().max(400).optional(),
})
export type SkillEvalCaseResult = z.infer<typeof SkillEvalCaseResultSchema>

export const SkillEvalStopSchema = z.enum(['calls', 'cost', 'wallclock', 'error'])
export type SkillEvalStop = z.infer<typeof SkillEvalStopSchema>

export const SkillEvalBudgetSchema = z.object({
  maxCalls: z.number().int().nonnegative(),
  maxCostUsd: z.number().nonnegative(),
  maxWallclockMs: z.number().int().nonnegative(),
})
export type SkillEvalBudget = z.infer<typeof SkillEvalBudgetSchema>

export const SkillEvalRunSchema = z.object({
  runId: z.string().min(1).max(64),
  startedAt: z.number(),
  finishedAt: z.number(),
  modelId: z.string().min(1).max(120),
  results: z.array(SkillEvalCaseResultSchema).max(50),
  passed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  // Ước lượng, không phải hoá đơn — xem đầu file.
  estimatedCostUsd: z.number().nonnegative(),
  // false ⇒ model không có trong bảng giá, chiều `cost` bị vô hiệu và hai chiều
  // calls/wallclock là lưới an toàn duy nhất.
  pricingKnown: z.boolean(),
  budget: SkillEvalBudgetSchema,
  stoppedBy: SkillEvalStopSchema.optional(),
})
export type SkillEvalRun = z.infer<typeof SkillEvalRunSchema>

// Trần ------------------------------------------------------------------------

// Trần MẶC ĐỊNH cho một lần chạy eval. Đủ rộng cho bộ 8–10 ca người dùng gõ tay,
// đủ chặt để một lần bấm nhầm không đốt hạn mức. Chỉnh bằng env của sidecar.
export const DEFAULT_EVAL_BUDGET: SkillEvalBudget = {
  maxCalls: 20,
  maxCostUsd: 0.5,
  maxWallclockMs: 5 * 60_000,
}

const ENV_KEYS = {
  maxCalls: 'AWOG_SKILL_EVAL_MAX_CALLS',
  maxCostUsd: 'AWOG_SKILL_EVAL_MAX_USD',
  maxWallclockMs: 'AWOG_SKILL_EVAL_MAX_WALLCLOCK_MS',
} as const

function envNumber(key: string, fallback: number): number {
  const raw = process.env[key]
  if (raw === undefined || raw.trim().length === 0) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

let cachedBudget: SkillEvalBudget | null = null

export function evalBudget(): SkillEvalBudget {
  if (cachedBudget) return cachedBudget
  cachedBudget = {
    maxCalls: envNumber(ENV_KEYS.maxCalls, DEFAULT_EVAL_BUDGET.maxCalls),
    maxCostUsd: envNumber(ENV_KEYS.maxCostUsd, DEFAULT_EVAL_BUDGET.maxCostUsd),
    maxWallclockMs: envNumber(ENV_KEYS.maxWallclockMs, DEFAULT_EVAL_BUDGET.maxWallclockMs),
  }
  return cachedBudget
}

// Prompt ----------------------------------------------------------------------

// Cắt danh mục để input token của mỗi ca không phình theo số skill người dùng có.
const MAX_CATALOGUE_ENTRIES = 60
const MAX_CATALOGUE_DESC_CHARS = 300

export const EVAL_SYSTEM_PROMPT = `You are the skill router of an AI coding assistant. You are given a catalogue of available skills and ONE user request.

Decide which single skill (if any) you would load to handle that request, using ONLY the skill names and descriptions — exactly as you would during a normal turn.

Respond with ONLY a JSON object, no prose and no code fence:

{"skill": "<skill-id or null>", "reason": "<max 25 words>"}

Rules:
- "skill" MUST be an id from the catalogue, or null when no skill applies.
- Pick at most one skill. Do not invent ids.
- Judge by the description only; do not assume a skill does more than it says.`

export function buildCatalogue(skills: Skill[]): string {
  const entries = skills.slice(0, MAX_CATALOGUE_ENTRIES).map((s) => {
    const desc = s.description.slice(0, MAX_CATALOGUE_DESC_CHARS).replace(/\s+/g, ' ').trim()
    return `- ${s.id} — ${s.name}: ${desc}`
  })
  return entries.join('\n')
}

export function buildCasePrompt(catalogue: string, userPrompt: string): string {
  return `Skill catalogue:\n${catalogue || '(empty)'}\n\nUser request:\n"""\n${userPrompt}\n"""\n\nAnswer with the JSON object now.`
}

// Chấm điểm + đọc kết quả (thuần) ---------------------------------------------

// Model trả về id không có trong danh mục ⇒ coi như "không chọn skill nào": nó
// bịa, và bịa thì không được tính là kích hoạt đúng.
export function parseChoice(
  raw: string,
  knownIds: readonly string[],
): { chosen: string | null; reason: string } {
  const trimmed = raw.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed)
  const payload = fenced?.[1]?.trim() ?? trimmed
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return { chosen: null, reason: '' }
  }
  if (typeof parsed !== 'object' || parsed === null) return { chosen: null, reason: '' }
  const rec = parsed as { skill?: unknown; reason?: unknown }
  const reason = typeof rec.reason === 'string' ? rec.reason.slice(0, 400) : ''
  const skill = typeof rec.skill === 'string' ? rec.skill.trim() : ''
  if (!skill || skill.toLowerCase() === 'null' || skill.toLowerCase() === 'none') {
    return { chosen: null, reason }
  }
  return { chosen: knownIds.includes(skill) ? skill : null, reason }
}

export function scoreCase(
  expect: SkillEvalExpectation,
  chosen: string | null,
  skillId: string,
): boolean {
  return expect === 'activate' ? chosen === skillId : chosen !== skillId
}

// Ước lượng chi phí -----------------------------------------------------------

// 4 ký tự ≈ 1 token: đủ chính xác cho một cái phanh, và không kéo thêm tokenizer.
const CHARS_PER_TOKEN = 4
// Câu trả lời là một object JSON một dòng — 150 token đã là rộng rãi.
const EST_OUTPUT_TOKENS = 150

export function estimateCallCostUsd(modelId: string, promptChars: number): number | null {
  const price = getEffectivePricing(modelId, {})
  if (!price) return null
  return cost(
    {
      inputTokens: Math.ceil(promptChars / CHARS_PER_TOKEN),
      outputTokens: EST_OUTPUT_TOKENS,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    price,
  )
}

// Chi phí THẬT của một lượt, từ usage provider trả về. `null` khi model không có
// giá trong catalog — lúc đó caller giữ lại ước lượng và hạ `pricingKnown`.
function actualCallCostUsd(
  modelId: string,
  usage: { inputTokens: number; outputTokens: number },
): number | null {
  const price = getEffectivePricing(modelId, {})
  if (!price) return null
  return cost(
    { ...usage, cacheReadTokens: 0, cacheWriteTokens: 0 },
    price,
  )
}

// Chạy ------------------------------------------------------------------------

export interface RunEvalArgs {
  skillId: string
  cases: SkillEvalCase[]
  // Toàn bộ skill đang thấy được (danh mục model sẽ chọn trong đó).
  catalogueSkills: Skill[]
  modelId: string
  accountId?: string | undefined
  runId: string
}

function clipError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.slice(0, 400)
}

function skipped(c: SkillEvalCase): SkillEvalCaseResult {
  return {
    caseId: c.id,
    prompt: c.prompt,
    expect: c.expect,
    chosen: null,
    pass: false,
    reason: '',
    status: 'skipped',
  }
}

export async function runSkillEval(args: RunEvalArgs): Promise<SkillEvalRun> {
  const budget = evalBudget()
  const startedAt = Date.now()
  const catalogue = buildCatalogue(args.catalogueSkills)
  const knownIds = args.catalogueSkills.map((s) => s.id)

  const results: SkillEvalCaseResult[] = []
  let estimatedCostUsd = 0
  let calls = 0
  let consecutiveErrors = 0
  let stoppedBy: SkillEvalStop | undefined
  let pricingKnown = true

  for (const c of args.cases) {
    if (stoppedBy) {
      results.push(skipped(c))
      continue
    }
    const prompt = buildCasePrompt(catalogue, c.prompt)
    const estimate = estimateCallCostUsd(args.modelId, EVAL_SYSTEM_PROMPT.length + prompt.length)
    if (estimate === null) pricingKnown = false

    // Ba cửa trước MỖI lượt gọi. Chạm cửa nào thì dừng phát lượt mới; ca hiện tại
    // và các ca sau trả về 'skipped'.
    if (budget.maxCalls > 0 && calls >= budget.maxCalls) stoppedBy = 'calls'
    else if (budget.maxWallclockMs > 0 && Date.now() - startedAt > budget.maxWallclockMs) {
      stoppedBy = 'wallclock'
    } else if (
      budget.maxCostUsd > 0 &&
      estimate !== null &&
      estimatedCostUsd + estimate > budget.maxCostUsd
    ) {
      stoppedBy = 'cost'
    }
    if (stoppedBy) {
      log.warn('skills.eval: budget reached', { dimension: stoppedBy, calls, estimatedCostUsd })
      results.push(skipped(c))
      continue
    }

    calls += 1
    // Cộng ước lượng NGAY: nếu lượt này ném lỗi thì nó vẫn có thể đã tốn tiền, và
    // một trần quên tính lượt hỏng là trần đếm thiếu.
    estimatedCostUsd += estimate ?? 0
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await completePiWithUsage({
        accountId: args.accountId,
        modelId: args.modelId,
        systemPrompt: EVAL_SYSTEM_PROMPT,
        prompt,
      })
      const raw = res.text
      // Thay ước lượng bằng số đo thật. Trần vẫn phải đoán ở cửa vào (chưa tiêu thì
      // chưa biết), nhưng tổng đã tiêu thì không có lý do gì để ở lại dạng đoán.
      const actual = actualCallCostUsd(res.modelUsed, res.usage)
      if (actual !== null) estimatedCostUsd += actual - (estimate ?? 0)
      consecutiveErrors = 0
      const { chosen, reason } = parseChoice(raw, knownIds)
      results.push({
        caseId: c.id,
        prompt: c.prompt,
        expect: c.expect,
        chosen,
        pass: scoreCase(c.expect, chosen, args.skillId),
        reason,
        status: 'scored',
      })
    } catch (err) {
      consecutiveErrors += 1
      results.push({
        caseId: c.id,
        prompt: c.prompt,
        expect: c.expect,
        chosen: null,
        pass: false,
        reason: '',
        status: 'error',
        errorMessage: clipError(err),
      })
      // Hai lỗi liên tiếp gần như luôn là lỗi hệ thống (hết hạn token, mất
      // mạng), không phải lỗi của ca kiểm — chạy tiếp chỉ tốn thời gian.
      if (consecutiveErrors >= 2) stoppedBy = 'error'
    }
  }

  const scored = results.filter((r) => r.status === 'scored')
  const run: SkillEvalRun = {
    runId: args.runId,
    startedAt,
    finishedAt: Date.now(),
    modelId: args.modelId,
    results,
    passed: scored.filter((r) => r.pass).length,
    total: scored.length,
    estimatedCostUsd,
    pricingKnown,
    budget,
  }
  if (stoppedBy) run.stoppedBy = stoppedBy
  return run
}

// Khoá lưu trữ ----------------------------------------------------------------

// Một bộ ca kiểm thuộc về (source, projectId, id) — cùng id ở hai tier là hai
// skill khác nhau, nên khoá phải gộp cả ba.
export function evalKey(id: string, source: SkillSource, projectId?: string): string {
  const safe = (v: string): string => v.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64)
  return `${safe(source)}__${safe(projectId ?? 'global')}__${safe(id)}`
}
