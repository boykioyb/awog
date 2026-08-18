<template>
  <LibraryEntityModal
    :open="open"
    :title="t('hooks.scriptEdit.title', { path })"
    :lock-scrim="isGenerating"
    :width="640"
    @close="emit('cancel')"
  >
    <div class="hse">
      <div class="hse-hint">{{ t('hooks.scriptEdit.hint') }}</div>

      <div v-if="content === null" class="hse-promptbox">
        <textarea
          v-model="prompt"
          class="hse-ta"
          rows="3"
          :disabled="isGenerating"
          :placeholder="t('hooks.scriptEdit.placeholder')"
          @keydown.enter.exact.prevent="onGenerate"
        />
      </div>

      <div v-if="error" class="hse-err">{{ error }}</div>

      <div v-if="content !== null" class="hse-preview">
        <MonacoViewer :value="content" language="shell" read-only />
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button v-if="content !== null" class="btn" @click="resetDraft">
        <Icon name="refresh" />
        {{ t('hooks.scriptEdit.regenerate') }}
      </button>
      <button
        v-if="content === null"
        class="btn pri"
        :disabled="isGenerating || !prompt.trim()"
        @click="onGenerate"
      >
        <Icon :name="isGenerating ? 'refresh' : 'sparkles'" :class="{ spin: isGenerating }" />
        {{ isGenerating ? t('hooks.scriptEdit.generating') : t('hooks.scriptEdit.generate') }}
      </button>
      <button v-else class="btn pri" @click="onApply">
        <Icon name="check" />
        {{ t('hooks.scriptEdit.apply') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// LLM-driven hook SCRIPT edit — one-shot `hooks.generate-script` (writes/revises
// the raw code of the file a hook runs, e.g. format-after-edit.sh). The proposed
// content is previewed read-only in Monaco; Apply emits it up to the editor,
// which feeds it into the inline (editable) Monaco viewer. With no engine /
// account it reports that instead of writing a placeholder into the script.
import { ref, watch } from 'vue'
import MonacoViewer from '~/components/common/MonacoViewer.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useSidecar } from '~/composables/useSidecar'
import { useHooksStore } from '~/stores/hooks'

const props = defineProps<{
  open: boolean
  path: string
  command: string
  currentContent: string
  accountId: string | null
}>()

const emit = defineEmits<{ apply: [content: string]; cancel: [] }>()

const { t } = useI18n()
const sc = useSidecar()
const store = useHooksStore()

const prompt = ref('')
const content = ref<string | null>(null)
const isGenerating = ref(false)
const error = ref<string | null>(null)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      prompt.value = ''
      content.value = null
      error.value = null
    }
  },
)

const resetDraft = () => {
  content.value = null
}

const onGenerate = async () => {
  const text = prompt.value.trim()
  if (!text || isGenerating.value) return
  isGenerating.value = true
  error.value = null
  try {
    // Never write a placeholder into a script the hook engine will actually run.
    if (!sc.available || !props.accountId) {
      error.value = t('common.aiUnavailable')
      return
    }
    content.value = await store.generateHookScript(text, props.accountId, {
      command: props.command,
      currentScript: props.currentContent,
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isGenerating.value = false
  }
}

const onApply = () => {
  if (content.value !== null) emit('apply', content.value)
}
</script>

<style scoped>
.hse {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.hse-hint {
  font-size: 0.9231rem;
  color: var(--textDim);
  line-height: 1.55;
}
.hse-promptbox {
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 11px;
}
.hse-ta {
  width: 100%;
  background: transparent;
  border: 0;
  outline: none;
  resize: vertical;
  min-height: 4rem;
  color: var(--text);
  font-size: 0.9231rem;
  line-height: 1.55;
  font-family: var(--sans);
}
.hse-err {
  font-size: 0.8846rem;
  color: var(--danger);
  background: var(--bgInput);
  border: 1px solid var(--danger);
  border-radius: 8px;
  padding: 8px 11px;
}
.hse-preview {
  height: 320px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
}
.spin {
  animation: hse-spin 0.9s linear infinite;
}
@keyframes hse-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
