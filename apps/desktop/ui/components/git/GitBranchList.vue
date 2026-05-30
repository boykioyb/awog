<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div
      class="px-3 py-2 flex items-center justify-between flex-shrink-0"
      :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <div class="text-[0.79em] uppercase tracking-wider" :style="{ color: t.textDim }">
        Branches
      </div>
      <button
        class="flex items-center gap-1 px-2 py-1 text-[0.71em] rounded transition"
        :style="{ background: t.accent, color: t.accentText }"
        @click="showCreate = true"
      >
        <Plus :size="10" />
        New
      </button>
    </div>
    <div class="flex-1 overflow-y-auto">
      <div class="px-3 py-2 text-[0.71em] uppercase tracking-wider" :style="{ color: t.textFaint }">
        Local
      </div>
      <GitBranchTree
        :rows="localRows"
        :collapsed-folders="collapsedFolders"
        @toggle-folder="toggleFolder"
        @checkout="onCheckout"
        @context-menu="onTreeContextMenu"
        @more-menu="onTreeMoreMenu"
      />

      <div
        v-if="remoteRows.length > 0"
        class="px-3 py-2 text-[0.71em] uppercase tracking-wider"
        :style="{ color: t.textFaint, borderTop: `1px solid ${t.border}` }"
      >
        Remote
      </div>
      <GitBranchTree
        :rows="remoteRows"
        :collapsed-folders="collapsedFolders"
        is-remote
        @toggle-folder="toggleFolder"
        @context-menu="onTreeContextMenu"
        @more-menu="onTreeMoreMenu"
      />
    </div>

    <GitBranchContextMenu
      :open="menu !== null"
      :position="menu ?? { x: 0, y: 0 }"
      :branch-name="menu?.name ?? ''"
      :is-remote="menu?.isRemote ?? false"
      :is-current="menu?.isCurrent ?? false"
      @close="menu = null"
      @checkout="onMenuCheckout"
      @checkout-as-local="onMenuCheckoutAsLocal"
      @create-from="onMenuCreateFrom"
      @rename="onMenuRename"
      @copy="copyToClipboard"
      @fetch="store.fetchRemote()"
      @delete="(name) => (pendingDelete = name)"
    />

    <GitBranchNameModal
      :open="showCreate"
      title="Create branch"
      submit-label="Create"
      placeholder="branch-name"
      :from-label="createFromRef || 'HEAD'"
      :model-value="newName"
      @update:model-value="newName = $event"
      @close="showCreate = false"
      @submit="onCreate"
    />

    <GitBranchNameModal
      :open="renameTarget !== null"
      title="Rename branch"
      submit-label="Rename"
      placeholder="new-branch-name"
      :from-label="renameTarget ?? ''"
      :model-value="renameValue"
      @update:model-value="renameValue = $event"
      @close="renameTarget = null"
      @submit="onRename"
    />

    <ConfirmDeleteModal
      v-if="pendingDelete"
      title="Delete branch?"
      :description="`Branch '${pendingDelete}' sẽ bị xóa. Tiếp tục?`"
      @confirm="confirmDelete"
      @cancel="onCancelDelete"
    >
      <template #extra>
        <label
          class="flex items-center gap-2 text-[0.79em] cursor-pointer select-none"
          :style="{ color: t.text }"
        >
          <input
            v-model="deleteRemoteToo"
            type="checkbox"
            class="cursor-pointer"
            :style="{ accentColor: t.danger }"
          />
          <span>
            Also delete
            <span class="font-mono">origin/{{ pendingDelete }}</span>
          </span>
        </label>
      </template>
    </ConfirmDeleteModal>

    <ConfirmDeleteModal
      v-if="store.pendingDeleteError"
      title="Force delete branch?"
      :description="`Branch '${store.pendingDeleteError.branch}' chưa được merge. Xóa bằng force sẽ mất commit chưa merge. Tiếp tục?`"
      @confirm="onForceDelete"
      @cancel="store.clearPendingDeleteError()"
    />
  </div>
</template>

<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import { buildBranchTree, flattenTree, isValidGitRef } from '~/utils/branch-tree'

const { t } = useTheme()
const store = useGitStore()

const showCreate = ref(false)
const newName = ref('')
const createFromRef = ref<string>('')
const pendingDelete = ref<string | null>(null)
const renameTarget = ref<string | null>(null)
const renameValue = ref('')

type MenuCtx = {
  x: number
  y: number
  name: string
  isRemote: boolean
  isCurrent: boolean
}
const menu = ref<MenuCtx | null>(null)

const localBranches = computed(() => store.branches.filter((b) => !b.isRemote))
const remoteBranches = computed(() => store.branches.filter((b) => b.isRemote))

const collapsedFolders = ref<Set<string>>(new Set())

const toggleFolder = (path: string) => {
  const next = new Set(collapsedFolders.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  collapsedFolders.value = next
}

const localRows = computed(() =>
  flattenTree(buildBranchTree(localBranches.value), collapsedFolders.value, 0, ''),
)
const remoteRows = computed(() =>
  flattenTree(buildBranchTree(remoteBranches.value), collapsedFolders.value, 0, 'r:'),
)

// ─── Context menu positioning ────────────────────────────────────────────
const MENU_WIDTH = 200
const MENU_HEIGHT = 220
const openMenuAt = (x: number, y: number, name: string, isRemote: boolean, isCurrent: boolean) => {
  const maxX = window.innerWidth - MENU_WIDTH - 8
  const maxY = window.innerHeight - MENU_HEIGHT - 8
  menu.value = { x: Math.min(x, maxX), y: Math.min(y, maxY), name, isRemote, isCurrent }
}

const onTreeContextMenu = (e: MouseEvent, name: string, isRemote: boolean, isCurrent: boolean) =>
  openMenuAt(e.clientX, e.clientY, name, isRemote, isCurrent)

const onTreeMoreMenu = (e: MouseEvent, name: string, isRemote: boolean, isCurrent: boolean) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  openMenuAt(rect.right, rect.bottom + 2, name, isRemote, isCurrent)
}

// ─── Checkout (dirty-aware) ──────────────────────────────────────────────
// Sidecar arbitrates dirty-tree refusal — on DIRTY_TREE the store populates
// `pendingCheckoutError` and the modal opens. UI no longer guards client-side.
const onCheckout = async (name: string, isCurrent: boolean) => {
  if (isCurrent) return
  await store.checkoutBranch(name)
}

// ─── Modal actions ───────────────────────────────────────────────────────
const deleteRemoteToo = ref(false)
const confirmDelete = async () => {
  if (pendingDelete.value) {
    const opts: { deleteRemote?: boolean } = {}
    if (deleteRemoteToo.value) opts.deleteRemote = true
    await store.deleteBranch(pendingDelete.value, opts)
  }
  pendingDelete.value = null
  deleteRemoteToo.value = false
}
const onCancelDelete = () => {
  pendingDelete.value = null
  deleteRemoteToo.value = false
}

// Force delete pathway — triggered when sidecar returned UNMERGED. Preserves
// the user's "also delete remote" choice from the first modal.
const onForceDelete = async () => {
  const pending = store.pendingDeleteError
  if (!pending) return
  store.clearPendingDeleteError()
  const opts: { force: true; deleteRemote?: boolean } = { force: true }
  if (deleteRemoteToo.value) opts.deleteRemote = true
  await store.deleteBranch(pending.branch, opts)
  deleteRemoteToo.value = false
}

const onCreate = async (value: string) => {
  const name = value.trim()
  if (!isValidGitRef(name)) return
  await store.createBranch(name, createFromRef.value || undefined)
  newName.value = ''
  createFromRef.value = ''
  showCreate.value = false
}

const onRename = async (value: string) => {
  const oldName = renameTarget.value
  if (!oldName) return
  const next = value.trim()
  if (!isValidGitRef(next)) return
  await store.renameBranch(oldName, next)
  renameTarget.value = null
  renameValue.value = ''
}

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Clipboard có thể fail trong môi trường non-secure; bỏ qua silently.
  }
}

// ─── Context menu handlers ───────────────────────────────────────────────
const onMenuCheckout = async (name: string, isCurrent: boolean) => {
  menu.value = null
  await onCheckout(name, isCurrent)
}

const onMenuCheckoutAsLocal = async (remoteName: string) => {
  menu.value = null
  const localName = remoteName.replace(/^origin\//, '')
  await store.createBranch(localName, remoteName)
  await onCheckout(localName, false)
}

const onMenuCreateFrom = (fromRef: string) => {
  menu.value = null
  createFromRef.value = fromRef
  showCreate.value = true
}

const onMenuRename = (name: string) => {
  menu.value = null
  renameTarget.value = name
  renameValue.value = name
}
</script>
