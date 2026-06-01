<template>
  <div class="flex flex-col h-full overflow-hidden" :style="{ background: t.bg }">
    <WorkspaceDrawerHeader
      :title="tr('workspace.tab.terminal')"
      :icon="TerminalSquare"
      @close="close"
    />

    <!-- Tab strip: switch / rename (double-click) / close, plus new. -->
    <div
      class="flex items-center gap-1 px-2 py-1 flex-shrink-0 overflow-x-auto"
      :style="{ borderBottom: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="flex items-center rounded flex-shrink-0 pl-2 pr-1 transition"
        :style="{
          background: tab.id === activeId ? t.bgActive : 'transparent',
          color: tab.id === activeId ? t.text : t.textDim,
        }"
      >
        <input
          v-if="editingId === tab.id"
          v-model="draft"
          class="bg-transparent outline-none text-[1em] w-24"
          :style="{ color: t.text }"
          @blur="commitRename"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
          @keydown.escape="editingId = null"
        />
        <button
          v-else
          type="button"
          class="text-[1em] py-0.5"
          @click="activeId = tab.id"
          @dblclick="startRename(tab)"
        >
          {{ tab.name }}
        </button>
        <button
          type="button"
          class="p-0.5 ml-1 rounded transition"
          :style="{ color: t.textFaint }"
          :title="tr('workspace.close')"
          @click="closeTab(tab.id)"
        >
          <X :size="11" />
        </button>
      </div>
      <button
        type="button"
        class="p-1 rounded transition flex-shrink-0"
        :style="{ color: t.textDim }"
        :title="tr('workspace.terminal.new')"
        @click="addTab"
      >
        <Plus :size="14" />
      </button>
    </div>

    <!-- One always-mounted instance per tab (PTY persists across switches);
         only the active one is shown. -->
    <div class="flex-1 overflow-hidden relative">
      <div v-for="tab in tabs" v-show="tab.id === activeId" :key="tab.id" class="absolute inset-0">
        <WorkspaceTerminalInstance
          :session="session"
          :workspace-root="workspaceRoot"
          :visible="tab.id === activeId"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Plus, TerminalSquare, X } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import type { Session } from '~/types'
import { useWorkspacePanelStore } from '~/stores/workspacePanel'
import WorkspaceDrawerHeader from './WorkspaceDrawerHeader.vue'
import WorkspaceTerminalInstance from './WorkspaceTerminalInstance.vue'

const props = defineProps<{
  session: Session
  workspaceRoot: string
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const panel = useWorkspacePanelStore()

interface TermTab {
  id: string
  name: string
}

const tabs = ref<TermTab[]>([])
const activeId = ref('')
const editingId = ref<string | null>(null)
const draft = ref('')
let counter = 0

const close = () => panel.closeDrawer(props.session.id)

const addTab = () => {
  counter += 1
  const id = `term-${Date.now().toString(36)}-${counter.toString(36)}`
  tabs.value = [...tabs.value, { id, name: `Terminal ${counter}` }]
  activeId.value = id
}

const closeTab = (id: string) => {
  const idx = tabs.value.findIndex((tab) => tab.id === id)
  if (idx < 0) return
  const next = tabs.value.filter((tab) => tab.id !== id)
  tabs.value = next
  if (activeId.value !== id) return
  if (next.length) {
    activeId.value = (next[idx - 1] ?? next[0])!.id
  } else {
    // Closing the last terminal closes the whole drawer.
    activeId.value = ''
    close()
  }
}

const startRename = (tab: TermTab) => {
  editingId.value = tab.id
  draft.value = tab.name
}

const commitRename = () => {
  const id = editingId.value
  if (!id) return
  const name = draft.value.trim()
  if (name) tabs.value = tabs.value.map((tab) => (tab.id === id ? { ...tab, name } : tab))
  editingId.value = null
}

onMounted(addTab)
</script>
