<template>
  <!-- Terminal của workbench dock — wrap WorkspaceTerminal (multi-tab PTY thật
       qua terminal.*, split pane, rename/duplicate context menu) với khoá nhóm
       riêng `workbench:<projectId>`; tab strip zsh·pnpm dev·+ do widget tự vẽ.
       Tab được quản bên trong WorkspaceTerminal: store chỉ mirror `termActive`
       (id PTY đang sống của tab đang chọn) cho các view khác tham chiếu. -->
  <div class="flex h-full min-h-0">
    <div class="flex h-full min-w-0 flex-1 flex-col">
      <WorkspaceTerminal
        ref="termEl"
        :root="termRoot"
        :ready="sc.available"
        :pty-key="ptyKey"
        :visible="visible"
        @conn="onConn"
      />
    </div>
    <!-- Snippets (project đang mở + tầng Global) — CÙNG rail + store với dock terminal
         toàn cục: Workbench ẩn dock toàn cục nên trước đây ở đây không có snippets.
         Bật/tắt bằng nút trên DockBar; trạng thái mở dùng chung useGlobalTerminal. -->
    <TerminalSnippetsRail
      v-if="snippetsOpen"
      :project="currentProject"
      :project-label="currentProjectLabel"
      :can-run="!!wb.termActive"
      @run="onRunSnippet"
      @close="setSnippetsOpen(false)"
    />
  </div>
</template>

<script setup lang="ts">
// Slice D — view Terminal. KHÔNG viết xterm/PTY mới: reuse WorkspaceTerminal
// (cùng widget session workspace panel + global dock dùng). `root` theo tab
// project đang chọn (folder kéo của phiên active ưu tiên — y hệt
// GlobalTerminalHost); "~" khi ở tab Default → terminal vẫn dùng được.
//
// "Mở Terminal ở đây" (Explorer, slice B): `openTerminalAt(cwd)` đẩy một
// pending request vào useWorkbenchDock; ta tạo tab mới bằng transport ghim cwd
// (terminal.*, chung idField 'terminalId' nên canCreatePane không đòi root và
// link file vẫn hoạt động). Thiếu API cwd của widget đúng như task dự kiến —
// transport chính là điểm nới chính thức cho chuyện này.
import { computed, ref, watch, nextTick } from 'vue'
import WorkspaceTerminal from '~/components/session/workspace/WorkspaceTerminal.vue'
import { useSidecar } from '~/composables/useSidecar'
import type { TerminalTransport } from '~/composables/useTerminalApi'
import { useTerminalApi } from '~/composables/useTerminalApi'
import { useWorkbenchDock } from '~/composables/useWorkbenchDock'
import { useWorkspaceData } from '~/composables/useWorkspaceData'
import { useSessionsStore } from '~/stores/sessions'
import { useWorkbenchStore } from '~/stores/workbench'
import TerminalSnippetsRail from '~/components/shell/TerminalSnippetsRail.vue'
import { useGlobalTerminal } from '~/composables/useGlobalTerminal'
import { useProjects } from '~/composables/useProjects'

const wb = useWorkbenchStore()
const dock = useWorkbenchDock()
const sessions = useSessionsStore()
const sc = useSidecar()
const api = useTerminalApi()

const HOME_KEY = '__home__'
// Khoá nhóm PTY per project — cùng quy ước `global:<key>` của dock toàn cục.
const ptyKey = computed(() => `workbench:${sessions.activeTab || HOME_KEY}`)

const { root: projectRoot } = useWorkspaceData(() => sessions.activeTab || undefined)
const termRoot = computed(() => {
  const s = sessions.active
  if (s && s.project === sessions.activeTab && s.workspaceFolder) return s.workspaceFolder
  return projectRoot.value || '~'
})

// Widget có thể nhìn thấy = dock đang mở, không cuộn, đúng view Terminal.
const visible = computed(
  () => !wb.dockHidden && wb.dockH > wb.DOCK_MIN + 1 && wb.dockView === 'Terminal',
)

// Mirror `termActive` = id PTY sống của tab đang chọn (null = chưa spawn) —
// store không sở hữu danh sách tab (widget tự quản), chỉ giữ tham chiếu này.
function onConn(id: string | null): void {
  wb.termActive = id ?? ''
}

// ── Tab theo cwd ("Mở Terminal ở đây") ────────────────────────────────────
// Transport local ghim cwd — giống `localTransport` của widget nhưng không
// phụ thuộc `props.root`, nên tab sống độc lập với việc project resolve.
const cwdTransport = (cwd: string): TerminalTransport => ({
  create: (cols, rows) =>
    api.create(cwd, ptyKey.value, cols, rows).then((r) => ({ id: r.terminalId })),
  write: (id, data) => api.write(id, data),
  resize: (id, cols, rows) => api.resize(id, cols, rows),
  kill: (id) => api.kill(id),
  dataEvent: 'terminal.data',
  exitEvent: 'terminal.exit',
  idField: 'terminalId',
})

const termEl = ref<{
  addTab?: (activate: boolean, label?: string | null, tr?: TerminalTransport) => string
  runText?: (text: string) => void
} | null>(null)

// ── Snippets ───────────────────────────────────────────────────────────────
const { snippetsOpen, setSnippetsOpen } = useGlobalTerminal()
const { projectName } = useProjects()
// Project thật để lọc snippet (null = tab Default → chỉ tầng Global).
const currentProject = computed(() => sessions.activeTab || null)
const currentProjectLabel = computed(() =>
  currentProject.value ? projectName(currentProject.value) : '',
)
// Chạy snippet: thêm newline cho nó thực thi, ghi vào tab đang chọn qua transport
// của chính tab đó (local hay SSH đều đúng) — y hệt GlobalTerminalHost.
function onRunSnippet(command: string): void {
  termEl.value?.runText?.(`${command}\n`)
}

const baseName = (p: string): string =>
  p
    .replace(/[/\\]+$/, '')
    .split(/[/\\]/)
    .pop() || p

async function drainPending(): Promise<void> {
  const api2 = termEl.value
  if (!api2?.addTab) return
  const req = dock.takePendingOpen()
  if (!req) return
  // Label = tên thư mục; tab chạy transport ghim cwd riêng (vẫn PTY local).
  api2.addTab(true, baseName(req.cwd), cwdTransport(req.cwd))
  await nextTick()
}

// Nhặt yêu cầu "Mở Terminal ở đây": chờ widget mount (lazy-mount ở WorkbenchDock
// chỉ gắn ref khi view Terminal được chọn lần đầu). Đọc `.nonce` (không phải
// object) để hai lần gọi cùng cwd vẫn kích watch.
watch([() => dock.pendingTermOpen.value?.nonce, termEl], () => void drainPending(), {
  deep: false,
  immediate: true,
})
</script>
