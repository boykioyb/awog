<template>
  <footer class="statusbar">
    <!-- Plan-usage donuts pinned to the LEFT edge. -->
    <div class="sb-cluster sb-usage">
      <StatusUsage />
    </div>

    <!-- Session-context chips hug the RIGHT; shown only while viewing a session
         (the active session drives branch / context / project / config). -->
    <div class="sb-cluster sb-session">
      <template v-if="active">
        <!-- Informational chips: these give up width first (labels ellipsis) so the
             Files + Terminal toggles below never get pushed off the window edge. -->
        <div class="sb-info">
          <StatusBranch :session="active" />
          <span class="sb-div" />
          <StatusContext :session="active" />
          <span class="sb-div" />
          <!-- Quick-view project. Đợt §3.4 từng bỏ chip này vì tên project lặp lại
               lần thứ ba (tab strip · header · status bar) — nhưng đó là lập luận về
               CHUỖI LẶP, còn cái mất đi là một HÀNH ĐỘNG dùng hằng ngày. Trả lại;
               hàng "Mở project" trong context-menu của tab giữ làm đường thứ hai. -->
          <button
            class="sb-item"
            :title="t('statusbar.project.open')"
            @click="projectModal.open(active.project)"
          >
            <Icon name="folder" style="width: var(--icon-sm); height: var(--icon-sm)" />
            <span class="sb-proj">{{ projName }}</span>
          </button>
          <span class="sb-div" />
          <!-- MỘT chip cấu hình: model · account · effort · style (§3.4). -->
          <StatusConfig :session="active" />
        </div>
        <span class="sb-div" />
        <!-- Files + Browser. §3.4 từng chuyển hai cái này vào `Views ▾` với lý do
             "chúng là view, không phải trạng thái" — đúng về phân loại, sai về thực
             tế dùng: đây là hai khung bật/tắt liên tục, và một cú bấm ở mép cửa sổ
             không thay được bằng hai cú bấm qua menu. Trả lại. -->
        <button
          class="sb-item sb-ico"
          :class="{ 'sb-on': wpViews.includes('Files') }"
          :title="t('statusbar.workspaceFiles')"
          @click="wpToggle('Files')"
        >
          <Icon name="folder" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <!-- Browser (ADR 0086) — Chromium nhúng của agent, mở như một khung panel. -->
        <button
          class="sb-item sb-ico"
          :class="{ 'sb-on': wpViews.includes('Browser') }"
          :title="t('statusbar.workspaceBrowser')"
          @click="wpToggle('Browser')"
        >
          <Icon name="globe" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <span class="sb-div" />
      </template>

      <!-- Global terminal toggle — ALWAYS visible (every page, with or without a
           session). Opens the app-wide terminal dock (cwd = home). -->
      <button
        class="sb-item sb-ico"
        :class="{ 'sb-on': gtOpen }"
        :title="t('statusbar.terminalGlobal')"
        @click="gtToggle"
      >
        <Icon name="commands" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
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
const active = computed(() => (route.path.startsWith('/sessions') ? sessions.active : null))
const projName = computed(() => (active.value ? projectName(active.value.project) : ''))
</script>

<style scoped>
.statusbar {
  flex: 0 0 var(--statusbar-h);
  height: var(--statusbar-h);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 8px 0 10px;
  /* Drawn as an inset shadow, not a border: a border comes out of the content box and
     left 25px inside a 26px bar, centring 20px children at 3.5. */
  box-shadow: inset 0 1px 0 var(--border);
  background: var(--bgPanel);
  color: var(--textDim);
  /* Sit above page content + the in-session workspace panel (≤81) so the upward
     popovers/tooltips are never clipped; modals (100+) still win. */
  position: relative;
  z-index: 82;
}
.sb-cluster {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
/* Donuts hug the left edge; session chips hug the right (justify-content:
   space-between on .statusbar splits them to opposite edges). */
.sb-usage {
  flex: 0 0 auto;
}
.sb-session {
  flex: 0 1 auto;
  min-width: 0;
  /* No `overflow: hidden` here — the chip popovers open UPWARD (above the bar) and
     an overflow clip on this cluster would hide them. Instead of clipping, the
     informational chips (.sb-info) shrink and their labels self-truncate, so the
     row stays bounded and the Files + Terminal toggles stay pinned at the edge. */
}
/* Shrinkable informational-chip region (branch / context / project / config). It
   yields width first when the bar is narrow; the sibling Files + Terminal toggles
   below never shrink, so Terminal is always reachable. */
.sb-info {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 1 auto;
  min-width: 0;
}
/* Files + Terminal toggles (and their separators) hold their full width — they are
   the last things allowed to disappear. */
.sb-session > .sb-item,
.sb-session > .sb-div {
  flex: 0 0 auto;
}
/* Let each chip inside the info region shrink below its content width so the text
   labels ellipsis-truncate instead of overflowing past the window edge. Icons keep
   their fixed size (no min-width override); only the labels give way. */
.statusbar :deep(.sb-info .sb-wrap),
.statusbar :deep(.sb-info .sb-cfg),
.statusbar :deep(.sb-info .sb-item),
.statusbar :deep(.sb-info .sb-branch),
.statusbar :deep(.sb-info .sb-cfg-lbl),
.statusbar :deep(.sb-info .sb-proj) {
  min-width: 0;
}
/* The context chip is short + fixed ("274k/1.00M") and has no ellipsis, so keep it
   from shrinking to avoid clipping the numbers mid-digit. */
.statusbar :deep(.sb-info .sb-wrap:has(> .ctxmini)) {
  flex: 0 0 auto;
}
.sb-div {
  width: 1px;
  height: 14px;
  background: var(--border);
  margin: 0 2px;
  flex: 0 0 auto;
}
/* Shared compact status-bar item (chrome — fixed 12px like the tray popover, not
   the body 1em scale). Sub-components reuse this class. */
.statusbar :deep(.sb-item) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 7px;
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  font-size: 12px;
  line-height: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition:
    color 0.12s,
    background 0.12s;
}
.statusbar :deep(.sb-item:hover) {
  color: var(--text);
  background: var(--bgHover);
}
.statusbar :deep(.sb-item:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
/* Nút CHỈ-ICON ở mép phải (Files · Browser · Terminal).
   Ba nút này bỏ nhãn chữ vì icon đã tự nói (thư mục / quả cầu / dấu nhắc lệnh), và
   `title` vẫn là tên gọi cho tooltip lẫn screen reader — cùng quy ước icon-only mà
   header của các *Detail.vue dùng. Chữ chỉ giữ ở những chip mà chữ CHÍNH LÀ dữ liệu
   (branch, project, model, account, effort, style): ở đó không icon nào thay được.
   Padding đối xứng + bỏ gap để ô bấm vuông thay vì lệch về phía nhãn đã mất. */
.statusbar :deep(.sb-item.sb-ico) {
  gap: 0;
  padding: 0 5px;
}
/* Active workspace toggle (the view is open) — accent-tinted like the prototype's
   "on" chips, no solid gray fill. */
.sb-item.sb-on {
  color: var(--accent);
  background: var(--accentDim);
}
/* Dirty-count badge on the branch chip. */
.statusbar :deep(.sb-badge) {
  min-width: 16px;
  height: 14px;
  padding: 0 4px;
  border-radius: var(--r-pill);
  background: var(--accentDim);
  color: var(--accent);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  line-height: 18px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.sb-proj {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
