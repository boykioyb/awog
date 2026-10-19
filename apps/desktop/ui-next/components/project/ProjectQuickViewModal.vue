<template>
  <!-- Teleport to body so the peek escapes the workspace-panel stacking context and
       renders as a top-level overlay. Single instance, driven by the shared
       useProjectModal() store. ProjectDetail is mounted lazily (v-if) so its GH / repo
       discovery only runs while the peek is open. Full management parity with the
       /projects page: the header + Overview actions are wired to the shared
       useProjectActions flows. Launching an action closes the peek first so the
       action's own modal (z:100) isn't hidden behind this overlay (z:120). -->
  <Teleport to="body">
    <!-- Giữ overlay tự dựng (không Dialog reka): từ trong peek người dùng mở file qua
         PreviewModal / hộp nhập dùng chung teleport ra body — Dialog modal của reka khoá
         pointer-events của body nên các bề mặt đó sẽ không bấm được. -->
    <!-- hook-ok: `.ovl.on` — OVERLAYS trong composables/useEmbeddedBrowser.ts -->
    <div v-if="isOpen" class="ovl on" :class="OVERLAY" @click.self="close">
      <div
        class="flex h-[86vh] w-[min(1100px,95vw)] flex-col overflow-hidden rounded-lg border border-input bg-background shadow-lg"
        role="dialog"
        aria-modal="true"
      >
        <div class="flex flex-none items-center gap-2 border-b bg-card px-3.5 py-2.5">
          <Icon name="projects" class="size-3.5 text-primary" />
          <span class="font-semibold">
            {{ project ? project.name : t('sessions.workspace.projectModal.title') }}
          </span>
          <span class="flex-1" />
          <Button
            variant="ghost"
            size="iconSm"
            class="text-dim"
            :title="t('common.close')"
            :aria-label="t('common.close')"
            @click="close"
          >
            <Icon name="x" class="size-3.5" />
          </Button>
        </div>
        <!-- ProjectDetail tự lo overflow (.dscroll / tab GH); ở đây chỉ chặn tràn khỏi
             modal: flex cột + min-h-0 + overflow-hidden giống pane /projects. -->
        <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ProjectDetail
            v-if="project && view"
            :project="project"
            :view="view"
            :deep-link="deepLink"
            @edit="onEdit"
            @delete="onDelete"
            @open-llm="onOpenLlm"
            @open-code="onOpenCode"
            @open-workspace="onOpenWorkspace"
            @save-template="onSaveTemplate"
            @install-template="onInstallTemplate"
            @imported="(n) => actions.onImported(n)"
          />
          <div v-else class="p-6 text-sm text-dim">
            {{ t('sessions.workspace.projectModal.notFound') }}
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Action modals — mounted OUTSIDE the peek's v-if so they survive the peek
       closing when an action launches. Each self-teleports to body. -->
  <ProjectEditor
    :open="actions.editorOpen.value"
    :project="actions.editTarget.value"
    :busy="actions.editorBusy.value"
    :error="actions.editorError.value"
    :progress="actions.editorProgress.value"
    :can-browse="actions.canBrowse.value"
    :inspect="actions.inspectPath"
    :inspect-remote="actions.inspectRemote"
    :generate-description="actions.generateDescription"
    :browse="actions.browseFolder"
    @save="actions.onSave"
    @cancel="actions.closeEditor"
  />
  <ProjectLlmDefaultsModal
    :open="actions.llmOpen.value"
    :project="actions.llmTarget.value"
    @saved="actions.onLlmSaved"
    @cancel="actions.closeLlm"
  />
  <LibraryConfirmDelete
    :open="!!actions.pendingDelete.value"
    :title="t('projects.delete.title')"
    :description="actions.deleteDescription.value"
    @confirm="actions.confirmDelete"
    @cancel="actions.cancelDelete"
  />
  <SaveAsTemplateDialog
    :open="actions.saveTemplateOpen.value"
    :projects="actions.templateProjects.value"
    @close="actions.closeSaveTemplate"
    @saved="actions.onTemplateSaved"
  />
  <InstallTemplateDialog
    :open="actions.installTemplateOpen.value"
    :projects="actions.templateProjects.value"
    @close="actions.closeInstallTemplate"
    @installed="actions.onTemplateInstalled"
  />
</template>

<script setup lang="ts">
// Project quick-view modal — pops the project's detail (Overview / Issues / PRs) over
// the current session so the user can peek at info + GitHub issues/PRs AND run the
// full set of project actions (edit / delete / templates / LLM defaults / open code /
// open workspace) without navigating to /projects. Opened from the session header via
// useProjectModal().open(key); mounted once in the default layout. The management
// flows are shared with the /projects page via useProjectActions.
import { computed } from 'vue'
import ProjectDetail from '~/components/project/ProjectDetail.vue'
import ProjectEditor from '~/components/project/ProjectEditor.vue'
import ProjectLlmDefaultsModal from '~/components/project/ProjectLlmDefaultsModal.vue'
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'
import SaveAsTemplateDialog from '~/components/templates/SaveAsTemplateDialog.vue'
import InstallTemplateDialog from '~/components/templates/InstallTemplateDialog.vue'
import { useProjectModal, type ProjectDeepLink } from '~/composables/useProjectModal'
import { useProjectView } from '~/composables/useProjectView'
import { useProjectActions } from '~/composables/useProjectActions'
import { useProjectsStore } from '~/stores/projects'
import type { Project } from '~/types'
import Button from '~/components/ui/button/Button.vue'

// Scrim của peek: z-120 (trên shell, dưới modal hành động z-100+ khi peek đã đóng).
const OVERLAY = 'fixed inset-0 z-120 flex items-center justify-center bg-black/55 p-6'

const { t } = useI18n()
const { isOpen, key, tab, ghNumber, target, close } = useProjectModal()
const store = useProjectsStore()

// Deep-link the opener asked for (GitHub notification toast → this PR/issue).
// `target` re-stamps on every open so clicking the same notification twice
// re-applies it even when the detail is already showing that thread.
const deepLink = computed<ProjectDeepLink | null>(() =>
  tab.value ? { tab: tab.value, ghNumber: ghNumber.value, token: target.value } : null,
)

// The session's `project` value may be an id OR a display name — resolve either.
const project = computed<Project | null>(() => {
  const k = key.value
  if (!k) return null
  return store.projectById(k) ?? store.projects.find((p) => p.name === k) ?? null
})
const view = useProjectView(() => project.value?.id ?? null)

// Shared management flows, scoped to the peeked project.
const actions = useProjectActions({
  currentProject: () => project.value,
})

// Launch an action: close the peek first (its z:120 overlay would otherwise hide the
// action modal at z:100), then run the flow with the peeked project.
function withProject(run: (p: Project) => void): void {
  const p = project.value
  if (!p) return
  close()
  run(p)
}
const onEdit = () => withProject((p) => actions.openEdit(p))
const onDelete = () => withProject((p) => actions.askDelete(p))
const onOpenLlm = () => withProject((p) => actions.openLlm(p))
const onOpenCode = () => withProject((p) => void actions.openCode(p))
const onOpenWorkspace = () => withProject((p) => actions.openWorkspace(p))
const onSaveTemplate = () => withProject(() => actions.openSaveTemplate())
const onInstallTemplate = () => withProject(() => void actions.openInstallTemplate())

// Esc closes the peek (only while open, so it doesn't swallow other Esc users).
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && isOpen.value) {
    e.preventDefault()
    close()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>
