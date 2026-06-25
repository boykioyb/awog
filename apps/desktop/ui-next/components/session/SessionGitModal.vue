<template>
  <!-- Teleport to body so the modal escapes the workspace-panel stacking context
       and renders as a top-level full-window overlay. Single instance, driven by
       the shared useGitModal() store. The Git Manager is mounted lazily (v-if) so
       its store.init() only runs while the modal is actually open. -->
  <Teleport to="body">
    <div v-if="isOpen" class="ovl on gitovl" @click.self="close">
      <div class="gitmodal">
        <div class="gitmodal-head">
          <Icon name="git" style="width: 14px; height: 14px; color: var(--accent)" />
          <span class="gitmodal-title">{{ t('sessions.workspace.gitModal.title') }}</span>
          <span style="flex: 1" />
          <button class="gitmodal-x" :title="t('common.close')" @click="close">
            <Icon name="x" style="width: 14px; height: 14px" />
          </button>
        </div>
        <div class="gitmodal-body">
          <GitManager :project-id="projectId ?? undefined" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Session Git modal — pops the full Git Manager over the current session (the
// session stays mounted behind the backdrop) so the user can stage/commit/branch
// without navigating away. Opened from the session workspace Diff header via
// useGitModal().open(projectId); mounted once in the default layout.
import { useGitModal } from '~/composables/useGitModal'

const { t } = useI18n()
const { isOpen, projectId, close } = useGitModal()

// Esc closes the modal (only while open, so it doesn't swallow other Esc users).
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && isOpen.value) {
    e.preventDefault()
    close()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
/* Center the large modal (the base .ovl pins to the top for small dialogs). */
.gitovl {
  align-items: center;
  padding: 24px;
  z-index: 120;
}
.gitmodal {
  width: min(1280px, 95vw);
  height: 88vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--borderStrong);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
}
.gitmodal-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bgEl);
}
.gitmodal-title {
  font-weight: 600;
}
.gitmodal-x {
  background: transparent;
  border: none;
  color: var(--textDim);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: inline-flex;
}
.gitmodal-x:hover {
  color: var(--text);
  background: var(--bgHover);
}
/* The Git Manager fills the remaining height; its own .gcols handles overflow. */
.gitmodal-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
</style>
