import { computed, ref } from 'vue'
import type { Session } from '~/composables/useSessionsData'
import { useSessionsStore } from '~/stores/sessions'
import { useWorkbenchStore } from '~/stores/workbench'
import type { DockView } from '~/types/workbench'

// State + intents for the Session Workbench bottom dock (ADR 0098, slice D).
// Layout state itself lives in `stores/workbench` (dockView / dockH / dockHidden /
// termTabs mirror); this composable owns everything that is NOT plain layout:
//
//   • dockViews — the view list, conditional on the active session being a
//     multi-agent run (Team). Mirrors the prototype's dockViews().
//   • collapsed / expandDock / collapseDock — the 3-state height model
//     (full / rolled up to 34 / hidden), matching the prototype + the
//     contract's DOCK_MIN.
//   • openTerminalAt — entry point for "Mở Terminal ở đây" (Explorer ctx,
//     slice B): reveals the dock on the Terminal view and queues a new
//     terminal tab spawned at that cwd. The queue survives the terminal
//     being unmounted (first visit to the Terminal view mounts it lazily).
//
// The workbench has its own bottom dock, so while this page is shown the
// app-wide GlobalTerminalHost is suppressed (useGlobalTerminal.setSuppressed)
// — the two would stack over each other and fight over ⌘J.

// Phiên là channel đa-agent: lead của một run (con khai teamRunId trỏ nó),
// member của một run, có team spec materialize, hoặc một "vai có thật" đang
// điều phối. Cùng dấu hiệu `curSession()?.agents` của prototype, chiếu sang
// mô hình teamRunId/teamId/agent thật của store.
const isTeamSession = (s: Session | null, all: Session[]): boolean => {
  if (!s) return false
  if (s.agent || s.teamId || s.teamRunId || s.spawnConfig) return true
  const eid = s.engineId
  return !!eid && all.some((x) => x.teamRunId === eid)
}

// Yêu cầu mở một tab terminal tại cwd cụ thể, chờ DockTerminal (lười-mount)
// nhặt. `nonce` buộc watch chạy lại kể cả khi gọi 2 lần cùng một cwd.
const pendingTermOpen = ref<{ cwd: string; nonce: number } | null>(null)
let termNonce = 0

export function useWorkbenchDock() {
  const wb = useWorkbenchStore()
  const sessions = useSessionsStore()

  // 2 view cốt lõi + Team khi phiên active là channel đa-agent. 'Diff' đã gỡ
  // khỏi dock — xem diff qua SCM view / doc tab. Khi danh sách mất Team thì
  // view đang chọn co về Terminal (prototype: renderSessionTabs làm đúng
  // việc này).
  const dockViews = computed<DockView[]>(() => {
    const base: DockView[] = ['Terminal', 'Tasks', 'Cost', 'Info']
    return isTeamSession(sessions.active, sessions.sessions) ? [...base, 'Team'] : base
  })

  // `dockH` gần DOCK_MIN (34) = cuộn lên: chỉ còn bar, body ẩn (PTV sống tiếp).
  const collapsed = computed(() => wb.dockH <= wb.DOCK_MIN + 1)

  function collapseDock(): void {
    wb.dockH = wb.DOCK_MIN
  }

  // "Mở rộng": cao tối đa = min(480, 60% stage) — stage là hộp flex cha của
  // dock; không đo được (hoặc SSR) rớt về cửa sổ, vẫn clamp [34, 480]. Không bao
  // giờ THU dock: stage thấp quá thì giữ nguyên cỡ hiện tại thay vì co lại.
  function expandDock(stageHeight?: number): void {
    const h = stageHeight || (typeof window !== 'undefined' ? window.innerHeight : 0)
    const target = Math.min(wb.DOCK_MAX, Math.floor(h * 0.6))
    wb.dockH = Math.max(wb.dockH, wb.DOCK_MIN, Math.min(wb.DOCK_MAX, target))
  }

  // "Mở Terminal ở đây": hiện dock + chuyển view về Terminal + xếp một tab
  // spawn ở `cwd`. DockTerminal nhặt yêu cầu khi nó mount được (lazy-mount).
  function openTerminalAt(cwd: string): void {
    wb.dockView = 'Terminal'
    wb.toggleDock(true)
    if (collapsed.value) wb.dockH = 210
    pendingTermOpen.value = { cwd, nonce: ++termNonce }
  }

  function takePendingOpen(): { cwd: string; nonce: number } | null {
    const v = pendingTermOpen.value
    pendingTermOpen.value = null
    return v
  }

  return {
    dockViews,
    collapsed,
    collapseDock,
    expandDock,
    openTerminalAt,
    pendingTermOpen,
    takePendingOpen,
  }
}
