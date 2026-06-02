<template>
  <div
    class="px-4 md:px-6 py-2 relative"
    :style="{ background: t.bg, borderTop: `1px solid ${t.border}` }"
  >
    <!-- Resize grip for the whole composer block — drag up to grow. -->
    <div
      class="absolute top-0 left-0 right-0 h-2 -translate-y-1/2 flex items-center justify-center cursor-row-resize z-10"
      title="Drag to resize"
      @mousedown="onResizeStart"
    >
      <div
        class="w-10 h-1 rounded-full transition"
        :style="{ background: resizing ? t.accent : t.border }"
      />
    </div>

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

    <!-- Mode + MCP promoted to their own row above the input (user preference).
         The remaining connection/account/model chips stay in the toolbar below. -->
    <div class="flex items-center gap-1 mb-1.5">
      <SessionChipsPopover :session="session" :only="['mode', 'mcp']" />
    </div>

    <!-- Input field: soft rounded with the send action inside. Connection /
         account / model chips live in the toolbar below it (lighter than a top
         chip header). Textarea stays resizable (top grip + bottom-right grip). -->
    <div
      class="rounded-xl"
      :style="{
        background: t.bgInput,
        border: `1px solid ${composerFocus ? t.borderFocus : t.border}`,
      }"
    >
      <div class="flex items-end gap-2 pl-3 pr-2 py-1.5">
        <textarea
          ref="textareaRef"
          v-model="draft"
          rows="2"
          :placeholder="placeholder"
          class="flex-1 bg-transparent py-1 text-[1em] resize-y min-h-[2.75rem] max-h-[50vh] outline-none"
          :style="{ color: t.text }"
          @focus="composerFocus = true"
          @blur="onBlur"
          @input="mention.detect"
          @click="mention.detect"
          @keyup="mention.detect"
          @keydown="onComposerKeydown"
        />
        <button
          class="inline-flex items-center justify-center w-7 h-7 rounded-lg transition flex-shrink-0 self-end"
          :style="{ color: t.textDim }"
          title="Attach file or image"
          @click="fileInputRef?.click()"
        >
          <Paperclip :size="14" />
        </button>
        <button
          v-if="isStreaming"
          class="inline-flex items-center justify-center w-7 h-7 rounded-lg transition flex-shrink-0 self-end"
          :style="{ background: t.danger, color: t.accentText, cursor: 'pointer' }"
          title="Stop (interrupt response)"
          @click="onStop"
        >
          <Square :size="11" fill="currentColor" />
        </button>
        <button
          v-else
          :disabled="!canSend"
          class="inline-flex items-center justify-center w-7 h-7 rounded-lg transition flex-shrink-0 self-end"
          :style="{
            background: !canSend ? 'transparent' : t.accent,
            color: !canSend ? t.textFaint : t.accentText,
            cursor: !canSend ? 'not-allowed' : 'pointer',
          }"
          title="Send (Enter)"
          @click="onSend"
        >
          <Send :size="13" />
        </button>
      </div>

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

    <!-- Toolbar: account / model / effort chips + context usage. Sits under the
         input (Claude Code style). The provider/connection chip is dropped —
         the account chip already implies the provider. Mode + MCP live in the
         row above the input; the attach button sits next to Send. -->
    <div class="flex items-center gap-1 mt-1.5">
      <SessionChipsPopover :session="session" :only="['account', 'model']" />
      <div class="ml-auto flex items-center gap-1">
        <SessionContextStatus :session="session" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { FileText, Paperclip, Quote, Send, Square, X } from 'lucide-vue-next'
import { computed, inject, onBeforeUnmount, ref, toRef, watch } from 'vue'
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

// Drag the top grip to resize the whole composer block. Writes the textarea's
// inline height imperatively (same channel as the native resize-y grip, so the
// two affordances coexist without fighting Vue's reactive style).
const RESIZE_MIN_PX = 52
const resizing = ref(false)
let resizeStartY = 0
let resizeStartH = 0

const onResizeMove = (e: MouseEvent) => {
  const el = textareaRef.value
  if (!el) return
  const max = window.innerHeight * 0.5
  const next = Math.max(RESIZE_MIN_PX, Math.min(max, resizeStartH + (resizeStartY - e.clientY)))
  el.style.height = `${next}px`
}

const onResizeEnd = () => {
  if (!resizing.value) return
  resizing.value = false
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
}

const onResizeStart = (e: MouseEvent) => {
  const el = textareaRef.value
  if (!el) return
  e.preventDefault()
  resizeStartY = e.clientY
  resizeStartH = el.offsetHeight
  resizing.value = true
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeEnd)
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
})

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
