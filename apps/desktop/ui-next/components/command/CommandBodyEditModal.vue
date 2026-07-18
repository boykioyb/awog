<template>
  <LibraryEntityModal
    :open="open"
    :title="t('commands.bodyEdit.title', { name: command.name })"
    :lock-scrim="isGenerating"
    :width="520"
    @close="emit('cancel')"
  >
    <div class="cbe">
      <div class="cbe-hint">{{ t('commands.bodyEdit.hint') }}</div>

      <div v-if="!draft" class="cbe-promptbox">
        <textarea
          v-model="prompt"
          class="cbe-ta"
          rows="3"
          :disabled="isGenerating"
          :placeholder="t('commands.bodyEdit.placeholder')"
          @keydown.enter.exact.prevent="onGenerate"
        />
      </div>

      <div v-if="error" class="cbe-err">{{ error }}</div>

      <div v-if="draft" class="cbe-preview">
        <div class="cbe-prow">
          <span class="mono cbe-pname">/{{ draft.name }}</span>
          <span v-if="draft.argumentHint" class="tag mono">{{ draft.argumentHint }}</span>
        </div>
        <div class="cbe-pdesc">{{ draft.description }}</div>
        <LibraryMarkdownBody
          :title="t('commands.bodyEdit.proposed')"
          :content="draft.body || t('commands.bodyEdit.emptyBody')"
        />
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button v-if="draft" class="btn" @click="resetDraft">
        <Icon name="refresh" />
        {{ t('commands.bodyEdit.regenerate') }}
      </button>
      <button
        v-if="!draft"
        class="btn pri"
        :disabled="isGenerating || !prompt.trim()"
        @click="onGenerate"
      >
        <Icon :name="isGenerating ? 'refresh' : 'sparkles'" :class="{ spin: isGenerating }" />
        {{ isGenerating ? t('commands.bodyEdit.generating') : t('commands.bodyEdit.generate') }}
      </button>
      <button v-else class="btn pri" @click="onApply">
        <Icon name="check" />
        {{ t('commands.bodyEdit.apply') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// LLM-driven body edit — port of the old UI CommandBodyEditModal, using the
// one-shot `commands.generate` RPC with `currentCommand` (revise the existing
// command). On a sidecar/account miss it falls back to a local "revision note"
// append so the UX stays usable offline. Apply preserves storage metadata
// (identity/source/projectId) — only content fields come from the model.
import { ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import { useSidecar } from '~/composables/useSidecar'
import { useCommandsStore, type Command } from '~/stores/commands'

const props = defineProps<{
  open: boolean
  command: Command
  accountId: string | null
}>()

const emit = defineEmits<{ apply: [command: Command]; cancel: [] }>()

const { t } = useI18n()
const sc = useSidecar()
const store = useCommandsStore()

type Draft = { name: string; description: string; argumentHint: string; body: string }

const prompt = ref('')
const draft = ref<Draft | null>(null)
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

const resetDraft = () => {
  draft.value = null
}

const onGenerate = async () => {
  const text = prompt.value.trim()
  if (!text || isGenerating.value) return
  isGenerating.value = true
  error.value = null
  try {
    if (!sc.available || !props.accountId) {
      // Offline fallback: append a revision note so something visibly changes.
      await new Promise<void>((r) => setTimeout(r, 350))
      draft.value = {
        name: props.command.name,
        description: props.command.description,
        argumentHint: props.command.argumentHint ?? '',
        body: `${props.command.body}\n\n<!-- Edit requested: ${text} -->`,
      }
      return
    }
    const current = {
      name: props.command.name,
      description: props.command.description,
      argumentHint: props.command.argumentHint ?? '',
      body: props.command.body,
    }
    draft.value = await store.generateCommand(text, props.accountId, current)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isGenerating.value = false
  }
}

const onApply = () => {
  const d = draft.value
  if (!d) return
  // Preserve identity/location; only content fields come from the model.
  const updated: Command = {
    ...props.command,
    name: d.name,
    description: d.description,
    body: d.body,
  }
  if (d.argumentHint) updated.argumentHint = d.argumentHint
  emit('apply', updated)
}
</script>

<style scoped>
.cbe {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.cbe-hint {
  font-size: 0.9231rem;
  color: var(--textDim);
  line-height: 1.55;
}
.cbe-promptbox {
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 11px;
}
.cbe-ta {
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
.cbe-err {
  font-size: 0.8846rem;
  color: var(--danger);
  background: var(--bgInput);
  border: 1px solid var(--danger);
  border-radius: 8px;
  padding: 8px 11px;
}
.cbe-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cbe-prow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.cbe-pname {
  font-size: 0.9615rem;
  font-weight: 500;
  color: var(--text);
}
.cbe-pdesc {
  font-size: 0.9231rem;
  color: var(--textMuted);
}
.spin {
  animation: cbe-spin 0.9s linear infinite;
}
@keyframes cbe-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
