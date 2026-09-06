<template>
  <LibraryEntityModal
    :open="open"
    :title="t('rules.creator.title')"
    :lock-scrim="isGenerating"
    :width="560"
    @close="emit('close')"
  >
    <div class="rpc">
      <div class="rpc-hint">{{ t('rules.creator.hint') }}</div>

      <LibraryScopePicker v-model="scope" :projects="projects" />

      <div v-if="!draft" class="rpc-promptbox">
        <textarea
          v-model="prompt"
          class="rpc-ta"
          rows="3"
          :disabled="isGenerating"
          :placeholder="t('rules.creator.placeholder')"
          @keydown.enter.exact.prevent="onGenerate"
        />
      </div>

      <div v-if="error" class="rpc-err">{{ error }}</div>

      <div v-if="draft" class="rpc-preview">
        <div class="rpc-prow">
          <span class="rpc-pname">{{ draft.name }}</span>
          <span v-if="slug" class="tag mono">{{ slug }}.md</span>
        </div>
        <div class="rpc-pdesc">{{ draft.description }}</div>
        <LibraryMarkdownBody
          :title="t('rules.creator.proposed')"
          :content="draft.body || t('rules.creator.emptyBody')"
        />
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button v-if="draft" class="btn" @click="resetDraft">
        <Icon name="refresh" />
        {{ t('rules.creator.regenerate') }}
      </button>
      <button
        v-if="!draft"
        class="btn pri"
        :disabled="isGenerating || !prompt.trim()"
        @click="onGenerate"
      >
        <Icon :name="isGenerating ? 'refresh' : 'sparkles'" :class="{ spin: isGenerating }" />
        {{ isGenerating ? t('rules.creator.generating') : t('rules.creator.generate') }}
      </button>
      <button v-else class="btn pri" :disabled="!canSave" @click="onSave">
        <Icon name="check" />
        {{ t('rules.creator.save') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Chat-driven rule creation — drafts a rule from a natural-language prompt via
// the one-shot `rules.generate` RPC, then persists into the chosen tier. Unlike
// the reference SkillPromptCreator (streaming `skills.author`), the sidecar has
// NO `rules.author` method, so this mirrors the SkillBodyEditModal one-shot shape
// instead: prompt → draft preview → save. On a sidecar/account miss it falls
// back to dropping the prompt into the body so the UX stays usable offline.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import LibraryScopePicker from '~/components/library/LibraryScopePicker.vue'
import { useSidecar } from '~/composables/useSidecar'
import { useRulesStore, type Rule, type RuleDraft } from '~/stores/rules'

const props = withDefaults(
  defineProps<{
    open: boolean
    accountId: string | null
    projects: { id: string; name: string }[]
    // Tier preselected when the modal opens — 'global' or a projectId, set by the
    // per-group "+" so creating inside a project group lands in that tier.
    initialScope?: string
  }>(),
  { initialScope: 'global' },
)

const emit = defineEmits<{ save: [payload: { rule: Rule }]; close: [] }>()

const { t } = useI18n()
const sc = useSidecar()
const store = useRulesStore()

const scope = ref('global')
const prompt = ref('')
const draft = ref<RuleDraft | null>(null)
const isGenerating = ref(false)
const error = ref<string | null>(null)

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const slug = computed(() => (draft.value ? slugify(draft.value.name) : ''))

const canSave = computed(() => !!(draft.value?.name && draft.value.body && slug.value))

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      scope.value = props.initialScope
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
    // No engine / no account: say so. A locally-derived draft would be presented
    // as the model's output, which it is not.
    if (!sc.available || !props.accountId) {
      error.value = t('common.aiUnavailable')
      return
    }
    draft.value = await store.generateRule(text, props.accountId)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isGenerating.value = false
  }
}

const onSave = () => {
  const d = draft.value
  if (!d || !canSave.value) return
  // Map the picked scope ('global' or a projectId) to source/projectId.
  const rule: Rule = {
    id: slug.value,
    source: scope.value === 'global' ? 'global' : 'project',
    name: d.name,
    description: d.description,
    body: d.body,
    enabled: true,
  }
  if (rule.source === 'project') rule.projectId = scope.value
  emit('save', { rule })
}
</script>

<style scoped>
.rpc {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.rpc-hint {
  font-size: var(--fs-sm);
  color: var(--textDim);
  line-height: 1.55;
}
.rpc-promptbox {
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  padding: 11px;
}
.rpc-ta {
  width: 100%;
  background: transparent;
  border: 0;
  outline: none;
  resize: vertical;
  min-height: 4rem;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: 1.55;
  font-family: var(--sans);
}
.rpc-err {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--danger);
  background: var(--bgInput);
  border: 1px solid var(--danger);
  border-radius: var(--r-sm);
  padding: 8px 11px;
}
.rpc-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rpc-prow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.rpc-pname {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 550;
  color: var(--text);
}
.rpc-pdesc {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textMuted);
}
.spin {
  animation: rpc-spin 0.9s linear infinite;
}
@keyframes rpc-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
