<template>
  <section class="flex min-w-0 flex-1 overflow-hidden" data-page="connections">
    <LibraryView
      :items="sources"
      :item-key="(c) => c.slug"
      :search-text="(c) => c.slug + c.name + (c.description ?? '')"
      :placeholder="t('connections.search')"
      show-new
      @new="openAddPicker"
    >
      <template #row="{ item }">
        <div class="group/crow" @contextmenu.prevent="openRowMenu($event, item)">
          <div class="flex items-center gap-2">
            <SourceAvatar :source="item" size="sm" />
            <span class="min-w-0 flex-1 truncate text-base font-medium">
              {{ item.name || item.slug }}
            </span>
            <Badge variant="outline" class="text-muted-foreground uppercase">
              {{ t('connections.typeBadge.' + item.type) }}
            </Badge>
            <Badge
              v-if="deriveStatus(item) !== 'connected'"
              variant="outline"
              :class="STATUS_BADGE[deriveStatus(item)]"
              :title="item.connectionError || undefined"
            >
              {{ t('connections.statusBadge.' + deriveStatus(item)) }}
            </Badge>
          </div>
          <!-- 2×2: the ⋯ rides the second row's dead space on the right instead
               of reserving a slot on row 1 (leaving an empty gap between the
               badges and the row edge when it's hidden). -->
          <div class="mt-1 flex items-center justify-between gap-1.5 text-sm text-muted-foreground">
            <span class="min-w-0 flex-1 truncate">
              {{ item.tagline || item.provider || sourceTransport(item) }}
            </span>
            <!-- Nút ⋯ chỉ hiện khi hover hàng để dòng mô tả giữ đủ bề ngang lúc rảnh. -->
            <Button
              :title="t('connections.menu.more')"
              :aria-label="t('connections.menu.more')"
              class="-my-0.5 -mr-1 size-5 shrink-0 opacity-0 transition-opacity group-hover/crow:opacity-100 focus-visible:opacity-100"
              variant="ghost"
              size="iconSm"
              @click.stop="openRowMenu($event, item)"
            >
              <Icon name="dots" class="size-3.5" />
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
import { deriveStatus, sourceTransport, type SourceConnectionStatus } from '~/stores/connections'

const { t } = useI18n()

// Màu badge trạng thái ở hàng list (chữ + viền) — cùng ý nghĩa với SOURCE_STATUS_COLORS
// (stores/connections.ts) nhưng ở dạng utility ngữ nghĩa thay cho var màu inline.
const STATUS_BADGE: Record<SourceConnectionStatus, string> = {
  connected: 'border-success text-success',
  needs_auth: 'border-warning text-warning',
  failed: 'border-destructive text-destructive',
  untested: 'text-dim',
  local_disabled: 'text-faint',
}

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
