<template>
  <section class="page on tpl-page" data-page="templates">
    <div class="tpl-bar">
      <span class="tpl-bar-title">{{ t('templates.title') }}</span>
      <span style="flex: 1" />
      <button class="btn sm" :disabled="refreshing" @click="refresh()">
        <Icon name="refresh" style="width: 13px; height: 13px" />
        {{ t('templates.refresh') }}
      </button>
      <button class="btn sm" @click="openFetchDialog">
        <Icon name="globe" style="width: 13px; height: 13px" />
        {{ t('templates.fetchGithub') }}
      </button>
      <button class="btn pri sm" @click="openSaveDialog">
        <Icon name="plus" style="width: 13px; height: 13px" />
        {{ t('templates.new') }}
      </button>
    </div>

    <LibraryView
      :items="templates"
      :item-key="templateKey"
      :search-text="(tpl) => tpl.name + tpl.description"
      :placeholder="t('templates.search')"
    >
      <template #row="{ item: tpl }">
        <div class="lrow">
          <span class="ttl">{{ tpl.name }}</span>
          <span class="tag">
            {{ t('templates.detail.entityCount', { n: tpl.entities.length }) }}
          </span>
        </div>
        <div class="sub">{{ tpl.description || t('templates.noDescription') }}</div>
      </template>

      <template #detail="{ item: tpl }">
        <TemplateDetail :template="tpl" @install="openInstallFor(tpl)" @delete="askDelete(tpl)" />
      </template>
    </LibraryView>

    <!-- save-as (export a project's project-tier entities into a bundle) -->
    <SaveAsTemplateDialog
      :open="saveDialogOpen"
      :projects="projectList"
      @close="closeSaveDialog"
      @saved="onSaved"
    />

    <!-- install (write a bundle into a target project) -->
    <InstallTemplateDialog
      :open="installDialogOpen"
      :projects="projectList"
      :fixed-template-id="installFixedTemplateId"
      @close="closeInstallDialog"
      @installed="onInstalled"
    />

    <!-- fetch from a public GitHub folder (ADR 0037) -->
    <FetchFromGithubDialog :open="fetchDialogOpen" @close="closeFetchDialog" @fetched="onFetched" />

    <!-- delete confirm -->
    <LibraryConfirmDelete
      :open="!!pendingDelete"
      :title="t('templates.delete.title', { name: pendingDelete?.name ?? '' })"
      :description="t('templates.delete.description')"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
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
// Project Templates library — live store + full flow (list/detail + Install,
// Save-as, Fetch-from-GitHub dialogs + delete confirm). Replaces the static
// prototype seed. Master-detail shell from <LibraryView>; all state + handlers
// live in useTemplatesPage (page-controller). Mirrors the Skills reference slice
// (ADR 0035/0036).
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'
import LibraryView from '~/components/library/LibraryView.vue'
import FetchFromGithubDialog from '~/components/templates/FetchFromGithubDialog.vue'
import InstallTemplateDialog from '~/components/templates/InstallTemplateDialog.vue'
import SaveAsTemplateDialog from '~/components/templates/SaveAsTemplateDialog.vue'
import TemplateDetail from '~/components/templates/TemplateDetail.vue'
import { useTemplatesPage } from '~/composables/useTemplatesPage'

const { t } = useI18n()

const {
  templates,
  projectList,
  templateKey,
  refreshing,
  refresh,
  saveDialogOpen,
  fetchDialogOpen,
  installDialogOpen,
  installFixedTemplateId,
  openSaveDialog,
  openFetchDialog,
  openInstallFor,
  closeSaveDialog,
  closeFetchDialog,
  closeInstallDialog,
  onSaved,
  onFetched,
  onInstalled,
  pendingDelete,
  askDelete,
  cancelDelete,
  confirmDelete,
  toasts,
  toastColor,
} = useTemplatesPage()
</script>

<style scoped>
/* Column layout — a slim action bar above the master-detail shell. */
.tpl-page {
  flex-direction: column;
}
/* Let the LibraryView shell (.md, flex:1) shrink + scroll inside the column. */
.tpl-page :deep(.md) {
  min-height: 0;
}
.tpl-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 16px;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.tpl-bar-title {
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
  color: var(--text);
}
</style>
