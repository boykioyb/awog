<template>
  <LibraryEntityModal
    :open="open"
    :title="t('hooks.configEdit.title', { name: hook.name || hook.event })"
    :lock-scrim="isGenerating"
    :width="520"
    @close="emit('cancel')"
  >
    <div class="hce">
      <div class="hce-hint">{{ t('hooks.configEdit.hint') }}</div>

      <div v-if="!draft" class="hce-promptbox">
        <textarea
          v-model="prompt"
          class="hce-ta"
          rows="3"
          :disabled="isGenerating"
          :placeholder="t('hooks.configEdit.placeholder')"
          @keydown.enter.exact.prevent="onGenerate"
        />
      </div>

      <div v-if="error" class="hce-err">{{ error }}</div>

      <div v-if="draft" class="hce-preview">
        <div class="hce-prow">
          <span class="tag mono hce-acc">{{ draft.event }}</span>
          <span class="tag">{{ draft.runMode }}</span>
        </div>
        <pre class="codeblk hce-cmd">{{ draft.command }}</pre>
        <div v-if="matcherText" class="hce-matcher mono">matcher: {{ matcherText }}</div>
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button v-if="draft" class="btn" @click="resetDraft">
        <Icon name="refresh" />
        {{ t('hooks.configEdit.regenerate') }}
      </button>
      <button
        v-if="!draft"
        class="btn pri"
        :disabled="isGenerating || !prompt.trim()"
        @click="onGenerate"
      >
        <Icon :name="isGenerating ? 'refresh' : 'sparkles'" :class="{ spin: isGenerating }" />
        {{ isGenerating ? t('hooks.configEdit.generating') : t('hooks.configEdit.generate') }}
      </button>
      <button v-else class="btn pri" @click="onApply">
        <Icon name="check" />
        {{ t('hooks.configEdit.apply') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// LLM-driven hook CONFIG edit — one-shot `hooks.generate` with `currentHook`
// (revise the existing draft). Apply emits the proposed config up to the editor,
// which merges it into the editing draft (user still Saves). With no engine /
// account it surfaces an error — there is nothing to revise with.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useSidecar } from '~/composables/useSidecar'
import { useHooksStore, type Hook, type HookConfig } from '~/stores/hooks'

const props = defineProps<{
  open: boolean
  hook: Hook
  accountId: string | null
}>()

const emit = defineEmits<{ apply: [config: HookConfig]; cancel: [] }>()

const { t } = useI18n()
const sc = useSidecar()
const store = useHooksStore()

const prompt = ref('')
const draft = ref<HookConfig | null>(null)
const isGenerating = ref(false)
const error = ref<string | null>(null)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      prompt.value = ''
      draft.value = null
      error.value = null
    }
  },
)

const matcherText = computed(() =>
  draft.value && Object.keys(draft.value.matcher).length ? JSON.stringify(draft.value.matcher) : '',
)

const resetDraft = () => {
  draft.value = null
}

const onGenerate = async () => {
  const text = prompt.value.trim()
  if (!text || isGenerating.value) return
  if (!sc.available || !props.accountId) {
    error.value = !sc.available ? t('hooks.configEdit.offline') : t('hooks.configEdit.noAccount')
    return
  }
  isGenerating.value = true
  error.value = null
  try {
    draft.value = await store.generateHook(text, props.accountId, {
      name: props.hook.name,
      description: props.hook.description,
      event: props.hook.event,
      matcher: props.hook.matcher,
      command: props.hook.command,
      cwd: props.hook.cwd,
      timeoutMs: props.hook.timeoutMs,
      runMode: props.hook.runMode,
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isGenerating.value = false
  }
}

const onApply = () => {
  if (draft.value) emit('apply', draft.value)
}
</script>

<style scoped>
.hce {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.hce-hint {
  font-size: var(--fs-sm);
  color: var(--textDim);
  line-height: var(--lh-md);
}
.hce-promptbox {
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  padding: 11px;
}
.hce-ta {
  width: 100%;
  background: transparent;
  border: 0;
  outline: none;
  resize: vertical;
  min-height: 4rem;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-md);
  font-family: var(--sans);
}
.hce-err {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--danger);
  background: var(--bgInput);
  border: 1px solid var(--danger);
  border-radius: var(--r-sm);
  padding: 8px 11px;
}
.hce-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  padding: 12px;
}
.hce-prow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.hce-acc {
  color: var(--accent);
}
.hce-cmd {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.hce-matcher {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.spin {
  animation: hce-spin 0.9s linear infinite;
}
@keyframes hce-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
