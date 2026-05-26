<template>
  <MasterDetailShell
    :mobile-pane="mobilePane"
    :selected-id="creating ? '_creating' : selectedAgentId"
    list-width="18rem"
    @update:mobile-pane="onBack"
  >
    <template #list>
      <div
        class="px-3 py-3 flex items-center gap-2"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <SearchInput v-model="searchQuery" class="flex-1" placeholder="Search agents..." />
        <button
          ref="newButtonRef"
          class="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded font-medium transition"
          :style="{ background: t.accent, color: t.accentText }"
          @click="startCreate"
        >
          <Plus :size="12" />
          New
        </button>
      </div>
      <div class="flex-1 overflow-y-auto">
        <div
          v-for="agent in filtered"
          :key="agent.id"
          class="w-full px-3 py-2.5 text-left cursor-pointer transition"
          :style="{
            background: isSelected(agent.id) ? t.bgActive : 'transparent',
            borderBottom: `1px solid ${t.border}`,
            borderLeft: `2px solid ${isSelected(agent.id) ? t.accent : 'transparent'}`,
          }"
          @click="selectAgent(agent.id)"
          @contextmenu="onContextMenu($event, agent.id)"
          @mouseenter="
            (e) => {
              if (!isSelected(agent.id))
                (e.currentTarget as HTMLElement).style.background = t.bgHover
            }
          "
          @mouseleave="
            (e) => {
              if (!isSelected(agent.id))
                (e.currentTarget as HTMLElement).style.background = 'transparent'
            }
          "
        >
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 min-w-0">
              <input
                v-if="renamingId === agent.id"
                :ref="setRenameInputRef"
                v-model="renameValue"
                class="text-[12px] font-medium flex-1 min-w-0 rounded px-1 py-0.5"
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
              <div
                v-else
                class="text-[12px] font-medium truncate"
                :style="{ color: t.text }"
                @dblclick.stop="startRename(agent.id, agent.name)"
              >
                {{ agent.name }}
              </div>
              <span
                class="text-[8px] uppercase tracking-wider font-semibold flex-shrink-0 px-1 py-0.5 rounded"
                :style="{
                  color: t.textMuted,
                  background: t.bgInput,
                  border: `1px solid ${t.border}`,
                }"
              >
                {{ agent.role }}
              </span>
              <button
                class="p-1 rounded flex-shrink-0 transition opacity-60 hover:opacity-100"
                :style="{ color: t.textMuted }"
                title="Actions"
                @click.stop="openMenuFromButton($event, agent.id)"
              >
                <MoreHorizontal :size="13" />
              </button>
            </div>
            <div class="text-[10px] truncate" :style="{ color: t.textDim }">
              {{ modelLabel(agent) }} · {{ agent.skillIds.length }}
              {{ agent.skillIds.length === 1 ? 'skill' : 'skills' }}
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #detail>
      <AgentEditor
        v-if="creating"
        :agent="null"
        :initial-draft="manualSeed"
        @save="onSave"
        @cancel="cancelCreate"
      />
      <AgentEditor
        v-else-if="editing && selectedAgent"
        :agent="selectedAgent"
        @save="onSave"
        @cancel="editing = false"
      />
      <AgentDetail
        v-else-if="selectedAgent"
        :agent="selectedAgent"
        @edit="editing = true"
        @duplicate="onDuplicate"
        @delete="confirmDelete = selectedAgent"
      />
    </template>

    <template #empty-detail>
      <EmptyView :icon="Users" title="Select an agent or create a new one" />
    </template>
  </MasterDetailShell>

  <AgentPromptCreator
    v-if="showPromptModal"
    :anchor="anchor"
    @save="onPromptSave"
    @edit-manually="onEditManually"
    @cancel="showPromptModal = false"
  />

  <ConfirmDeleteModal
    v-if="confirmDelete"
    :title="`Delete agent &quot;${confirmDelete.name}&quot;?`"
    description="This will remove the agent permanently. Workflows currently using this agent will need a replacement."
    @confirm="onDelete"
    @cancel="confirmDelete = null"
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
import { Edit3, MoreHorizontal, Plus, Trash2, Users } from 'lucide-vue-next'
import type { Agent } from '~/types'
import type { AgentDraft } from '~/composables/useAgentGenerator'
import type { ContextMenuItem } from '~/components/ContextMenu.vue'
import { MODELS } from '~/utils/models'

const { t } = useTheme()
const ws = useWorkspaceStore()

const selectedAgentId = ref<string | null>(ws.agents[0]?.id ?? null)
const editing = ref(false)
const creating = ref(false)
const searchQuery = ref('')
const confirmDelete = ref<Agent | null>(null)
const showPromptModal = ref(false)
const newButtonRef = ref<HTMLButtonElement | null>(null)
const anchor = ref<{ top: number; left: number } | null>(null)
const manualSeed = ref<AgentDraft | null>(null)
const mobilePane = ref<'list' | 'detail'>('list')

const selectedAgent = computed<Agent | undefined>(() =>
  ws.agents.find((a) => a.id === selectedAgentId.value),
)

const filtered = computed<Agent[]>(() => {
  const q = searchQuery.value.toLowerCase()
  if (!q) return ws.agents
  return ws.agents.filter(
    (a) => a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q),
  )
})

const isSelected = (id: string) => selectedAgentId.value === id && !creating.value

const modelLabel = (agent: Agent) => MODELS.find((m) => m.id === agent.model)?.label ?? ''

const selectAgent = (id: string) => {
  selectedAgentId.value = id
  creating.value = false
  editing.value = false
  mobilePane.value = 'detail'
}

const startCreate = () => {
  manualSeed.value = null
  creating.value = false
  editing.value = false
  selectedAgentId.value = null
  const rect = newButtonRef.value?.getBoundingClientRect()
  anchor.value = rect ? { top: rect.bottom + 8, left: rect.left } : null
  showPromptModal.value = true
}

const cancelCreate = () => {
  creating.value = false
  manualSeed.value = null
  selectedAgentId.value = ws.agents[0]?.id ?? null
}

const onBack = () => {
  mobilePane.value = 'list'
  editing.value = false
  creating.value = false
}

const onSave = (data: Agent) => {
  const isExisting = !!data.id && !!ws.agents.find((a) => a.id === data.id)
  if (isExisting) {
    ws.saveAgent(data)
    editing.value = false
  } else {
    const before = new Set(ws.agents.map((a) => a.id))
    ws.saveAgent(data)
    const created = ws.agents.find((a) => !before.has(a.id))
    if (created) selectedAgentId.value = created.id
    creating.value = false
    manualSeed.value = null
  }
  mobilePane.value = 'detail'
}

const onPromptSave = (data: Agent) => {
  const before = new Set(ws.agents.map((a) => a.id))
  ws.saveAgent({ ...data, id: '' })
  const created = ws.agents.find((a) => !before.has(a.id))
  if (created) selectedAgentId.value = created.id
  showPromptModal.value = false
  mobilePane.value = 'detail'
}

const onEditManually = (draft: AgentDraft) => {
  manualSeed.value = draft
  showPromptModal.value = false
  selectedAgentId.value = null
  editing.value = false
  creating.value = true
  mobilePane.value = 'detail'
}

const onDuplicate = () => {
  if (!selectedAgent.value) return
  const created = ws.duplicateAgent(selectedAgent.value)
  selectedAgentId.value = created.id
  mobilePane.value = 'detail'
}

const onDelete = () => {
  if (!confirmDelete.value) return
  const { id } = confirmDelete.value
  ws.deleteAgent(id)
  if (selectedAgentId.value === id) {
    selectedAgentId.value = ws.agents[0]?.id ?? null
  }
  confirmDelete.value = null
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
  const item = ws.agents.find((a) => a.id === id)
  if (trimmed && item && trimmed !== item.name) {
    ws.saveAgent({ ...item, name: trimmed })
  }
  renamingId.value = null
}

const cancelRename = () => {
  renamingId.value = null
}

const menuItems = computed<ContextMenuItem[]>(() => {
  const ctx = contextMenu.value
  if (!ctx) return []
  const item = ws.agents.find((a) => a.id === ctx.id)
  if (!item) return []
  return [
    { label: 'Rename', icon: Edit3, action: () => startRename(item.id, item.name) },
    {
      label: 'Delete',
      icon: Trash2,
      danger: true,
      action: () => {
        confirmDelete.value = item
      },
    },
  ]
})
</script>
