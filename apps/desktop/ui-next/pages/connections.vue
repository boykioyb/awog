<template>
  <section class="page on" data-page="connections">
    <LibraryView
      :items="sources"
      :item-key="(c) => c.slug"
      :search-text="(c) => c.slug + c.name + (c.description ?? '') + sourceTransport(c)"
      :placeholder="t('connections.search')"
      show-new
      @new="openCreator"
    >
      <template #row="{ item }">
        <div class="lrow">
          <span
            class="sdot"
            :style="{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              flex: '0 0 auto',
              background: statusColor(item.connectionStatus),
            }"
          />
          <span class="ttl">{{ item.name || item.slug }}</span>
          <span class="tag mono" style="padding: 1px 6px">{{ sourceTransport(item) }}</span>
        </div>
        <div class="sub">
          {{ t('connections.status.' + (item.connectionStatus ?? 'untested')) }}
        </div>
      </template>

      <template #detail="{ item }">
        <ConnectionDetail
          :source="item"
          @edit="openEditor(item)"
          @delete="askDelete(item)"
          @toggle="onToggle(item)"
          @toggle-tool="(tool) => onToggleTool(item, tool)"
          @test="(done) => runTest(item, done)"
        />
      </template>
    </LibraryView>

    <!-- create (chat-driven config authoring) -->
    <ConnectionPromptCreator
      :open="creatorOpen"
      :account-id="accountId"
      @close="onCreatorClose"
      @turn="onCreatorTurn"
    />

    <!-- edit (form) -->
    <ConnectionEditor
      :open="editorOpen"
      :source="editTarget"
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
import ConnectionDetail from '~/components/connection/ConnectionDetail.vue'
import ConnectionEditor from '~/components/connection/ConnectionEditor.vue'
import ConnectionPromptCreator from '~/components/connection/ConnectionPromptCreator.vue'
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'
import { useConnectionsPage } from '~/composables/useConnectionsPage'
import { sourceTransport, type SourceConnectionStatus } from '~/stores/connections'

const { t } = useI18n()

const {
  sources,
  accountId,
  creatorOpen,
  openCreator,
  onCreatorTurn,
  onCreatorClose,
  editorOpen,
  editTarget,
  openEditor,
  closeEditor,
  onSave,
  onToggle,
  onToggleTool,
  runTest,
  runVerify,
  pendingDelete,
  askDelete,
  cancelDelete,
  deleteDescription,
  confirmDelete,
  toasts,
  toastColor,
} = useConnectionsPage()

const STATUS_COLORS: Record<SourceConnectionStatus, string> = {
  connected: 'var(--green)',
  needs_auth: 'var(--amber)',
  failed: 'var(--danger)',
  untested: 'var(--textDim)',
  local_disabled: 'var(--textFaint)',
}
const statusColor = (status: SourceConnectionStatus | undefined): string =>
  STATUS_COLORS[status ?? 'untested']
</script>
