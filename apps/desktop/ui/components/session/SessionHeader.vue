<template>
  <div
    class="px-4 md:px-6 py-3 flex items-center gap-2"
    :style="{
      borderBottom: `1px solid ${parts.border}`,
      background: parts.bg,
      backdropFilter: parts.blur,
    }"
  >
    <div class="min-w-0 flex-1">
      <input
        v-model="titleDraft"
        class="text-[1em] font-semibold bg-transparent outline-none w-full truncate"
        :style="{ color: t.text }"
        @blur="commitTitle"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      />
      <div class="text-[1em] mt-0.5 flex items-center gap-1.5" :style="{ color: t.textDim }">
        <span class="font-mono">{{ session.id }}</span>
        <span :style="{ color: t.textFaint }">·</span>
        <span>{{ session.messages.length }} messages</span>
        <span :style="{ color: t.textFaint }">·</span>
        <span>Updated {{ fmt(session.updatedAt) }}</span>
        <span :style="{ color: t.textFaint }">·</span>
        <button
          ref="projectBtnRef"
          type="button"
          class="inline-flex items-center gap-1 px-1.5 py-0.5 -my-0.5 rounded transition"
          :style="{
            color: project ? t.text : t.textFaint,
            background: showProjectMenu ? t.bgSubtle : 'transparent',
          }"
          :title="project ? 'Change project' : 'Assign to project'"
          @click="showProjectMenu = !showProjectMenu"
        >
          <FolderGit2 :size="10" />
          {{ project ? project.name : 'No project' }}
          <ChevronDown :size="10" />
        </button>
      </div>
    </div>
    <button
      class="p-1.5 rounded transition flex-shrink-0"
      :style="{ color: infoOpen ? t.accent : t.textDim }"
      :title="tr('sessionInfo.open')"
      @click="toggleInfo"
    >
      <Info :size="14" />
    </button>
    <button
      ref="wsBtnRef"
      class="p-1.5 rounded transition flex-shrink-0"
      :style="{ color: activeDrawer || showWorkspaceMenu ? t.accent : t.textDim }"
      :title="tr('workspace.toggle')"
      @click="showWorkspaceMenu = !showWorkspaceMenu"
    >
      <PanelRight :size="14" />
    </button>
    <button
      class="p-1.5 rounded transition flex-shrink-0"
      :style="{ color: t.textDim }"
      title="Delete session"
      @click="emit('delete')"
    >
      <Trash2 :size="14" />
    </button>
  </div>

  <WorkspaceMenu
    :open="showWorkspaceMenu"
    :anchor="wsMenuPos"
    :active="activeDrawer"
    @select="onSelectWorkspace"
    @close="showWorkspaceMenu = false"
  />

  <Teleport to="body">
    <div v-if="showProjectMenu" class="fixed inset-0 z-40" @click="showProjectMenu = false" />
    <div
      v-if="showProjectMenu"
      class="fixed z-50 rounded-md shadow-lg overflow-hidden text-[1em] min-w-[180px]"
      :style="{
        background: t.bgPanel,
        border: `1px solid ${t.border}`,
        top: `${menuPos.top}px`,
        left: `${menuPos.left}px`,
      }"
    >
      <button
        type="button"
        class="w-full text-left px-3 py-1.5 transition flex items-center gap-2"
        :style="{
          color: !session.projectId ? t.accent : t.text,
          background: !session.projectId ? t.bgSubtle : 'transparent',
        }"
        @click="selectProject(null)"
      >
        <FolderGit2 :size="11" />
        <span>No project</span>
      </button>
      <div class="h-px" :style="{ background: t.border }" />
      <button
        v-for="p in workspace.projects"
        :key="p.id"
        type="button"
        class="w-full text-left px-3 py-1.5 transition flex items-center gap-2"
        :style="{
          color: session.projectId === p.id ? t.accent : t.text,
          background: session.projectId === p.id ? t.bgSubtle : 'transparent',
        }"
        @click="selectProject(p.id)"
      >
        <FolderGit2 :size="11" />
        <span class="truncate">{{ p.name }}</span>
      </button>
      <div
        v-if="workspace.projects.length === 0"
        class="px-3 py-2 text-center"
        :style="{ color: t.textDim }"
      >
        No projects defined
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ChevronDown, FolderGit2, Info, PanelRight, Trash2 } from 'lucide-vue-next'
import { nextTick, ref, computed, watch } from 'vue'
import type { Session, WorkspaceTab } from '~/types'
import { formatTime } from '~/utils/time'
import { useWorkspacePanelStore } from '~/stores/workspacePanel'
import { useSessionInfoPanelStore } from '~/stores/sessionInfoPanel'
import WorkspaceMenu from './workspace/WorkspaceMenu.vue'

const settingsStore = useSettingsStore()
const sessionsStore = useSessionsStore()
const panel = useWorkspacePanelStore()
const infoPanel = useSessionInfoPanelStore()
const { t: tr } = useI18n()
const fmt = (at: string | undefined) => formatTime(at, settingsStore.defaults?.timezone)

const props = defineProps<{
  session: Session
}>()

const emit = defineEmits<{
  rename: [title: string]
  delete: []
}>()

const { t } = useTheme()
const { parts } = useGlass()
const workspace = useWorkspaceStore()

const titleDraft = ref(props.session.title)
const showProjectMenu = ref(false)
const projectBtnRef = ref<HTMLElement | null>(null)
const menuPos = ref({ top: 0, left: 0 })

// Workspace tools dropdown (Diff / Files / Terminal / …).
const showWorkspaceMenu = ref(false)
const wsBtnRef = ref<HTMLElement | null>(null)
const wsMenuPos = ref({ top: 0, left: 0 })
const activeDrawer = computed(() => panel.activeDrawer(props.session.id))
const infoOpen = computed(() => infoPanel.isOpen(props.session.id))

// The Info panel and the workspace drawer both dock right — keep one open at a
// time so they never stack on the same edge.
const onSelectWorkspace = (tab: WorkspaceTab) => {
  panel.openDrawer(props.session.id, tab)
  infoPanel.close(props.session.id)
  showWorkspaceMenu.value = false
}

const toggleInfo = () => {
  infoPanel.toggle(props.session.id)
  if (infoOpen.value) {
    panel.closeDrawer(props.session.id)
    showWorkspaceMenu.value = false
  }
}

watch(
  () => props.session.id,
  () => {
    titleDraft.value = props.session.title
    showProjectMenu.value = false
    showWorkspaceMenu.value = false
  },
)

watch(showProjectMenu, async (open) => {
  if (!open) return
  await nextTick()
  const r = projectBtnRef.value?.getBoundingClientRect()
  if (r) menuPos.value = { top: r.bottom + 4, left: r.left }
})

watch(showWorkspaceMenu, async (open) => {
  if (!open) return
  await nextTick()
  const r = wsBtnRef.value?.getBoundingClientRect()
  // Right-align the 230px menu under the button, clamped to the viewport.
  if (r) wsMenuPos.value = { top: r.bottom + 4, left: Math.max(8, r.right - 230) }
})

const project = computed(() =>
  props.session.projectId ? workspace.projectById(props.session.projectId) : undefined,
)

const selectProject = (projectId: string | null) => {
  sessionsStore.setSessionProject(props.session.id, projectId)
  showProjectMenu.value = false
}

const commitTitle = () => {
  const next = titleDraft.value.trim() || 'Untitled session'
  titleDraft.value = next
  if (next !== props.session.title) emit('rename', next)
}
</script>
