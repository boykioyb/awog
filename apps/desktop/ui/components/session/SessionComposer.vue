<template>
  <div
    class="px-4 md:px-6 py-2 relative"
    :style="{ background: t.bg, borderTop: `1px solid ${t.border}` }"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- File drop overlay — shown only while dragging OS files over the composer.
         pointer-events-none so the drag/drop events keep reaching the root. -->
    <div
      v-if="isDraggingFiles"
      class="absolute inset-0 z-20 flex items-center justify-center rounded-xl pointer-events-none m-1"
      :style="{ background: `${t.bgInput}f2`, border: `2px dashed ${t.accent}` }"
    >
      <div class="flex items-center gap-2 text-[1em] font-medium" :style="{ color: t.accent }">
        <Paperclip :size="16" />
        <span>Drop files to attach</span>
      </div>
    </div>

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

    <!-- Queued messages (Session steering/queue): sit directly atop the input,
         auto-sent FIFO once the current turn finishes. -->
    <SessionQueueList :session="session" />

    <!-- Input field: soft rounded with the send action inside. Connection /
         account / model chips live in the toolbar below it (lighter than a top
         chip header). The composer is resized via the top grip only (the
         textarea's native corner grip is disabled — resize-none). -->
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
          class="flex-1 bg-transparent py-1 text-[1em] resize-none min-h-[2.75rem] max-h-[50vh] outline-none"
          :style="{ color: t.text }"
          @focus="composerFocus = true"
          @blur="onBlur"
          @input="mention.detect"
          @click="mention.detect"
          @keyup="mention.detect"
          @keydown="onComposerKeydown"
          @paste="onPaste"
        />
        <button
          class="inline-flex items-center justify-center w-7 h-7 rounded-lg transition flex-shrink-0 self-end"
          :style="{ color: t.textDim }"
          title="Attach file or image"
          @click="fileInputRef?.click()"
        >
          <Paperclip :size="14" />
        </button>
        <!-- While a turn streams: Stop (interrupt) + a split send button whose
             primary action is Insert/steer (or Queue when the draft carries
             attachments/quotes) and whose caret opens the alternate action. -->
        <template v-if="isStreaming">
          <button
            class="inline-flex items-center justify-center w-7 h-7 rounded-lg transition flex-shrink-0 self-end"
            :style="{ background: t.danger, color: t.accentText, cursor: 'pointer' }"
            title="Stop (interrupt response)"
            @click="onStop"
          >
            <Square :size="11" fill="currentColor" />
          </button>
          <div class="relative flex items-stretch self-end flex-shrink-0">
            <button
              :disabled="!canSend"
              class="inline-flex items-center justify-center w-7 h-7 rounded-l-lg transition"
              :style="{
                background: !canSend ? 'transparent' : t.accent,
                color: !canSend ? t.textFaint : t.accentText,
                cursor: !canSend ? 'not-allowed' : 'pointer',
              }"
              :title="
                streamPrimaryAction === 'steer'
                  ? tr('session.composer.steer.hint')
                  : tr('session.composer.queue.hint')
              "
              @click="onStreamPrimary"
            >
              <Send v-if="streamPrimaryAction === 'steer'" :size="13" />
              <Clock v-else :size="13" />
            </button>
            <button
              class="inline-flex items-center justify-center w-4 h-7 rounded-r-lg transition"
              :style="{ background: t.bgHover, color: t.textDim, borderLeft: `1px solid ${t.bg}` }"
              :title="tr('session.composer.queue')"
              @click="sendMenuOpen = !sendMenuOpen"
            >
              <ChevronUp :size="11" />
            </button>

            <!-- Backdrop closes the menu on any outside click. -->
            <div v-if="sendMenuOpen" class="fixed inset-0 z-10" @click="sendMenuOpen = false" />
            <div
              v-if="sendMenuOpen"
              class="absolute bottom-full right-0 mb-1 z-20 rounded-lg overflow-hidden"
              :style="{
                minWidth: '200px',
                background: t.bgInput,
                border: `1px solid ${t.border}`,
                boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
              }"
            >
              <button
                type="button"
                :disabled="!canSteerText"
                class="w-full text-left px-3 py-1.5 text-[1em] flex flex-col gap-0.5"
                :style="{
                  color: canSteerText ? t.text : t.textFaint,
                  cursor: canSteerText ? 'pointer' : 'not-allowed',
                }"
                @click="pickSteer"
              >
                <span class="font-medium">{{ tr('session.composer.steer') }}</span>
                <span class="text-[12px]" :style="{ color: t.textFaint }">
                  {{ tr('session.composer.steer.hint') }}
                </span>
              </button>
              <button
                type="button"
                :disabled="!canSend"
                class="w-full text-left px-3 py-1.5 text-[1em] flex flex-col gap-0.5"
                :style="{
                  color: canSend ? t.text : t.textFaint,
                  cursor: canSend ? 'pointer' : 'not-allowed',
                  borderTop: `1px solid ${t.border}`,
                }"
                @click="pickQueue"
              >
                <span class="font-medium">{{ tr('session.composer.queue') }}</span>
                <span class="text-[12px]" :style="{ color: t.textFaint }">
                  {{ tr('session.composer.queue.hint') }}
                </span>
              </button>
            </div>
          </div>
        </template>
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
        <div v-for="(fu, i) in pendingFollowUps" :key="fu.id" class="flex flex-col gap-1">
          <div
            class="inline-flex items-start gap-1.5 px-2 py-1 rounded text-[1em] w-full"
            :style="{
              background: `${t.accent}14`,
              color: t.text,
              border: `1px solid ${t.accent}40`,
            }"
          >
            <!-- Badge + quote text jump back to the highlighted source on click;
                 the Note/remove buttons keep their own handlers beside it. -->
            <button
              type="button"
              class="inline-flex items-start gap-1.5 flex-1 min-w-0 text-left"
              :title="tr('session.followup.reveal')"
              @click="revealFollowUpAnchor(fu.id)"
            >
              <!-- Number matches the ① anchor badge dropped into the source message. -->
              <span
                class="inline-flex items-center justify-center font-mono leading-none flex-shrink-0"
                :style="{
                  minWidth: '16px',
                  height: '16px',
                  marginTop: '1px',
                  padding: '0 4px',
                  borderRadius: '8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  background: t.accent,
                  color: t.accentText,
                }"
              >
                {{ i + 1 }}
              </span>
              <span class="flex-1 min-w-0">
                <span class="block truncate italic" :style="{ color: t.textDim }">
                  {{ truncateForChip(fu.selectedText) }}
                </span>
                <span v-if="fu.note" class="block truncate" :style="{ color: t.text }">
                  {{ fu.note }}
                </span>
              </span>
            </button>
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

    <!-- Transient feedback after a `/command` runs (mode switch / compact). -->
    <div
      v-if="commandNotice"
      class="mt-1 px-1 text-[12px] leading-none"
      :style="{ color: t.textDim }"
    >
      {{ commandNotice }}
    </div>

    <!-- Toolbar: account / model / effort chips + context usage. Sits under the
         input (Claude Code style). The provider/connection chip is dropped —
         the account chip already implies the provider. Mode + MCP live in the
         row above the input; the attach button sits next to Send. -->
    <div class="flex items-center gap-1 mt-1.5">
      <SessionChipsPopover :session="session" :only="['account', 'model']" />
      <SessionStylePicker ref="stylePickerRef" :session="session" />
      <div class="ml-auto flex items-center gap-1">
        <SessionContextStatus :session="session" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ChevronUp, Clock, FileText, Paperclip, Send, Square, X } from 'lucide-vue-next'
import { computed, inject, onBeforeUnmount, ref, toRef, useTemplateRef, watch } from 'vue'
import type { Session, SessionAttachment } from '~/types'
import { FOLLOW_UP_KEY } from '~/utils/follow-up-context'
import { revealFollowUpAnchor } from '~/utils/follow-up-anchor'
import { composeOutgoingMessage, truncateForChip } from '~/utils/follow-up'
import { findSessionCommand } from '~/utils/session-catalog'
import { buildPastedTextAttachment, intakeFile } from '~/utils/attachment-intake'
import {
  expandCommandBody,
  findInvocableCommand,
  parseSlashInvocation,
} from '~/utils/slash-command'

const props = defineProps<{
  session: Session
  // Absolute path of the session's bound project — drives `@file` mention
  // suggestions. Null when no project is bound.
  workspaceRoot: string | null
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const store = useSessionsStore()
const ws = useWorkspaceStore()
const settings = useSettingsStore()
const { composer } = useComposerSettings()

const draft = ref('')
const composerFocus = ref(false)
const textareaRef = useTemplateRef<HTMLTextAreaElement>('textareaRef')
const fileInputRef = ref<HTMLInputElement | null>(null)
// Response-style popover (ADR 0046) — opened by the `/style` command dispatch.
const stylePickerRef = useTemplateRef<{ open: () => void }>('stylePickerRef')
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

// Follow-ups are owned by SessionChat (parent) so the same state is shared
// with SessionMessageList. inject is safe to call without a default — if a
// caller mounts the composer outside SessionChat we treat follow-ups as off.
const followUpController = inject(FOLLOW_UP_KEY, null)
const pendingFollowUps = computed(() => followUpController?.pending.value ?? [])
const editingFollowUpId = ref<string | null>(null)

// Transient one-line notice shown under the input after a `/command` runs (e.g.
// a mode switch confirmation, or "compact not ready yet"). Mode switches are
// also reflected live in the mode chip above the input.
const commandNotice = ref<string | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | null = null
const showNotice = (text: string) => {
  commandNotice.value = text
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => {
    commandNotice.value = null
  }, 3200)
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
  if (noticeTimer) clearTimeout(noticeTimer)
})

// Dispatch a picked `/command`. The picker only offers mode switches + compact
// (see session-catalog). Mode flips the session's permission mode immediately;
// compact is wired to the SDK once the runner adopts session resume (B) — for
// now it tells the user it is not ready instead of pretending to run.
const onCommand = (commandId: string) => {
  const cmd = findSessionCommand(commandId)
  if (!cmd) return
  if (cmd.action.type === 'mode') {
    store.updateSettings(props.session.id, { mode: cmd.action.mode })
    showNotice(`Mode → ${cmd.name}`)
  } else if (cmd.action.type === 'compact') {
    // Manual /compact (ADR 0047) is aggressive: keepRecentTokens 0 → keep only
    // the last turn so it compacts even a short conversation. The store shows the
    // running state (spinner + Stop); we surface the outcome as a composer notice.
    void store
      .compactSession(props.session.id, { keepRecentTokens: 0 })
      .then((result) => showNotice(tr(`session.compaction.notice.${result}`)))
  } else if (cmd.action.type === 'style') {
    // `/style` opens the response-style popover (ADR 0046) — the same picker as
    // the toolbar chip, not a text expansion.
    stylePickerRef.value?.open()
  }
}

const mention = useMentionAutocomplete(draft, textareaRef, toRef(props, 'workspaceRoot'), onCommand)
const { autocomplete, activeIndex } = mention

watch(
  () => props.session.id,
  () => {
    draft.value = ''
    mention.close()
    pendingAttachments.value = []
    commandNotice.value = null
    sendMenuOpen.value = false
  },
)

const placeholder = computed(() =>
  settings.appearance.composerSendKey === 'shift-enter'
    ? 'Type a message... (Shift+Enter to send)'
    : 'Type a message... (Enter to send)',
)

// Which Enter chord submits, per Settings → Appearance. 'enter': plain Enter
// sends, Shift+Enter = newline. 'shift-enter': the inverse. The non-send chord
// falls through to the textarea's default newline behavior.
const isSendChord = (ev: KeyboardEvent) =>
  ev.key === 'Enter' &&
  (settings.appearance.composerSendKey === 'shift-enter' ? ev.shiftKey : !ev.shiftKey)

const canSend = computed(
  () =>
    draft.value.trim().length > 0 ||
    pendingAttachments.value.length > 0 ||
    pendingFollowUps.value.length > 0,
)

const isStreaming = computed(() => store.isSessionStreaming(props.session.id))

// Build the (text, attachments, followUps, commandInvocation) tuple from the
// current draft — shared by Send (immediate) and Add-to-queue. Slash commands
// expand here so a queued command stores its already-expanded body. The full
// quote is preserved (chip truncation is purely visual — lukilabs/craft-agents-oss#580);
// follow-ups go through alongside `text` so the store can render the numbered
// cards + anchor badges while the model receives the serialized quote markdown.
const composeSendArgs = () => {
  const followUps = pendingFollowUps.value
  let body = draft.value
  let commandInvocation: string | undefined
  const invocation = parseSlashInvocation(draft.value)
  if (invocation) {
    const cmd = findInvocableCommand(ws.commands, invocation.name, props.session.projectId)
    if (cmd) {
      body = expandCommandBody(cmd.body, invocation.args)
      commandInvocation = invocation.args
        ? `/${invocation.name} ${invocation.args}`
        : `/${invocation.name}`
    }
  }
  const text = composeOutgoingMessage(body, followUps)
  const attachments = pendingAttachments.value.length ? [...pendingAttachments.value] : undefined
  return {
    text,
    attachments,
    followUps: followUps.length ? followUps : undefined,
    commandInvocation,
  }
}

const clearComposer = () => {
  draft.value = ''
  pendingAttachments.value = []
  editingFollowUpId.value = null
  followUpController?.clear()
}

const onSend = () => {
  if (!canSend.value) return
  // Defensive: a tight race (Enter fires as a turn is still in flight) must never
  // open a second concurrent turn — that would make Stop retarget the queued
  // turn. Route to steer/queue instead, the intended in-flight behavior.
  if (isStreaming.value) {
    onStreamPrimary()
    return
  }
  const { text, attachments, followUps, commandInvocation } = composeSendArgs()
  store.sendMessage(props.session.id, text, attachments, followUps, commandInvocation)
  clearComposer()
}

// ── Sending while a turn is streaming (Session steering/queue) ──────────────
// Default action = Insert (steer the running turn, text only); the dropdown
// also offers Add-to-queue. A draft carrying attachments or quotes can't be
// steered (those need a full turn), so the primary action switches to Queue.
const sendMenuOpen = ref(false)
const canSteerText = computed(
  () =>
    draft.value.trim().length > 0 &&
    pendingAttachments.value.length === 0 &&
    pendingFollowUps.value.length === 0,
)
const streamPrimaryAction = computed<'steer' | 'queue'>(() =>
  canSteerText.value ? 'steer' : 'queue',
)

// Steer: inject the draft text into the running turn (sidecar getSteeringMessages).
// Text only — clears just the draft (canSteerText guarantees no attachments/quotes).
const onSteer = async () => {
  const text = draft.value
  if (!text.trim()) return
  draft.value = ''
  mention.close()
  await store.sendSteer(props.session.id, text)
  showNotice(tr('session.composer.steer.done'))
}

// Queue: stash the full draft (text + attachments + quotes) to auto-send as a
// fresh turn once the current one finishes.
const onQueue = () => {
  if (!canSend.value) return
  const { text, attachments, followUps, commandInvocation } = composeSendArgs()
  store.enqueueMessage(props.session.id, text, attachments, followUps, commandInvocation)
  clearComposer()
  showNotice(tr('session.composer.queue.done'))
}

const onStreamPrimary = () => {
  if (!canSend.value) return
  if (streamPrimaryAction.value === 'steer') void onSteer()
  else onQueue()
}

const pickSteer = () => {
  sendMenuOpen.value = false
  void onSteer()
}
const pickQueue = () => {
  sendMenuOpen.value = false
  onQueue()
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
    if (isSendChord(ev)) {
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
  if (isSendChord(ev)) {
    ev.preventDefault()
    // While a turn streams, the send chord steers (or queues) instead of being
    // blocked; otherwise it sends normally.
    if (isStreaming.value) onStreamPrimary()
    else onSend()
  }
}

const onBlur = () => {
  composerFocus.value = false
  // delay to allow mousedown to trigger applyAutocomplete before dropdown closes
  setTimeout(mention.close, 100)
}

// Shared by the paperclip picker, drag-and-drop, and clipboard paste — turns
// dropped/selected File objects into pending attachments. intakeFile decides
// what reaches the model: images become inline image blocks, text-decodable
// files carry their content in `preview` (sent as a text block by the sidecar),
// other binary attaches display-only, and risky/executable types are rejected.
const addFiles = async (files: FileList | File[]) => {
  const outcomes = await Promise.all(Array.from(files).map(intakeFile))
  const accepted: SessionAttachment[] = []
  const rejected: string[] = []
  let truncated = false
  for (const outcome of outcomes) {
    if (outcome.ok) {
      accepted.push(outcome.attachment)
      if (outcome.truncated) truncated = true
    } else {
      rejected.push(outcome.name)
    }
  }
  if (accepted.length) pendingAttachments.value.push(...accepted)
  if (rejected.length) {
    showNotice(tr('session.composer.attach.risky_blocked', { names: rejected.join(', ') }))
  } else if (truncated) {
    showNotice(tr('session.composer.attach.truncated'))
  }
}

// Clipboard paste. Two cases beyond plain text:
//   1) the clipboard carries files (a screenshot, a copied file) → attach them
//      through the same intake path as the picker/drop.
//   2) a large plain-text paste (≥ threshold, feature enabled) → convert it to a
//      `pasted-text-N.txt` attachment instead of dumping it inline, keeping the
//      input clean. Small pastes fall through to the textarea's default insert.
const onPaste = (ev: ClipboardEvent) => {
  const data = ev.clipboardData
  if (!data) return
  if (data.files && data.files.length > 0) {
    ev.preventDefault()
    void addFiles(data.files)
    return
  }
  if (!composer.value.pasteAsFile) return
  const text = data.getData('text/plain')
  if (!text || text.length < composer.value.pasteThreshold) return
  ev.preventDefault()
  const index = pendingAttachments.value.filter((a) => a.name.startsWith('pasted-text-')).length + 1
  const { attachment, truncated } = buildPastedTextAttachment(text, index)
  pendingAttachments.value.push(attachment)
  if (truncated) showNotice(tr('session.composer.attach.truncated'))
}

const onFileSelected = (ev: Event) => {
  const input = ev.target as HTMLInputElement
  if (!input.files) return
  addFiles(input.files)
  input.value = ''
}

// Drag-and-drop from the OS file manager onto the composer. We only react when
// the drag actually carries files (so internal text drags don't trigger the
// overlay) and use a depth counter so moving over child elements doesn't flicker
// the overlay off. Tauri's native file-drop is disabled for this window
// (dragDropEnabled: false) so the webview gets standard HTML5 drop events with
// real File objects — same path as the paperclip picker.
const isDraggingFiles = ref(false)
let dragDepth = 0

const dragHasFiles = (ev: DragEvent) => Array.from(ev.dataTransfer?.types ?? []).includes('Files')

const onDragEnter = (ev: DragEvent) => {
  if (!dragHasFiles(ev)) return
  ev.preventDefault()
  dragDepth += 1
  isDraggingFiles.value = true
}

const onDragOver = (ev: DragEvent) => {
  if (!dragHasFiles(ev)) return
  // preventDefault is required for the subsequent drop to fire.
  ev.preventDefault()
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'
}

const onDragLeave = (ev: DragEvent) => {
  if (!dragHasFiles(ev)) return
  dragDepth -= 1
  if (dragDepth <= 0) {
    dragDepth = 0
    isDraggingFiles.value = false
  }
}

const onDrop = (ev: DragEvent) => {
  dragDepth = 0
  isDraggingFiles.value = false
  const files = ev.dataTransfer?.files
  if (!files || files.length === 0) return
  ev.preventDefault()
  addFiles(files)
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
