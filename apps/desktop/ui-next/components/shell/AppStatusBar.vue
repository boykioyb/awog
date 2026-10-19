<template>
  <!-- Status bar toàn app (footer kiểu VSCode). z-82: nổi trên nội dung trang + panel
       workspace trong phiên (≤81) để popover/tooltip mở lên không bị che; modal
       (100+) vẫn thắng. Hairline trên cùng là Separator nằm đè (absolute) chứ không
       phải border — border ăn 1px của hộp 26px và đẩy chip 20px vào nửa pixel. -->
  <footer
    class="relative z-82 flex h-(--statusbar-h) shrink-0 items-center justify-between gap-3 bg-sidebar pr-2 pl-2.5 text-dim"
  >
    <Separator class="absolute inset-x-0 top-0" />
    <!-- Plan-usage donuts pinned to the LEFT edge. -->
    <StatusUsage class="shrink-0" />

    <!-- Session-context chips hug the RIGHT; shown only while viewing a session
         (the active session drives branch / context / project / config).
         Không `overflow-hidden` ở cụm này — popover của chip mở LÊN trên thanh;
         thay vì cắt, các chip thông tin tự co và nhãn tự cắt `…`. -->
    <div class="flex min-w-0 shrink items-center gap-1">
      <template v-if="active">
        <!-- Informational chips: these give up width first (labels ellipsis) so the
             Files + Terminal toggles below never get pushed off the window edge. -->
        <div class="flex min-w-0 shrink items-center gap-1">
          <StatusBranch :session="active" />
          <Separator orientation="vertical" class="mx-0.5 h-3.5!" />
          <StatusContext :session="active" />
          <Separator orientation="vertical" class="mx-0.5 h-3.5!" />
          <!-- Quick-view project. Đợt §3.4 từng bỏ chip này vì tên project lặp lại
               lần thứ ba (tab strip · header · status bar) — nhưng đó là lập luận về
               CHUỖI LẶP, còn cái mất đi là một HÀNH ĐỘNG dùng hằng ngày. Trả lại;
               hàng "Mở project" trong context-menu của tab giữ làm đường thứ hai. -->
          <StatusChip
            :title="t('statusbar.project.open')"
            @click="projectModal.open(active.project)"
          >
            <Icon name="folder" />
            <span class="max-w-40 truncate">{{ projName }}</span>
          </StatusChip>
          <Separator orientation="vertical" class="mx-0.5 h-3.5!" />
          <!-- Chip cấu hình set-once: style. Model + effort là per-turn nên nằm
               trong composer footer (proto), không lặp lại ở đây. -->
          <StatusConfig :session="active" />
        </div>
        <Separator orientation="vertical" class="mx-0.5 h-3.5!" />
        <!-- Files + Browser. §3.4 từng chuyển hai cái này vào `Views ▾` với lý do
             "chúng là view, không phải trạng thái" — đúng về phân loại, sai về thực
             tế dùng: đây là hai khung bật/tắt liên tục, và một cú bấm ở mép cửa sổ
             không thay được bằng hai cú bấm qua menu. Trả lại.
             Nút CHỈ-ICON: icon đã tự nói, `title` là tên cho tooltip + screen reader;
             chữ chỉ giữ ở chip mà chữ CHÍNH LÀ dữ liệu (branch, project, style). -->
        <StatusChip
          class="shrink-0 px-1"
          :active="wpViews.includes('Files')"
          :title="t('statusbar.workspaceFiles')"
          @click="wpToggle('Files')"
        >
          <Icon name="folder" />
        </StatusChip>
        <!-- Browser (ADR 0086) — Chromium nhúng của agent, mở như một khung panel. -->
        <StatusChip
          class="shrink-0 px-1"
          :active="wpViews.includes('Browser')"
          :title="t('statusbar.workspaceBrowser')"
          @click="wpToggle('Browser')"
        >
          <Icon name="globe" />
        </StatusChip>
        <Separator orientation="vertical" class="mx-0.5 h-3.5!" />
      </template>

      <!-- Global terminal toggle — ALWAYS visible (every page, with or without a
           session). Opens the app-wide terminal dock (cwd = home). -->
      <StatusChip
        class="shrink-0 px-1"
        :active="gtOpen"
        :title="t('statusbar.terminalGlobal')"
        @click="gtToggle"
      >
        <Icon name="commands" />
      </StatusChip>
    </div>
  </footer>
</template>

<script setup lang="ts">
// Global status bar (VSCode-style footer), mounted once in the default layout. Left
// edge shows per-account plan-usage donuts; the right edge surfaces the ACTIVE
// session's git branch (quick-switch), context-window usage, a project-modal opener,
// the model/account/effort/style config chips, and the Files panel toggle — moved
// out of the SessionDetail header so they are reachable from a fixed spot. Those
// session items render only on the Sessions route with an open session. The global
// Terminal toggle (app-wide terminal dock, cwd = home) is ALWAYS visible.
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useGlobalTerminal } from '~/composables/useGlobalTerminal'

const { t } = useI18n()
const route = useRoute()
const sessions = useSessionsStore()
const { projectName } = useProjects()
const projectModal = useProjectModal()
// Cầu nối workspace-panel: bật/tắt khung Files + Browser của session đang mở; danh
// sách khung đang mở (SessionDetail publish) quyết định trạng thái sáng của chip.
const { openViews: wpViews, toggleView: wpToggle } = useWorkspacePanel()
// Always-visible global terminal dock (independent of any session).
const { isOpen: gtOpen, toggle: gtToggle } = useGlobalTerminal()

// The active session, but only while the Sessions screen is the one in view.
const active = computed(() => (route.path.startsWith('/workbench') ? sessions.active : null))
const projName = computed(() => (active.value ? projectName(active.value.project) : ''))
</script>
