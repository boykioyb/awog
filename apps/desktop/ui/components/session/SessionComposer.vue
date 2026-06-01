<template>
  <div
    class="px-4 md:px-6 py-2 relative"
    :style="{ background: t.bg, borderTop: `1px solid ${t.border}` }"
  >
    <div
      v-if="autocomplete.items.length > 0"
      class="absolute left-4 right-4 md:left-6 md:right-6 bottom-full mb-1 z-10"
    >
      <SessionAutocomplete
        :title="autocomplete.title"
        :items="autocomplete.items"
        :active-index="activeIndex"
        @pick="mention.apply"
        @hover="activeIndex = $event"
      />
    </div>

    <div
      class="rounded-md"
      :style="{
        background: t.bgInput,
        border: `1px solid ${composerFocus ? t.borderFocus : t.border}`,
      }"
    >
      <div
        class="px-2 py-1 flex items-center gap-1 flex-wrap"
        :style="{ borderBottom: `1px solid ${t.border}` }"
      >
        <SessionChipsPopover :session="session" />

        <div class="ml-auto flex items-center gap-1">
          <SessionContextStatus :session="session" />
        </div>

        <button
          class="inline-flex items-center justify-center w-6 h-6 rounded transition"
          :style="{ color: t.textDim }"
          title="Attach file or image"
          @click="fileInputRef?.click()"
        >
          <Paperclip :size="12" />
        </button>
        <button
          v-if="isStreaming"
          class="inline-flex items-center justify-center w-6 h-6 rounded transition"
          :style="{ background: t.danger, color: t.accentText, cursor: 'pointer' }"
          title="Stop (interrupt response)"
          @click="onStop"
        >
          <Square :size="10" fill="currentColor" />
        </button>
        <button
          v-else
          :disabled="!canSend"
          class="inline-flex items-center justify-center w-6 h-6 rounded transition"
          :style="{
            background: !canSend ? 'transparent' : t.accent,
            color: !canSend ? t.textFaint : t.accentText,
            cursor: !canSend ? 'not-allowed' : 'pointer',
          }"
          title="Send (Enter)"
          @click="onSend"
        >
          <Send :size="12" />
        </button>
      </div>

      <textarea
        ref="textareaRef"
        v-model="draft"
        rows="2"
        :placeholder="placeholder"
        class="w-full bg-transparent px-3 py-2 text-[1em] resize-none outline-none"
        :style="{ color: t.text }"
        @focus="composerFocus = true"
        @blur="onBlur"
        @input="mention.detect"
        @click="mention.detect"
        @keyup="mention.detect"
        @keydown="onComposerKeydown"
      />

      <div
        v-if="pendingAttachments.length > 0"
        class="px-2 py-1.5 flex flex-wrap gap-1.5 items-end"
        :style="{ borderTop: `1px solid ${t.border}` }"
      >
        <template v-for="att in pendingAttachments" :key="att.id">
          <div
            v-if="att.type === 'image' && att.url"
            class="relative group rounded overflow-hidden"
            :style="{
              width: '72px',
              height: '54px',
              border: `1px solid ${t.border}`,
              background: t.bgSubtle,
            }"
            :title="att.name"
          >
            <img :src="att.url" :alt="att.name" class="w-full h-full object-cover" />
            <button
              class="absolute top-0.5 right-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full"
              :style="{ background: t.overlay, color: t.onAccent }"
              @click="removeAttachment(att.id)"
            >
              <X :size="9" />
            </button>
          </div>
          <div
            v-else
            class="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[1em]"
            :style="{
              background: t.bgSubtle,
              color: t.text,
              border: `1px solid ${t.border}`,
            }"
          >
            <FileText :size="11" :style="{ color: t.textDim }" />
            <span class="font-mono truncate" :style="{ maxWidth: '180px' }">{{ att.name }}</span>
            <span v-if="att.size" :style="{ color: t.textFaint }">{{ att.size }}</span>
            <button
              class="text-[1em] inline-flex items-center"
              :style="{ color: t.textDim }"
              @click="removeAttachment(att.id)"
            >
              <X :size="10" />
            </button>
          </div>
        </template>
      </div>

      <div
        v-if="pendingFollowUps.length > 0"
        class="px-2 py-1.5 flex flex-col gap-1.5"
        :style="{ borderTop: `1px solid ${t.border}` }"
      >
        <div v-for="fu in pendingFollowUps" :key="fu.id" class="flex flex-col gap-1">
          <div
            class="inline-flex items-start gap-1.5 px-2 py-1 rounded text-[1em] w-full"
            :style="{
              background: t.bgSubtle,
              color: t.text,
              border: `1px solid ${t.border}`,
            }"
          >
            <Quote :size="11" :style="{ color: t.accent, marginTop: '2px', flexShrink: 0 }" />
            <div class="flex-1 min-w-0">
              <div class="truncate italic" :style="{ color: t.textDim }">
                {{ truncateForChip(fu.selectedText) }}
              </div>
              <div v-if="fu.note" class="truncate" :style="{ color: t.text }">
                {{ fu.note }}
              </div>
            </div>
            <button
              type="button"
              class="text-[1em] inline-flex items-center px-1 rounded"
              :style="{ color: t.textDim }"
              :title="editingFollowUpId === fu.id ? 'Close note editor' : 'Edit note'"
              @click="toggleEditFollowUp(fu.id)"
            >
              {{ editingFollowUpId === fu.id ? 'Done' : 'Note' }}
            </button>
            <button
              type="button"
              class="text-[1em] inline-flex items-center"
              :style="{ color: t.textDim }"
              title="Remove follow-up"
              @click="removeFollowUp(fu.id)"
            >
              <X :size="10" />
            </button>
          </div>
          <textarea
            v-if="editingFollowUpId === fu.id"
            rows="2"
            :value="fu.note"
            placeholder="Instruction for this quote (e.g. rewrite, expand, keep only this)"
            class="w-full rounded px-2 py-1 text-[1em] resize-none outline-none"
            :style="{
              background: t.bgInput,
              color: t.text,
              border: `1px solid ${t.border}`,
            }"
            @input="updateFollowUpNote(fu.id, ($event.target as HTMLTextAreaElement).value)"
          />
        </div>
      </div>

      <input
        ref="fileInputRef"
        type="file"
        multiple
        accept="*/*"
        class="hidden"
        @change="onFileSelected"
      />
    </div>
    <div class="text-[1em] mt-1 px-1" :style="{ color: t.textFaint }">
      Enter to send · @ file · $ agent · / command · select text in a reply to quote it
    </div>
  </div>
</template>

<script setup lang="ts">
import { FileText, Paperclip, Quote, Send, Square, X } from 'lucide-vue-next'
import { computed, inject, ref, toRef, watch } from 'vue'
import type { Session, SessionAttachment } from '~/types'
import { FOLLOW_UP_KEY } from '~/utils/follow-up-context'
import { composeOutgoingMessage, truncateForChip } from '~/utils/follow-up'

const props = defineProps<{
  session: Session
  // Absolute path of the session's bound project — drives `@file` mention
  // suggestions. Null when no project is bound.
  workspaceRoot: string | null
}>()

const { t } = useTheme()
const store = useSessionsStore()

const draft = ref('')
const composerFocus = ref(false)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const pendingAttachments = ref<SessionAttachment[]>([])

// Follow-ups are owned by SessionChat (parent) so the same state is shared
// with SessionMessageList. inject is safe to call without a default — if a
// caller mounts the composer outside SessionChat we treat follow-ups as off.
const followUpController = inject(FOLLOW_UP_KEY, null)
const pendingFollowUps = computed(() => followUpController?.pending.value ?? [])
const editingFollowUpId = ref<string | null>(null)

const mention = useMentionAutocomplete(draft, textareaRef, toRef(props, 'workspaceRoot'))
const { autocomplete, activeIndex } = mention

watch(
  () => props.session.id,
  () => {
    draft.value = ''
    mention.close()
    pendingAttachments.value = []
  },
)

const placeholder = computed(() => 'Type a message... (Enter to send)')

const canSend = computed(
  () =>
    draft.value.trim().length > 0 ||
    pendingAttachments.value.length > 0 ||
    pendingFollowUps.value.length > 0,
)

const isStreaming = computed(() => store.isSessionStreaming(props.session.id))

const onSend = () => {
  if (!canSend.value) return
  const followUps = pendingFollowUps.value
  // Full quote is preserved here — chip truncation is purely visual.
  // See lukilabs/craft-agents-oss#580 for the rationale.
  const text = composeOutgoingMessage(draft.value, followUps)
  const attachments = pendingAttachments.value.length ? [...pendingAttachments.value] : undefined
  store.sendMessage(props.session.id, text, attachments)
  draft.value = ''
  pendingAttachments.value = []
  editingFollowUpId.value = null
  followUpController?.clear()
}

const onStop = () => {
  store.cancelMessage(props.session.id)
}

const onComposerKeydown = (ev: KeyboardEvent) => {
  if (autocomplete.value.items.length > 0) {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault()
      mention.moveDown()
      return
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault()
      mention.moveUp()
      return
    }
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault()
      mention.pickActive()
      return
    }
    if (ev.key === 'Escape') {
      ev.preventDefault()
      mention.close()
      return
    }
  }
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault()
    onSend()
  }
}

const onBlur = () => {
  composerFocus.value = false
  // delay to allow mousedown to trigger applyAutocomplete before dropdown closes
  setTimeout(mention.close, 100)
}

const fmtSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

const onFileSelected = (ev: Event) => {
  const input = ev.target as HTMLInputElement
  if (!input.files) return
  Array.from(input.files).forEach((f) => {
    const isImage = f.type.startsWith('image/')
    pendingAttachments.value.push({
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: f.name,
      type: isImage ? 'image' : 'file',
      size: fmtSize(f.size),
      mime: f.type,
      url: isImage ? URL.createObjectURL(f) : undefined,
    })
  })
  input.value = ''
}

const toggleEditFollowUp = (id: string) => {
  editingFollowUpId.value = editingFollowUpId.value === id ? null : id
}

const updateFollowUpNote = (id: string, note: string) => {
  followUpController?.update(id, { note })
}

const removeFollowUp = (id: string) => {
  if (editingFollowUpId.value === id) editingFollowUpId.value = null
  followUpController?.remove(id)
}

const removeAttachment = (id: string) => {
  const removed = pendingAttachments.value.find((a) => a.id === id)
  if (removed?.url && removed.url.startsWith('blob:')) {
    URL.revokeObjectURL(removed.url)
  }
  pendingAttachments.value = pendingAttachments.value.filter((a) => a.id !== id)
}
</script>
