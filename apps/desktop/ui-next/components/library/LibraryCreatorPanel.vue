<template>
  <Dialog :open="open" @update:open="(v) => !v && onClose()">
    <!-- Không có scrim close/Esc khi đang stream — không bỏ dở lượt đang chạy. -->
    <DialogContent
      class="flex h-[70vh] max-h-170 w-135 max-w-[94vw] flex-col gap-0 overflow-hidden border-input bg-card p-0 sm:rounded-2xl"
      @pointer-down-outside="guardDismiss"
      @focus-outside.prevent
      @escape-key-down="guardDismiss"
    >
      <DialogHeader class="flex-none flex-row items-center gap-2 border-b px-4 py-3 pr-12">
        <Icon name="sparkles" class="size-3.5 text-primary" />
        <DialogTitle class="text-base font-semibold">{{ title }}</DialogTitle>
        <DialogDescription class="text-xs text-dim">{{ subtitle }}</DialogDescription>
        <AiModelPicker width="180px" />
      </DialogHeader>

      <div ref="logRef" class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3.5">
        <div v-if="messages.length === 0 && !error" class="text-sm text-dim">
          <slot name="hint">{{ hint }}</slot>
        </div>

        <template v-for="(m, i) in messages" :key="i">
          <div class="flex flex-col gap-1.5 text-sm">
            <div v-if="m.steps && m.steps.length" class="flex flex-col gap-1">
              <CreatorStepRow v-for="s in m.steps" :key="s.id" :step="s" />
            </div>
            <!-- User text stays verbatim (their own input); the agent reply renders as
                 sanitized markdown so **bold**, lists, code, links etc. don't show raw. -->
            <!-- px-ok: góc dưới-phải gần vuông CHÍNH LÀ đuôi bong bóng chat -->
            <div
              v-if="m.role === 'user'"
              class="max-w-[85%] self-end rounded-lg rounded-br-[2px] bg-selected px-3 py-2 text-foreground"
            >
              {{ m.text }}
            </div>
            <div v-else-if="m.text" class="space-y-2.5 text-foreground">
              <template v-for="(seg, si) in segmentsFor(m.text)" :key="si">
                <MermaidView v-if="seg.type === 'mermaid'" :code="seg.code" />
                <pre
                  v-else-if="seg.type === 'widget'"
                  class="font-mono text-xs whitespace-pre-wrap"
                ><code>{{ seg.code }}</code></pre>
                <SessionMarkdownHtml v-else :html="seg.html" />
              </template>
            </div>
          </div>
        </template>

        <div v-if="isStreaming" class="flex flex-col gap-1.5 text-sm">
          <div v-if="streamingSteps.length" class="flex flex-col gap-1">
            <CreatorStepRow v-for="s in streamingSteps" :key="s.id" :step="s" />
          </div>
          <div class="space-y-2.5 text-foreground">
            <template v-for="(seg, si) in streamingSegments" :key="si">
              <MermaidView v-if="seg.type === 'mermaid'" :code="seg.code" />
              <pre
                v-else-if="seg.type === 'widget'"
                class="font-mono text-xs whitespace-pre-wrap"
              ><code>{{ seg.code }}</code></pre>
              <SessionMarkdownHtml v-else :html="seg.html" />
            </template>
            <span class="ml-0.5 animate-pulse text-primary">▋</span>
          </div>
        </div>

        <div
          v-if="error"
          class="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {{ error }}
        </div>
      </div>

      <!-- Area-specific panel docked above the composer (e.g. the Connections
           secret-entry step after a config is written). Empty by default. -->
      <slot name="below-log" />

      <div class="flex-none px-4 pb-4">
        <div class="flex flex-col gap-2.5 rounded-xl border bg-muted p-3">
          <LibraryScopePicker v-if="!hideScope" v-model="scope" :projects="projects" />
          <!-- resize-none: composer tự giãn theo nội dung (autoGrowTextarea), không kéo tay. -->
          <Textarea
            ref="taRef"
            v-model="promptText"
            class="max-h-50 min-h-[2.6em] resize-none overflow-y-auto border-0 bg-transparent p-0 font-sans text-sm shadow-none focus-visible:ring-0"
            rows="2"
            :disabled="isStreaming"
            :placeholder="messages.length === 0 ? placeholder : iteratePlaceholder"
            @keydown.enter.exact.prevent="onSend"
          />
          <div class="flex items-center justify-between">
            <span class="text-xs text-faint">
              <template v-if="messages.length === 0">
                {{ t('library.creator.sendHint') }}
              </template>
              <template v-else>{{ t('library.creator.turns', { n: messages.length }) }}</template>
            </span>
            <Button
              size="iconSm"
              class="rounded-full"
              :disabled="!sendEnabled"
              :title="isStreaming ? t('library.creator.generating') : t('library.creator.send')"
              :aria-label="
                isStreaming ? t('library.creator.generating') : t('library.creator.send')
              "
              @click="onSend"
            >
              <Icon
                :name="isStreaming ? 'refresh' : 'send'"
                :class="{ 'animate-spin': isStreaming }"
              />
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Generic chat-driven creation panel — port of the old UI SkillPromptCreator +
// PromptCreatorPanel, generalised over an entity `kind`. Drives the streaming
// `<area>.author` RPC through usePromptCreator: the model writes the entity file
// to disk and streams text/step deltas; on close the page re-hydrates its list.
//
// Reused by skills/agents/commands/rules/hooks: each passes its `method`
// (e.g. 'skills.author'), the projects for the scope picker, an `accountId`
// resolver, and localized title/hint/placeholder strings.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import LibraryScopePicker from '~/components/library/LibraryScopePicker.vue'
import CreatorStepRow from '~/components/library/CreatorStepRow.vue'
import SessionMarkdownHtml from '~/components/session/SessionMarkdownHtml.vue'
import MermaidView from '~/components/common/MermaidView.vue'
import AiModelPicker from '~/components/common/AiModelPicker.vue'
import { usePromptCreator } from '~/composables/usePromptCreator'
import { useMarkdown } from '~/composables/useMarkdown'
import type { CreatorAccountKind, ProviderName } from '~/stores/settings'
import Button from '~/components/ui/button/Button.vue'
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogDescription from '~/components/ui/dialog/DialogDescription.vue'
import DialogHeader from '~/components/ui/dialog/DialogHeader.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'
import Textarea from '~/components/ui/textarea/Textarea.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    // Author RPC, e.g. 'skills.author'. Stream events are `<method>.chunk|step|done`.
    method: string
    // Resolved creator account (provider-agnostic). A null accountId → send is
    // refused with wording chosen from `kind` (see usePromptCreator.send).
    account: { accountId: string | null; provider: ProviderName; kind: CreatorAccountKind }
    projects?: { id: string; name: string }[]
    title: string
    subtitle?: string
    hint?: string
    placeholder?: string
    iteratePlaceholder?: string
    // Initial scope picker value when the panel opens (e.g. a projectId from the
    // per-group "+" button). Defaults to 'global'.
    initialScope?: string
    // Entities with no tier choice (agents are global-only roles) hide the scope
    // picker entirely — scope stays pinned at initialScope.
    hideScope?: boolean
    // Extra params merged into every author RPC call (e.g. a source-edit context).
    // Passed straight through to usePromptCreator. Optional.
    extraParams?: Record<string, unknown>
  }>(),
  {
    projects: () => [],
    subtitle: '',
    hint: '',
    placeholder: '',
    iteratePlaceholder: '',
    initialScope: 'global',
    hideScope: false,
    extraParams: undefined,
  },
)

const emit = defineEmits<{
  // Closing the panel — the page should re-hydrate its list because the author
  // RPC may have written a new file to disk during the conversation.
  close: []
  // Fired after each completed turn (also a hint to re-hydrate live). Carries the
  // raw `<method>.done` payload so a caller can act on author-specific extras
  // (e.g. the written source slug → prompt for its secrets).
  turn: [meta?: Record<string, unknown> | null]
}>()

const { t } = useI18n()

const scope = ref('global')
const promptText = ref('')
const logRef = ref<HTMLElement | null>(null)
// Textarea shadcn là component ⇒ template ref trả instance, element nằm ở `$el`.
const taRef = useTemplateRef<{ $el: HTMLTextAreaElement }>('taRef')

// Auto-grow the composer from ~2 lines up to a cap, then scroll internally — so a
// long pasted prompt is readable instead of trapped in a 2-row box. Height floor is
// enforced by the textarea's min-height class; JS only drives the upward growth.
const TEXTAREA_MAX_HEIGHT = 200
const autoGrowTextarea = () => {
  const el = taRef.value?.$el
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`
}
watch(promptText, () => nextTick(autoGrowTextarea))

const creator = usePromptCreator({
  method: props.method,
  scope: () => scope.value,
  account: () => props.account,
  extraParams: () => props.extraParams ?? {},
})
const { messages, streamingText, streamingSteps, error, isStreaming, send, lastDone } = creator

// Agent replies render as sanitized markdown (same pipeline as the session
// transcript): split into ordered HTML runs + mermaid fences. Finalized messages
// parse once per render (cheap — the creator transcript is short); the live
// streaming reply re-parses each frame it grows.
const { renderMarkdown } = useMarkdown()
const segmentsFor = (text: string) => renderMarkdown(text)
const streamingSegments = computed(() => renderMarkdown(streamingText.value))

const sendEnabled = computed(() => !isStreaming.value && promptText.value.trim().length > 0)

const scrollToBottom = () => {
  nextTick(() => {
    const el = logRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

watch([streamingText, () => messages.value.length], scrollToBottom)

const onSend = async () => {
  const text = promptText.value.trim()
  if (!text || isStreaming.value) return
  promptText.value = ''
  await send(text)
  emit('turn', lastDone.value)
  scrollToBottom()
}

const onClose = () => emit('close')
// Scrim / Esc không đóng khi đang stream — không bỏ dở lượt đang chạy.
const guardDismiss = (e: Event) => {
  if (isStreaming.value) e.preventDefault()
}

// Reset transcript each time the panel opens; subscribe to stream events.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      messages.value = []
      streamingText.value = ''
      streamingSteps.value = []
      error.value = null
      promptText.value = ''
      scope.value = props.initialScope
      void creator.subscribe()
    } else {
      creator.abort()
    }
  },
)

onMounted(() => {
  if (props.open) void creator.subscribe()
})
onBeforeUnmount(() => creator.teardown())
</script>
