<template>
  <div class="flex-1 flex flex-col overflow-hidden relative">
    <SessionHeader :session="session" @rename="onRename" @delete="emit('delete')" />

    <SessionMessageList
      :messages="session.messages"
      :pending-agent-ids="session.pendingAgentIds"
      @open-attachment="openAttachment"
    />

    <SessionComposer :session="session" />

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
import { computed, provide, ref, watch } from 'vue'
import type { Session, SessionAttachment, SessionFollowUp, SessionStep } from '~/types'
import { SELECT_STEP_KEY, SELECTED_STEP_ID_KEY } from '~/utils/step-context'
import { FOLLOW_UP_KEY } from '~/utils/follow-up-context'

const props = defineProps<{
  session: Session
}>()

const emit = defineEmits<{ delete: [] }>()

const store = useSessionsStore()

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
