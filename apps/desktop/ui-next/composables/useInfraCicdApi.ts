// Vỏ mỏng kiểu-hoá quanh bốn RPC của màn Triển khai (Mốc 4).
// Khuôn `useInfraResourcesApi.ts`: một hàm cho một method, kiểu khớp HỢP ĐỒNG đã
// đóng băng ở sidecar — không tự đổi tên, không tự đổi hình dạng.
//
// LUẬT CỦA BỀ MẶT NÀY: `list` là lời gọi ĐẮT (mỗi nguồn AWS tốn nhiều tiến trình
// `aws`, mỗi dự án GitHub tốn một `gh run list`), `log` là lời gọi ĐẮT NHẤT. Không
// hàm nào ở đây được gọi từ `onMounted`/`watch` — mỗi lời gọi đứng sau một cú bấm
// (spec: "Không auto-refresh").
import { useSidecar } from './useSidecar'

export type CicdSource = 'github' | 'codepipeline' | 'codebuild' | 'amplify'

export type CicdStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'unknown'

export type CicdRun = {
  id: string
  source: CicdSource
  project: string
  title: string
  branch: string
  commit: string
  status: CicdStatus
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  actor: string
  url: string | null
  stepName: string | null
  needsApproval: boolean
  ref: Record<string, string>
}

export type CicdStep = {
  id: string
  name: string
  status: CicdStatus
  startedAt: string | null
  durationMs: number | null
  group: string
  /** Có mặt khi log của bước nằm ở CloudWatch Logs (CodeBuild). */
  logRef: { group: string; stream: string | null } | null
  /** Link log công khai (Amplify) — mở bằng trình duyệt. */
  logUrl: string | null
}

export type CicdArtifact = { name: string; url: string | null; sizeBytes: number | null }

export type CicdPullRequest = { number: number; title: string; url: string; repo: string }

export type CicdApproval = { id: string; label: string }

export type CicdRunDetail = {
  run: CicdRun
  steps: CicdStep[]
  artifacts: CicdArtifact[]
  pr: CicdPullRequest | null
  /** CHỈ TÊN biến môi trường — không bao giờ có giá trị. */
  envNames: string[]
  approvals: CicdApproval[]
}

/** Cổng quyền chặn: UI mở hộp duyệt rồi gọi lại ĐÚNG payload kèm vé này. */
export type CicdBlocked = {
  blocked: true
  requiresApproval: boolean
  approvalTicket?: string
  command: string
  reason: string
  class: string
  accountKind: string
  mode: string
}

/**
 * Hình dạng THÔ trên dây: lượt bị cổng chặn không mang trường `ok` (sidecar trả
 * `{blocked: true, …}`). Giữ đúng sự thật đó ở đây rồi chuẩn hoá ngay tại `outcome()`
 * — kiểu công khai bên dưới phải phân biệt được bằng `ok`, nếu không thì mỗi chỗ đọc
 * kết quả lại phải tự đoán, và TypeScript không thu hẹp được union.
 */
type WireOutcome<T> =
  | { ok: true; value: T }
  | (CicdBlocked & { ok?: false })
  | { ok: false; blocked: false; error: string }

/** Ba kết cục, ba nhánh phân biệt được bằng `ok` và `blocked`. */
export type CicdOutcome<T> =
  | { ok: true; value: T }
  | (CicdBlocked & { ok: false })
  | { ok: false; blocked: false; error: string }

/** `blocked` thô (`ok` vắng mặt) → `ok: false`. Mọi lời gọi đi qua đây. */
function outcome<T>(res: WireOutcome<T>): CicdOutcome<T> {
  if (res.ok) return res
  return res.blocked ? { ...res, ok: false } : res
}

export type CicdSourceResult = {
  source: CicdSource
  runs: CicdRun[]
  error: string | null
  /** Khoá i18n dạng `key|a|b` khi nguồn bị cắt bớt. */
  note: string | null
  blocked: (Omit<CicdBlocked, 'blocked'> & { requiresApproval: boolean }) | null
}

export type CicdLogValue = {
  lines: string[]
  command: string
  totalLines: number
  truncated: boolean
}

export type CicdWorkflow = { name: string; path: string; state: string }

export type CicdProjectRef = { projectId: string; repoPath?: string; account?: string }

export type CicdRunsParams = {
  sources: CicdSource[]
  projects: CicdProjectRef[]
  branch?: string
  limit?: number
  context: { profile?: string; region?: string; accountId?: string }
  tickets?: Partial<Record<CicdSource, string>>
}

export type CicdRefParams = {
  source: CicdSource
  ref: Record<string, string>
  context: { profile?: string; region?: string; accountId?: string }
  approvalTicket?: string
}

export function useInfraCicdApi() {
  const sc = useSidecar()

  return {
    list: (p: CicdRunsParams): Promise<{ results: CicdSourceResult[] }> =>
      sc.request<{ results: CicdSourceResult[] }>('infra.cicd-runs', p),

    detail: async (p: CicdRefParams): Promise<CicdOutcome<CicdRunDetail>> =>
      outcome(await sc.request<WireOutcome<CicdRunDetail>>('infra.cicd-run', p)),

    log: async (p: CicdRefParams & { stepId: string }): Promise<CicdOutcome<CicdLogValue>> =>
      outcome(await sc.request<WireOutcome<CicdLogValue>>('infra.cicd-log', p)),

    action: (
      p: CicdRefParams & {
        kind: 'rerun' | 'cancel' | 'dispatch' | 'approve'
        failedOnly?: boolean
        workflow?: string
        gitRef?: string
        inputs?: { key: string; value: string }[]
        approve?: boolean
        summary?: string
      },
    ): Promise<CicdOutcome<string>> =>
      sc.request<WireOutcome<string>>('infra.cicd-action', p).then(outcome),

    workflows: async (p: CicdProjectRef): Promise<CicdOutcome<CicdWorkflow[]>> =>
      outcome(await sc.request<WireOutcome<CicdWorkflow[]>>('infra.cicd-workflows', p)),
  }
}
