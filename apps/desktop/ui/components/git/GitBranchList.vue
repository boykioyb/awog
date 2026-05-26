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
      <div
        v-for="b in localBranches"
        :key="b.name"
        class="group flex items-center gap-2 px-3 py-2 cursor-pointer transition"
        :style="{
          background: hovered === b.name ? t.bgHover : 'transparent',
          borderLeft: b.isCurrent ? `2px solid ${t.accent}` : '2px solid transparent',
        }"
        @mouseenter="hovered = b.name"
        @mouseleave="hovered = null"
        @click="onCheckout(b.name, b.isCurrent)"
      >
        <GitBranchIcon :size="12" :style="{ color: b.isCurrent ? t.accent : t.textDim }" />
        <span class="text-xs flex-1 truncate" :style="{ color: t.text }">{{ b.name }}</span>
        <span v-if="b.isCurrent" class="text-[10px]" :style="{ color: t.textDim }">current</span>
        <span
          v-if="b.ahead > 0 || b.behind > 0"
          class="text-[10px] font-mono"
          :style="{ color: t.textDim }"
        >
          {{ b.ahead > 0 ? `↑${b.ahead}` : '' }}{{ b.behind > 0 ? ` ↓${b.behind}` : '' }}
        </span>
        <button
          v-if="!b.isCurrent"
          class="opacity-0 group-hover:opacity-100 p-1 rounded transition"
          title="Delete branch"
          :style="{ color: t.textDim }"
          @click.stop="askDelete(b.name)"
        >
          <Trash2 :size="11" />
        </button>
      </div>

      <div
        v-if="remoteBranches.length > 0"
        class="px-3 py-2 text-[10px] uppercase tracking-wider"
        :style="{ color: t.textFaint, borderTop: `1px solid ${t.border}` }"
      >
        Remote
      </div>
      <div
        v-for="b in remoteBranches"
        :key="b.name"
        class="flex items-center gap-2 px-3 py-2"
        :style="{ background: 'transparent' }"
      >
        <Cloud :size="12" :style="{ color: t.textDim }" />
        <span class="text-xs flex-1 truncate font-mono" :style="{ color: t.textMuted }">
          {{ b.name }}
        </span>
      </div>
    </div>

    <div
      v-if="showCreate"
      class="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 p-3"
      style="background: rgba(0, 0, 0, 0.5)"
      @click="showCreate = false"
    >
      <div
        class="w-full max-w-[400px] rounded-lg overflow-hidden flex flex-col"
        :style="{
          background: t.bgPanel,
          border: `1px solid ${t.borderStrong}`,
          boxShadow: `0 20px 60px ${t.shadow}`,
        }"
        @click.stop
      >
        <div
          class="px-4 py-3 text-sm font-medium"
          :style="{ borderBottom: `1px solid ${t.border}`, color: t.text }"
        >
          Create branch
        </div>
        <div class="p-4 flex flex-col gap-2">
          <input
            v-model="newName"
            placeholder="branch-name"
            class="w-full rounded text-xs px-2 py-1.5"
            :style="{
              background: t.bgInput,
              color: t.text,
              border: `1px solid ${t.border}`,
              outline: 'none',
            }"
            @keydown.enter="onCreate"
          />
          <div class="text-[10px]" :style="{ color: t.textDim }">
            From:
            <span class="font-mono">HEAD</span>
            ({{ store.currentBranch }})
          </div>
        </div>
        <div
          class="px-4 py-3 flex justify-end gap-2"
          :style="{ borderTop: `1px solid ${t.border}` }"
        >
          <button
            class="px-3 py-1.5 text-xs rounded transition"
            :style="{ color: t.textMuted }"
            @click="showCreate = false"
          >
            Cancel
          </button>
          <button
            class="px-3 py-1.5 text-xs rounded font-medium transition"
            :style="{ background: t.accent, color: t.accentText }"
            @click="onCreate"
          >
            Create
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="dirtyCheckout"
      class="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 p-3"
      style="background: rgba(0, 0, 0, 0.5)"
      @click="dirtyCheckout = null"
    >
      <div
        class="w-full max-w-[420px] rounded-lg overflow-hidden flex flex-col"
        :style="{
          background: t.bgPanel,
          border: `1px solid ${t.borderStrong}`,
          boxShadow: `0 20px 60px ${t.shadow}`,
        }"
        @click.stop
      >
        <div
          class="px-4 py-3 text-sm font-medium"
          :style="{ borderBottom: `1px solid ${t.border}`, color: t.text }"
        >
          Uncommitted changes
        </div>
        <div class="p-4 text-xs" :style="{ color: t.textMuted }">
          Workspace có change uncommitted. Chuyển sang
          <span class="font-mono">{{ dirtyCheckout }}</span>
          bằng cách nào?
        </div>
        <div
          class="px-4 py-3 flex justify-end gap-2"
          :style="{ borderTop: `1px solid ${t.border}` }"
        >
          <button
            class="px-3 py-1.5 text-xs rounded transition"
            :style="{ color: t.textMuted }"
            @click="dirtyCheckout = null"
          >
            Cancel
          </button>
          <button
            class="px-3 py-1.5 text-xs rounded transition"
            :style="{
              background: t.bgInput,
              color: t.text,
              border: `1px solid ${t.border}`,
            }"
            @click="dirtyDiscard"
          >
            Discard & checkout
          </button>
          <button
            class="px-3 py-1.5 text-xs rounded font-medium transition"
            :style="{ background: t.accent, color: t.accentText }"
            @click="dirtyStash"
          >
            Stash & checkout
          </button>
        </div>
      </div>
    </div>

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
import { GitBranch as GitBranchIcon, Plus, Trash2, Cloud } from 'lucide-vue-next'

const { t } = useTheme()
const store = useGitStore()

const hovered = ref<string | null>(null)
const showCreate = ref(false)
const newName = ref('')
const pendingDelete = ref<string | null>(null)
const dirtyCheckout = ref<string | null>(null)

const localBranches = computed(() => store.branches.filter((b) => !b.isRemote))
const remoteBranches = computed(() => store.branches.filter((b) => b.isRemote))

const onCheckout = async (name: string, isCurrent: boolean) => {
  if (isCurrent) return
  if (store.hasUncommitted) {
    dirtyCheckout.value = name
    return
  }
  await store.checkoutBranch(name)
}

const dirtyStash = async () => {
  const target = dirtyCheckout.value
  if (!target) return
  dirtyCheckout.value = null
  await store.stashSave(`auto-stash before switch to ${target}`)
  await store.checkoutBranch(target)
}

const dirtyDiscard = async () => {
  const target = dirtyCheckout.value
  if (!target) return
  dirtyCheckout.value = null
  store.statusFiles = []
  await store.checkoutBranch(target)
}

const askDelete = (name: string) => {
  pendingDelete.value = name
}

const confirmDelete = async () => {
  if (pendingDelete.value) {
    await store.deleteBranch(pendingDelete.value)
  }
  pendingDelete.value = null
}

const onCreate = async () => {
  const name = newName.value.trim()
  if (!name) return
  // Validate Git ref name (basic).
  if (/[\s~^:?*[]/.test(name) || name.includes('..') || name.includes('@{')) {
    return
  }
  await store.createBranch(name)
  newName.value = ''
  showCreate.value = false
}
</script>
