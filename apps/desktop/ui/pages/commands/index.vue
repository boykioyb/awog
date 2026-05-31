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
        <SearchInput v-model="searchQuery" class="flex-1" placeholder="Search commands..." />
        <button
          ref="newButtonRef"
          class="flex items-center gap-1 px-2.5 py-1.5 text-[1em] rounded font-medium transition"
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
          v-for="ty in typeFilters"
          :key="ty"
          class="px-2 py-0.5 text-[1em] rounded transition flex-shrink-0"
          :style="{
            background: typeFilter === ty ? t.bgActive : 'transparent',
            color: typeFilter === ty ? t.text : t.textDim,
            border: `1px solid ${typeFilter === ty ? t.borderStrong : 'transparent'}`,
          }"
          @click="typeFilter = ty"
        >
          {{ ty }}
        </button>
      </div>

      <div class="flex-1 overflow-y-auto">
        <div
          v-for="cmd in filtered"
          :key="cmd.id"
          class="w-full px-3 py-2 cursor-pointer transition"
          :style="{
            background: selectedId === cmd.id ? t.bgActive : 'transparent',
            borderBottom: `1px solid ${t.border}`,
            borderLeft: `2px solid ${selectedId === cmd.id ? t.accent : 'transparent'}`,
          }"
          @click="onSelect(cmd.id)"
          @contextmenu="onContextMenu($event, cmd.id)"
        >
          <div class="flex items-center gap-2 mb-0.5">
            <Slash :size="11" :style="{ color: t.textDim }" />
            <input
              v-if="renamingId === cmd.id"
              :ref="setRenameInputRef"
              v-model="renameValue"
              class="text-[1em] font-mono flex-1 rounded px-1 py-0.5"
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
              class="text-[1em] font-mono flex-1 truncate"
              :style="{ color: t.text }"
              @dblclick.stop="!cmd.system && startRename(cmd.id, cmd.name)"
            >
              /{{ cmd.name }}
            </span>
            <span
              v-if="cmd.system"
              class="text-[1em] uppercase px-1 rounded"
              :style="{
                background: t.bgInput,
                color: t.textFaint,
                border: `1px solid ${t.border}`,
              }"
            >
              sys
            </span>
            <button
              class="p-1 rounded flex-shrink-0 transition opacity-60 hover:opacity-100"
              :style="{ color: t.textMuted }"
              title="Actions"
              @click.stop="openMenuFromButton($event, cmd.id)"
            >
              <MoreHorizontal :size="13" />
            </button>
          </div>
          <div class="text-[1em] truncate pl-5" :style="{ color: t.textDim }">
            {{ cmd.type }} · {{ cmd.description }}
          </div>
        </div>
      </div>
    </template>

    <template #detail>
      <CommandEditor
        v-if="mode === 'edit'"
        :command="selected ?? null"
        :initial-draft="manualSeed"
        @save="onSave"
        @cancel="onCancel"
      />
      <CommandDetail
        v-else-if="selected"
        :command="selected"
        @edit="mode = 'edit'"
        @delete="askDelete"
      />
    </template>

    <template #empty-detail>
      <EmptyView :icon="Slash" title="Select a command" />
    </template>
  </MasterDetailShell>

  <CommandPromptCreator
    v-if="showPromptModal"
    :anchor="anchor"
    @save="onSave"
    @edit-manually="onEditManually"
    @cancel="onCancelPromptModal"
  />

  <ConfirmDeleteModal
    v-if="pendingDeleteId"
    title="Delete command?"
    :description="`Command /'${selected?.name}' sẽ bị xóa.`"
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
import { Plus, Slash, Edit3, Trash2, MoreHorizontal } from 'lucide-vue-next'
import type { CommandType, SlashCommand } from '~/types'
import type { CommandDraft } from '~/composables/useCommandGenerator'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'

const { t } = useTheme()
const ws = useWorkspaceStore()

const searchQuery = ref('')
const typeFilter = ref<'all' | CommandType>('all')
const mode = ref<'view' | 'edit'>('view')
const selectedId = ref<string | null>(ws.commands[0]?.id ?? null)
const mobilePane = ref<'list' | 'detail'>('list')
const pendingDeleteId = ref<string | null>(null)
const showPromptModal = ref(false)
const newButtonRef = ref<HTMLButtonElement | null>(null)
const anchor = ref<{ top: number; left: number } | null>(null)
const manualSeed = ref<CommandDraft | null>(null)

const typeFilters: Array<'all' | CommandType> = [
  'all',
  'prompt',
  'agent-switch',
  'shell',
  'workflow',
]

const selected = computed<SlashCommand | undefined>(() =>
  ws.commands.find((c) => c.id === selectedId.value),
)

const filtered = computed<SlashCommand[]>(() =>
  ws.commands.filter((c) => {
    if (typeFilter.value !== 'all' && c.type !== typeFilter.value) return false
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      if (!c.name.toLowerCase().includes(q) && !c.description.toLowerCase().includes(q))
        return false
    }
    return true
  }),
)

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

const onEditManually = (draft: CommandDraft) => {
  manualSeed.value = draft
  selectedId.value = null
  showPromptModal.value = false
  mode.value = 'edit'
  mobilePane.value = 'detail'
}

const onSave = (data: SlashCommand) => {
  const isNew = !ws.commands.some((c) => c.id === data.id)
  if (isNew) {
    const finalId = data.id || `cmd${Date.now()}`
    ws.saveCommand({ ...data, id: finalId })
    selectedId.value = finalId
  } else {
    ws.saveCommand(data)
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
  if (!selected.value) selectedId.value = ws.commands[0]?.id ?? null
}

const onBack = () => {
  mobilePane.value = 'list'
  mode.value = 'view'
}

const onCancelPromptModal = () => {
  showPromptModal.value = false
}

const askDelete = () => {
  if (selected.value && !selected.value.system) pendingDeleteId.value = selected.value.id
}

const confirmDelete = () => {
  if (!pendingDeleteId.value) return
  ws.deleteCommand(pendingDeleteId.value)
  selectedId.value = ws.commands[0]?.id ?? null
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
  const item = ws.commands.find((c) => c.id === id)
  if (trimmed && item && !item.system && trimmed !== item.name) {
    ws.saveCommand({ ...item, name: trimmed })
  }
  renamingId.value = null
}

const cancelRename = () => {
  renamingId.value = null
}

const menuItems = computed<ContextMenuItem[]>(() => {
  const ctx = contextMenu.value
  if (!ctx) return []
  const item = ws.commands.find((c) => c.id === ctx.id)
  if (!item) return []
  return [
    {
      label: 'Rename',
      icon: Edit3,
      disabled: item.system,
      action: () => startRename(item.id, item.name),
    },
    {
      label: 'Delete',
      icon: Trash2,
      danger: true,
      disabled: item.system,
      action: () => {
        pendingDeleteId.value = item.id
      },
    },
  ]
})
</script>
