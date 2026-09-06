<template>
  <section class="page on" data-page="projects">
    <div class="md libwrap">
      <ProjectList
        :projects="projects"
        :selected-id="selected?.id ?? null"
        @select="onSelect"
        @new="openCreate"
      />
      <ProjectDetail
        v-if="selected && overview"
        :project="selected"
        :view="overview"
        @edit="openEdit(selected)"
        @delete="askDelete(selected)"
        @open-llm="openLlm(selected)"
        @open-code="openCode(selected)"
        @open-workspace="openWorkspace(selected)"
        @save-template="openSaveTemplate"
        @install-template="openInstallTemplate"
        @imported="onImported"
      />
      <div v-else class="detail">
        <div class="empty">
          <span class="ei">
            <Icon name="projects" style="width: var(--icon-lg); height: var(--icon-lg)" />
          </span>
          <div class="et">{{ t('projects.empty') }}</div>
          <button class="btn pri sm" @click="openCreate">
            <Icon name="plus" />
            {{ t('projects.list.new') }}
          </button>
        </div>
      </div>
    </div>

    <!-- create / edit (link / clone / update) -->
    <ProjectEditor
      :open="editorOpen"
      :project="editTarget"
      :busy="editorBusy"
      :error="editorError"
      :progress="editorProgress"
      :can-browse="canBrowse"
      :inspect="inspectPath"
      :inspect-remote="inspectRemote"
      :generate-description="generateDescription"
      :browse="browseFolder"
      @save="onSave"
      @cancel="closeEditor"
    />

    <!-- per-project LLM defaults -->
    <ProjectLlmDefaultsModal
      :open="llmOpen"
      :project="llmTarget"
      @saved="onLlmSaved"
      @cancel="closeLlm"
    />

    <!-- delete confirm -->
    <LibraryConfirmDelete
      :open="!!pendingDelete"
      :title="t('projects.delete.title')"
      :description="deleteDescription"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />

    <!-- save-as template — pre-targeted to the selected project (single-entry
         projects list locks the source picker to it) -->
    <SaveAsTemplateDialog
      :open="saveTemplateOpen"
      :projects="templateProjects"
      @close="closeSaveTemplate"
      @saved="onTemplateSaved"
    />

    <!-- install template — target pre-fixed to the selected project -->
    <InstallTemplateDialog
      :open="installTemplateOpen"
      :projects="templateProjects"
      @close="closeInstallTemplate"
      @installed="onTemplateInstalled"
    />

    <!-- transient toasts -->
    <div
      v-for="tt in toasts"
      :key="tt.id"
      class="toast"
      :style="{ borderColor: toastColor(tt.kind) }"
    >
      {{ tt.text }}
    </div>
  </section>
</template>

<script setup lang="ts">
// Projects — live store + full CRUD (link / clone / edit / delete) + per-project
// LLM defaults + GitHub Issues/PR integration + Templates (save-as / install,
// pre-targeted to the selected project) + in-app code workspace entry. Master-
// detail layout; all state + handlers live in useProjectsPage (page-controller).
// Replaces the static PDATA seed with the real projects store + gh.* RPC.
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'
import ProjectDetail from '~/components/project/ProjectDetail.vue'
import ProjectEditor from '~/components/project/ProjectEditor.vue'
import ProjectLlmDefaultsModal from '~/components/project/ProjectLlmDefaultsModal.vue'
import ProjectList from '~/components/project/ProjectList.vue'
import InstallTemplateDialog from '~/components/templates/InstallTemplateDialog.vue'
import SaveAsTemplateDialog from '~/components/templates/SaveAsTemplateDialog.vue'
import { useProjectsPage } from '~/composables/useProjectsPage'

const { t } = useI18n()

const {
  projects,
  selected,
  selectProject,
  overview,
  editorOpen,
  editTarget,
  editorBusy,
  editorError,
  editorProgress,
  openCreate,
  openEdit,
  closeEditor,
  onSave,
  inspectPath,
  inspectRemote,
  generateDescription,
  browseFolder,
  canBrowse,
  llmOpen,
  llmTarget,
  openLlm,
  closeLlm,
  onLlmSaved,
  pendingDelete,
  askDelete,
  cancelDelete,
  deleteDescription,
  confirmDelete,
  openCode,
  openWorkspace,
  templateProjects,
  saveTemplateOpen,
  installTemplateOpen,
  openSaveTemplate,
  closeSaveTemplate,
  onTemplateSaved,
  openInstallTemplate,
  closeInstallTemplate,
  onTemplateInstalled,
  onImported,
  toasts,
  toastColor,
} = useProjectsPage()

const onSelect = (id: string) => {
  const p = projects.value.find((x) => x.id === id)
  if (p) selectProject(p)
}
</script>
