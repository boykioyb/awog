// Runner playbook: `check → preflight → do → verify → rollback`, tất cả qua CỔNG
// QUYỀN DÙNG CHUNG (`infra/gated.ts`).
//
// BỐN TÍNH CHẤT LÀ HÀNG RÀO, KHÔNG PHẢI TIỆN ÍCH:
//   1. LUẬT ROLLBACK cưỡng chế Ở ĐÂY (`submit`), không phải gợi ý ở UI. Một bước
//      `do` không có bước quay lui thì không có đường nào tới `awaiting-approval`.
//   2. PREFLIGHT chạy HẾT mọi bước `check` TRƯỚC khi bất kỳ bước `do` nào chạy —
//      biết bước 3 sẽ hỏng vì thiếu quyền, thay vì phát hiện lúc đã làm xong 1–2.
//      `submit` chạy preflight TRƯỚC khi tạo bản ghi chạy, nên không có bản ghi
//      rác nào khi tiền đề chưa đủ.
//   3. MỌI bước ghi đi qua `runGated` với `actor: playbook:<id>#<bước>`. Playbook
//      KHÔNG phải đường vòng để chạy lệnh không bị ghi nhật ký, cũng không phải
//      đường vòng để bỏ qua ma trận quyền.
//   4. HỒ SƠ SAU KHI CHẠY LÀ BẤT BIẾN. Bản ghi sửa được trong lúc chạy; tới trạng
//      thái cuối (`done` / `rolled-back`) nó bị ĐÓNG BĂNG: ghi thêm một trang Wiki
//      (`mode: 'create'` ⇒ trùng đường dẫn là LỖI) và từ đó `persistRun` từ chối
//      mọi lần ghi. Muốn đổi thì chạy một bản mới, bản cũ còn nguyên để đối chiếu.
//
// BẢN GHI CHẠY CHỤP LẠI PLAYBOOK LÚC GỬI DUYỆT. Sửa file playbook sau khi duyệt
// không làm đổi thứ đã duyệt — câu "duyệt bản nào" phải trả lời được.

import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { log } from '../../util/logger.js'
import { RpcError } from '../../transport/rpc.js'
import { awogHome, sanitizeChild } from '../../util/path.js'
import { saveWikiPage } from '../../wiki/store.js'
import { recordInfraAction } from '../audit/store.js'
import { runGated } from '../gated.js'
import { infraAuditContext } from '../run.js'
import {
  ERROR_MISSING_ROLLBACK,
  PLAYBOOK_SOURCES,
  PLAYBOOK_STATUSES,
  PLAYBOOK_VERBS,
  PlaybookSchema,
  interpolateArgs,
  missingRollbackSteps,
  resolveVariables,
  rollbackPlan,
  stepActor,
  stepsOfVerb,
  validatePlaybook,
} from './schema.js'
import type { InfraAccountKind, InfraMode } from '../policy.js'
import type { InfraCommandClass } from '../types.js'
import type { InfraContext } from '../run.js'
import type { Playbook, PlaybookIssue, PlaybookSource, PlaybookStatus, PlaybookStep, PlaybookVerb } from './schema.js'

const RUNS_DIR = sanitizeChild('playbook-runs')
const MAX_RUNS = 500

// ─── Kết quả bị cổng chặn (hợp đồng §2) ──────────────────────────────────────

/**
 * Đúng shape §2 của hợp đồng Mốc 5 — graph và playbook trả về CÙNG shape này khi
 * bị cổng chặn, để UI dùng một hộp duyệt duy nhất.
 *
 * `stepId`/`stepNumber` là phần THÊM của riêng playbook: hợp đồng §2 không có chỗ
 * nói "bước nào bị chặn", mà một hộp duyệt không chỉ được dòng thì người dùng
 * phải tự đoán mình đang duyệt việc gì.
 */
export type PlaybookBlocked = {
  ok: false
  blocked: true
  /** UI mở hộp duyệt rồi gọi lại kèm vé; `false` = ma trận chặn hẳn, đừng mời lại. */
  requiresApproval: boolean
  approvalTicket?: string | undefined
  command: string
  reason: string
  class: InfraCommandClass
  accountKind: InfraAccountKind
  mode: InfraMode
  stepId: string
  stepNumber: number
}

// ─── Bản ghi chạy ────────────────────────────────────────────────────────────

export const STEP_RUN_STATUSES = ['pending', 'running', 'ok', 'failed', 'blocked', 'skipped'] as const
export type StepRunStatus = (typeof STEP_RUN_STATUSES)[number]

export type PlaybookStepRun = {
  stepId: string
  verb: PlaybookVerb
  title: string
  /** `playbook:<id>#<bước>` — cột "ai" của màn Nhật ký. */
  actor: string
  command: string
  status: StepRunStatus
  class: InfraCommandClass
  exitCode: number | null
  durationMs: number
  reason?: string | undefined
  /** ISO lúc bước kết thúc — ghép với `actor` để nối tới dòng nhật ký. */
  at?: string | undefined
}

export type PlaybookRun = {
  id: string
  playbookId: string
  playbookName: string
  source: PlaybookSource
  projectId?: string | undefined
  /** Bản playbook ĐÃ DUYỆT — sửa file gốc sau đó không đổi được bản ghi này. */
  playbook: Playbook
  status: PlaybookStatus
  context: InfraContext
  values: Record<string, string>
  steps: PlaybookStepRun[]
  createdAt: string
  updatedAt: string
  approvedBy?: string | undefined
  approvedAt?: string | undefined
  failedStepId?: string | undefined
  /** Đã đóng băng vào Wiki ⇒ mọi lần ghi sau bị từ chối. */
  frozen: boolean
  wikiPage?: string | undefined
  /** Vì sao không ghi được trang Wiki. Có mặt = bề mặt phụ hỏng, bản ghi vẫn xong. */
  freezeError?: string | undefined
}

// ─── Đọc lại bản ghi: file này là dữ liệu L1 ─────────────────────────────────
//
// `~/.awog/playbook-runs/*.json` nằm trong thư mục người dùng sửa được, mà thứ
// trong đó CHÍNH LÀ các lệnh sắp được spawn. Nên đọc lại phải qua schema y như
// một file playbook — cùng luật "validate ở biên" của `.claude/rules/security.md`.
// Cổng quyền vẫn là hàng rào thật (mọi bước đi qua `runGated`), nhưng một bản ghi
// méo mó phải hỏng thành "run not found" chứ không thành một lỗi TypeError ở giữa
// vòng lặp spawn.
const RunContextSchema = z.object({
  profile: z.string().max(200).optional(),
  region: z.string().max(64).optional(),
  accountId: z.string().max(64).optional(),
  cluster: z.string().max(200).optional(),
  namespace: z.string().max(200).optional(),
  workspace: z.string().max(500).optional(),
})

const StepRunSchema = z.object({
  stepId: z.string().min(1).max(64),
  verb: z.enum(PLAYBOOK_VERBS),
  title: z.string().max(200),
  actor: z.string().min(1).max(200),
  command: z.string().max(4096),
  status: z.enum(STEP_RUN_STATUSES),
  class: z.enum(['read', 'write', 'destructive', 'context-switch']),
  exitCode: z.number().int().nullable(),
  durationMs: z.number().nonnegative(),
  reason: z.string().max(4096).optional(),
  at: z.string().max(64).optional(),
})

const PlaybookRunSchema = z.object({
  id: z.string().min(1).max(200),
  playbookId: z.string().min(1).max(64),
  playbookName: z.string().max(200),
  source: z.enum(PLAYBOOK_SOURCES),
  projectId: z.string().max(200).optional(),
  playbook: PlaybookSchema,
  status: z.enum(PLAYBOOK_STATUSES),
  context: RunContextSchema,
  values: z.record(z.string(), z.string()),
  steps: z.array(StepRunSchema),
  createdAt: z.string().min(1).max(64),
  updatedAt: z.string().min(1).max(64),
  approvedBy: z.string().max(200).optional(),
  approvedAt: z.string().max(64).optional(),
  failedStepId: z.string().max(64).optional(),
  frozen: z.boolean(),
  wikiPage: z.string().max(400).optional(),
  freezeError: z.string().max(2000).optional(),
})

// ─── Lưu bản ghi ─────────────────────────────────────────────────────────────

function runsDir(): string {
  return join(awogHome(), RUNS_DIR)
}

function runFile(id: string): string {
  return join(runsDir(), `${sanitizeChild(id)}.json`)
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

async function writeRunFile(run: PlaybookRun): Promise<void> {
  await mkdir(runsDir(), { recursive: true, mode: 0o700 })
  const file = runFile(run.id)
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(run, null, 2), 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

/** Bất biến: bản ghi đã đóng băng thì không sửa được nữa (spec, phần bảo mật). */
function assertMutable(run: PlaybookRun): void {
  if (run.frozen) throw new RpcError(-32602, `Playbook run is frozen: ${run.id}`)
}

function persistRun(run: PlaybookRun): Promise<void> {
  assertMutable(run)
  return writeRunFile(run)
}

export async function loadRun(id: string): Promise<PlaybookRun | null> {
  let raw: string
  try {
    raw = await readFile(runFile(id), 'utf8')
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    log.warn('playbooks: run record is not JSON', {
      id,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
  const res = PlaybookRunSchema.safeParse(parsed)
  if (!res.success) {
    log.warn('playbooks: run record failed its schema', {
      id,
      why: res.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join(','),
    })
    return null
  }
  return res.data
}

export async function listRuns(
  opts: { playbookId?: string | undefined; limit?: number | undefined } = {},
): Promise<PlaybookRun[]> {
  let names: string[]
  try {
    names = await readdir(runsDir())
  } catch (err) {
    if (!isMissing(err)) {
      log.warn('playbooks: readdir runs failed', {
        err: err instanceof Error ? err.message : String(err),
      })
    }
    return []
  }

  const runs: PlaybookRun[] = []
  for (const name of names) {
    if (runs.length >= MAX_RUNS) break
    if (!name.endsWith('.json')) continue
    // eslint-disable-next-line no-await-in-loop
    const run = await loadRun(name.slice(0, -5))
    if (!run) continue
    if (opts.playbookId !== undefined && run.playbookId !== opts.playbookId) continue
    runs.push(run)
  }
  runs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  const limit = Math.min(Math.max(1, Math.trunc(opts.limit ?? 100)), MAX_RUNS)
  return runs.slice(0, limit)
}

// ─── Gọi cổng ────────────────────────────────────────────────────────────────

type GateOutcome =
  | {
      kind: 'ran'
      ok: boolean
      command: string
      class: InfraCommandClass
      exitCode: number | null
      durationMs: number
      reason: string
    }
  | { kind: 'blocked'; blocked: PlaybookBlocked }
  | { kind: 'invalid'; issues: PlaybookIssue[] }

async function gateStep(input: {
  playbook: Playbook
  step: PlaybookStep
  number: number
  values: Record<string, string>
  context: InfraContext
  approvalTicket?: string | undefined
}): Promise<GateOutcome> {
  const interpolated = interpolateArgs(input.step.args, input.values, input.step.id)
  if (!interpolated.ok) return { kind: 'invalid', issues: interpolated.issues }

  const gated = await runGated({
    tool: input.step.tool,
    args: interpolated.args,
    context: input.context,
    surface: 'playbook',
    toolName: 'infra_playbook',
    actor: stepActor(input.playbook.id, input.number),
    ...(input.approvalTicket !== undefined ? { approvalTicket: input.approvalTicket } : {}),
  })

  if (gated.blocked) {
    return {
      kind: 'blocked',
      blocked: {
        ok: false,
        blocked: true,
        requiresApproval: gated.requiresApproval,
        ...(gated.approvalTicket !== undefined ? { approvalTicket: gated.approvalTicket } : {}),
        command: gated.command,
        reason: gated.reason,
        class: gated.class,
        accountKind: gated.accountKind,
        mode: gated.mode,
        stepId: input.step.id,
        stepNumber: input.number,
      },
    }
  }

  return {
    kind: 'ran',
    ok: gated.result.ok,
    command: gated.command,
    class: gated.class,
    exitCode: gated.result.exitCode,
    durationMs: gated.result.durationMs,
    reason: (gated.result.stderr.trim() || gated.result.stdout.trim()).slice(0, 400),
  }
}

function actorOf(playbook: Playbook, number: number): string {
  return stepActor(playbook.id, number)
}

function stepRun(input: {
  step: PlaybookStep
  number: number
  playbook: Playbook
  outcome: Extract<GateOutcome, { kind: 'ran' }>
}): PlaybookStepRun {
  return {
    stepId: input.step.id,
    verb: input.step.verb,
    title: input.step.title,
    actor: actorOf(input.playbook, input.number),
    command: input.outcome.command,
    status: input.outcome.ok ? 'ok' : 'failed',
    class: input.outcome.class,
    exitCode: input.outcome.exitCode,
    durationMs: input.outcome.durationMs,
    ...(input.outcome.ok ? {} : { reason: input.outcome.reason }),
    at: new Date().toISOString(),
  }
}

/**
 * Dấu "đang chạy" ghi XUỐNG ĐĨA trước khi spawn.
 *
 * Không có nó thì một lần thoát app giữa bước để lại bản ghi y như chưa hề chạy
 * bước đó, và lượt chạy tiếp theo sẽ lặng lẽ chạy lại một lệnh không idempotent
 * (`aws s3api create-bucket` lần hai là lỗi, nhưng `acm request-certificate` lần
 * hai là một chứng chỉ mới). Có nó thì `runPlaybook` biết mình đang đứng ở đâu.
 */
function runningStep(step: PlaybookStep, number: number, playbook: Playbook): PlaybookStepRun {
  return {
    stepId: step.id,
    verb: step.verb,
    title: step.title,
    actor: actorOf(playbook, number),
    command: `${step.tool} ${step.args.join(' ')}`,
    status: 'running',
    class: 'read',
    exitCode: null,
    durationMs: 0,
  }
}

function blockedStep(
  step: PlaybookStep,
  number: number,
  playbook: Playbook,
  blocked: PlaybookBlocked,
): PlaybookStepRun {
  return {
    stepId: step.id,
    verb: step.verb,
    title: step.title,
    actor: actorOf(playbook, number),
    command: blocked.command,
    status: 'blocked',
    class: blocked.class,
    exitCode: null,
    durationMs: 0,
    reason: blocked.reason,
    at: new Date().toISOString(),
  }
}

function upsertStep(run: PlaybookRun, entry: PlaybookStepRun): void {
  const index = run.steps.findIndex((s) => s.stepId === entry.stepId)
  if (index === -1) run.steps.push(entry)
  else run.steps[index] = entry
}

function stepOk(run: PlaybookRun, stepId: string): boolean {
  return run.steps.some((s) => s.stepId === stepId && s.status === 'ok')
}

function inFlight(run: PlaybookRun): PlaybookStepRun | undefined {
  return run.steps.find((s) => s.status === 'running')
}

// ─── Preflight ───────────────────────────────────────────────────────────────

export type PlaybookCheckResult = {
  stepId: string
  title: string
  ok: boolean
  command: string
  class: InfraCommandClass
  exitCode: number | null
  actor: string
  reason?: string
}

export type PreflightResult =
  | { ok: true; checks: PlaybookCheckResult[] }
  | {
      ok: false
      blocked: false
      error: string
      failedStepId?: string
      checks: PlaybookCheckResult[]
      issues?: PlaybookIssue[]
    }
  | PlaybookBlocked

/**
 * Chạy TOÀN BỘ bước `check`, dừng ở bước hỏng đầu tiên và nói rõ bước nào.
 *
 * Hàm này là chỗ DUY NHẤT biết thứ tự "check trước, do sau", và `submit` gọi nó
 * trước khi tạo bản ghi chạy — nên không có đường nào chạy `do` trước khi `check`
 * xong. Một vé duyệt truyền vào được dùng cho bước ĐẦU TIÊN cần nó rồi tiêu hết
 * (vé gắn vân tay của đúng một lời gọi).
 */
export async function runPreflight(input: {
  playbook: Playbook
  values: Record<string, string>
  context: InfraContext
  approvalTicket?: string | undefined
}): Promise<PreflightResult> {
  const checks = stepsOfVerb(input.playbook, 'check')
  const results: PlaybookCheckResult[] = []
  let ticket = input.approvalTicket

  for (let i = 0; i < checks.length; i++) {
    const step = checks[i]
    const number = i + 1
    // eslint-disable-next-line no-await-in-loop
    const outcome = await gateStep({
      playbook: input.playbook,
      step,
      number,
      values: input.values,
      context: input.context,
      ...(ticket !== undefined ? { approvalTicket: ticket } : {}),
    })
    ticket = undefined

    if (outcome.kind === 'invalid') {
      return { ok: false, blocked: false, error: 'playbook.error.invalid', issues: outcome.issues, checks: results }
    }
    if (outcome.kind === 'blocked') return outcome.blocked

    const entry: PlaybookCheckResult = {
      stepId: step.id,
      title: step.title,
      ok: outcome.ok,
      command: outcome.command,
      class: outcome.class,
      exitCode: outcome.exitCode,
      actor: actorOf(input.playbook, number),
    }
    if (!outcome.ok) entry.reason = outcome.reason
    results.push(entry)

    if (!outcome.ok) {
      return {
        ok: false,
        blocked: false,
        error: 'playbook.error.preflightFailed',
        failedStepId: step.id,
        checks: results,
      }
    }
  }

  return { ok: true, checks: results }
}

// ─── Gửi duyệt ───────────────────────────────────────────────────────────────

export type SubmitInput = {
  playbook: Playbook
  source: PlaybookSource
  projectId?: string | undefined
  values: Record<string, string>
  context: InfraContext
  approvalTicket?: string | undefined
}

export type SubmitResult =
  | { ok: true; run: PlaybookRun }
  | PlaybookBlocked
  | {
      ok: false
      blocked: false
      error: string
      issues?: PlaybookIssue[]
      missing?: string[]
      missingRollback?: string[]
      failedStepId?: string
      checks?: PlaybookCheckResult[]
    }

/**
 * Tạo một bản ghi chạy ở trạng thái `awaiting-approval`.
 *
 * Thứ tự kiểm là CÓ CHỦ Ý: luật rollback đứng TRƯỚC preflight, nên một playbook
 * thiếu bước quay lui bị từ chối mà không chạy một lệnh nào — trả lời "không được
 * gửi duyệt" không cần tốn một lượt gọi AWS nào.
 */
export async function submitPlaybook(input: SubmitInput): Promise<SubmitResult> {
  const structural = validatePlaybook(input.playbook)
  if (structural.length > 0) {
    return { ok: false, blocked: false, error: 'playbook.error.invalid', issues: structural }
  }

  const missingRollback = missingRollbackSteps(input.playbook)
  if (missingRollback.length > 0) {
    return {
      ok: false,
      blocked: false,
      error: ERROR_MISSING_ROLLBACK,
      missingRollback: missingRollback.map((s) => s.id),
    }
  }

  const resolved = resolveVariables(input.playbook.variables, input.values)
  if (!resolved.ok) {
    return {
      ok: false,
      blocked: false,
      error: resolved.issues.length > 0 ? 'playbook.error.invalid' : 'playbook.error.missingValue',
      missing: resolved.missing,
      issues: resolved.issues,
    }
  }

  const preflight = await runPreflight({
    playbook: input.playbook,
    values: resolved.values,
    context: input.context,
    ...(input.approvalTicket !== undefined ? { approvalTicket: input.approvalTicket } : {}),
  })
  if (preflight.ok === false && preflight.blocked === true) return preflight
  if (!preflight.ok) {
    return {
      ok: false,
      blocked: false,
      error: preflight.error,
      ...(preflight.failedStepId !== undefined ? { failedStepId: preflight.failedStepId } : {}),
      ...(preflight.issues !== undefined ? { issues: preflight.issues } : {}),
      checks: preflight.checks,
    }
  }

  const now = new Date().toISOString()
  const run: PlaybookRun = {
    id: randomUUID(),
    playbookId: input.playbook.id,
    playbookName: input.playbook.name,
    source: input.source,
    ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
    playbook: input.playbook,
    status: 'awaiting-approval',
    context: input.context,
    values: resolved.values,
    // Preflight đã chạy xong nên phần `check` có sẵn trong bản ghi; `do`/`verify`/
    // `rollback` được thêm vào đúng lúc chúng chạy.
    steps: preflight.checks.map((c) => ({
      stepId: c.stepId,
      verb: 'check' as const,
      title: c.title,
      actor: c.actor,
      command: c.command,
      status: 'ok' as const,
      class: c.class,
      exitCode: c.exitCode,
      durationMs: 0,
      at: now,
    })),
    createdAt: now,
    updatedAt: now,
    frozen: false,
  }
  await persistRun(run)
  return { ok: true, run }
}

// ─── Duyệt ───────────────────────────────────────────────────────────────────

export type ApproveResult = { ok: true; run: PlaybookRun } | { ok: false; blocked: false; error: string }

/**
 * Duyệt là một HÀNH ĐỘNG GHI, nên nó vào nhật ký: ai duyệt, bản nào, lúc nào.
 *
 * Nhật ký ghi TRƯỚC khi đổi trạng thái — nếu không ghi được thì bản duyệt không
 * tồn tại, chứ không phải tồn tại mà không ai biết.
 */
export async function approveRun(
  runId: string,
  approvedBy?: string | undefined,
): Promise<ApproveResult> {
  const run = await loadRun(runId)
  if (!run) return { ok: false, blocked: false, error: 'playbook.error.runNotFound' }
  assertMutable(run)
  if (run.status !== 'awaiting-approval') {
    return { ok: false, blocked: false, error: 'playbook.error.wrongStatus' }
  }

  await recordInfraAction({
    actor: 'human',
    surface: 'playbook',
    tool: 'infra_playbook',
    argv: ['playbook', 'approve', run.playbookId, run.id],
    context: infraAuditContext(run.context),
    class: 'write',
    decision: 'approved',
    result: { summary: `approved run ${run.id} of playbook ${run.playbookId}` },
  })

  const now = new Date().toISOString()
  run.status = 'approved'
  run.approvedAt = now
  if (approvedBy !== undefined) run.approvedBy = approvedBy
  run.updatedAt = now
  await persistRun(run)
  return { ok: true, run }
}

// ─── Chạy ────────────────────────────────────────────────────────────────────

export type RunPlaybookResult =
  | { ok: true; run: PlaybookRun }
  | PlaybookBlocked
  | {
      ok: false
      blocked: false
      error: string
      issues?: PlaybookIssue[]
      /** Có mặt khi lỗi gắn với một bước cụ thể (bước chạy dở, tham số sai). */
      stepId?: string
      verb?: PlaybookVerb
    }

/**
 * Chạy các bước `do` (kèm `verify` tương ứng) của một bản ghi ĐÃ DUYỆT.
 *
 * Gọi lại cùng `runId` = CHẠY TIẾP: bước đã `ok` bị bỏ qua, nên một bước cần
 * duyệt giữa đường không phải chạy lại từ đầu. Vé duyệt chỉ áp cho bước ĐẦU TIÊN
 * được thử trong lượt này — vé gắn vân tay của đúng một lời gọi.
 *
 * Bước chạy DỞ thì từ chối chạy tiếp (xem `playbook.error.stepInFlight`): lệnh
 * hạ tầng không idempotent, nên "chạy lại cho chắc" là cách tạo ra tài nguyên thứ
 * hai. Đường đi tiếp là `rollback` — nó nhận trạng thái `running` chính vì lý do
 * này.
 */
export async function runPlaybook(
  runId: string,
  approvalTicket?: string | undefined,
): Promise<RunPlaybookResult> {
  const run = await loadRun(runId)
  if (!run) return { ok: false, blocked: false, error: 'playbook.error.runNotFound' }
  assertMutable(run)

  const unfinished = inFlight(run)
  if (unfinished) {
    return {
      ok: false,
      blocked: false,
      error: 'playbook.error.stepInFlight',
      stepId: unfinished.stepId,
      verb: unfinished.verb,
    }
  }
  if (run.status !== 'approved' && run.status !== 'running') {
    return { ok: false, blocked: false, error: 'playbook.error.wrongStatus' }
  }

  const dos = stepsOfVerb(run.playbook, 'do')
  run.status = 'running'
  run.updatedAt = new Date().toISOString()
  await persistRun(run)

  let ticket = approvalTicket
  for (let i = 0; i < dos.length; i++) {
    const doStep = dos[i]
    if (stepOk(run, doStep.id)) continue
    const number = i + 1

    // Dấu "đang chạy" xuống đĩa TRƯỚC khi spawn — xem `runningStep`.
    upsertStep(run, runningStep(doStep, number, run.playbook))
    run.updatedAt = new Date().toISOString()
    await persistRun(run)

    // eslint-disable-next-line no-await-in-loop
    const outcome = await gateStep({
      playbook: run.playbook,
      step: doStep,
      number,
      values: run.values,
      context: run.context,
      ...(ticket !== undefined ? { approvalTicket: ticket } : {}),
    })
    ticket = undefined

    if (outcome.kind === 'invalid') {
      run.status = 'failed'
      run.failedStepId = doStep.id
      run.updatedAt = new Date().toISOString()
      await persistRun(run)
      return {
        ok: false,
        blocked: false,
        error: 'playbook.error.invalid',
        issues: outcome.issues,
        stepId: doStep.id,
      }
    }
    if (outcome.kind === 'blocked') {
      upsertStep(run, blockedStep(doStep, number, run.playbook, outcome.blocked))
      // Về `approved` để lượt gọi sau (kèm vé) chạy tiếp được — bản ghi không kẹt.
      run.status = 'approved'
      run.updatedAt = new Date().toISOString()
      await persistRun(run)
      return outcome.blocked
    }

    upsertStep(run, stepRun({ step: doStep, number, playbook: run.playbook, outcome }))
    if (!outcome.ok) {
      run.status = 'failed'
      run.failedStepId = doStep.id
      run.updatedAt = new Date().toISOString()
      await persistRun(run)
      return { ok: true, run }
    }

    const verify = stepsOfVerb(run.playbook, 'verify')[i]
    if (verify !== undefined) {
      // eslint-disable-next-line no-await-in-loop
      const checked = await gateStep({
        playbook: run.playbook,
        step: verify,
        number,
        values: run.values,
        context: run.context,
      })
      if (checked.kind === 'invalid') {
        run.status = 'failed'
        run.failedStepId = verify.id
        run.updatedAt = new Date().toISOString()
        await persistRun(run)
        return { ok: true, run }
      }
      if (checked.kind === 'blocked') {
        upsertStep(run, blockedStep(verify, number, run.playbook, checked.blocked))
        run.status = 'approved'
        run.updatedAt = new Date().toISOString()
        await persistRun(run)
        return checked.blocked
      }
      upsertStep(run, stepRun({ step: verify, number, playbook: run.playbook, outcome: checked }))
      if (!checked.ok) {
        // Không tin exit code của `do`: `do` xong mà `verify` hỏng nghĩa là kết quả
        // CHƯA đạt, nên playbook dừng ở đây chứ không nhảy sang bước sau.
        run.status = 'failed'
        run.failedStepId = verify.id
        run.updatedAt = new Date().toISOString()
        await persistRun(run)
        return { ok: true, run }
      }
    }
  }

  run.status = 'done'
  run.updatedAt = new Date().toISOString()
  await freezeRun(run)
  return { ok: true, run }
}

// ─── Quay lui ────────────────────────────────────────────────────────────────

export type RollbackPlaybookResult =
  | { ok: true; run: PlaybookRun }
  | PlaybookBlocked
  | { ok: false; blocked: false; error: string; issues?: PlaybookIssue[] }

/**
 * Chạy kế hoạch quay lui DỰNG NGƯỢC từ chính khai báo của các bước `do` đã chạy
 * thành công — soạn sẵn lúc rảnh, không phải nghĩ lúc đang cháy.
 *
 * Dừng ở bước quay lui hỏng đầu tiên: chạy tiếp sau một lần hoàn tác thất bại là
 * làm hỏng thêm thứ đang định cứu.
 *
 * KHÁC `runPlaybook` ở chỗ KHÔNG từ chối bước chạy dở: đây đã là đường hồi phục,
 * chặn nó thì bản ghi kẹt vĩnh viễn mà không còn lối nào khác.
 */
export async function rollbackPlaybook(
  runId: string,
  approvalTicket?: string | undefined,
): Promise<RollbackPlaybookResult> {
  const run = await loadRun(runId)
  if (!run) return { ok: false, blocked: false, error: 'playbook.error.runNotFound' }
  assertMutable(run)
  if (run.status !== 'failed' && run.status !== 'running') {
    return { ok: false, blocked: false, error: 'playbook.error.wrongStatus' }
  }

  const executed = stepsOfVerb(run.playbook, 'do')
    .filter((s) => stepOk(run, s.id))
    .map((s) => s.id)
  if (executed.length === 0) {
    return { ok: false, blocked: false, error: 'playbook.error.nothingToRollback' }
  }

  const rollbacks = stepsOfVerb(run.playbook, 'rollback')
  const { plan } = rollbackPlan(run.playbook, executed)
  let ticket = approvalTicket

  for (const step of plan) {
    if (stepOk(run, step.id)) continue
    const number = rollbacks.findIndex((r) => r.id === step.id) + 1

    upsertStep(run, runningStep(step, number, run.playbook))
    run.updatedAt = new Date().toISOString()
    await persistRun(run)

    // eslint-disable-next-line no-await-in-loop
    const outcome = await gateStep({
      playbook: run.playbook,
      step,
      number,
      values: run.values,
      context: run.context,
      ...(ticket !== undefined ? { approvalTicket: ticket } : {}),
    })
    ticket = undefined

    if (outcome.kind === 'invalid') {
      return { ok: false, blocked: false, error: 'playbook.error.invalid', issues: outcome.issues }
    }
    if (outcome.kind === 'blocked') {
      upsertStep(run, blockedStep(step, number, run.playbook, outcome.blocked))
      run.updatedAt = new Date().toISOString()
      await persistRun(run)
      return outcome.blocked
    }

    upsertStep(run, stepRun({ step, number, playbook: run.playbook, outcome }))
    if (!outcome.ok) {
      run.failedStepId = step.id
      run.updatedAt = new Date().toISOString()
      await persistRun(run)
      return { ok: true, run }
    }
  }

  run.status = 'rolled-back'
  run.updatedAt = new Date().toISOString()
  await freezeRun(run)
  return { ok: true, run }
}

// ─── Đóng băng vào Wiki ──────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${String(ms)}ms`
}

const VERDICT: Record<StepRunStatus, string> = {
  pending: 'chưa chạy',
  running: 'đang chạy',
  ok: 'xong',
  failed: 'HỎNG',
  blocked: 'bị chặn',
  skipped: 'bỏ qua',
}

function runMarkdown(run: PlaybookRun): string {
  const lines = [
    '| Bước | Việc | Lệnh | Kết quả | Mất | Ai bảo |',
    '|---|---|---|---|---|---|',
  ]
  for (const step of run.steps) {
    lines.push(
      `| ${step.stepId} | ${step.title} | \`${step.command}\` | ${VERDICT[step.status]} | ` +
        `${fmtDuration(step.durationMs)} | \`${step.actor}\` |`,
    )
  }
  return [
    '',
    `- **Bản playbook:** \`${run.playbookId}\` (nguồn: ${run.source})`,
    `- **Trạng thái:** \`${run.status}\``,
    `- **Người duyệt:** ${run.approvedBy ?? '(không ghi nhận tên)'} lúc ${run.approvedAt ?? '(không rõ)'}`,
    `- **Ngữ cảnh:** profile ${run.context.profile ?? '(mặc định)'} · region ${run.context.region ?? '(mặc định)'}`,
    '',
    'Bản ghi này là **ảnh chụp bất biến**: sửa playbook sau đó không làm đổi nó.',
    'Đối chiếu với nhật ký hoạt động bằng cách lọc theo cột `Ai bảo`.',
    '',
    ...lines,
    '',
  ].join('\n')
}

/**
 * Ghi hồ sơ vào Wiki rồi khoá bản ghi.
 *
 * `mode: 'create'` chính là hàng rào bất biến: trùng đường dẫn là LỖI, nên không
 * lượt nào lặng lẽ đè lên hồ sơ đã đóng băng của lượt trước.
 *
 * Kho JSON của lượt chạy là nguồn CHÍNH và đã ghi xong trước khi tới đây; trang
 * Wiki là bề mặt phụ. Hỏng ở đây không nuốt lỗi — nó được ghi vào `freezeError`
 * để UI nói được "hồ sơ chưa vào Wiki", thay vì báo thành công sai.
 */
async function freezeRun(run: PlaybookRun): Promise<void> {
  const path = `playbooks/${run.playbookId}-${run.id}`
  run.wikiPage = path
  try {
    await saveWikiPage({
      source: run.projectId !== undefined ? 'project' : 'global',
      ...(run.projectId !== undefined ? { projectId: run.projectId } : {}),
      path,
      title: `Hồ sơ chạy: ${run.playbookName} (${run.status})`,
      description: `Ảnh chụp bất biến của playbook ${run.playbookId}, trạng thái ${run.status}.`,
      tags: ['playbook', run.playbookId],
      body: runMarkdown(run),
      mode: 'create',
    })
  } catch (err) {
    run.freezeError = err instanceof Error ? err.message : String(err)
    log.warn('playbooks: freezing the run into the wiki failed', {
      runId: run.id,
      err: run.freezeError,
    })
  }
  run.frozen = true
  await writeRunFile(run)
}
