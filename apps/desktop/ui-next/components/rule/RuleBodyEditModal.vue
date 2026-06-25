<template>
  <LibraryEntityModal
    :open="open"
    :title="t('rules.bodyEdit.title', { name: rule.name })"
    :lock-scrim="isGenerating"
    :width="520"
    @close="emit('cancel')"
  >
    <div class="rbe">
      <div class="rbe-hint">{{ t('rules.bodyEdit.hint') }}</div>

      <div v-if="!draft" class="rbe-promptbox">
        <textarea
          v-model="prompt"
          class="rbe-ta"
          rows="3"
          :disabled="isGenerating"
          :placeholder="t('rules.bodyEdit.placeholder')"
          @keydown.enter.exact.prevent="onGenerate"
        />
      </div>

      <div v-if="error" class="rbe-err">{{ error }}</div>

      <div v-if="draft" class="rbe-preview">
        <div class="rbe-prow">
          <span class="rbe-pname">{{ draft.name }}</span>
        </div>
        <div class="rbe-pdesc">{{ draft.description }}</div>
        <LibraryMarkdownBody
          :title="t('rules.bodyEdit.proposed')"
          :content="draft.body || t('rules.bodyEdit.emptyBody')"
        />
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button v-if="draft" class="btn" @click="resetDraft">
        <Icon name="refresh" />
        {{ t('rules.bodyEdit.regenerate') }}
      </button>
      <button
        v-if="!draft"
        class="btn pri"
        :disabled="isGenerating || !prompt.trim()"
        @click="onGenerate"
      >
        <Icon :name="isGenerating ? 'refresh' : 'sparkles'" :class="{ spin: isGenerating }" />
        {{ isGenerating ? t('rules.bodyEdit.generating') : t('rules.bodyEdit.generate') }}
      </button>
      <button v-else class="btn pri" :disabled="!canApply" @click="onApply">
        <Icon name="check" />
        {{ t('rules.bodyEdit.apply') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// LLM-driven body edit — port of the old UI RuleBodyEditModal, using the one-shot
// `rules.generate` RPC with `currentRule` (revise the existing rule). On a
// sidecar/account miss it falls back to a local "revision note" append so the UX
// stays usable offline. Apply preserves storage metadata (source/projectId/
// enabled/globs) — only content comes from the model.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import { useSidecar } from '~/composables/useSidecar'
import { useRulesStore, type Rule, type RuleDraft } from '~/stores/rules'

const props = defineProps<{
  open: boolean
  rule: Rule
  accountId: string | null
}>()

const emit = defineEmits<{ apply: [rule: Rule]; cancel: [] }>()

const { t } = useI18n()
const sc = useSidecar()
const store = useRulesStore()

const prompt = ref('')
const draft = ref<RuleDraft | null>(null)
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

const canApply = computed(() => !!(draft.value?.name && draft.value.body))

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
        name: props.rule.name,
        description: props.rule.description,
        body: `${props.rule.body}\n\n<!-- Edit requested: ${text} -->`,
      }
      return
    }
    const current = {
      name: props.rule.name,
      description: props.rule.description,
      body: props.rule.body,
    }
    draft.value = await store.generateRule(text, props.accountId, current)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isGenerating.value = false
  }
}

const onApply = () => {
  const d = draft.value
  if (!d || !canApply.value) return
  // Preserve identity/location; only content fields come from the model.
  const updated: Rule = { ...props.rule, name: d.name, description: d.description, body: d.body }
  emit('apply', updated)
}
</script>

<style scoped>
.rbe {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.rbe-hint {
  font-size: 0.9231rem;
  color: var(--textDim);
  line-height: 1.55;
}
.rbe-promptbox {
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 11px;
}
.rbe-ta {
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
.rbe-err {
  font-size: 0.8846rem;
  color: var(--danger);
  background: var(--bgInput);
  border: 1px solid var(--danger);
  border-radius: 8px;
  padding: 8px 11px;
}
.rbe-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rbe-prow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.rbe-pname {
  font-size: 0.9615rem;
  font-weight: 550;
  color: var(--text);
}
.rbe-pdesc {
  font-size: 0.9231rem;
  color: var(--textMuted);
}
.spin {
  animation: rbe-spin 0.9s linear infinite;
}
@keyframes rbe-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
