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
          <button
            class="sb-item"
            :title="t('statusbar.project.open')"
            @click="projectModal.open(active.project)"
          >
            <Icon name="folder" style="width: var(--icon-sm); height: var(--icon-sm)" />
            <span class="sb-proj">{{ projName }}</span>
          </button>
          <span class="sb-div" />
          <!-- Model / Account / Effort / Style chips (moved out of the composer). -->
          <StatusConfig :session="active" />
        </div>
        <span class="sb-div" />
        <!-- Quick workspace toggle (open/close the session's Files panel view).
             The session's project-scoped Terminal tab stays reachable from the
             workspace panel's own view picker. -->
        <button
          class="sb-item"
          :class="{ 'sb-on': wpViews.includes('Files') }"
          :title="t('statusbar.workspaceFiles')"
          @click="wpToggle('Files')"
        >
          <Icon name="folder" style="width: var(--icon-sm); height: var(--icon-sm)" />
          Files
        </button>
        <span class="sb-div" />
      </template>

      <!-- Global terminal toggle — ALWAYS visible (every page, with or without a
           session). Opens the app-wide terminal dock (cwd = home). -->
      <button
        class="sb-item"
        :class="{ 'sb-on': gtOpen }"
        :title="t('statusbar.terminalGlobal')"
        @click="gtToggle"
      >
        <Icon name="commands" style="width: var(--icon-sm); height: var(--icon-sm)" />
        Terminal
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
// Workspace-panel bridge: toggle the active session's Files panel; the open-views
// list (published by SessionDetail) drives the chip's active state.
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
  line-height: 1;
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
  line-height: 17px;
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
