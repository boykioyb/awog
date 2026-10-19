<template>
  <section class="flex min-w-0 flex-1 flex-col overflow-hidden" data-page="templates">
    <!-- Thanh hành động mảnh nằm trên khung master-detail. -->
    <div class="flex shrink-0 items-center gap-2 border-b px-4 py-3">
      <h1 class="flex-1 text-lg font-semibold text-foreground">{{ t('templates.title') }}</h1>
      <Button :disabled="refreshing" variant="outline" size="sm" @click="refresh()">
        <Icon name="refresh" class="size-3.5" />
        {{ t('templates.refresh') }}
      </Button>
      <Button variant="outline" size="sm" @click="openDiscoverDialog">
        <Icon name="layers" class="size-3.5" />
        {{ t('templatesDiscover.open') }}
      </Button>
      <Button variant="outline" size="sm" @click="openFetchDialog">
        <Icon name="globe" class="size-3.5" />
        {{ t('templates.fetchGithub') }}
      </Button>
      <Button variant="default" size="sm" @click="openSaveDialog">
        <Icon name="plus" class="size-3.5" />
        {{ t('templates.new') }}
      </Button>
    </div>

    <!-- min-h-0: cho khung LibraryView (flex-1) co lại và tự cuộn trong cột. -->
    <LibraryView
      class="min-h-0"
      :items="templates"
      :item-key="templateKey"
      :search-text="(tpl) => tpl.name + tpl.description"
      :placeholder="t('templates.search')"
    >
      <template #row="{ item: tpl }">
        <div class="flex items-center gap-2">
          <span class="min-w-0 flex-1 truncate text-base font-medium">{{ tpl.name }}</span>
          <Badge variant="outline" class="text-muted-foreground">
            {{ t('templates.detail.entityCount', { n: tpl.entities.length }) }}
          </Badge>
        </div>
        <div class="mt-1 truncate text-sm text-muted-foreground">
          {{ tpl.description || t('templates.noDescription') }}
        </div>
      </template>

      <template #detail="{ item: tpl }">
        <TemplateDetail
          :template="tpl"
          @install="openInstallFor(tpl)"
          @delete="askDelete(tpl)"
          @check-update="openUpdateFor(tpl)"
        />
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

    <!-- browse the published catalog, then consent, then install (gói #37) -->
    <TemplateDiscoverDialog
      :open="discoverDialogOpen"
      @close="closeDiscoverDialog"
      @installed="onDiscoverInstalled"
    />

    <TemplateUpdateDialog
      v-if="updateCheck"
      :open="updateDialogOpen"
      :template-name="updateTemplateName"
      :check="updateCheck"
      @close="closeUpdateDialog"
      @updated="onUpdated"
    />

    <!-- delete confirm -->
    <LibraryConfirmDelete
      :open="!!pendingDelete"
      :title="t('templates.delete.title', { name: pendingDelete?.name ?? '' })"
      :description="t('templates.delete.description')"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />
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
import TemplateDiscoverDialog from '~/components/templates/TemplateDiscoverDialog.vue'
import TemplateUpdateDialog from '~/components/templates/TemplateUpdateDialog.vue'
import { useTemplatesPage } from '~/composables/useTemplatesPage'
import Button from '~/components/ui/button/Button.vue'

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
  discoverDialogOpen,
  installFixedTemplateId,
  openSaveDialog,
  openFetchDialog,
  openDiscoverDialog,
  openInstallFor,
  closeSaveDialog,
  closeFetchDialog,
  closeDiscoverDialog,
  closeInstallDialog,
  onSaved,
  onFetched,
  onDiscoverInstalled,
  onInstalled,
  updateDialogOpen,
  updateCheck,
  updateTemplateName,
  openUpdateFor,
  closeUpdateDialog,
  onUpdated,
  pendingDelete,
  askDelete,
  cancelDelete,
  confirmDelete,
} = useTemplatesPage()
</script>
