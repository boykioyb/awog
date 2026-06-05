<template>
  <div class="flex-1 flex flex-col overflow-hidden relative">
    <SessionHeader :session="session" @rename="onRename" @delete="emit('delete')" />

    <SessionMessageList
      :messages="session.messages"
      :pending-agent-ids="session.pendingAgentIds"
      @open-attachment="openAttachment"
    />

    <SessionComposer :session="session" :workspace-root="workspaceRoot" />

    <SessionWorkspacePanel
      v-if="activeDrawer"
      :session="session"
      :active="activeDrawer"
      :workspace-root="workspaceRoot"
    />

    <SessionInfoPanel
      v-if="infoPanel.isOpen(session.id)"
      :session="session"
      @open-attachment="openAttachment"
    />

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
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import type { Session, SessionAttachment, SessionFollowUp, SessionStep } from '~/types'
import { SELECT_STEP_KEY, SELECTED_STEP_ID_KEY } from '~/utils/step-context'
import { FOLLOW_UP_KEY } from '~/utils/follow-up-context'
import { useWorkspacePanelStore } from '~/stores/workspacePanel'
import { useSessionInfoPanelStore } from '~/stores/sessionInfoPanel'
import { WORKSPACE_TOOLS, matchesShortcut } from '~/utils/workspace-tools'
import SessionWorkspacePanel from './workspace/SessionWorkspacePanel.vue'
import SessionInfoPanel from './info/SessionInfoPanel.vue'

const props = defineProps<{
  session: Session
}>()

const emit = defineEmits<{ delete: [] }>()

const store = useSessionsStore()
const panel = useWorkspacePanelStore()
const infoPanel = useSessionInfoPanelStore()
const workspace = useWorkspaceStore()

// Absolute path of the session's bound project — every workspace tab operates
// against this. Null when no project is bound (panel shows an empty state).
const workspaceRoot = computed<string | null>(() => {
  const id = props.session.projectId
  if (!id) return null
  return workspace.projects.find((p) => p.id === id)?.path ?? null
})

// The composer's `$` (agent) and `/` (skill) autocomplete read agents/skills
// from the workspace store. Scope the hydration to THIS session's project so
// the picker offers only the user/global tiers plus the bound project's — not
// every other project's agents/skills. An empty id list ⇒ user/global only.
// Re-runs only when the bound project changes, so switching between sessions of
// the same project reuses the loaded set.
watch(
  () => props.session.projectId,
  (projectId) => {
    const ids = projectId ? [projectId] : []
    workspace.hydrateAgentsFromSidecar(ids)
    workspace.hydrateSkillsFromSidecar(ids)
  },
  { immediate: true },
)

const activeDrawer = computed(() => panel.activeDrawer(props.session.id))

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
  () => {
    selectedStep.value = null
    viewingAttachment.value = null
    pendingFollowUps.value = []
  },
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
</script>
