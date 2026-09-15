// Thin typed wrapper around the Mốc 2 `infra.logs-*` RPCs (CloudWatch Logs +
// Insights). Mirrors useAwsProfilesApi.ts: one function per method, types matching
// the FROZEN contract the sidecar registers — không tự đổi tên/shape.
//
// LUẬT CỦA BỀ MẶT NÀY. Ba hàm ĐẦU TIÊN trong danh sách gọi-mạng đều TỐN TIỀN
// (Insights tính theo GB quét). Không hàm nào ở đây được gọi từ `onMounted`,
// `watch`, hay "nền cho tiện" — mỗi lời gọi phải đứng sau một cú bấm. Đây là
// ràng buộc của `infra.tasks.md` (2.6), không phải một lời khuyên.
import { useSidecar } from './useSidecar'

// ── infra.logs-groups ────────────────────────────────────────────────────────
export type AwsLogGroup = {
  name: string
  arn: string
  /** Byte đang lưu — cơ sở của ước lượng GB trước khi chạy. */
  storedBytes: number
  retentionDays: number | null
  createdAt: number | null
}

export type AwsLogsGroupsResult =
  | { ok: true; groups: AwsLogGroup[]; nextToken: string | null }
  | { ok: false; error: string }

// ── infra.logs-estimate ──────────────────────────────────────────────────────
export type AwsLogsEstimate = {
  ok: true
  bytes: number
  usd: number
  /** `history` = số ĐO của lần chạy trước cùng câu lệnh; `stored` = trần trên. */
  basis: 'history' | 'stored'
  groupCount: number
}
export type AwsLogsEstimateResult = AwsLogsEstimate | { ok: false; error: string }

// ── infra.logs-query-start / -status / -cancel ───────────────────────────────
export type AwsInsightsStatus =
  | 'Scheduled'
  | 'Running'
  | 'Complete'
  | 'Failed'
  | 'Cancelled'
  | 'Timeout'
  | 'Unknown'

export type AwsInsightsRow = Record<string, string>

export type AwsLogsStartResult = { ok: true; queryId: string } | { ok: false; error: string }

export type AwsLogsPollOk = {
  ok: true
  status: AwsInsightsStatus
  rows: AwsInsightsRow[]
  /** Byte THẬT đã quét — con số quyết định hoá đơn. */
  bytesScanned: number
  recordsMatched: number
  recordsScanned: number
}
export type AwsLogsPollResult = AwsLogsPollOk | { ok: false; error: string }

// ── infra.logs-library ───────────────────────────────────────────────────────
export type AwsLogsTemplate = {
  id: string
  /** Câu Insights. KHÔNG dịch: cú pháp là của AWS. Tiêu đề dịch nằm ở i18n. */
  query: string
  windowSeconds: number
}

export type AwsSavedQuery = {
  id: string
  name: string
  query: string
  logGroups: string[]
  windowSeconds: number
  savedAt: string
  /** Số đo của lần chạy gần nhất — cơ sở ước lượng GB lần sau. */
  lastBytesScanned?: number
}

export type AwsLogsHistoryEntry = {
  id: string
  query: string
  logGroups: string[]
  windowSeconds: number
  ranAt: string
  bytesScanned: number
  estimatedUsd?: number
  recordsMatched: number
  status: string
}

export type AwsLogsLibraryResult = {
  ok: true
  templates: AwsLogsTemplate[]
  saved: AwsSavedQuery[]
  history: AwsLogsHistoryEntry[]
}

export type AwsLogsSaveParams = {
  name: string
  query: string
  logGroups: string[]
  windowSeconds: number
  /** Có ⇒ ghi đè câu cùng id thay vì tạo bản thứ hai trùng tên. */
  id?: string
}

export function useAwsLogsApi() {
  const sidecar = useSidecar()
  return {
    groups: (params: {
      profile?: string
      region?: string
      prefix?: string
      pattern?: string
      limit?: number
      nextToken?: string
    }) => sidecar.request<AwsLogsGroupsResult>('infra.logs-groups', params),

    // Ước lượng GB quét. RẺ (chỉ đọc metadata) nhưng vẫn là một lời gọi CLI —
    // gọi khi người dùng đổi câu lệnh/khoảng thời gian, không gọi trên mỗi phím.
    estimate: (params: {
      logGroups: string[]
      query?: string
      profile?: string
      region?: string
    }) => sidecar.request<AwsLogsEstimateResult>('infra.logs-estimate', params),

    start: (params: {
      logGroups: string[]
      query: string
      startMs: number
      endMs: number
      limit?: number
      estimatedUsd?: number
      profile?: string
      region?: string
    }) => sidecar.request<AwsLogsStartResult>('infra.logs-query-start', params),

    status: (queryId: string, profile?: string, region?: string) =>
      sidecar.request<AwsLogsPollResult>('infra.logs-query-status', {
        queryId,
        ...(profile !== undefined ? { profile } : {}),
        ...(region !== undefined ? { region } : {}),
      }),

    // Huỷ THẬT (`logs stop-query`), không chỉ ngừng hỏi: truy vấn chưa xong vẫn
    // quét và vẫn tính tiền cho tới khi AWS tự kết thúc.
    cancel: (queryId: string, profile?: string, region?: string) =>
      sidecar.request<{ ok: boolean; error?: string }>('infra.logs-query-cancel', {
        queryId,
        ...(profile !== undefined ? { profile } : {}),
        ...(region !== undefined ? { region } : {}),
      }),

    library: () => sidecar.request<AwsLogsLibraryResult>('infra.logs-library', { action: 'list' }),
    saveQuery: (params: AwsLogsSaveParams) =>
      sidecar.request<{ ok: true; saved: AwsSavedQuery }>('infra.logs-library', {
        action: 'save',
        ...params,
      }),
    deleteQuery: (id: string) =>
      sidecar.request<{ ok: true; removed: boolean }>('infra.logs-library', {
        action: 'delete',
        id,
      }),
    clearHistory: () =>
      sidecar.request<{ ok: true; removed: number }>('infra.logs-library', {
        action: 'clear-history',
      }),
  }
}
