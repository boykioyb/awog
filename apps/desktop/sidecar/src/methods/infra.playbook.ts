// `infra.playbook-*` — bề mặt RPC của playbook hạ tầng (mốc 5.4 · 5.6 · 5.7).
//
// MỘT QUY ƯỚC XUYÊN SUỐT FILE: câu trả lời cho một thất bại ĐÃ LƯỜNG TRƯỚC là một
// object `{ ok: false, ... }`, không phải một ngoại lệ. "Playbook thiếu bước quay
// lui", "file người dùng viết sai", "chưa duyệt" đều là câu trả lời bình thường
// của một câu hỏi hợp lệ — ném chúng đi thì UI phải bọc mọi lời gọi trong
// try/catch rồi tự đoán lỗi nào là lỗi nào. Ngoại lệ để dành cho sự cố thật (đĩa
// hỏng, tham số sai kiểu); `RpcError` từ tầng dưới chỉ nổi lên cho những ca đó.
//
// KẾT QUẢ BỊ CỔNG CHẶN dùng ĐÚNG shape §2 của hợp đồng Mốc 5 (`ok:false`,
// `blocked:true`, `requiresApproval`, `approvalTicket?`, `command`, `reason`,
// `class`, `accountKind`, `mode`) — cộng `stepId`/`stepNumber` của riêng playbook.
// `requiresApproval === false` là ma trận chặn hẳn: UI **không** được mời duyệt
// lại, chỉ được nói lý do.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { BUILTIN_PLAYBOOKS, builtinPlaybook } from '../infra/playbook/builtin.js'
import {
  approveRun,
  listRuns,
  rollbackPlaybook,
  runPlaybook,
  runPreflight,
  submitPlaybook,
} from '../infra/playbook/runner.js'
import {
  deletePlaybook,
  listPlaybooks,
  readPlaybook,
  savePlaybook,
  summarizePlaybook,
} from '../infra/playbook/store.js'
import {
  PlaybookDraftSchema,
  buildPlaybook,
  isValidPlaybookId,
  resolveVariables,
  validatePlaybook,
} from '../infra/playbook/schema.js'
import type {
  ApproveResult,
  PlaybookRun,
  PreflightResult,
  RollbackPlaybookResult,
  RunPlaybookResult,
  SubmitResult,
} from '../infra/playbook/runner.js'
import type { Playbook, PlaybookIssue, PlaybookSource } from '../infra/playbook/schema.js'
import type { PlaybookSummary } from '../infra/playbook/store.js'

// ─── Tham số ─────────────────────────────────────────────────────────────────

const MAX_VALUES = 64
const MAX_VALUE_CHARS = 1024
const MAX_RUNS_LIMIT = 100
const DEFAULT_RUNS_LIMIT = 20

const SOURCE = z.enum(['builtin', 'global', 'project'])
const WRITABLE_SOURCE = z.enum(['global', 'project'])

const Id = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidPlaybookId, 'playbook.error.badId')
const ProjectId = z.string().min(1).max(200).optional()
const RunId = z.string().min(1).max(200)
const ApprovalTicket = z.string().max(100).optional()

/**
 * Ngữ cảnh hạ tầng đang ghim. SÁU trường chứ không phải ba: playbook chạy được cả
 * terraform (`workspace`) lẫn kubectl (`cluster`/`namespace`), và một ngữ cảnh bị
 * cắt cụt ở đây là một lệnh chạy nhầm chỗ.
 */
const Context = z
  .object({
    profile: z.string().max(200).optional(),
    region: z.string().max(64).optional(),
    accountId: z.string().max(64).optional(),
    cluster: z.string().max(200).optional(),
    namespace: z.string().max(200).optional(),
    workspace: z.string().max(500).optional(),
  })
  .default({})

// Chặn trần ở ĐÂY chứ không ở tầng nội suy: `resolveVariables` chỉ đọc những tên
// playbook khai, nên khoá lạ bị bỏ qua — nhưng một payload IPC 10.000 khoá vẫn
// phải bị cắt trước khi nó thành một object trong RAM.
const Values = z
  .record(z.string().max(64), z.string().max(MAX_VALUE_CHARS))
  .default({})
  .transform((rec) => Object.fromEntries(Object.entries(rec).slice(0, MAX_VALUES)))

const Scope = z.object({ source: SOURCE, projectId: ProjectId, id: Id })
const RunScope = z.object({
  source: SOURCE,
  projectId: ProjectId,
  id: Id,
  values: Values,
  context: Context,
  approvalTicket: ApprovalTicket,
})

// ─── Hình dạng trả về của nhóm quản lý playbook ──────────────────────────────
//
// Nhóm chạy (`preflight`/`submit`/`approve`/`run`/`rollback`) trả về thẳng các
// kiểu của `runner.ts` — chúng đã là hợp đồng, khai lại ở đây là hai nguồn sự thật.

export type PlaybookListResult = { ok: true; playbooks: PlaybookSummary[] }

export type PlaybookReadResult =
  | { ok: true; playbook: Playbook; summary: PlaybookSummary }
  | { ok: false; error: string; issues?: PlaybookIssue[] }

export type PlaybookSaveResult =
  | { ok: true; playbook: Playbook; summary: PlaybookSummary }
  | { ok: false; error: string; issues?: PlaybookIssue[] }

export type PlaybookDeleteResult = { ok: true } | { ok: false; error: string }

export type PlaybookRunsResult = { ok: true; runs: PlaybookRun[] }

// ─── Nạp một playbook để chạy ────────────────────────────────────────────────

type Resolved = { playbook: Playbook } | { error: string; issues?: PlaybookIssue[] }

/**
 * Playbook dựng sẵn nằm trong MÃ, không trên đĩa, nên nhánh `builtin` phải rẽ
 * TRƯỚC khi chạm filesystem. Cùng một id ở hai tier là hai playbook khác nhau, nên
 * `source` luôn là một phần của khoá — không bao giờ suy ra từ kết quả dò.
 */
async function resolvePlaybook(
  source: PlaybookSource,
  projectId: string | undefined,
  id: string,
): Promise<Resolved> {
  if (source === 'builtin') {
    const pb = builtinPlaybook(id)
    return pb ? { playbook: pb } : { error: 'playbook.error.notFound' }
  }
  const parsed = await readPlaybook(source, projectId, id)
  if (!parsed) return { error: 'playbook.error.notFound' }
  if (!parsed.ok) return { error: 'playbook.error.invalid', issues: parsed.issues }
  return { playbook: parsed.playbook }
}

// ─── Quản lý playbook ────────────────────────────────────────────────────────

register('infra.playbook-list', async (raw): Promise<PlaybookListResult> => {
  const p = z
    .object({ projectIds: z.array(z.string().min(1).max(200)).max(50).default([]) })
    .parse(raw)
  const builtins = BUILTIN_PLAYBOOKS.map((pb) => summarizePlaybook(pb, 'builtin'))
  return { ok: true, playbooks: [...builtins, ...(await listPlaybooks(p.projectIds))] }
})

register('infra.playbook-read', async (raw): Promise<PlaybookReadResult> => {
  const p = Scope.parse(raw)
  const resolved = await resolvePlaybook(p.source, p.projectId, p.id)
  if ('error' in resolved) {
    return {
      ok: false,
      error: resolved.error,
      ...(resolved.issues !== undefined ? { issues: resolved.issues } : {}),
    }
  }
  return {
    ok: true,
    playbook: resolved.playbook,
    summary: summarizePlaybook(resolved.playbook, p.source, p.projectId),
  }
})

register('infra.playbook-save', async (raw): Promise<PlaybookSaveResult> => {
  const p = z
    .object({ source: WRITABLE_SOURCE, projectId: ProjectId, id: Id, draft: PlaybookDraftSchema })
    .parse(raw)

  // Kiểm cấu trúc Ở ĐÂY để lỗi người-dùng-viết-sai ra về dưới dạng
  // `{ ok: false, issues }` thay vì một ngoại lệ (xem quy ước đầu file).
  // `savePlaybook` chạy lại đúng hai phép kiểm này và ném — nó không thể ném ở lượt
  // gọi này, vì ta vừa đi qua cửa đó. Luật ROLLBACK thì CỐ Ý không kiểm ở đây: một
  // bản nháp còn thiếu bước quay lui phải lưu được để còn sửa (nó chỉ bị chặn lúc
  // `submit`).
  const tier = p.source === 'project' ? 'project' : 'global'
  const issues = validatePlaybook(
    buildPlaybook(p.draft, { id: p.id, tier, updatedAt: new Date().toISOString() }),
  )
  if (issues.length > 0) return { ok: false, error: 'playbook.error.invalid', issues }

  const saved = await savePlaybook({
    source: p.source,
    ...(p.projectId !== undefined ? { projectId: p.projectId } : {}),
    id: p.id,
    draft: p.draft,
  })
  return { ok: true, playbook: saved, summary: summarizePlaybook(saved, p.source, p.projectId) }
})

register('infra.playbook-delete', async (raw): Promise<PlaybookDeleteResult> => {
  const p = Scope.parse(raw)
  if (p.source === 'builtin') return { ok: false, error: 'playbook.error.builtinReadOnly' }
  await deletePlaybook(p.source, p.projectId, p.id)
  return { ok: true }
})

// ─── Vòng đời một lượt chạy ──────────────────────────────────────────────────
//
// Đây là các lượt gọi DUY NHẤT trong nhóm này có thể trả về shape bị chặn của §2.

register('infra.playbook-preflight', async (raw): Promise<PreflightResult> => {
  const p = RunScope.parse(raw)
  const resolved = await resolvePlaybook(p.source, p.projectId, p.id)
  if ('error' in resolved) {
    return {
      ok: false,
      blocked: false,
      error: resolved.error,
      checks: [],
      ...(resolved.issues !== undefined ? { issues: resolved.issues } : {}),
    }
  }

  const values = resolveVariables(resolved.playbook.variables, p.values)
  if (!values.ok) {
    return {
      ok: false,
      blocked: false,
      error: values.issues.length > 0 ? 'playbook.error.invalid' : 'playbook.error.missingValue',
      checks: [],
      issues: values.issues,
    }
  }

  return runPreflight({
    playbook: resolved.playbook,
    values: values.values,
    context: p.context,
    ...(p.approvalTicket !== undefined ? { approvalTicket: p.approvalTicket } : {}),
  })
})

register('infra.playbook-submit', async (raw): Promise<SubmitResult> => {
  const p = RunScope.parse(raw)
  const resolved = await resolvePlaybook(p.source, p.projectId, p.id)
  if ('error' in resolved) {
    return {
      ok: false,
      blocked: false,
      error: resolved.error,
      ...(resolved.issues !== undefined ? { issues: resolved.issues } : {}),
    }
  }
  return submitPlaybook({
    playbook: resolved.playbook,
    source: p.source,
    ...(p.projectId !== undefined ? { projectId: p.projectId } : {}),
    values: p.values,
    context: p.context,
    ...(p.approvalTicket !== undefined ? { approvalTicket: p.approvalTicket } : {}),
  })
})

register('infra.playbook-approve', async (raw): Promise<ApproveResult> => {
  const p = z.object({ runId: RunId, approvedBy: z.string().max(200).optional() }).parse(raw)
  return approveRun(p.runId, p.approvedBy)
})

register('infra.playbook-run', async (raw): Promise<RunPlaybookResult> => {
  const p = z.object({ runId: RunId, approvalTicket: ApprovalTicket }).parse(raw)
  return runPlaybook(p.runId, p.approvalTicket)
})

register('infra.playbook-rollback', async (raw): Promise<RollbackPlaybookResult> => {
  const p = z.object({ runId: RunId, approvalTicket: ApprovalTicket }).parse(raw)
  return rollbackPlaybook(p.runId, p.approvalTicket)
})

register('infra.playbook-runs', async (raw): Promise<PlaybookRunsResult> => {
  const p = z
    .object({
      playbookId: z.string().min(1).max(64).optional(),
      limit: z.number().int().min(1).max(MAX_RUNS_LIMIT).default(DEFAULT_RUNS_LIMIT),
    })
    .parse(raw)
  return { ok: true, runs: await listRuns({ playbookId: p.playbookId, limit: p.limit }) }
})
