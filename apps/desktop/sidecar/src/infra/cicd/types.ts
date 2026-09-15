// Kiểu dùng chung của màn Triển khai (Mốc 4, task 4.2–4.6).
//
// BỐN NGUỒN, MỘT HÌNH DẠNG. GitHub Actions · CodePipeline · CodeBuild · Amplify
// nói bốn ngôn ngữ khác nhau (status/conclusion/execution status/build status/job
// status) nhưng câu hỏi của người dùng chỉ có một: "bản triển khai này ổn không,
// hỏng ở bước nào". Nên mọi nguồn được dịch về CÙNG một `CicdRun` TRƯỚC khi lên
// UI — dịch ở tầng dữ liệu thì bảng, bộ lọc và thông báo chỉ viết một lần.
//
// KHÔNG có trường nào chứa giá trị secret. `envNames` chỉ có TÊN biến môi trường
// của pipeline (task 4.4: "Chỉ tên, không giá trị").

export const CICD_SOURCES = ['github', 'codepipeline', 'codebuild', 'amplify'] as const
export type CicdSource = (typeof CICD_SOURCES)[number]

/**
 * Trạng thái đã quy về một thang. `waiting` là ca riêng chứ không phải `running`:
 * một pipeline đang CHỜ NGƯỜI DUYỆT không tự tiến tiếp, nên gộp nó vào "đang
 * chạy" là giấu đi thứ duy nhất người dùng cần bấm lúc đó.
 */
export const CICD_STATUSES = [
  'queued',
  'running',
  'waiting',
  'success',
  'failed',
  'cancelled',
  'skipped',
  'unknown',
] as const
export type CicdStatus = (typeof CICD_STATUSES)[number]

/** Trạng thái coi là "còn đang chạy" (dùng cho nhịp làm mới và cho thông báo). */
export const CICD_LIVE: ReadonlySet<CicdStatus> = new Set<CicdStatus>([
  'queued',
  'running',
  'waiting',
])

export type CicdRun = {
  /** Khoá ổn định giữa các lần poll: dùng để biết "lần chạy NÀY vừa hỏng". */
  id: string
  source: CicdSource
  /** Dự án/pipeline/app mà người dùng nhận ra ("shop-api", "infra", "shop-web"). */
  project: string
  /** Tên workflow/stage — dòng chính của bảng. */
  title: string
  branch: string
  commit: string
  status: CicdStatus
  /** ISO; rỗng khi nguồn không nói (Amplify chỉ có `lastDeployTime`). */
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  actor: string
  url: string | null
  /** Bước đang hỏng/đang chờ — sidecar suy, UI không tự đoán từ log. */
  stepName: string | null
  /** Đang chờ một người bấm duyệt (CodePipeline approval / environment rule). */
  needsApproval: boolean
  /** Con trỏ để mở chi tiết — hình dạng theo từng nguồn, xem `ref` của mỗi file. */
  ref: Record<string, string>
}

export type CicdStep = {
  id: string
  name: string
  status: CicdStatus
  startedAt: string | null
  durationMs: number | null
  /** Ai/cái gì chạy bước này (GitHub: tên job) — rỗng nếu nguồn không có. */
  group: string
  /**
   * Nguồn log của bước khi nó nằm ở CloudWatch Logs (CodeBuild): tên log group +
   * stream để UI GIEO câu truy vấn sang tab Logs đã có, thay vì dựng một viewer
   * thứ hai. `null` khi bước không có log (hoặc log ở nơi khác — xem `logUrl`).
   */
  logRef: { group: string; stream: string | null } | null
  /** Link log công khai của nguồn (Amplify) — mở bằng trình duyệt, không tải về. */
  logUrl: string | null
}

export type CicdArtifact = {
  name: string
  /** Trang tải artifact; null khi nguồn không có URL công khai. */
  url: string | null
  sizeBytes: number | null
}

export type CicdPullRequest = {
  number: number
  title: string
  url: string
  /** owner/repo — để UI mở đúng tab PR của dự án tương ứng. */
  repo: string
}

export type CicdApproval = {
  /** Id môi trường (GitHub) hoặc tên stage/action (CodePipeline). */
  id: string
  label: string
}

export type CicdRunDetail = {
  run: CicdRun
  steps: readonly CicdStep[]
  artifacts: readonly CicdArtifact[]
  pr: CicdPullRequest | null
  /** CHỈ TÊN biến môi trường của pipeline. Không bao giờ có giá trị. */
  envNames: readonly string[]
  /** Việc đang chờ người bấm, nếu có. */
  approvals: readonly CicdApproval[]
}

/**
 * Cổng quyền chặn một nguồn ngay lúc NẠP BẢNG — dạng UI cần để mở hộp duyệt rồi
 * gọi lại kèm `approvalTicket`. Chỉ xảy ra khi ma trận siết nhịp ĐỌC (mặc định
 * thì đọc chạy thẳng), nhưng im lặng bỏ nguồn đó là giấu dữ liệu người dùng đang
 * hỏi, nên nó phải là một trạng thái nhìn thấy được.
 */
export type CicdSourceBlocked = {
  requiresApproval: boolean
  /** Có mặt khi `requiresApproval` — vé do sidecar phát, không phải UI khai. */
  approvalTicket?: string
  command: string
  reason: string
  class: string
  /** `accountKind` là kết quả của sidecar; UI chỉ đổi màu theo nó. */
  accountKind: string
  mode: string
}

/** Kết quả một nguồn khi nạp bảng: hỏng MỘT nguồn không được làm trắng cả bảng. */
export type CicdSourceResult = {
  source: CicdSource
  runs: readonly CicdRun[]
  /** Câu lỗi đã lọc token; có mặt nghĩa là nguồn này KHÔNG đọc được. */
  error: string | null
  /** Câu nói rõ nguồn này bị cắt bớt (vd chỉ đọc 10 pipeline đầu). */
  note: string | null
  /** Nguồn bị cổng quyền chặn (chưa có vé / ma trận chặn hẳn). */
  blocked: CicdSourceBlocked | null
}

// ─── Đổi trạng thái của từng nguồn về thang chung ────────────────────────────

/** GitHub Actions: cặp (status, conclusion). */
export function githubStatus(status: string, conclusion: string | null): CicdStatus {
  if (status === 'completed') {
    switch ((conclusion ?? '').toLowerCase()) {
      case 'success':
        return 'success'
      case 'failure':
      case 'timed_out':
      case 'startup_failure':
        return 'failed'
      case 'cancelled':
        return 'cancelled'
      case 'skipped':
        return 'skipped'
      case 'action_required':
        return 'waiting'
      case 'neutral':
        return 'unknown'
      default:
        return 'unknown'
    }
  }
  if (status === 'in_progress') return 'running'
  if (status === 'queued' || status === 'requested' || status === 'pending' || status === 'waiting') {
    return 'queued'
  }
  return 'unknown'
}

/** CodePipeline: `status` của một pipeline execution. */
export function pipelineStatus(status: string): CicdStatus {
  switch (status) {
    case 'Succeeded':
      return 'success'
    case 'Failed':
      return 'failed'
    case 'Stopped':
      return 'cancelled'
    case 'Stopping':
      return 'running'
    case 'Superseded':
      return 'cancelled'
    case 'InProgress':
      return 'running'
    default:
      return 'unknown'
  }
}

/** CodeBuild: `buildStatus`. */
export function codebuildStatus(status: string): CicdStatus {
  switch (status) {
    case 'SUCCEEDED':
      return 'success'
    case 'FAILED':
    case 'FAULT':
    case 'TIMED_OUT':
      return 'failed'
    case 'STOPPED':
      return 'cancelled'
    case 'IN_PROGRESS':
      return 'running'
    case 'QUEUED':
      return 'queued'
    default:
      return 'unknown'
  }
}

/** Amplify Hosting: `jobSummary.status`. */
export function amplifyStatus(status: string): CicdStatus {
  switch (status) {
    case 'SUCCEED':
      return 'success'
    case 'FAILED':
      return 'failed'
    case 'CANCELLED':
      return 'cancelled'
    case 'RUNNING':
    case 'CREATE_IN_PROGRESS':
      return 'running'
    case 'PENDING':
      return 'queued'
    default:
      return 'unknown'
  }
}

/** Khoảng thời gian giữa hai mốc ISO (null nếu thiếu/không hợp lệ/âm). */
export function spanMs(from: string, to: string | null): number | null {
  if (!from || !to) return null
  const a = Date.parse(from)
  const b = Date.parse(to)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null
  return b - a
}
