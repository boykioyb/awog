<template>
  <section class="page on" data-page="connections">
    <LibraryView
      :items="sources"
      :item-key="(c) => c.slug"
      :search-text="(c) => c.slug + c.name + (c.description ?? '')"
      :placeholder="t('connections.search')"
      show-new
      @new="openAddPicker"
    >
      <template #row="{ item }">
        <div class="crow" @contextmenu.prevent="openRowMenu($event, item)">
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
          <!-- 2×2: the ⋯ rides the second row's dead space on the right instead
               of reserving a slot on row 1 (leaving an empty gap between the
               badges and the row edge when it's hidden). -->
          <div class="sub">
            <span class="sub-txt">
              {{ item.tagline || item.provider || sourceTransport(item) }}
            </span>
            <Button
              :title="t('connections.menu.more')"
              class="crow-menu"
              variant="outline"
              size="iconMd"
              @click.stop="openRowMenu($event, item)"
            >
              <Icon name="dots" style="width: var(--icon-sm); height: var(--icon-sm)" />
            </Button>
          </div>
        </div>
      </template>

      <template #detail="{ item }">
        <ConnectionDetail
          :source="item"
          @edit="openEditor(item)"
          @delete="askDelete(item)"
          @reveal="revealSource(item)"
          @toggle="onToggle(item)"
          @test="(done) => runTest(item, done)"
          @oauth="(done) => runOAuth(item, done)"
          @cancel-oauth="cancelOAuth(item)"
        />
      </template>
    </LibraryView>

    <!-- per-source action menu (⋯ button + right-click): Edit / Show in folder /
         Delete — Craft SourceMenu parity -->
    <AppContextMenu
      :open="!!rowMenu.pos.value"
      :position="rowMenu.pos.value ?? { x: 0, y: 0 }"
      :items="rowMenuItems"
      @close="rowMenu.close"
      @select="onRowMenuSelect"
    />

    <!-- add flow — first step: pick a starting point (blank / AI / preset) -->
    <ConnectionAddPicker
      :open="addPickerOpen"
      :presets="presets"
      @close="closeAddPicker"
      @scratch="startFromScratch"
      @ai="startFromAi"
      @pick="onPickPreset"
      @quick="onQuickPick"
    />

    <!-- "Kết nối" guided flow — upsert → secrets → test → OAuth, không qua
         editor (Claude Connectors parity). Editor vẫn là đường thoát nâng cao. -->
    <ConnectionQuickConnect
      :open="quick.open.value"
      :phase="quick.phase.value"
      :draft="quick.draft.value"
      :meta="quick.meta.value"
      :secret-fields="quick.secretFields.value"
      :secret-note-key="quick.secretNoteKey.value"
      :busy-key="quick.busyKey.value"
      :error-text="quick.errorText.value"
      :error-stderr="quick.errorStderr.value"
      :done-tools="quick.doneTools.value"
      @close="quick.close"
      @advance="quick.advance"
      @open-in-editor="quick.openInEditor"
      @retry="quick.retry"
      @submit-secrets="quick.submitSecrets"
    />

    <!-- create / refine (chat-driven config authoring) -->
    <ConnectionPromptCreator
      :open="creatorOpen"
      :account="account"
      :edit-source="creatorEditSource"
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
      @refine-ai="editTarget && openCreatorForEdit(editTarget)"
    />

    <!-- delete confirm -->
    <LibraryConfirmDelete
      :open="!!pendingDelete"
      :title="t('connections.delete')"
      :description="deleteDescription"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />
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
import ConnectionQuickConnect from '~/components/connection/ConnectionQuickConnect.vue'
import SourceAvatar from '~/components/connection/SourceAvatar.vue'
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'
import { useConnectionsPage } from '~/composables/useConnectionsPage'
import Button from '~/components/ui/button/Button.vue'
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
  account,
  addPickerOpen,
  presets,
  openAddPicker,
  closeAddPicker,
  startFromScratch,
  startFromAi,
  onPickPreset,
  onQuickPick,
  quick,
  creatorOpen,
  creatorEditSource,
  openCreatorForEdit,
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
  revealSource,
  rowMenu,
  openRowMenu,
  rowMenuItems,
  onRowMenuSelect,
} = useConnectionsPage()
</script>

<style scoped>
.crow-type {
  font-size: 12px;
  line-height: 18px;
  padding: 1px 6px;
  text-transform: uppercase;
}
.crow-status {
  font-size: 12px;
  line-height: 18px;
  padding: 1px 6px;
  background: transparent;
}
/* Per-source ⋯ menu button — sits on the second row (right end of .sub),
   reveals on row hover so the slug line keeps its full width when idle. */
.sub {
  justify-content: space-between;
}
.sub-txt {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.crow-menu {
  width: 22px;
  height: 18px;
  border: none;
  border-radius: var(--r-xs);
  flex: 0 0 auto;
  margin: -1px -4px -1px 0;
  opacity: 0;
  transition: opacity 0.12s;
}
.libli:hover .crow-menu {
  opacity: 1;
}
.crow-menu:hover {
  background: var(--bgHover);
  color: var(--text);
}
</style>
