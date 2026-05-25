<template>
  <div class="flex flex-1 overflow-hidden">
    <!-- Sidebar list -->
    <div
      class="flex flex-col flex-shrink-0 w-full md:w-72"
      :class="{ 'hidden md:flex': mobilePane === 'detail' }"
      :style="{ borderRight: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <div
        class="px-3 py-3 flex items-center gap-2"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <div class="flex-1 relative">
          <Search
            :size="11"
            class="absolute left-2 top-1/2 -translate-y-1/2"
            :style="{ color: t.textDim }"
          />
          <input
            v-model="searchQuery"
            placeholder="Search servers..."
            class="w-full rounded pl-7 pr-2 py-1.5 text-xs"
            :style="{
              background: t.bgInput,
              border: `1px solid ${t.border}`,
              color: t.text,
              outline: 'none',
            }"
          />
        </div>
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
          v-for="f in transportFilters"
          :key="f"
          class="px-2 py-0.5 text-[11px] rounded transition flex-shrink-0 capitalize"
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
              class="text-[12px] flex-1 rounded px-1 py-0.5"
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
              class="text-[12px] flex-1 truncate"
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
              title="Actions"
              @click.stop="openMenuFromButton($event, srv.id)"
            >
              <MoreHorizontal :size="13" />
            </button>
          </div>
          <div class="text-[10px] truncate pl-5 font-mono" :style="{ color: t.textDim }">
            {{ srv.id }} · {{ srv.transport }} · {{ srv.tools.length }} tools
          </div>
        </div>
      </div>
    </div>

    <!-- Main pane -->
    <div
      class="flex-1 overflow-y-auto"
      :class="{ 'hidden md:block': mobilePane === 'list' }"
      :style="{ background: t.bg }"
    >
      <button
        class="md:hidden flex items-center gap-1 px-3 py-2 text-xs transition"
        :style="{ color: t.textMuted, borderBottom: `1px solid ${t.border}` }"
        @click="onBack"
      >
        <ChevronLeft :size="14" />
        Back
      </button>

      <McpEditor
        v-if="mode === 'edit'"
        :server="selected ?? null"
        :initial-draft="manualSeed"
        @save="onSave"
        @cancel="onCancel"
      />
      <McpDetail
        v-else-if="selected"
        :server="selected"
        @edit="mode = 'edit'"
        @delete="askDelete"
      />
      <div v-else class="flex items-center justify-center h-full">
        <div class="text-center">
          <Plug
            :size="28"
            class="mx-auto mb-2"
            :stroke-width="1.5"
            :style="{ color: t.textFaint }"
          />
          <div class="text-sm" :style="{ color: t.textDim }">Select an MCP server</div>
        </div>
      </div>
    </div>

    <McpPromptCreator
      v-if="showPromptModal"
      :anchor="anchor"
      @save="onSave"
      @edit-manually="onEditManually"
      @cancel="onCancelPromptModal"
    />

    <ConfirmDeleteModal
      v-if="pendingDeleteId"
      title="Remove MCP server?"
      :description="`Server '${pendingDeleteName}' sẽ bị xóa khỏi workspace. Agent đang dùng sẽ mất tool này.`"
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
  </div>
</template>

<script setup lang="ts">
import { Search, Plus, Plug, ChevronLeft, Edit3, Trash2, MoreHorizontal } from 'lucide-vue-next'
import type { MCPServer, MCPStatus, MCPTransport } from '~/types'
import type { McpDraft } from '~/composables/useMcpGenerator'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'

const { t } = useTheme()
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
const manualSeed = ref<McpDraft | null>(null)

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

const onEditManually = (draft: McpDraft) => {
  manualSeed.value = draft
  selectedId.value = null
  showPromptModal.value = false
  mode.value = 'edit'
  mobilePane.value = 'detail'
}

const onSave = (data: MCPServer) => {
  const isNew = !ws.mcpServers.some((s) => s.id === data.id)
  if (isNew) {
    const finalId = data.id || `mcp${Date.now()}`
    ws.saveMCPServer({ ...data, id: finalId })
    selectedId.value = finalId
  } else {
    ws.saveMCPServer(data)
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
  if (!selected.value) selectedId.value = ws.mcpServers[0]?.id ?? null
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
  () => ws.mcpServers.find((s) => s.id === pendingDeleteId.value)?.name ?? '',
)

const confirmDelete = () => {
  if (!pendingDeleteId.value) return
  ws.deleteMCPServer(pendingDeleteId.value)
  if (selectedId.value === pendingDeleteId.value) {
    selectedId.value = ws.mcpServers[0]?.id ?? null
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
  const item = ws.mcpServers.find((s) => s.id === id)
  if (trimmed && item && trimmed !== item.name) {
    ws.saveMCPServer({ ...item, name: trimmed })
  }
  renamingId.value = null
}

const cancelRename = () => {
  renamingId.value = null
}

const menuItems = computed<ContextMenuItem[]>(() => {
  const ctx = contextMenu.value
  if (!ctx) return []
  const item = ws.mcpServers.find((s) => s.id === ctx.id)
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
