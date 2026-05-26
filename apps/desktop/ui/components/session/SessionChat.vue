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
import type { Session, SessionAttachment, SessionStep } from '~/types'
import { SELECT_STEP_KEY, SELECTED_STEP_ID_KEY } from '~/utils/step-context'

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

watch(
  () => props.session.id,
  () => {
    selectedStep.value = null
    viewingAttachment.value = null
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
