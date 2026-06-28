<template>
  <!-- Teleport to body so the modal escapes the workspace-panel stacking context
       and renders as a top-level overlay. Single instance, driven by the shared
       useProjectModal() store. ProjectDetail is mounted lazily (v-if) so its GH /
       repo discovery only runs while the modal is actually open, and in `compact`
       mode so management chrome (edit / delete / templates) is hidden — this is a
       read-only peek at the project + its GitHub issues/PRs. -->
  <Teleport to="body">
    <div v-if="isOpen" class="ovl on projovl" @click.self="close">
      <div class="projmodal">
        <div class="projmodal-head">
          <Icon name="projects" style="width: 14px; height: 14px; color: var(--accent)" />
          <span class="projmodal-title">
            {{ project ? project.name : t('sessions.workspace.projectModal.title') }}
          </span>
          <span style="flex: 1" />
          <button class="projmodal-x" :title="t('common.close')" @click="close">
            <Icon name="x" style="width: 14px; height: 14px" />
          </button>
        </div>
        <div class="projmodal-body">
          <ProjectDetail v-if="project && view" :project="project" :view="view" compact />
          <div v-else class="fd" style="padding: 24px">
            {{ t('sessions.workspace.projectModal.notFound') }}
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Project quick-view modal — pops the project's detail (Overview / Issues / PRs)
// over the current session so the user can peek at info + GitHub issues/PRs without
// navigating away. Opened from the session header via useProjectModal().open(key);
// mounted once in the default layout. Mirrors SessionGitModal.
import { computed } from 'vue'
import ProjectDetail from '~/components/project/ProjectDetail.vue'
import { useProjectModal } from '~/composables/useProjectModal'
import { useProjectView } from '~/composables/useProjectView'
import { useProjectsStore } from '~/stores/projects'
import type { Project } from '~/types'

const { t } = useI18n()
const { isOpen, key, close } = useProjectModal()
const store = useProjectsStore()

// The session's `project` value may be an id OR a display name — resolve either.
const project = computed<Project | null>(() => {
  const k = key.value
  if (!k) return null
  return store.projectById(k) ?? store.projects.find((p) => p.name === k) ?? null
})
const view = useProjectView(() => project.value?.id ?? null)

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
/* Center the modal (the base .ovl pins to the top for small dialogs). */
.projovl {
  align-items: center;
  padding: 24px;
  z-index: 120;
}
.projmodal {
  width: min(1100px, 95vw);
  height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border: 1px solid var(--borderStrong);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
}
.projmodal-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bgEl);
}
.projmodal-title {
  font-weight: 600;
}
.projmodal-x {
  background: transparent;
  border: none;
  color: var(--textDim);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: inline-flex;
}
.projmodal-x:hover {
  color: var(--text);
  background: var(--bgHover);
}
/* ProjectDetail (.detail) fills the remaining space; its own .dscroll / GH tabs
   handle overflow. Mirror the /projects detail pane constraints (flex column +
   min-height:0 + overflow:hidden) so it never spills past the modal. */
.projmodal-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
/* The issue/PR fullscreen drawer overlays its pane via position:absolute. On the
   /projects page that context comes from `[data-page='projects'] .projmain`; the
   modal lives on another page, so re-apply the same context + overlay here. */
.projmodal-body :deep(.projmain) {
  position: relative;
}
.projmodal-body :deep(.ghdrawer.full) {
  position: absolute;
  inset: 0;
  width: auto;
  z-index: 5;
}
</style>
