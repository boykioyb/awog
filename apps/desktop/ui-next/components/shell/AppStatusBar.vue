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
        <StatusBranch :session="active" />
        <span class="sb-div" />
        <StatusContext :session="active" />
        <span class="sb-div" />
        <button
          class="sb-item"
          :title="t('statusbar.project.open')"
          @click="projectModal.open(active.project)"
        >
          <Icon name="folder" style="width: 13px; height: 13px" />
          <span class="sb-proj">{{ projName }}</span>
        </button>
        <span class="sb-div" />
        <!-- Model / Account / Effort / Style chips (moved out of the composer). -->
        <StatusConfig :session="active" />
        <span class="sb-div" />
        <!-- Quick workspace toggles (open/close the Files / Terminal panel views). -->
        <button
          class="sb-item"
          :class="{ 'sb-on': wpViews.includes('Files') }"
          :title="t('statusbar.workspaceFiles')"
          @click="wpToggle('Files')"
        >
          <Icon name="folder" style="width: 13px; height: 13px" />
          Files
        </button>
        <button
          class="sb-item"
          :class="{ 'sb-on': wpViews.includes('Terminal') }"
          :title="t('statusbar.workspaceTerminal')"
          @click="wpToggle('Terminal')"
        >
          <Icon name="commands" style="width: 13px; height: 13px" />
          Terminal
        </button>
      </template>
    </div>
  </footer>
</template>

<script setup lang="ts">
// Global status bar (VSCode-style footer), mounted once in the default layout. Left
// edge shows per-account plan-usage donuts; the right edge surfaces the ACTIVE
// session's git branch (quick-switch), context-window usage, a project-modal opener,
// and the model/account/effort/style config chips — moved out of the SessionDetail
// header so they are reachable from a fixed spot. Session items render only on the
// Sessions route with an open session.
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const { t } = useI18n()
const route = useRoute()
const sessions = useSessionsStore()
const { projectName } = useProjects()
const projectModal = useProjectModal()
// Workspace-panel bridge: toggle Files/Terminal in the active session's panel; the
// open-views list (published by SessionDetail) drives the chips' active state.
const { openViews: wpViews, toggleView: wpToggle } = useWorkspacePanel()

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
  border-top: 1px solid var(--border);
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
  /* No `overflow: hidden` here — the chip popovers open UPWARD (above the bar) and
     an overflow clip on this cluster would hide them. Chip labels self-truncate
     (max-width + ellipsis) so the row stays bounded without clipping. */
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
  border-radius: 6px;
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
  border-radius: 99px;
  background: var(--accentDim);
  color: var(--accent);
  font-family: var(--code);
  font-size: 11px;
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
