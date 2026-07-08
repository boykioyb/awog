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
              <div class="lcp-text">{{ m.text }}</div>
            </div>
          </template>

          <div v-if="isStreaming" class="lcp-msg agent">
            <div v-if="streamingSteps.length" class="lcp-steps">
              <CreatorStepRow v-for="s in streamingSteps" :key="s.id" :step="s" />
            </div>
            <div class="lcp-text">
              {{ streamingText }}
              <span class="lcp-caret">▋</span>
            </div>
          </div>

          <div v-if="error" class="lcp-err">{{ error }}</div>
        </div>

        <div class="lcp-foot">
          <div class="lcp-box">
            <LibraryScopePicker v-model="scope" :projects="projects" />
            <textarea
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
import { usePromptCreator } from '~/composables/usePromptCreator'

const props = withDefaults(
  defineProps<{
    open: boolean
    // Author RPC, e.g. 'skills.author'. Stream events are `<method>.chunk|step|done`.
    method: string
    // Account id for the author RPC, or null (no active account → send refused).
    accountId: string | null
    projects?: { id: string; name: string }[]
    title: string
    subtitle?: string
    hint?: string
    placeholder?: string
    iteratePlaceholder?: string
    // Initial scope picker value when the panel opens (e.g. a projectId from the
    // per-group "+" button). Defaults to 'global'.
    initialScope?: string
  }>(),
  {
    projects: () => [],
    subtitle: '',
    hint: '',
    placeholder: '',
    iteratePlaceholder: '',
    initialScope: 'global',
  },
)

const emit = defineEmits<{
  // Closing the panel — the page should re-hydrate its list because the author
  // RPC may have written a new file to disk during the conversation.
  close: []
  // Fired after each completed turn (also a hint to re-hydrate live).
  turn: []
}>()

const { t } = useI18n()

const scope = ref('global')
const promptText = ref('')
const logRef = ref<HTMLElement | null>(null)

const creator = usePromptCreator({
  method: props.method,
  scope: () => scope.value,
  accountId: () => props.accountId,
})
const { messages, streamingText, streamingSteps, error, isStreaming, send } = creator

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
  emit('turn')
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
  border-radius: 16px;
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
  font-size: 1rem;
  font-weight: 600;
  color: var(--text);
}
.lcp-sub {
  font-size: 0.8462rem;
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
  font-size: 0.9231rem;
  color: var(--textDim);
  line-height: 1.6;
}
.lcp-msg {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.9231rem;
  line-height: 1.6;
}
.lcp-msg.user .lcp-text {
  align-self: flex-end;
  background: var(--accentDim);
  color: var(--text);
  border-radius: 12px 12px 2px 12px;
  padding: 8px 12px;
  max-width: 85%;
}
.lcp-msg.agent .lcp-text {
  color: var(--textMuted);
  white-space: pre-wrap;
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
  font-size: 0.8846rem;
  color: var(--danger);
  background: var(--bgInput);
  border: 1px solid var(--danger);
  border-radius: 8px;
  padding: 8px 11px;
}
.lcp-foot {
  flex: 0 0 auto;
  padding: 0 16px 16px;
}
.lcp-box {
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 11px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.lcp-ta {
  width: 100%;
  background: transparent;
  border: 0;
  outline: none;
  resize: none;
  color: var(--text);
  font-size: 0.9231rem;
  line-height: 1.55;
  font-family: var(--sans);
}
.lcp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.lcp-foothint {
  font-size: 0.8462rem;
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
