<template>
  <Teleport to="body">
    <div v-if="open" class="ovl on lcp-ovl" @click.self="onBackdrop">
      <div class="lcp" role="dialog" aria-modal="true">
        <div class="lcp-hd">
          <Icon name="sparkles" style="width: 13px; height: 13px; color: var(--accent)" />
          <span class="lcp-title">{{ title }}</span>
          <span class="lcp-sub">{{ subtitle }}</span>
          <span style="flex: 1" />
          <button class="iconbtn lcp-x" :title="t('common.close')" @click="onClose">
            <Icon name="x" style="width: 14px; height: 14px" />
          </button>
        </div>

        <div ref="logRef" class="lcp-log">
          <div v-if="messages.length === 0 && !error" class="lcp-hint">
            <slot name="hint">{{ hint }}</slot>
          </div>

          <template v-for="(m, i) in messages" :key="i">
            <div class="lcp-msg" :class="m.role">
              <div v-if="m.steps && m.steps.length" class="lcp-steps">
                <CreatorStepRow v-for="s in m.steps" :key="s.id" :step="s" />
              </div>
              <!-- User text stays verbatim (their own input); the agent reply renders as
                   sanitized markdown so **bold**, lists, code, links etc. don't show raw. -->
              <div v-if="m.role === 'user'" class="lcp-text">{{ m.text }}</div>
              <div v-else-if="m.text" class="lcp-text lcp-md mdwrap">
                <template v-for="(seg, si) in segmentsFor(m.text)" :key="si">
                  <MermaidView v-if="seg.type === 'mermaid'" :code="seg.code" />
                  <SessionMarkdownHtml v-else :html="seg.html" />
                </template>
              </div>
            </div>
          </template>

          <div v-if="isStreaming" class="lcp-msg agent">
            <div v-if="streamingSteps.length" class="lcp-steps">
              <CreatorStepRow v-for="s in streamingSteps" :key="s.id" :step="s" />
            </div>
            <div class="lcp-text lcp-md mdwrap">
              <template v-for="(seg, si) in streamingSegments" :key="si">
                <MermaidView v-if="seg.type === 'mermaid'" :code="seg.code" />
                <SessionMarkdownHtml v-else :html="seg.html" />
              </template>
              <span class="lcp-caret">▋</span>
            </div>
          </div>

          <div v-if="error" class="lcp-err">{{ error }}</div>
        </div>

        <!-- Area-specific panel docked above the composer (e.g. the Connections
             secret-entry step after a config is written). Empty by default. -->
        <slot name="below-log" />

        <div class="lcp-foot">
          <div class="lcp-box">
            <LibraryScopePicker v-model="scope" :projects="projects" />
            <textarea
              ref="taRef"
              v-model="promptText"
              class="lcp-ta"
              rows="2"
              :disabled="isStreaming"
              :placeholder="messages.length === 0 ? placeholder : iteratePlaceholder"
              @keydown.enter.exact.prevent="onSend"
            />
            <div class="lcp-row">
              <span class="lcp-foothint">
                <template v-if="messages.length === 0">
                  {{ t('library.creator.sendHint') }}
                </template>
                <template v-else>{{ t('library.creator.turns', { n: messages.length }) }}</template>
              </span>
              <button
                class="lcp-send"
                :class="{ busy: isStreaming }"
                :disabled="!sendEnabled"
                :title="isStreaming ? t('library.creator.generating') : t('library.creator.send')"
                @click="onSend"
              >
                <Icon
                  :name="isStreaming ? 'refresh' : 'send'"
                  :class="{ spin: isStreaming }"
                  style="width: 14px; height: 14px"
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import LibraryScopePicker from '~/components/library/LibraryScopePicker.vue'
import CreatorStepRow from '~/components/library/CreatorStepRow.vue'
import SessionMarkdownHtml from '~/components/session/SessionMarkdownHtml.vue'
import MermaidView from '~/components/common/MermaidView.vue'
import { usePromptCreator } from '~/composables/usePromptCreator'
import { useMarkdown } from '~/composables/useMarkdown'
import type { CreatorAccountKind, ProviderName } from '~/stores/settings'

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
const taRef = ref<HTMLTextAreaElement | null>(null)

// Auto-grow the composer from ~2 lines up to a cap, then scroll internally — so a
// long pasted prompt is readable instead of trapped in a 2-row box. Height floor is
// enforced by the `.lcp-ta` min-height; JS only drives the upward growth.
const TEXTAREA_MAX_HEIGHT = 200
const autoGrowTextarea = () => {
  const el = taRef.value
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
const onBackdrop = () => {
  if (isStreaming.value) return // don't drop an in-flight turn
  onClose()
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

<style scoped>
.lcp-ovl {
  align-items: center;
  padding-top: 0;
}
.lcp {
  width: 540px;
  max-width: 94vw;
  height: 70vh;
  max-height: 680px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-panel);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.6);
}
.lcp-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--border);
  flex: 0 0 auto;
}
.lcp-title {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 600;
  color: var(--text);
}
.lcp-sub {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.lcp-x {
  width: 28px;
  height: 28px;
}
.lcp-log {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.lcp-hint {
  font-size: var(--fs-sm);
  color: var(--textDim);
  line-height: 1.6;
}
.lcp-msg {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: var(--fs-sm);
  line-height: 1.6;
}
.lcp-msg.user .lcp-text {
  align-self: flex-end;
  background: var(--accentDim);
  color: var(--text);
  /* design-token-ok: the near-square bottom-right corner IS the speech-bubble tail;
     rounding it to a token erases the tail. */
  border-radius: var(--r-btn) var(--r-btn) 2px var(--r-btn);
  padding: 8px 12px;
  max-width: 85%;
}
.lcp-msg.agent .lcp-text {
  color: var(--textMuted);
}
/* Rendered-markdown agent reply: SessionMarkdownHtml carries the prose styling
   (.mdinline :deep); here we just space consecutive segments (a prose run + a
   mermaid diagram, etc.) like the transcript's .mdwrap. No pre-wrap — the markdown
   owns block layout now. */
.lcp-md {
  color: var(--text);
}
.lcp-md > * + * {
  margin-top: 10px;
}
.lcp-md .lcp-caret {
  margin-left: 2px;
}
.lcp-steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.lcp-caret {
  color: var(--accent);
  animation: lcp-blink 1s step-end infinite;
}
.lcp-err {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--danger);
  background: var(--bgInput);
  border: 1px solid var(--danger);
  border-radius: var(--r-sm);
  padding: 8px 11px;
}
.lcp-foot {
  flex: 0 0 auto;
  padding: 0 16px 16px;
}
.lcp-box {
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  padding: 11px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lcp-ta {
  width: 100%;
  min-height: 2.6em;
  max-height: 200px;
  overflow-y: auto;
  background: transparent;
  border: 0;
  outline: none;
  resize: none;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: 1.55;
  font-family: var(--sans);
}
.lcp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.lcp-foothint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
.lcp-send {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 0;
  display: grid;
  place-items: center;
  background: var(--accent);
  color: var(--accentText);
  cursor: pointer;
}
.lcp-send:disabled {
  background: var(--bgPanel);
  color: var(--textFaint);
  cursor: default;
}
.spin {
  animation: lcp-spin 0.9s linear infinite;
}
@keyframes lcp-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes lcp-blink {
  50% {
    opacity: 0;
  }
}
</style>
