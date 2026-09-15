// Vỏ mỏng kiểu-hoá quanh các RPC của Mốc 3 (Explorer + Nhật ký + phiên bong bóng).
// Khuôn `useAwsLogsApi.ts`: một hàm cho một method, kiểu khớp HỢP ĐỒNG đã đóng
// băng ở sidecar — không tự đổi tên, không tự đổi hình dạng.
//
// LUẬT CỦA BỀ MẶT NÀY. `list`/`detail`/`action` đều là GỌI AWS THẬT: `list` tốn
// một lời gọi API, `detail` tốn một lời gọi NỮA cho mỗi dòng, `action` có thể
// ĐỔI tài nguyên. Vì vậy không hàm nào ở đây được gọi từ `onMounted`/`watch` —
// mỗi lời gọi phải đứng sau một cú bấm (spec: "Không auto-refresh").
//
// `probe` thì ngược lại: nó là hai lệnh ĐỌC rẻ và nó phải chạy khi mở view, nếu
// không thì task 3.3 không có gì để ẩn. Ngoại lệ này là có chủ đích và chỉ áp cho
// đúng một hàm.
import { useSidecar } from './useSidecar'

// ── Hình dạng dùng chung ─────────────────────────────────────────────────────

export type InfraColumn = {
  key: string
  label: string
  align?: 'left' | 'right'
  width?: string
  wide?: boolean
}

export type InfraResourceRow = Record<string, string>

export type InfraFormField = {
  key: string
  label: string
  placeholder?: string
  required?: boolean
}

export type InfraActionDescriptor = {
  id: string
  label: string
  consequence: string
  danger: boolean
  confirm: 'none' | 'simple' | 'type-name'
  /**
   * Hành động IAM mà lệnh này cần (vd `ec2:TerminateInstances`), `null` khi view
   * chưa khai. Đây là thứ duy nhất cho phép `actionDenied()` ẩn ĐÚNG nút — đoán
   * theo chuỗi id là đoán mò, và đoán sai thì hoặc giấu nút người dùng có quyền,
   * hoặc hiện nút chắc chắn `AccessDenied`.
   */
  iam: string | null
  /**
   * Ô nhập thêm của hành động (Mốc 4). Rỗng = bấm là chạy. Có phần tử = UI mở
   * form với ngữ cảnh của dòng đã có, người dùng điền rồi mới gọi.
   */
  fields: readonly InfraFormField[]
  /**
   * Hành động chỉ ĐIỀU HƯỚNG: mở view con với tham số lấy từ dòng (`values` ánh
   * xạ `tên tham số` → `khoá trên dòng`). Không có lệnh nào được chạy, nên UI
   * KHÔNG gọi RPC cho hành động này.
   */
  opensView: { viewId: string; values: Readonly<Record<string, string>> } | null
}

export type InfraFormDescriptor = InfraActionDescriptor & {
  typeNameField: string | null
  fields: readonly InfraFormField[]
}

export type InfraViewDescriptor = {
  id: string
  service: string
  label: string
  about: string
  /** Cảnh báo luôn hiện khi mở view (khoá i18n); `null` = không có. */
  notice: string | null
  support: 'full' | 'list'
  columns: { simple: readonly InfraColumn[]; full: readonly InfraColumn[] }
  required: readonly InfraFormField[]
  hasDetail: boolean
  hasConsole: boolean
  canProbe: boolean
  actions: readonly InfraActionDescriptor[]
  forms: readonly InfraFormDescriptor[]
}

export type InfraCatalogService = {
  id: string
  group: string
  label: string
  about: string
  level: 'full' | 'list' | 'console'
  target:
    | { kind: 'view'; viewId: string }
    | { kind: 'tab'; tab: 'logs' | 'kubernetes' | 'accounts' | 'overview' }
    | { kind: 'console'; url: string }
  consoleUrl: string | null
}

export type InfraExplorerCatalog = {
  views: InfraViewDescriptor[]
  groups: string[]
  services: InfraCatalogService[]
  defaultPinned: string[]
}

/** Ngữ cảnh AWS đi kèm mọi lời gọi — sidecar chèn nó vào argv, UI không tự thêm cờ. */
export type InfraAwsContext = {
  profile?: string
  region?: string
  accountId?: string
}

/** Cổng quyền đã chặn kèm vé để gọi lại sau khi người dùng duyệt. */
export type InfraBlocked = {
  ok: false
  blocked: true
  requiresApproval: boolean
  approvalTicket?: string
  command: string
  reason: string
  class: string
  /** Do `accountKindOf()` của sidecar trả về — hộp duyệt đổi màu theo nó. */
  accountKind: 'normal' | 'production'
  mode: 'auto' | 'ask' | 'block'
}

export type InfraFailed = {
  ok: false
  blocked: false
  error: string
  missing: string[]
}

export type InfraListResult =
  | { ok: true; rows: InfraResourceRow[]; nextToken: string | null; command: string }
  | InfraBlocked
  | InfraFailed

export type InfraDetailResult =
  | { ok: true; json: string; command: string }
  | InfraBlocked
  | InfraFailed

export type InfraActionResult =
  | { ok: true; command: string; stdout: string; filePath: string | null }
  | InfraBlocked
  | InfraFailed

export type InfraVerdict = 'allowed' | 'denied' | 'unknown'

export type InfraProbeResult = { verdict: InfraVerdict; deniedActions: string[] }

// ── Nhật ký hoạt động ────────────────────────────────────────────────────────

export type InfraAuditEntry = {
  at: string
  actor: string
  sessionId?: string
  messageId?: string
  surface: string
  tool: string
  argv: string[]
  context: {
    profile?: string
    accountId?: string
    region?: string
    cluster?: string
    namespace?: string
    workspace?: string
  }
  class: 'read' | 'write' | 'destructive' | 'context-switch'
  decision: 'auto' | 'approved' | 'denied' | 'blocked' | 'bypass-temp'
  result: { exitCode?: number; durationMs?: number; bytesScanned?: number; summary?: string }
  cost?: { estimatedUsd?: number }
  truncated?: boolean
}

export type InfraAuditSummary = {
  total: number
  byClass: Record<string, number>
  byDecision: Record<string, number>
  estimatedUsd: number
}

export type InfraAuditFilter = {
  since?: string
  until?: string
  actor?: string
  class?: 'read' | 'write' | 'destructive' | 'context-switch'
  decision?: 'auto' | 'approved' | 'denied' | 'blocked' | 'bypass-temp'
  contains?: string
}

export type InfraCleanResult =
  | { ok: true; removed: number }
  | { ok: false; reason: 'confirm' | 'changed'; total?: number }

export type InfraExportResult = {
  ok: true
  filename: string
  count: number
  text: string
}

export type InfraBubbleWorkspace = {
  ok: true
  path: string
  name: string
  created: boolean
  parent: string
}

// ── API ──────────────────────────────────────────────────────────────────────

export function useInfraResourcesApi() {
  const sc = useSidecar()

  return {
    /** Metadata tĩnh: view + danh mục Dịch vụ. Không chạy CLI, không đọc đĩa. */
    catalog(region: string): Promise<InfraExplorerCatalog> {
      return sc.request<InfraExplorerCatalog>('infra.explorer-catalog', { region })
    },

    list(params: {
      viewId: string
      values?: Record<string, string>
      token?: string
      context: InfraAwsContext
      approvalTicket?: string
    }): Promise<InfraListResult> {
      return sc.request<InfraListResult>('infra.resource-list', {
        viewId: params.viewId,
        values: params.values ?? {},
        ...(params.token !== undefined ? { token: params.token } : {}),
        context: params.context,
        surface: 'explorer',
        ...(params.approvalTicket !== undefined ? { approvalTicket: params.approvalTicket } : {}),
      })
    },

    detail(params: {
      viewId: string
      row: InfraResourceRow
      context: InfraAwsContext
      approvalTicket?: string
    }): Promise<InfraDetailResult> {
      return sc.request<InfraDetailResult>('infra.resource-detail', {
        viewId: params.viewId,
        row: params.row,
        context: params.context,
        surface: 'explorer',
        ...(params.approvalTicket !== undefined ? { approvalTicket: params.approvalTicket } : {}),
      })
    },

    action(params: {
      viewId: string
      actionId: string
      row?: InfraResourceRow
      values?: Record<string, string>
      context: InfraAwsContext
      approvalTicket?: string
    }): Promise<InfraActionResult> {
      return sc.request<InfraActionResult>('infra.resource-action', {
        viewId: params.viewId,
        actionId: params.actionId,
        row: params.row ?? {},
        values: params.values ?? {},
        context: params.context,
        surface: 'explorer',
        ...(params.approvalTicket !== undefined ? { approvalTicket: params.approvalTicket } : {}),
      })
    },

    /** Dò quyền ghi (task 3.3). Hai lệnh ĐỌC — hàm DUY NHẤT được gọi lúc mở view. */
    probe(params: { viewId: string; context: InfraAwsContext }): Promise<InfraProbeResult> {
      return sc.request<InfraProbeResult>('infra.resource-probe', {
        viewId: params.viewId,
        context: params.context,
        surface: 'explorer',
      })
    },

    /**
     * Deep link Console của một dòng (task 3.4). Hàm THUẦN ở sidecar (không CLI,
     * không tốn một dòng nhật ký). Sidecar tự bọc `goto` của cổng SSO khi profile
     * đăng nhập qua IAM Identity Center — renderer không biết luật đó.
     */
    consoleUrl(params: {
      viewId: string
      row: InfraResourceRow
      context: InfraAwsContext
    }): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
      return sc.request('infra.resource-console-url', {
        viewId: params.viewId,
        row: params.row,
        context: params.context,
      })
    },

    auditQuery(params: InfraAuditFilter & { limit?: number }): Promise<{
      entries: InfraAuditEntry[]
      summary: InfraAuditSummary
    }> {
      return sc.request('infra.audit-query', { ...params })
    },

    auditClean(
      params: InfraAuditFilter & {
        mode: 'filtered' | 'all'
        expectRemoved: number
        typed?: string
      },
    ): Promise<InfraCleanResult> {
      return sc.request<InfraCleanResult>('infra.audit-clean', { ...params })
    },

    auditExport(
      params: InfraAuditFilter & { format: 'csv' | 'jsonl'; limit?: number },
    ): Promise<InfraExportResult> {
      return sc.request<InfraExportResult>('infra.audit-export', { ...params })
    },

    /** Bảo đảm thư mục `awog-infra` tồn tại; trả đường dẫn tuyệt đối. */
    bubbleWorkspace(dir?: string): Promise<InfraBubbleWorkspace> {
      return sc.request<InfraBubbleWorkspace>('infra.bubble-workspace', {
        ...(dir !== undefined ? { dir } : {}),
      })
    },
  }
}
