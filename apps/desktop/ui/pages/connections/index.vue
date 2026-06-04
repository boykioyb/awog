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
        <SearchInput v-model="searchQuery" class="flex-1" :placeholder="tr('connections.search')" />
        <button
          ref="newButtonRef"
          class="p-1.5 rounded transition"
          :style="{ color: t.textDim }"
          :title="tr('connections.new')"
          @click="onNew"
          @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.color = t.text)"
          @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.color = t.textDim)"
        >
          <Plus :size="14" />
        </button>
      </div>

      <div
        class="px-2 py-2 flex items-center gap-1 overflow-x-auto"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <button
          v-for="f in transportFilters"
          :key="f"
          class="px-2 py-0.5 text-[1em] rounded transition flex-shrink-0 capitalize"
          :style="{
            background: transportFilter === f ? t.bgActive : 'transparent',
            color: transportFilter === f ? t.text : t.textDim,
            border: `1px solid ${transportFilter === f ? t.borderStrong : 'transparent'}`,
          }"
          @click="transportFilter = f"
        >
          {{ f }}
        </button>
      </div>

      <div class="flex-1 overflow-y-auto">
        <div
          v-for="srv in filtered"
          :key="srv.id"
          class="w-full px-3 py-2 cursor-pointer transition"
          :style="{
            background: selectedId === srv.id ? t.bgActive : 'transparent',
            borderBottom: `1px solid ${t.border}`,
            borderLeft: `2px solid ${selectedId === srv.id ? t.accent : 'transparent'}`,
          }"
          @click="onSelect(srv.id)"
          @contextmenu="onContextMenu($event, srv.id)"
        >
          <div class="flex items-center gap-2 mb-0.5">
            <Plug :size="11" :style="{ color: t.textDim }" />
            <input
              v-if="renamingId === srv.id"
              :ref="setRenameInputRef"
              v-model="renameValue"
              class="text-[1em] flex-1 rounded px-1 py-0.5"
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
              class="text-[1em] flex-1 truncate"
              :style="{ color: t.text }"
              @dblclick.stop="startRename(srv.id, srv.name)"
            >
              {{ srv.name }}
            </span>
            <span
              class="w-1.5 h-1.5 rounded-full flex-shrink-0"
              :style="{ background: statusDot(srv.status) }"
            />
            <button
              class="p-1 rounded flex-shrink-0 transition opacity-60 hover:opacity-100"
              :style="{ color: t.textMuted }"
              :title="tr('connections.actions')"
              @click.stop="openMenuFromButton($event, srv.id)"
            >
              <MoreHorizontal :size="13" />
            </button>
          </div>
          <div class="text-[1em] truncate pl-5 font-mono" :style="{ color: t.textDim }">
            {{ srv.id }} · {{ srv.transport }} · {{ srv.tools.length }} tools
          </div>
        </div>
      </div>
    </template>

    <template #detail>
      <McpEditor
        v-if="mode === 'edit'"
        :server="selected ?? null"
        @save="onSave"
        @cancel="onCancel"
      />
      <McpDetail
        v-else-if="selected"
        :server="selected"
        @edit="mode = 'edit'"
        @delete="askDelete"
      />
    </template>

    <template #empty-detail>
      <EmptyView :icon="Plug" :title="tr('connections.select')" />
    </template>
  </MasterDetailShell>

  <McpPromptCreator v-if="showPromptModal" :anchor="anchor" @close="onClosePromptModal" />

  <ConfirmDeleteModal
    v-if="pendingDeleteId"
    :title="tr('connections.delete.title')"
    :description="tr('connections.delete.description', { name: pendingDeleteName })"
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
import { Plus, Plug, Edit3, Trash2, MoreHorizontal } from 'lucide-vue-next'
import type { MCPServer, MCPStatus, MCPTransport } from '~/types'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'

const { t } = useTheme()
const { t: tr } = useI18n()
const ws = useWorkspaceStore()

const searchQuery = ref('')
const transportFilter = ref<'all' | MCPTransport>('all')
const mode = ref<'view' | 'edit'>('view')
const selectedId = ref<string | null>(ws.mcpServers[0]?.id ?? null)
const mobilePane = ref<'list' | 'detail'>('list')
const pendingDeleteId = ref<string | null>(null)
const showPromptModal = ref(false)
const newButtonRef = ref<HTMLButtonElement | null>(null)
const anchor = ref<{ top: number; left: number } | null>(null)

const transportFilters: Array<'all' | MCPTransport> = ['all', 'stdio', 'http', 'sse']

const selected = computed<MCPServer | undefined>(() =>
  ws.mcpServers.find((s) => s.id === selectedId.value),
)

const filtered = computed<MCPServer[]>(() =>
  ws.mcpServers.filter((s) => {
    if (transportFilter.value !== 'all' && s.transport !== transportFilter.value) return false
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      if (!s.name.toLowerCase().includes(q) && !s.id.toLowerCase().includes(q)) return false
    }
    return true
  }),
)

const statusDot = (status: MCPStatus): string => {
  const map: Record<MCPStatus, string> = {
    running: '#22c55e',
    starting: '#f59e0b',
    idle: '#737373',
    error: '#ef4444',
    disabled: '#404040',
  }
  return map[status]
}

const onSelect = (id: string) => {
  selectedId.value = id
  mode.value = 'view'
  mobilePane.value = 'detail'
}

const onNew = () => {
  mode.value = 'view'
  const rect = newButtonRef.value?.getBoundingClientRect()
  anchor.value = rect ? { top: rect.bottom + 8, left: rect.left } : null
  showPromptModal.value = true
}

const onSave = async (data: MCPServer) => {
  const finalId = data.id || `mcp${Date.now()}`
  try {
    const saved = await ws.saveMCPServer({ ...data, id: finalId })
    selectedId.value = saved.id
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[connections] save failed', err)
  }
  mode.value = 'view'
  mobilePane.value = 'detail'
}

const onCancel = () => {
  mode.value = 'view'
  if (!selected.value) selectedId.value = ws.mcpServers[0]?.id ?? null
}

const onBack = () => {
  mobilePane.value = 'list'
  mode.value = 'view'
}

const onClosePromptModal = async () => {
  showPromptModal.value = false
  // LLM may have written a new config.json to disk — pull fresh state so the
  // connection appears in the list and gets auto-selected.
  const beforeIds = new Set(ws.mcpServers.map((s) => s.id))
  await ws.hydrateMcpFromSidecar()
  const fresh = ws.mcpServers.find((s) => !beforeIds.has(s.id))
  if (fresh) {
    selectedId.value = fresh.id
    mobilePane.value = 'detail'
  }
}

const askDelete = () => {
  if (selected.value) pendingDeleteId.value = selected.value.id
}

const pendingDeleteName = computed(
  () => ws.mcpServers.find((s) => s.id === pendingDeleteId.value)?.name ?? '',
)

const confirmDelete = async () => {
  const id = pendingDeleteId.value
  if (!id) return
  pendingDeleteId.value = null
  try {
    await ws.deleteMCPServer(id)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[connections] delete failed', err)
    return
  }
  if (selectedId.value === id) {
    selectedId.value = ws.mcpServers[0]?.id ?? null
  }
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

const commitRename = async () => {
  const id = renamingId.value
  if (!id) return
  const trimmed = renameValue.value.trim()
  const item = ws.mcpServers.find((s) => s.id === id)
  renamingId.value = null
  if (trimmed && item && trimmed !== item.name) {
    try {
      await ws.saveMCPServer({ ...item, name: trimmed })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[connections] rename failed', err)
    }
  }
}

const cancelRename = () => {
  renamingId.value = null
}

let unsubscribeEvents: (() => void) | null = null

onMounted(async () => {
  unsubscribeEvents = await ws.subscribeMcpEvents()
  await ws.hydrateMcpFromSidecar()
  if (!selectedId.value && ws.mcpServers[0]) selectedId.value = ws.mcpServers[0].id
})

onBeforeUnmount(() => {
  if (unsubscribeEvents) unsubscribeEvents()
})

const menuItems = computed<ContextMenuItem[]>(() => {
  const ctx = contextMenu.value
  if (!ctx) return []
  const item = ws.mcpServers.find((s) => s.id === ctx.id)
  if (!item) return []
  return [
    {
      label: tr('connections.menu.rename'),
      icon: Edit3,
      action: () => startRename(item.id, item.name),
    },
    {
      label: tr('connections.menu.delete'),
      icon: Trash2,
      danger: true,
      action: () => {
        pendingDeleteId.value = item.id
      },
    },
  ]
})
</script>
