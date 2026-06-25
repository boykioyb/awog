<template>
  <section class="page on" data-page="connections">
    <LibraryView
      :items="servers"
      :item-key="(c) => c.id"
      :search-text="(c) => c.id + c.name + c.description + c.transport"
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
              background: statusColor(item.status),
            }"
          />
          <span class="ttl">{{ item.name || item.id }}</span>
          <span class="tag mono" style="padding: 1px 6px">{{ item.transport }}</span>
        </div>
        <div class="sub">
          {{ t('connections.toolsStatus', { n: item.tools.length, status: item.status }) }}
        </div>
      </template>

      <template #detail="{ item }">
        <ConnectionDetail
          :server="item"
          :stderr="stderrOf(item.id)"
          @edit="openEditor(item)"
          @delete="askDelete(item)"
          @toggle="onToggle(item)"
          @restart="onRestart(item)"
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
      :server="editTarget"
      :test="testServer"
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
// Connections (MCP) library — live store + full CRUD + chat-driven creation
// (ADR 0025, flat global "Sources" list). Replaces the static mock from the
// prototype port. Shell from <LibraryView>; all state + handlers live in
// useConnectionsPage (page-controller). Mirrors the skills reference slice.
import ConnectionDetail from '~/components/connection/ConnectionDetail.vue'
import ConnectionEditor from '~/components/connection/ConnectionEditor.vue'
import ConnectionPromptCreator from '~/components/connection/ConnectionPromptCreator.vue'
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'
import { useConnectionsPage } from '~/composables/useConnectionsPage'
import type { ConnectionStatus, McpServer, McpTestResult } from '~/stores/connections'

const { t } = useI18n()

const {
  servers,
  stderrOf,
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
  onRestart,
  onToggleTool,
  testServer,
  pendingDelete,
  askDelete,
  cancelDelete,
  deleteDescription,
  confirmDelete,
  toasts,
  toastColor,
} = useConnectionsPage()

const STATUS_COLORS: Record<ConnectionStatus, string> = {
  running: 'var(--green)',
  starting: 'var(--amber)',
  idle: 'var(--textDim)',
  error: 'var(--danger)',
  disabled: 'var(--textFaint)',
}
const statusColor = (status: ConnectionStatus): string => STATUS_COLORS[status]

// Bridge the detail's `test` emit (which carries a done-callback) to the store's
// async testServer — keeps ConnectionDetail store-free (SoC).
const runTest = (server: McpServer, done: (result: McpTestResult) => void) => {
  void testServer(server).then(done)
}
</script>
