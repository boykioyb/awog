// Vỏ mỏng kiểu-hoá quanh 10 RPC nhóm `infra.playbook-*` (Mốc 5, workstream A4 — trang
// `/playbooks`). Khuôn `useInfraCicdApi.ts`: một hàm cho một method, kiểu khớp HỢP
// ĐỒNG của sidecar (`methods/infra.playbook.ts` + `infra/playbook/{schema,runner,store}.ts`)
// — không tự đổi tên trường, không tự đổi hình dạng.
//
// VÒNG ĐỜI THEO `runId`, KHÔNG THEO `id` PLAYBOOK. `submit` TẠO bản ghi chạy (trạng
// thái `awaiting-approval`) rồi trả về `run`; `approve`/`run`/`rollback` đều nhận
// `runId`. Một playbook KHÔNG có trạng thái — trạng thái là của từng lượt chạy, nên
// đừng suy "playbook đang chờ duyệt" từ danh sách (`PlaybookSummary` không có field đó).
//
// CỔNG QUYỀN: kết quả bị chặn (§2 hợp đồng Mốc 5) đã mang `ok: false` từ sidecar
// (`runner.ts:PlaybookBlocked`), nên không cần lớp chuẩn hoá ở đây — union đã phân
// biệt được bằng `ok` + `blocked` và TypeScript thu hẹp thẳng.
import { useSidecar } from './useSidecar'
import type { InfraCommandClass, InfraContext, InfraMode, InfraTool } from '~/types'
import type { InfraAccountKind, InfraActionClass } from '~/composables/useConfirm'
import type { InfraGraph } from '~/composables/useInfraGraphApi'

// ── Playbook (hợp đồng §4 — `infra/playbook/schema.ts`) ──────────────────────

export type PlaybookKind = 'instruction' | 'deployment'
export type PlaybookVerb = 'check' | 'do' | 'verify' | 'rollback'
export type PlaybookTier = 'global' | 'project'
/** Nguồn của một playbook: hai tier trên đĩa + tier dựng sẵn CHỈ ĐỌC. */
export type PlaybookSource = 'builtin' | 'global' | 'project'

export type PlaybookStatus =
  | 'draft'
  | 'preflight'
  | 'awaiting-approval'
  | 'approved'
  | 'running'
  | 'done'
  | 'failed'
  | 'rolled-back'

export type PlaybookStep = {
  id: string
  title: string
  verb: PlaybookVerb
  tool: InfraTool
  /** MẢNG, không bao giờ là chuỗi shell; placeholder dạng `{{tên}}`. */
  args: readonly string[]
  /** Vì sao bước này tồn tại — người đọc cần, không phải trang trí. */
  note: string
}

export type PlaybookVariable = {
  name: string
  label: string
  required: boolean
  /** Giá trị dùng khi người dùng để trống. */
  default?: string
}

export type Playbook = {
  id: string
  name: string
  description: string
  kind: PlaybookKind
  tier: PlaybookTier
  variables: readonly PlaybookVariable[]
  steps: readonly PlaybookStep[]
  updatedAt: string
}

/**
 * Nháp người dùng gửi lên `-save`: thiếu `id`/`tier`/`updatedAt` vì sidecar ghép
 * chúng từ vị trí trên đĩa (`buildPlaybook`). Luật rollback CỐ Ý không bị chặn lúc
 * lưu — một bản nháp thiếu bước quay lui phải lưu được để còn sửa, nó chỉ bị chặn
 * lúc `submit`.
 */
export type PlaybookDraft = Omit<Playbook, 'id' | 'tier' | 'updatedAt'>

/** Một chỗ sai. `code` là KHOÁ i18n (UI hiện thẳng); `message` là chi tiết cho log. */
export type PlaybookIssue = { code: string; message: string; stepId?: string }

/**
 * Trạng thái của một bước trong một lượt chạy.
 *
 * `blocked` KHÁC `failed`: một bước bị cổng quyền chặn giữa đường KHÔNG làm lượt
 * chạy hỏng — bản ghi về lại `approved` và chạy tiếp được kèm vé. Gộp nó vào
 * `failed` là báo sai rằng việc đã hỏng.
 */
export type PlaybookStepRunStatus = 'pending' | 'running' | 'ok' | 'failed' | 'blocked' | 'skipped'

export type PlaybookStepRun = {
  stepId: string
  verb: PlaybookVerb
  title: string
  /** `playbook:<id>#<bước>` — cột "ai" của màn Nhật ký. */
  actor: string
  command: string
  status: PlaybookStepRunStatus
  class: InfraCommandClass
  exitCode: number | null
  durationMs: number
  reason?: string
  /** ISO lúc bước kết thúc — ghép với `actor` để nối tới dòng nhật ký. */
  at?: string
}

export type PlaybookRun = {
  id: string
  playbookId: string
  playbookName: string
  source: PlaybookSource
  projectId?: string
  /** Bản playbook ĐÃ DUYỆT — sửa file gốc sau đó không làm đổi bản ghi này. */
  playbook: Playbook
  status: PlaybookStatus
  context: InfraContext
  values: Record<string, string>
  steps: PlaybookStepRun[]
  createdAt: string
  updatedAt: string
  approvedBy?: string
  approvedAt?: string
  failedStepId?: string
  /** Đã đóng băng vào Wiki ⇒ mọi lần ghi sau bị từ chối. */
  frozen: boolean
  wikiPage?: string
  /** Vì sao không ghi được trang Wiki. Có mặt = bề mặt phụ hỏng, bản ghi vẫn xong. */
  freezeError?: string
}

/**
 * Dòng của danh sách (`store.ts:summarizePlaybook`). KHÔNG có "trạng thái": trạng
 * thái thuộc về từng lượt chạy, không thuộc playbook.
 */
export type PlaybookSummary = {
  id: string
  name: string
  description: string
  kind: PlaybookKind
  source: PlaybookSource
  tier: PlaybookTier
  projectId?: string
  updatedAt: string
  variables: PlaybookVariable[]
  stepCount: number
  checkCount: number
  doCount: number
  verifyCount: number
  rollbackCount: number
  /** Luật số một: `do` nào còn thiếu bước quay lui ⇒ KHÔNG gửi duyệt được. */
  canSubmit: boolean
  /** Id các bước `do` chưa có `rollback` tương ứng — UI hiện thẳng danh sách này. */
  missingRollback: string[]
  /** Khác rỗng khi file hỏng: UI hiện được "sai chỗ nào" thay vì bỏ qua im lặng. */
  issues: PlaybookIssue[]
}

// ── Kết quả (runner.ts) ──────────────────────────────────────────────────────

/**
 * Lượt bị cổng quyền chặn (§2 hợp đồng Mốc 5 — `runner.ts:PlaybookBlocked`).
 *
 * `requiresApproval === false` là ma trận chặn HẲN: hộp duyệt CHỈ được nói lý do +
 * nút chép lệnh, TUYỆT ĐỐI không mời người dùng duyệt lại (không có vé thì gọi lại
 * là ngõ cụt).
 */
export type PlaybookBlocked = {
  ok: false
  blocked: true
  requiresApproval: boolean
  approvalTicket?: string
  command: string
  reason: string
  class: InfraCommandClass
  accountKind: InfraAccountKind
  mode: InfraMode
  stepId: string
  stepNumber: number
}

/** Một bước `check` đã chạy trong preflight. */
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

export type PlaybookListResult = { ok: true; playbooks: PlaybookSummary[] }

export type PlaybookReadResult =
  | { ok: true; playbook: Playbook; summary: PlaybookSummary }
  | { ok: false; error: string; issues?: PlaybookIssue[] }

export type PlaybookSaveResult = PlaybookReadResult

export type PlaybookDeleteResult = { ok: true } | { ok: false; error: string }

export type PlaybookRunsResult = { ok: true; runs: PlaybookRun[] }

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

/** `approve` KHÔNG có nhánh blocked — duyệt là hành động ghi nhưng không qua cổng CLI. */
export type ApproveResult =
  | { ok: true; run: PlaybookRun }
  | { ok: false; blocked: false; error: string }

export type RollbackPlaybookResult =
  | { ok: true; run: PlaybookRun }
  | PlaybookBlocked
  | { ok: false; blocked: false; error: string; issues?: PlaybookIssue[] }

// ── Tham số ──────────────────────────────────────────────────────────────────

/**
 * Phạm vi một playbook. `source` LUÔN là một phần của khoá: cùng một id ở hai tier
 * là hai playbook khác nhau, và tier `builtin` nằm trong MÃ chứ không trên đĩa.
 */
export type PlaybookScope = { source: PlaybookSource; projectId?: string; id: string }

/**
 * Một lượt chạy. `context` có SÁU trường chứ không phải ba: playbook chạy được cả
 * terraform (`workspace`) lẫn kubectl (`cluster`/`namespace`).
 */
export type PlaybookRunParams = PlaybookScope & {
  values?: Record<string, string>
  context?: InfraContext
  approvalTicket?: string
}

// ── RPC ──────────────────────────────────────────────────────────────────────

export function usePlaybooksApi() {
  const sc = useSidecar()

  return {
    /** Đọc file cục bộ — danh sách KHÔNG nhận `context` và KHÔNG trả `notes`. */
    list: (p: { projectIds?: string[] } = {}): Promise<PlaybookListResult> =>
      sc.request<PlaybookListResult>('infra.playbook-list', p),

    read: (p: PlaybookScope): Promise<PlaybookReadResult> =>
      sc.request<PlaybookReadResult>('infra.playbook-read', p),

    save: (p: {
      source: PlaybookTier
      projectId?: string
      id: string
      draft: PlaybookDraft
    }): Promise<PlaybookSaveResult> => sc.request<PlaybookSaveResult>('infra.playbook-save', p),

    remove: (p: PlaybookScope): Promise<PlaybookDeleteResult> =>
      sc.request<PlaybookDeleteResult>('infra.playbook-delete', p),

    preflight: (p: PlaybookRunParams): Promise<PreflightResult> =>
      sc.request<PreflightResult>('infra.playbook-preflight', p),

    submit: (p: PlaybookRunParams): Promise<SubmitResult> =>
      sc.request<SubmitResult>('infra.playbook-submit', p),

    approve: (p: { runId: string; approvedBy?: string }): Promise<ApproveResult> =>
      sc.request<ApproveResult>('infra.playbook-approve', p),

    run: (p: { runId: string; approvalTicket?: string }): Promise<RunPlaybookResult> =>
      sc.request<RunPlaybookResult>('infra.playbook-run', p),

    rollback: (p: { runId: string; approvalTicket?: string }): Promise<RollbackPlaybookResult> =>
      sc.request<RollbackPlaybookResult>('infra.playbook-rollback', p),

    runs: (p: { playbookId?: string; limit?: number } = {}): Promise<PlaybookRunsResult> =>
      sc.request<PlaybookRunsResult>('infra.playbook-runs', p),
  }
}

// ── Suy dẫn thuần từ hình dạng dữ liệu ───────────────────────────────────────

/**
 * Từ khoá đánh dấu một lệnh ghi là XOÁ. Đây là phép ĐOÁN trên chính `args` (chứ
 * không phải bảng phân loại thật — bảng thật nằm ở `infra/classify.ts` của
 * sidecar), nên nó chỉ dùng để TÔ MÀU và GẮN CẢNH BÁO trên sơ đồ. Cổng quyền vẫn
 * chấm lớp lệnh theo đúng bảng của sidecar; UI không quyết định thay.
 */
const DESTRUCTIVE_HINT = /(^|\s)(delete|destroy|terminate|remove|deregister|purge|rm)(\s|$)/i

/**
 * Dịch vụ mà MỘT bước động vào — hàng 2 của sơ đồ.
 *
 * `args` là mảng và KHÔNG chứa tên binary (`tool` đã nói binary rồi), cũng không
 * chứa cờ ngữ cảnh (sidecar chèn cờ đó lúc chạy, không lưu vào bước). Nên với
 * `aws`, token không phải cờ đầu tiên CHÍNH LÀ tên dịch vụ:
 * `['ecs','update-service','--desired-count','4'] → 'ecs'`.
 *
 * `terraform`/`kubectl` không có khái niệm "dịch vụ AWS" — trả về chính tên tool,
 * vì đó đúng là thứ nó chạm, không phải suy đoán.
 */
export function stepServices(step: PlaybookStep): string[] {
  if (step.tool !== 'aws') return [step.tool]
  const head = step.args.find((a) => a !== '' && !a.startsWith('-'))
  return head ? [head] : []
}

export function stepClass(step: PlaybookStep): InfraActionClass {
  // Hai trong bốn verb là ĐỌC (check/verify) — chúng không bao giờ chạm gì.
  if (step.verb === 'check' || step.verb === 'verify') return 'read'
  return DESTRUCTIVE_HINT.test(step.args.join(' ')) ? 'destructive' : 'write'
}

/** Một node bị ảnh hưởng lan — hàng 3 của sơ đồ. */
export type PlaybookImpactNode = {
  id: string
  label: string
  service: string
  /** Đường suy ra nó có cạnh `inferred` (hoặc node `external`) ⇒ UI vẽ nét đứt. */
  inferred: boolean
}

/**
 * Ảnh hưởng lan: từ những node thuộc `services` bị chạm, đi NGƯỢC chiều cạnh
 * (cạnh `from → to` nghĩa là `from` phụ thuộc `to`) để gom những thứ chết theo —
 * đúng câu hỏi *"đụng vào cái này thì ai chết theo"*.
 *
 * KHÔNG bịa: chỉ trả về node CÓ trong graph và đi tới được bằng cạnh CÓ trong graph.
 * Không node nào khớp ⇒ mảng rỗng, và UI nói "không suy được" chứ không vẽ bừa.
 *
 * `InfraGraph` là type của workstream graph (`useInfraGraphApi.ts`) — nguồn dựng
 * graph là MỘT, nên hình dạng dây của `infra.graph-*` cũng chỉ có một bản khai.
 */
export function buildImpact(graph: InfraGraph, services: readonly string[]): PlaybookImpactNode[] {
  if (services.length === 0) return []
  const wanted = new Set(services.map((s) => s.toLowerCase()))
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))

  // reverse[to] = những cạnh trỏ TỚI nó, tức những thứ phụ thuộc nó.
  const reverse = new Map<string, { from: string; inferred: boolean }[]>()
  for (const e of graph.edges) {
    const list = reverse.get(e.to)
    if (list) list.push({ from: e.from, inferred: e.inferred })
    else reverse.set(e.to, [{ from: e.from, inferred: e.inferred }])
  }

  const seen = new Set<string>()
  const queue: { id: string; inferred: boolean }[] = []
  for (const n of graph.nodes) {
    if (n.kind !== 'service' || !wanted.has(n.service.toLowerCase()) || seen.has(n.id)) continue
    seen.add(n.id)
    queue.push({ id: n.id, inferred: n.inferred })
  }

  const out: PlaybookImpactNode[] = []
  while (queue.length > 0) {
    const cur = queue.shift()
    if (!cur) break
    for (const edge of reverse.get(cur.id) ?? []) {
      if (seen.has(edge.from)) continue
      seen.add(edge.from)
      const node = byId.get(edge.from)
      if (!node) continue
      const inferred = cur.inferred || edge.inferred || node.inferred
      out.push({ id: node.id, label: node.label, service: node.service, inferred })
      queue.push({ id: node.id, inferred })
    }
  }
  return out
}
