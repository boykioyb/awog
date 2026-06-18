<template>
  <!-- Split layout: the chat column flexes and the workspace panel docks beside
       it (right / left / bottom), pushing the conversation aside instead of
       floating over it. Direction follows the panel position. -->
  <div class="flex-1 flex overflow-hidden relative" :class="layoutClass">
    <!-- Chat column — step drawer / lightbox float over THIS only.
         min-w-0 / min-h-0 let it shrink in the row / bottom split directions. -->
    <div class="flex-1 flex flex-col overflow-hidden min-w-0 min-h-0 relative">
      <SessionHeader :session="session" @rename="onRename" @delete="emit('delete')" />

      <SessionMessageList
        :session="session"
        :messages="session.messages"
        :pending-agent-ids="session.pendingAgentIds"
        @open-attachment="openAttachment"
      />

      <SessionTodoPanel :session="session" />

      <SessionComposer :session="session" :workspace-root="workspaceRoot" />

      <SessionDrawer
        :open="selectedStep !== null"
        :step="selectedStep"
        @close="selectedStep = null"
      />

      <AttachmentLightbox
        v-if="viewingAttachment"
        :attachment="viewingAttachment"
        @close="viewingAttachment = null"
      />
    </div>

    <SessionWorkspacePanel
      v-if="hasWorkspacePanel"
      :session="session"
      :workspace-root="workspaceRoot"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import type { Session, SessionAttachment, SessionFollowUp, SessionStep } from '~/types'
import { SELECT_STEP_KEY, SELECTED_STEP_ID_KEY } from '~/utils/step-context'
import { FOLLOW_UP_KEY } from '~/utils/follow-up-context'
import { OPEN_ATTACHMENT_KEY } from '~/utils/attachment-context'
import { useWorkspacePanelStore } from '~/stores/workspacePanel'
import { WORKSPACE_TOOLS, matchesShortcut } from '~/utils/workspace-tools'
import SessionWorkspacePanel from './workspace/SessionWorkspacePanel.vue'

const props = defineProps<{
  session: Session
}>()

const emit = defineEmits<{ delete: [] }>()

const store = useSessionsStore()
const panel = useWorkspacePanelStore()
const workspace = useWorkspaceStore()

// Absolute path of the session's bound project — every workspace tab operates
// against this. Null when no project is bound (panel shows an empty state).
const workspaceRoot = computed<string | null>(() => {
  const id = props.session.projectId
  if (!id) return null
  return workspace.projects.find((p) => p.id === id)?.path ?? null
})

// The composer's `$` (agent) and `/` (skill / slash-command) autocomplete read
// agents/skills/commands from the workspace store. Scope the hydration to THIS
// session's project so the picker offers only the user/global tiers plus the
// bound project's — not every other project's. An empty id list ⇒ global only.
// Commands are expanded client-side on send (SessionComposer), so the store
// must be populated here too — otherwise a fresh session never sees the
// project's `/commands` until the user visits the Commands page. Re-runs only
// when the bound project changes, so switching between sessions of the same
// project reuses the loaded set.
watch(
  () => props.session.projectId,
  (projectId) => {
    const ids = projectId ? [projectId] : []
    workspace.hydrateAgentsFromSidecar(ids)
    workspace.hydrateSkillsFromSidecar(ids)
    workspace.hydrateCommandsFromSidecar(ids)
  },
  { immediate: true },
)

// The workspace split renders whenever at least one tool tab is open.
const hasWorkspacePanel = computed(() => panel.openTabs(props.session.id).length > 0)

// Flex direction for the chat ↔ workspace split. The panel is the second DOM
// child, so `flex-row-reverse` floats it to the left, `flex-col` to the bottom.
const layoutClass = computed(() => {
  if (panel.position === 'bottom') return 'flex-col'
  if (panel.position === 'left') return 'flex-row-reverse'
  return 'flex-row'
})

// Keyboard shortcuts open/toggle a workspace drawer (⇧⌘D diff, ⌃` terminal…).
const onShortcut = (e: KeyboardEvent) => {
  const tool = WORKSPACE_TOOLS.find((d) => matchesShortcut(e, d))
  if (!tool) return
  e.preventDefault()
  panel.toggleDrawer(props.session.id, tool.id)
}

onMounted(() => window.addEventListener('keydown', onShortcut))
onBeforeUnmount(() => window.removeEventListener('keydown', onShortcut))

const selectedStep = ref<SessionStep | null>(null)
const selectedStepId = computed(() => selectedStep.value?.id ?? null)
const viewingAttachment = ref<SessionAttachment | null>(null)

provide(SELECT_STEP_KEY, (step: SessionStep) => {
  selectedStep.value = step
})
provide(SELECTED_STEP_ID_KEY, selectedStepId)

// Composer-level follow-ups. Scoped to the current session — wiped on switch
// so we don't carry a quote into an unrelated conversation.
const pendingFollowUps = ref<SessionFollowUp[]>([])
provide(FOLLOW_UP_KEY, {
  pending: pendingFollowUps,
  add: (fu) => {
    pendingFollowUps.value = [
      ...pendingFollowUps.value,
      { id: `fu-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...fu },
    ]
  },
  update: (id, patch) => {
    pendingFollowUps.value = pendingFollowUps.value.map((f) =>
      f.id === id ? { ...f, ...patch } : f,
    )
  },
  remove: (id) => {
    pendingFollowUps.value = pendingFollowUps.value.filter((f) => f.id !== id)
  },
  clear: () => {
    pendingFollowUps.value = []
  },
})

watch(
  () => props.session.id,
  (id) => {
    selectedStep.value = null
    viewingAttachment.value = null
    pendingFollowUps.value = []
    // Refresh which messages have a Rewind snapshot (ADR 0038) for this session.
    void store.loadSnapshotIds(id)
  },
  { immediate: true },
)

const onRename = (title: string) => {
  store.renameSession(props.session.id, title)
}

const openAttachment = (att: SessionAttachment) => {
  if (att.type === 'image') {
    if (!att.url) return
  } else if (!att.preview) {
    return
  }
  viewingAttachment.value = att
}

// The Info workspace tab opens context files in the lightbox through this.
provide(OPEN_ATTACHMENT_KEY, openAttachment)
</script>
