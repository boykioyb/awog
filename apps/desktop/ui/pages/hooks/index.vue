<template>
  <MasterDetailShell
    :mobile-pane="mobilePane"
    :selected-id="mode === 'edit' && !selectedId ? '_creating' : selectedId"
    list-width="18rem"
    @update:mobile-pane="onBack"
  >
    <template #list>
      <div
        class="px-3 py-3 flex items-center gap-2"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <SearchInput v-model="searchQuery" class="flex-1" placeholder="Search hooks..." />
        <button
          ref="newButtonRef"
          class="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded font-medium transition"
          :style="{ background: t.accent, color: t.accentText }"
          @click="onNew"
        >
          <Plus :size="12" />
          New
        </button>
      </div>

      <div
        class="px-2 py-2 flex items-center gap-1 overflow-x-auto"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <button
          v-for="cat in eventCategories"
          :key="cat"
          class="px-2 py-0.5 text-[0.79em] rounded transition flex-shrink-0"
          :style="{
            background: eventFilter === cat ? t.bgActive : 'transparent',
            color: eventFilter === cat ? t.text : t.textDim,
            border: `1px solid ${eventFilter === cat ? t.borderStrong : 'transparent'}`,
          }"
          @click="eventFilter = cat"
        >
          {{ cat }}
        </button>
      </div>

      <div class="flex-1 overflow-y-auto">
        <div
          v-for="hook in filtered"
          :key="hook.id"
          class="w-full px-3 py-2 cursor-pointer transition"
          :style="{
            background: selectedId === hook.id ? t.bgActive : 'transparent',
            borderBottom: `1px solid ${t.border}`,
            borderLeft: `2px solid ${selectedId === hook.id ? t.accent : 'transparent'}`,
            opacity: hook.enabled ? 1 : 0.55,
          }"
          @click="onSelect(hook.id)"
          @contextmenu="onContextMenu($event, hook.id)"
        >
          <div class="flex items-center gap-2 mb-0.5">
            <Zap :size="11" :style="{ color: t.textDim }" />
            <input
              v-if="renamingId === hook.id"
              :ref="setRenameInputRef"
              v-model="renameValue"
              class="text-[0.86em] flex-1 rounded px-1 py-0.5"
              :style="{
                background: t.bgInput,
                border: `1px solid ${t.borderStrong}`,
                color: t.text,
                outline: 'none',
              }"
              @click.stop
              @keydown.enter="commitRename"
              @keydown.escape="cancelRename"
              @blur="commitRename"
            />
            <span
              v-else
              class="text-[0.86em] flex-1 truncate"
              :style="{ color: t.text }"
              @dblclick.stop="startRename(hook.id, hook.name)"
            >
              {{ hook.name }}
            </span>
            <span
              class="w-1.5 h-1.5 rounded-full flex-shrink-0"
              :style="{ background: lastRunDot(hook) }"
            />
            <button
              class="p-1 rounded flex-shrink-0 transition opacity-60 hover:opacity-100"
              :style="{ color: t.textMuted }"
              :title="`Actions for ${hook.name}`"
              @click.stop="openMenuFromButton($event, hook.id)"
            >
              <MoreHorizontal :size="13" />
            </button>
          </div>
          <div class="text-[0.71em] truncate pl-5 font-mono" :style="{ color: t.textDim }">
            {{ hook.event }}
          </div>
        </div>
      </div>
    </template>

    <template #detail>
      <HookEditor
        v-if="mode === 'edit'"
        :hook="selected ?? null"
        :initial-draft="manualSeed"
        @save="onSave"
        @cancel="onCancel"
      />
      <HookDetail v-else-if="selected" :hook="selected" @edit="mode = 'edit'" @delete="askDelete" />
    </template>

    <template #empty-detail>
      <EmptyView :icon="Zap" title="Select a hook" />
    </template>
  </MasterDetailShell>

  <HookPromptCreator
    v-if="showPromptModal"
    :anchor="anchor"
    @save="onSave"
    @edit-manually="onEditManually"
    @cancel="onCancelPromptModal"
  />

  <ConfirmDeleteModal
    v-if="pendingDeleteId"
    title="Delete hook?"
    :description="`Hook '${pendingDeleteName}' sẽ bị xóa vĩnh viễn. Audit log không bị ảnh hưởng.`"
    @confirm="confirmDelete"
    @cancel="pendingDeleteId = null"
  />

  <ContextMenu
    v-if="contextMenu"
    :x="contextMenu.x"
    :y="contextMenu.y"
    :items="menuItems"
    @close="contextMenu = null"
  />
</template>

<script setup lang="ts">
import { Plus, Zap, Edit3, Trash2, MoreHorizontal } from 'lucide-vue-next'
import type { Hook } from '~/types'
import type { HookDraft } from '~/composables/useHookGenerator'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'

const { t } = useTheme()
const ws = useWorkspaceStore()

const searchQuery = ref('')
const eventFilter = ref<string>('all')
const mode = ref<'view' | 'edit'>('view')
const selectedId = ref<string | null>(ws.hooks[0]?.id ?? null)
const mobilePane = ref<'list' | 'detail'>('list')
const pendingDeleteId = ref<string | null>(null)
const showPromptModal = ref(false)
const newButtonRef = ref<HTMLButtonElement | null>(null)
const anchor = ref<{ top: number; left: number } | null>(null)
const manualSeed = ref<HookDraft | null>(null)

const eventCategories = computed<string[]>(() => {
  const groups = new Set<string>(['all'])
  ws.hooks.forEach((h) => groups.add(h.event.split('.')[0] ?? h.event))
  return Array.from(groups)
})

const selected = computed<Hook | undefined>(() => ws.hooks.find((h) => h.id === selectedId.value))

const filtered = computed<Hook[]>(() =>
  ws.hooks.filter((h) => {
    if (eventFilter.value !== 'all' && !h.event.startsWith(eventFilter.value)) return false
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      if (!h.name.toLowerCase().includes(q) && !h.event.toLowerCase().includes(q)) return false
    }
    return true
  }),
)

const lastRunDot = (hook: Hook): string => {
  if (!hook.enabled) return '#404040'
  const last = hook.recentRuns[0]
  if (!last) return '#737373'
  return last.exitCode === 0 ? '#22c55e' : '#ef4444'
}

const onSelect = (id: string) => {
  selectedId.value = id
  mode.value = 'view'
  manualSeed.value = null
  mobilePane.value = 'detail'
}

const onNew = () => {
  manualSeed.value = null
  mode.value = 'view'
  const rect = newButtonRef.value?.getBoundingClientRect()
  anchor.value = rect ? { top: rect.bottom + 8, left: rect.left } : null
  showPromptModal.value = true
}

const onEditManually = (draft: HookDraft) => {
  manualSeed.value = draft
  selectedId.value = null
  showPromptModal.value = false
  mode.value = 'edit'
  mobilePane.value = 'detail'
}

const onSave = (data: Hook) => {
  const isNew = !ws.hooks.some((h) => h.id === data.id)
  if (isNew) {
    const finalId = data.id || `hk${Date.now()}`
    ws.saveHook({ ...data, id: finalId })
    selectedId.value = finalId
  } else {
    ws.saveHook(data)
    selectedId.value = data.id
  }
  mode.value = 'view'
  manualSeed.value = null
  showPromptModal.value = false
  mobilePane.value = 'detail'
}

const onCancel = () => {
  mode.value = 'view'
  manualSeed.value = null
  if (!selected.value) selectedId.value = ws.hooks[0]?.id ?? null
}

const onBack = () => {
  mobilePane.value = 'list'
  mode.value = 'view'
}

const onCancelPromptModal = () => {
  showPromptModal.value = false
}

const askDelete = () => {
  if (selected.value) pendingDeleteId.value = selected.value.id
}

const pendingDeleteName = computed(
  () => ws.hooks.find((h) => h.id === pendingDeleteId.value)?.name ?? '',
)

const confirmDelete = () => {
  if (!pendingDeleteId.value) return
  ws.deleteHook(pendingDeleteId.value)
  if (selectedId.value === pendingDeleteId.value) {
    selectedId.value = ws.hooks[0]?.id ?? null
  }
  pendingDeleteId.value = null
}

const contextMenu = ref<{ x: number; y: number; id: string } | null>(null)
const renamingId = ref<string | null>(null)
const renameValue = ref('')

const setRenameInputRef = (el: unknown) => {
  if (el instanceof HTMLInputElement) {
    nextTick(() => {
      el.focus()
      el.select()
    })
  }
}

const onContextMenu = (e: MouseEvent, id: string) => {
  e.preventDefault()
  contextMenu.value = { x: e.clientX, y: e.clientY, id }
}

const openMenuFromButton = (e: MouseEvent, id: string) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  contextMenu.value = { x: rect.right, y: rect.bottom + 4, id }
}

const startRename = (id: string, current: string) => {
  renamingId.value = id
  renameValue.value = current
}

const commitRename = () => {
  const id = renamingId.value
  if (!id) return
  const trimmed = renameValue.value.trim()
  const item = ws.hooks.find((h) => h.id === id)
  if (trimmed && item && trimmed !== item.name) {
    ws.saveHook({ ...item, name: trimmed })
  }
  renamingId.value = null
}

const cancelRename = () => {
  renamingId.value = null
}

const menuItems = computed<ContextMenuItem[]>(() => {
  const ctx = contextMenu.value
  if (!ctx) return []
  const item = ws.hooks.find((h) => h.id === ctx.id)
  if (!item) return []
  return [
    { label: 'Rename', icon: Edit3, action: () => startRename(item.id, item.name) },
    {
      label: 'Delete',
      icon: Trash2,
      danger: true,
      action: () => {
        pendingDeleteId.value = item.id
      },
    },
  ]
})
</script>
