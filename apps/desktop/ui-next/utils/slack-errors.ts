import { SidecarError, sidecarErrorText } from '~/composables/useSidecar'

// Lỗi Slack (docs/features/slack-threads.md) → câu cho người đọc.
//
// Sidecar ném `RpcError -32040` với `data.slackCode` (mã Slack gốc như `missing_scope`,
// `ratelimited`… hoặc mã tự đặt `not_connected`, `thread_not_tracked`…) và `data.needed`
// khi thiếu scope. Mã nào có câu i18n `slack.error.<code>` thì dùng câu đó; không có thì
// lùi về message thô của sidecar. Tách khỏi store vì store chỉ giữ dữ liệu + gọi RPC —
// đổi lỗi thành chữ là việc của lớp hiển thị.

export const SLACK_ERROR_CODE = -32040

export function slackErrorCode(err: unknown): { code: string | null; needed: string | null } {
  if (!(err instanceof SidecarError) || err.code !== SLACK_ERROR_CODE)
    return { code: null, needed: null }
  const data = (err.data ?? {}) as { slackCode?: unknown; needed?: unknown }
  return {
    code: typeof data.slackCode === 'string' ? data.slackCode : null,
    needed: typeof data.needed === 'string' ? data.needed : null,
  }
}

// Mã cho biết nguồn Slack hỏng (token, scope) — banner trạng thái cần đọc lại.
export const SLACK_AUTH_CODES: ReadonlySet<string> = new Set([
  'not_connected',
  'workspace_not_connected',
  'source_not_found',
  'invalid_auth',
  'token_revoked',
  'token_expired',
  'missing_scope',
])

// Main (electron/src/slack-files.ts) từ chối mở file ngoài allowlist chỉ-xem bằng Error
// có message `slack_open_blocked:<lý do>` (`type` | `executable`). Qua IPC chỉ còn
// message nên dò theo tiền tố.
const OPEN_BLOCKED_PREFIX = 'slack_open_blocked:'

export function isSlackOpenBlocked(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return msg.includes(OPEN_BLOCKED_PREFIX)
}

export function describeSlackError(
  err: unknown,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const { code, needed } = slackErrorCode(err)
  if (code) {
    const key = `slack.error.${code}`
    const text = t(key, { needed: needed ?? '' })
    if (text !== key) return text
  }
  return sidecarErrorText(err)
}
