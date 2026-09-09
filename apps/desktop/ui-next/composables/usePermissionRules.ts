// Trang Settings → Quyền: xem, thu hồi và gợi ý luật quyền (ADR 0080 — F10 +
// #40 của lượt infosec).
//
// Toàn bộ state + IPC của trang nằm ở đây; component chỉ bind (page-controller
// pattern). Composable KHÔNG tự quyết định gì về luật: nội dung luật luôn do
// sidecar cấp, UI chỉ gửi lại khoá (chuỗi nguyên văn khi xoá, id gợi ý khi
// thêm) — nếu UI được phép soạn nội dung luật thì một payload dựng tay ghi
// thẳng được `Bash(*)` vào file luật, đúng lỗ hổng mà ADR 0080 vá.
import { computed, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
// Tầng + loại luật đã có định nghĩa ở thẻ xin quyền trong phiên — dùng lại,
// không khai bản thứ hai (hai bản trùng tên còn phá auto-import của Nuxt).
import type {
  PermissionRuleKind,
  PermissionRuleScope,
} from '~/composables/useSessionPermissionRule'

export type PermissionRuleAction = 'allow' | 'deny'

export type PermissionRuleRow = {
  scope: PermissionRuleScope
  // Nguyên văn chuỗi luật trên đĩa — vừa là thứ hiện cho người đọc, vừa là khoá
  // gửi lại khi xoá.
  rule: string
  action: PermissionRuleAction
  // false ⇒ entry không parse được nên đang KHÔNG có hiệu lực (chỉ hiện để xoá).
  active: boolean
  toolName?: string
  kind?: PermissionRuleKind
  createdAt?: string
  file?: string
  projectId?: string
  projectName?: string
  sessionId?: string
  sessionTitle?: string
}

export type PermissionRuleFileError = {
  scope: PermissionRuleScope
  file: string
  reason: string
  projectId?: string
  projectName?: string
}

export type PermissionRuleSuggestion = {
  id: string
  rule: string
  toolName: string
  kind: PermissionRuleKind
  count: number
  lastAt?: string
  projects: { id: string; name: string }[]
}

export type PermissionScanReport = {
  sessions: number
  bytes: number
  truncated: boolean
}

export type PermissionRuleGroup = {
  key: string
  scope: PermissionRuleScope
  title: string
  file?: string
  rows: PermissionRuleRow[]
}

type ListResponse = {
  rules?: PermissionRuleRow[]
  corrupt?: PermissionRuleFileError[]
  userFile?: string
}
type SuggestResponse = {
  suggestions?: PermissionRuleSuggestion[]
  report?: PermissionScanReport
}

// Khoá hàng dùng cho `:key` và cho việc theo dõi hàng đang xoá.
export const permissionRuleKey = (row: PermissionRuleRow): string =>
  `${row.scope}|${row.projectId ?? row.sessionId ?? ''}|${row.action}|${row.rule}`

export function usePermissionRules() {
  const sc = useSidecar()

  const rules = ref<PermissionRuleRow[]>([])
  const fileErrors = ref<PermissionRuleFileError[]>([])
  const suggestions = ref<PermissionRuleSuggestion[]>([])
  const scanReport = ref<PermissionScanReport | null>(null)
  const userFile = ref('')

  const loading = ref(false)
  const loaded = ref(false)
  const scanning = ref(false)
  const busyKey = ref('')
  const lastError = ref('')

  const available = computed(() => sc.available)
  const denyCount = computed(() => rules.value.filter((r) => r.action === 'deny').length)

  // Gom theo tầng, và trong tầng project/session thì gom tiếp theo dự án/phiên.
  // Thứ tự: bền vững nhất trước (máy này → dự án → phiên).
  const groups = computed<PermissionRuleGroup[]>(() => {
    const out: PermissionRuleGroup[] = []
    const byKey = new Map<string, PermissionRuleGroup>()
    const push = (row: PermissionRuleRow, key: string, title: string): void => {
      let group = byKey.get(key)
      if (!group) {
        group = { key, scope: row.scope, title, ...(row.file ? { file: row.file } : {}), rows: [] }
        byKey.set(key, group)
        out.push(group)
      }
      group.rows.push(row)
    }
    for (const row of rules.value.filter((r) => r.scope === 'user')) push(row, 'user', '')
    for (const row of rules.value.filter((r) => r.scope === 'project')) {
      push(row, `project|${row.projectId ?? ''}`, row.projectName ?? row.projectId ?? '')
    }
    for (const row of rules.value.filter((r) => r.scope === 'session')) {
      push(row, `session|${row.sessionId ?? ''}`, row.sessionTitle ?? row.sessionId ?? '')
    }
    return out
  })

  async function load(): Promise<void> {
    if (!available.value) {
      loaded.value = true
      return
    }
    loading.value = true
    try {
      const res = await sc.request<ListResponse>('permissions.listRules', {})
      rules.value = Array.isArray(res.rules) ? res.rules : []
      fileErrors.value = Array.isArray(res.corrupt) ? res.corrupt : []
      userFile.value = typeof res.userFile === 'string' ? res.userFile : ''
      lastError.value = ''
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
      loaded.value = true
    }
  }

  async function removeRule(row: PermissionRuleRow): Promise<boolean> {
    if (!available.value) return false
    const key = permissionRuleKey(row)
    busyKey.value = key
    try {
      await sc.request('permissions.deleteRule', {
        scope: row.scope,
        rule: row.rule,
        action: row.action,
        ...(row.projectId ? { projectId: row.projectId } : {}),
        ...(row.sessionId ? { sessionId: row.sessionId } : {}),
      })
      rules.value = rules.value.filter((r) => permissionRuleKey(r) !== key)
      lastError.value = ''
      return true
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      busyKey.value = ''
    }
  }

  // Quét lịch sử để tìm luật đáng đề xuất. Chỉ đọc — không tạo luật nào.
  async function scan(): Promise<void> {
    if (!available.value) return
    scanning.value = true
    try {
      const res = await sc.request<SuggestResponse>('permissions.suggestRules', {})
      suggestions.value = Array.isArray(res.suggestions) ? res.suggestions : []
      scanReport.value = res.report ?? null
      lastError.value = ''
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
    } finally {
      scanning.value = false
    }
  }

  // Chấp nhận một gợi ý. `target` là 'user' hoặc 'project:<id>' — UI chỉ chọn
  // TẦNG, nội dung luật lấy từ bản park trong sidecar theo `id`.
  async function acceptSuggestion(
    suggestion: PermissionRuleSuggestion,
    target: string,
  ): Promise<boolean> {
    if (!available.value) return false
    const projectId = target.startsWith('project:') ? target.slice('project:'.length) : ''
    busyKey.value = suggestion.id
    try {
      await sc.request('permissions.acceptSuggestion', {
        id: suggestion.id,
        scope: projectId ? 'project' : 'user',
        ...(projectId ? { projectId } : {}),
      })
      suggestions.value = suggestions.value.filter((s) => s.id !== suggestion.id)
      lastError.value = ''
      await load()
      return true
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      busyKey.value = ''
    }
  }

  // Viết một luật DENY do người dùng tự gõ. Đây là đường DUY NHẤT trong UI tạo ra
  // được luật cấm — trước nó trang này chỉ chấp nhận gợi ý (luôn ra `allow`) và
  // xoá, nên không có cách nào tắt hẳn một tool.
  //
  // Khác `acceptSuggestion`, chỗ này gửi VĂN BẢN luật xuống sidecar. Ràng buộc
  // "nội dung luật không đi từ renderer xuống" chỉ bảo vệ chiều ALLOW (một payload
  // dựng tay ghi `Bash(*)` là cấp thêm quyền); chiều DENY không leo thang được, và
  // sidecar ghim cứng `action: 'deny'` nên không lật ngược được từ đây.
  async function addDenyRule(rule: string, target: string): Promise<boolean> {
    if (!available.value) return false
    const text = rule.trim()
    if (!text) return false
    const projectId = target.startsWith('project:') ? target.slice('project:'.length) : ''
    busyKey.value = `deny|${text}`
    try {
      await sc.request('permissions.addDenyRule', {
        rule: text,
        scope: projectId ? 'project' : 'user',
        ...(projectId ? { projectId } : {}),
      })
      await load()
      lastError.value = ''
      return true
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      busyKey.value = ''
    }
  }

  return {
    rules,
    groups,
    fileErrors,
    suggestions,
    scanReport,
    userFile,
    loading,
    loaded,
    scanning,
    busyKey,
    lastError,
    available,
    denyCount,
    load,
    removeRule,
    scan,
    acceptSuggestion,
    addDenyRule,
  }
}
