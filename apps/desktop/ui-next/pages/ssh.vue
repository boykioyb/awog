<template>
  <section class="page on" data-page="ssh">
    <SshWorkspace
      :hosts="hosts"
      :identities="identities"
      @connect="onConnect"
      @menu="openRowMenu"
      @new-host="openNew"
      @import="openImport"
      @new-identity="openNewIdentity"
      @edit-identity="openEditIdentity"
      @delete-identity="askDeleteIdentity"
    />

    <!-- per-host action menu (⋯ button + right-click): Connect / Edit / Delete -->
    <ContextMenu
      :open="!!rowMenu.pos.value"
      :position="rowMenu.pos.value ?? { x: 0, y: 0 }"
      :items="rowMenuItems"
      @close="rowMenu.close"
      @select="onRowMenuSelect"
    />

    <!-- create / edit host -->
    <SshEditor
      :open="editorOpen"
      :host="editTarget"
      :identities="identities"
      :hosts="hosts"
      :seed-folder="seedFolder"
      @save="onSaveHost"
      @cancel="closeEditor"
    />

    <!-- create / edit identity -->
    <SshIdentityEditor
      :open="identityEditorOpen"
      :identity="identityTarget"
      @save="onSaveIdentity"
      @cancel="closeIdentityEditor"
    />

    <!-- import from ~/.ssh/config -->
    <SshImportPicker
      :open="importOpen"
      :candidates="candidates"
      :loading="importLoading"
      @close="closeImport"
      @confirm="applyImport"
    />

    <!-- delete confirm (hosts + identities) -->
    <LibraryConfirmDelete
      :open="!!pendingDelete"
      :title="deleteTitle"
      :description="deleteDescription"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />

    <!-- host-key TOFU prompt (P2): parked connect awaits the user's decision -->
    <SshHostKeyModal :open="!!pendingHostKey" :prompt="pendingHostKey" @confirm="confirmHostKey" />

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
// SSH Manager (ADR 0063) — a Termius-style workspace: a top tab bar (persistent
// Hosts tab + one tab per open terminal) over a stage that shows either the Hosts
// management view (section nav + host grid / keychain / port forwarding / …) or a
// full-screen terminal. The shell + sections live in <SshWorkspace>; this page owns
// the overlays (editors, import, delete confirm, host-key TOFU, toasts) and wires
// the workspace's action events to useSshPage (page-controller).
import SshEditor from '~/components/ssh/SshEditor.vue'
import SshHostKeyModal from '~/components/ssh/SshHostKeyModal.vue'
import SshIdentityEditor from '~/components/ssh/SshIdentityEditor.vue'
import SshImportPicker from '~/components/ssh/SshImportPicker.vue'
import SshWorkspace from '~/components/ssh/SshWorkspace.vue'
import LibraryConfirmDelete from '~/components/library/LibraryConfirmDelete.vue'
import { useSshPage } from '~/composables/useSshPage'

const {
  hosts,
  identities,
  editorOpen,
  editTarget,
  seedFolder,
  openNew,
  closeEditor,
  onSaveHost,
  identityEditorOpen,
  identityTarget,
  openNewIdentity,
  openEditIdentity,
  askDeleteIdentity,
  closeIdentityEditor,
  onSaveIdentity,
  importOpen,
  importLoading,
  candidates,
  openImport,
  closeImport,
  applyImport,
  pendingDelete,
  cancelDelete,
  deleteTitle,
  deleteDescription,
  confirmDelete,
  onConnect,
  pendingHostKey,
  confirmHostKey,
  rowMenu,
  openRowMenu,
  rowMenuItems,
  onRowMenuSelect,
  toasts,
  toastColor,
} = useSshPage()
</script>
