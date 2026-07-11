<template>
  <section class="page on" data-page="connections">
    <LibraryView
      :items="sources"
      :item-key="(c) => c.slug"
      :search-text="(c) => c.slug + c.name + (c.description ?? '') + sourceTransport(c)"
      :placeholder="t('connections.search')"
      show-new
      @new="openAddPicker"
    >
      <template #row="{ item }">
        <div class="lrow">
          <SourceAvatar :source="item" size="sm" />
          <span class="ttl">{{ item.name || item.slug }}</span>
          <span class="tag crow-type">{{ t('connections.typeBadge.' + item.type) }}</span>
          <span
            v-if="deriveStatus(item) !== 'connected'"
            class="tag crow-status"
            :style="{ color: statusColor(item), borderColor: statusColor(item) }"
            :title="item.connectionError || undefined"
          >
            {{ t('connections.statusBadge.' + deriveStatus(item)) }}
          </span>
        </div>
        <div class="sub">
          {{ item.tagline || item.provider || sourceTransport(item) }}
        </div>
      </template>

      <template #detail="{ item }">
        <ConnectionDetail
          :source="item"
          @edit="openEditor(item)"
          @delete="askDelete(item)"
          @toggle="onToggle(item)"
          @test="(done) => runTest(item, done)"
          @oauth="(done) => runOAuth(item, done)"
          @cancel-oauth="cancelOAuth(item)"
        />
      </template>
    </LibraryView>

    <!-- add flow — first step: pick a starting point (blank / AI / preset) -->
    <ConnectionAddPicker
      :open="addPickerOpen"
      :presets="presets"
      @close="closeAddPicker"
      @scratch="startFromScratch"
      @ai="startFromAi"
      @pick="onPickPreset"
    />

    <!-- create (chat-driven config authoring) -->
    <ConnectionPromptCreator
      :open="creatorOpen"
      :account-id="accountId"
      @close="onCreatorClose"
      @turn="onCreatorTurn"
    />

    <!-- edit (form) — seeded with a preset draft when one was chosen -->
    <ConnectionEditor
      :open="editorOpen"
      :source="editTarget"
      :seed="seedSource"
      :setup-hint="seedSetupHint"
      :verify="runVerify"
      @save="onSave"
      @cancel="closeEditor"
    />

    <!-- delete confirm -->
    <LibraryConfirmDelete
      :open="!!pendingDelete"
      :title="t('connections.delete')"
      :description="deleteDescription"
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
// Connections (Sources) library — live store + full CRUD + chat-driven creation
// (ADR 0060 P1, "Craft Sources" model). Rewired from the old `mcp.*` surface to
// `source.*`. Shell from <LibraryView>; all state + handlers live in
// useConnectionsPage (page-controller). Status is the persisted last-test result,
// not a live process.
import ConnectionAddPicker from '~/components/connection/ConnectionAddPicker.vue'
import ConnectionDetail from '~/components/connection/ConnectionDetail.vue'
import ConnectionEditor from '~/components/connection/ConnectionEditor.vue'
import ConnectionPromptCreator from '~/components/connection/ConnectionPromptCreator.vue'
import SourceAvatar from '~/components/connection/SourceAvatar.vue'
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'
import { useConnectionsPage } from '~/composables/useConnectionsPage'
import {
  deriveStatus,
  sourceTransport,
  SOURCE_STATUS_COLORS,
  type Source,
} from '~/stores/connections'

const { t } = useI18n()

// Theme color for a source's derived status — drives the list-row status badge
// (text + border), matching Craft's colored status label.
const statusColor = (s: Source): string => SOURCE_STATUS_COLORS[deriveStatus(s)]

const {
  sources,
  accountId,
  addPickerOpen,
  presets,
  openAddPicker,
  closeAddPicker,
  startFromScratch,
  startFromAi,
  onPickPreset,
  creatorOpen,
  onCreatorTurn,
  onCreatorClose,
  editorOpen,
  editTarget,
  seedSource,
  seedSetupHint,
  openEditor,
  closeEditor,
  onSave,
  onToggle,
  runTest,
  runVerify,
  runOAuth,
  cancelOAuth,
  pendingDelete,
  askDelete,
  cancelDelete,
  deleteDescription,
  confirmDelete,
  toasts,
  toastColor,
} = useConnectionsPage()
</script>

<style scoped>
.crow-type {
  font-size: 12px;
  padding: 1px 6px;
  text-transform: uppercase;
}
.crow-status {
  font-size: 12px;
  padding: 1px 6px;
  background: transparent;
}
</style>
