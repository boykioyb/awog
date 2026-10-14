import { ref, watch } from 'vue'
import { useSessionsStore } from '~/stores/sessions'
import { useProjectsStore } from '~/stores/projects'
import { useSettingsStore } from '~/stores/settings'
import { useToast } from '~/composables/useToast'
import { useI18n } from '~/composables/useI18n'
import { isBoardSession, type Session } from '~/composables/useSessionsData'

// ⌘K session switcher của Session Workbench (ADR 0098 §L-2) — state + data +
// hành động nhảy giữa session/project. Singleton module-level vì overlay chỉ có
// một trên màn hình; component `workbench/stage/SessionSwitcher.vue` là surface
// duy nhất và cũng là nơi `installSettleToast()` được gọi.

const isOpen = ref(false)

function open(): void {
  isOpen.value = true
}
function close(): void {
  isOpen.value = false
}
function toggle(): void {
  isOpen.value = !isOpen.value
}

// Một hàng trong list ⌘K — phiên thuộc một project.
export interface SwitcherRow {
  id: number
  title: string
  status: Session['status']
  /** projectId của session ('' = tab Mặc định) */
  project: string
  /** Tên hiển thị của project (resolve sẵn để filter + render) */
  projectName: string
  updatedAt?: string
}

// Một nhóm = một project có ít nhất một phiên hiển thị.
export interface SwitcherGroup {
  project: string
  name: string
  /** số phiên streaming/awaiting trong nhóm (hiện "N đang chạy") */
  running: number
  rows: SwitcherRow[]
}

const RUN_STATUSES: Record<string, true> = { streaming: true, awaiting: true }

export function isRunStatus(status: Session['status']): boolean {
  return RUN_STATUSES[status] === true
}

// Tên hiển thị của một projectId: '' = tab "Mặc định" (session không thuộc
// project), id lạ (project đã xoá?) hiện nguyên id thay vì trống.
export function sessionProjectName(projectId: string): string {
  if (!projectId) return useI18n().t('wb.switch.defaultProject')
  return useProjectsStore().projectById(projectId)?.name ?? projectId
}

// Mọi session mọi project, gom nhóm cho overlay. Thứ tự: project đang mở trước,
// rồi các project có phiên đang chạy, rồi tên A→Z. Trong nhóm: running/awaiting
// trước, mới cập nhật trước. Ẩn phiên đã archive (vòng đời của chúng nằm ở
// popover ▾ của strip) và phiên "của board" (sống trong Teams/board).
export function allSessions(): SwitcherGroup[] {
  const sessions = useSessionsStore()
  const byProject = new Map<string, SwitcherRow[]>()
  for (const s of sessions.sessions) {
    if (sessions.isArchived(s.id) || isBoardSession(s)) continue
    const rows = byProject.get(s.project) ?? []
    rows.push({
      id: s.id,
      title: s.title,
      status: s.status,
      project: s.project,
      projectName: sessionProjectName(s.project),
      updatedAt: s.updatedAt,
    })
    byProject.set(s.project, rows)
  }
  const groups: SwitcherGroup[] = []
  for (const [project, rows] of byProject) {
    rows.sort(
      (a, b) =>
        Number(isRunStatus(b.status)) - Number(isRunStatus(a.status)) ||
        Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? '') ||
        a.title.localeCompare(b.title),
    )
    groups.push({
      project,
      name: sessionProjectName(project),
      running: rows.filter((r) => isRunStatus(r.status)).length,
      rows,
    })
  }
  const active = sessions.activeTab
  groups.sort(
    (a, b) =>
      Number(b.project === active) - Number(a.project === active) ||
      Number(b.running > 0) - Number(a.running > 0) ||
      a.name.localeCompare(b.name),
  )
  return groups
}

// Nhảy tới một phiên theo client id: setActive() tự mở tab project của phiên và
// nhớ phiên vừa xem cho tab đó, còn navigateTo đưa user về workbench khi lệnh
// nhảy phát ra từ một surface khác (toast).
export function jumpTo(sessionId: number): void {
  const sessions = useSessionsStore()
  sessions.setActive(sessionId)
  void navigateTo('/workbench')
}

// Chữ ký theo spec (docs/features/session-workbench.tasks.md Slice E): chọn
// project khác → đổi activeTab + activate; cùng project → activate. Resolve qua
// title (đã unique-hoá bởi generate-title khi cần).
export function jumpSession(projectId: string, title: string): void {
  const sessions = useSessionsStore()
  if (projectId !== sessions.activeTab) sessions.setActiveTab(projectId)
  const s = sessions.sessions.find((x) => x.project === projectId && x.title === title)
  if (s) sessions.setActive(s.id)
  void navigateTo('/workbench')
}

// ── Toast "phiên xong ở project khác" (ADR 0098 §L-2) ────────────────────────
// Watcher trạng thái theo đúng khuôn useNativeNotify, nhưng mục tiêu KHÁC:
// native notify chỉ bắn khi cửa sổ mất focus; toast này bắn khi user ĐANG dùng
// app mà một phiên thuộc project KHÁC tab đang mở vừa settle — cái mà mắt
// không thấy được vì strip chỉ hiện một project. Gate theo
// settings.notifications.sessionEvents (tôn trọng delivery 'native' = user chọn
// không toast). Phiên bản native của cùng sự kiện vẫn chạy khi unfocused.
const SETTLE_ACTIVE: Record<string, true> = { streaming: true, awaiting: true }
const SETTLE_DONE: Record<string, true> = { done: true, error: true }
let settleToastStop: (() => void) | null = null

export function installSettleToast(): void {
  if (settleToastStop) return
  const sessions = useSessionsStore()
  const projects = useProjectsStore()
  const settings = useSettingsStore()
  const toast = useToast()
  const { t } = useI18n()
  const last = new Map<number, Session['status']>()
  let seeded = false
  settleToastStop = watch(
    () => sessions.sessions.map((s) => ({ id: s.id, status: s.status })),
    (snap) => {
      // Lần đầu chỉ ghi nhận trạng thái — hydrate không được báo lại.
      if (!seeded) {
        for (const s of snap) last.set(s.id, s.status)
        seeded = true
        return
      }
      const live = new Set<number>()
      for (const s of snap) {
        live.add(s.id)
        const prev = last.get(s.id)
        last.set(s.id, s.status)
        if (prev == null || SETTLE_ACTIVE[prev] !== true || SETTLE_DONE[s.status] !== true) continue
        const full = sessions.sessions.find((x) => x.id === s.id)
        if (!full || full.project === sessions.activeTab) continue
        if (!settings.notifications.sessionEvents) continue
        if (settings.notifications.delivery === 'native') continue
        const project = projects.projectById(full.project)?.name ?? t('wb.switch.defaultProject')
        const toastId = `wb-settle-${full.id}`
        toast.add({
          id: toastId,
          title: t('wb.toast.settledTitle', { project }),
          description: full.title,
          color: full.status === 'error' ? 'error' : 'success',
          actions: [
            {
              label: t('wb.toast.openSession'),
              icon: 'sessions',
              onClick: () => {
                jumpTo(full.id)
                toast.remove(toastId)
              },
            },
          ],
        })
      }
      for (const id of [...last.keys()]) if (!live.has(id)) last.delete(id)
    },
    { deep: true },
  )
}

export function uninstallSettleToast(): void {
  settleToastStop?.()
  settleToastStop = null
}

export function useSessionSwitcher() {
  return { isOpen, open, close, toggle, allSessions, jumpSession, jumpTo }
}
