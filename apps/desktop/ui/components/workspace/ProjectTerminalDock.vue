<template>
  <div
    ref="rootEl"
    class="flex flex-col flex-shrink-0 overflow-hidden"
    :style="{ height: `${heightPx}px`, background: t.bg }"
  >
    <!-- Resize handle on the top edge — drag up grows the panel. -->
    <div
      class="flex-shrink-0 cursor-row-resize pt-dock-resizer"
      :style="{ height: '6px', background: dragging ? t.accent : t.border, zIndex: 5 }"
      @mousedown="onDragStart"
      @dblclick="resetSize"
    />

    <!-- Tab strip: switch / rename (double-click) / close, plus new + close-dock. -->
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
      <div class="flex-1" />
      <button
        type="button"
        class="p-1 rounded transition flex-shrink-0"
        :style="{ color: t.textDim }"
        :title="tr('workspace.close')"
        @click="emit('close')"
      >
        <X :size="14" />
      </button>
    </div>

    <!-- One always-mounted instance per tab (PTY persists across switches);
         only the active one is shown. -->
    <div class="flex-1 overflow-hidden relative">
      <div v-for="tab in tabs" v-show="tab.id === activeId" :key="tab.id" class="absolute inset-0">
        <WorkspaceTerminalInstance
          :session-id="terminalKey"
          :workspace-root="workspaceRoot"
          :visible="tab.id === activeId"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Plus, X } from 'lucide-vue-next'
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import WorkspaceTerminalInstance from '~/components/session/workspace/WorkspaceTerminalInstance.vue'

// Generic project terminal dock — reused by the Code Workspace and the Projects
// detail page. `terminalKey` is the opaque PTY group key (`proj:<projectId>`);
// each tab spawns its own PTY but they share this key for terminal.list grouping.
defineProps<{
  terminalKey: string
  workspaceRoot: string
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useTheme()
const { t: tr } = useI18n()

// ── Tabs ────────────────────────────────────────────────────────────────────
interface TermTab {
  id: string
  name: string
}

const tabs = ref<TermTab[]>([])
const activeId = ref('')
const editingId = ref<string | null>(null)
const draft = ref('')
let counter = 0

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
    // Closing the last terminal closes the whole dock.
    activeId.value = ''
    emit('close')
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

// ── Resize (self-managed height, persisted) ──────────────────────────────────
const STORAGE_KEY = 'awog.projectTerminal.height'
const DEFAULT_HEIGHT = 280
const MIN_HEIGHT = 140
const RESERVE = 140 // keep this much room above so the editor/content never collapses

const readStored = (): number => {
  if (typeof window === 'undefined') return DEFAULT_HEIGHT
  const raw = window.localStorage.getItem(STORAGE_KEY)
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_HEIGHT
}

const rootEl = useTemplateRef<HTMLElement>('rootEl')
const heightPx = ref(readStored())
const dragging = ref(false)
let dragStartY = 0
let dragStartHeight = 0

// Live cap from the parent flex column (its height is stable during a drag);
// reserve room for siblings so the editor/content can't be squeezed to zero.
const maxHeight = (): number => {
  const avail = rootEl.value?.parentElement?.clientHeight ?? 0
  if (avail <= 0) return Number.POSITIVE_INFINITY // not measurable yet — don't clamp
  return Math.max(MIN_HEIGHT, avail - RESERVE)
}

const clampHeight = (n: number): number => Math.max(MIN_HEIGHT, Math.min(n, maxHeight()))

const persist = () => {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(heightPx.value))
  } catch {
    // ignore quota / privacy-mode errors
  }
}

const onDragMove = (e: MouseEvent) => {
  heightPx.value = clampHeight(dragStartHeight - (e.clientY - dragStartY))
}

const onDragEnd = () => {
  if (!dragging.value) return
  dragging.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
  persist()
}

const onDragStart = (e: MouseEvent) => {
  e.preventDefault()
  dragStartY = e.clientY
  dragStartHeight = heightPx.value
  dragging.value = true
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onDragMove)
  window.addEventListener('mouseup', onDragEnd)
}

const resetSize = () => {
  heightPx.value = DEFAULT_HEIGHT
  persist()
}

onMounted(() => {
  addTab()
  heightPx.value = clampHeight(heightPx.value) // shrink an oversized persisted height to fit
})

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onDragMove)
  window.removeEventListener('mouseup', onDragEnd)
})
</script>

<style scoped>
.pt-dock-resizer {
  transition: background 120ms ease;
}
</style>
