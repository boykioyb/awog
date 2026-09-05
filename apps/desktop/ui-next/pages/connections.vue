<template>
  <section class="page on" data-page="connections">
    <LibraryView
      :items="itemsWithSsh"
      :item-key="(c) => c.slug"
      :search-text="(c) => c.slug + c.name + (c.description ?? '')"
      :placeholder="t('connections.search')"
      show-new
      @new="openAddPicker"
    >
      <template #row="{ item }">
        <!-- Built-in SSH entry: a pointer to the SSH page (hosts are managed there);
             it isn't a configurable source, so no type/status/menu. -->
        <div v-if="item.slug === SSH_SLUG" class="crow">
          <div class="lrow">
            <span class="ssh-src-ic"><Icon name="ssh" style="width: 15px; height: 15px" /></span>
            <span class="ttl">{{ t('connections.ssh.name') }}</span>
            <span class="tag crow-type">{{ t('connections.ssh.builtin') }}</span>
          </div>
          <div class="sub">{{ t('connections.ssh.sub', { n: agentHostCount }) }}</div>
        </div>
        <div v-else class="crow" @contextmenu.prevent="openRowMenu($event, item)">
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
            <button
              class="iconbtn crow-menu"
              :title="t('connections.menu.more')"
              @click.stop="openRowMenu($event, item)"
            >
              <Icon name="dots" style="width: 13px; height: 13px" />
            </button>
          </div>
          <div class="sub">
            {{ item.tagline || item.provider || sourceTransport(item) }}
          </div>
        </div>
      </template>

      <template #detail="{ item }">
        <div v-if="item.slug === SSH_SLUG" class="ssh-src-detail">
          <div class="ssh-src-hero">
            <span class="ssh-src-ic lg"><Icon name="ssh" style="width: 22px; height: 22px" /></span>
            <div>
              <div class="ssh-src-title">{{ t('connections.ssh.name') }}</div>
              <div class="ssh-src-desc">{{ t('connections.ssh.detail') }}</div>
            </div>
          </div>
          <p class="ssh-src-body">{{ t('connections.ssh.body', { n: agentHostCount }) }}</p>
          <button class="btn pri" @click="goSsh">
            <Icon name="ssh" style="width: 14px; height: 14px" />
            {{ t('connections.ssh.manage') }}
          </button>
        </div>
        <ConnectionDetail
          v-else
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
    <ContextMenu
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
import { computed, onMounted } from 'vue'
import { useConnectionsPage } from '~/composables/useConnectionsPage'
import { useSshStore } from '~/stores/ssh'
import {
  deriveStatus,
  sourceTransport,
  SOURCE_STATUS_COLORS,
  type Source,
} from '~/stores/connections'

const { t } = useI18n()

// Built-in SSH entry surfaced in the Sources list (ADR 0064 unified model). SSH
// isn't a configurable source — hosts are managed on the /ssh page — so this is a
// read-only pointer. Injected as a synthetic list item (cast: it's never passed to
// the source helpers except sourceTransport, which just returns its type string).
const SSH_SLUG = '__ssh__'
const sshStore = useSshStore()
const agentHostCount = computed(() => sshStore.hosts.filter((h) => h.agentEnabled !== false).length)
const sshEntry = computed(
  () =>
    ({
      slug: SSH_SLUG,
      name: t('connections.ssh.name'),
      type: 'builtin',
      description: 'ssh remote host terminal exec sftp',
    }) as unknown as Source,
)
const goSsh = () => navigateTo('/ssh')
onMounted(() => {
  void sshStore.loadAll()
})

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
  toasts,
  toastColor,
} = useConnectionsPage()

// Built-in SSH entry first, then the configured sources.
const itemsWithSsh = computed<Source[]>(() => [sshEntry.value, ...sources.value])
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
/* Per-source ⋯ menu button — reveals on row hover (mirrors the app's .hoveract
   pattern: kept in layout so fading it in never shifts the badges). */
.crow-menu {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--r-xs);
  flex: 0 0 auto;
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
/* Built-in SSH entry — accent-tinted icon tile, distinct from configurable sources. */
.ssh-src-ic {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  border-radius: var(--r-xs);
  background: var(--accentDim);
  color: var(--accent);
}
.ssh-src-ic.lg {
  width: 44px;
  height: 44px;
  border-radius: var(--r-btn);
}
.ssh-src-detail {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: flex-start;
}
.ssh-src-hero {
  display: flex;
  align-items: center;
  gap: 14px;
}
.ssh-src-title {
  font-size: var(--fs-lg);
  font-weight: 650;
  color: var(--text);
}
.ssh-src-desc {
  font-size: var(--fs-sm);
  color: var(--textDim);
  margin-top: 2px;
}
.ssh-src-body {
  font-size: 1em;
  line-height: 1.6;
  color: var(--textDim);
  max-width: 60ch;
}
</style>
