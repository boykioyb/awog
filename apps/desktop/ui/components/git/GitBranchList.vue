<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div
      class="px-3 py-2 flex items-center justify-between flex-shrink-0"
      :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <div class="text-[11px] uppercase tracking-wider" :style="{ color: t.textDim }">Branches</div>
      <button
        class="flex items-center gap-1 px-2 py-1 text-[10px] rounded transition"
        :style="{ background: t.accent, color: t.accentText }"
        @click="showCreate = true"
      >
        <Plus :size="10" />
        New
      </button>
    </div>
    <div class="flex-1 overflow-y-auto">
      <div class="px-3 py-2 text-[10px] uppercase tracking-wider" :style="{ color: t.textFaint }">
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
        class="px-3 py-2 text-[10px] uppercase tracking-wider"
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

    <GitDirtyCheckoutModal
      :open="dirtyCheckout !== null"
      :target-branch="dirtyCheckout ?? ''"
      @close="dirtyCheckout = null"
      @discard="onDirtyResolve('discard')"
      @keep="onDirtyResolve('keep')"
      @stash="onDirtyResolve('stash')"
    />

    <ConfirmDeleteModal
      v-if="pendingDelete"
      title="Delete branch?"
      :description="`Branch '${pendingDelete}' sẽ bị xóa. Tiếp tục?`"
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
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
const dirtyCheckout = ref<string | null>(null)
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
const onCheckout = async (name: string, isCurrent: boolean) => {
  if (isCurrent) return
  if (store.hasUncommitted) {
    dirtyCheckout.value = name
    return
  }
  await store.checkoutBranch(name)
}

// Một handler chung cho 3 action của dirty-checkout (stash/discard/keep).
// Mỗi action có pre-step khác nhau trước khi cùng checkout.
const onDirtyResolve = async (action: 'stash' | 'discard' | 'keep') => {
  const target = dirtyCheckout.value
  if (!target) return
  dirtyCheckout.value = null
  if (action === 'stash') {
    await store.stashSave(`auto-stash before switch to ${target}`)
  } else if (action === 'discard') {
    store.clearStatusForCurrentProject()
  }
  // 'keep': giữ nguyên statusFiles — chỉ checkout. Mock: branches/git carry-over.
  await store.checkoutBranch(target)
}

// ─── Modal actions ───────────────────────────────────────────────────────
const confirmDelete = async () => {
  if (pendingDelete.value) {
    await store.deleteBranch(pendingDelete.value)
  }
  pendingDelete.value = null
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
