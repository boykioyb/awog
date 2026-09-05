<template>
  <LibraryEntityModal
    :open="open"
    :title="t('commands.creator.title')"
    :lock-scrim="isGenerating"
    :width="540"
    @close="emit('close')"
  >
    <div class="cpc">
      <div class="cpc-hint">{{ t('commands.creator.hint') }}</div>

      <LibraryScopePicker v-model="scope" :projects="projects" />

      <div v-if="!draft" class="cpc-promptbox">
        <textarea
          v-model="prompt"
          class="cpc-ta"
          rows="3"
          :disabled="isGenerating"
          :placeholder="t('commands.creator.placeholder')"
          @keydown.enter.exact.prevent="onGenerate"
        />
      </div>

      <div v-if="error" class="cpc-err">{{ error }}</div>

      <div v-if="draft" class="cpc-preview">
        <div class="cpc-prow">
          <span class="mono cpc-pname">/{{ slugify(draft.name) }}</span>
          <span v-if="draft.argumentHint" class="tag mono">{{ draft.argumentHint }}</span>
        </div>
        <div class="cpc-pdesc">{{ draft.description }}</div>
        <LibraryMarkdownBody
          :title="t('commands.creator.generated')"
          :content="draft.body || t('commands.creator.emptyBody')"
        />
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button v-if="draft" class="btn" @click="resetDraft">
        <Icon name="refresh" />
        {{ t('commands.creator.regenerate') }}
      </button>
      <button v-if="draft" class="btn" @click="onEditDetails">
        <Icon name="edit" />
        {{ t('commands.creator.editDetails') }}
      </button>
      <button
        v-if="!draft"
        class="btn pri"
        :disabled="isGenerating || !prompt.trim()"
        @click="onGenerate"
      >
        <Icon :name="isGenerating ? 'refresh' : 'sparkles'" :class="{ spin: isGenerating }" />
        {{ isGenerating ? t('commands.creator.generating') : t('commands.creator.generate') }}
      </button>
      <button v-else class="btn pri" @click="onSave">
        <Icon name="save" />
        {{ t('commands.creator.save') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Command creation panel — port of the old UI CommandPromptCreator. Commands have
// only the ONE-SHOT `commands.generate` RPC (not a streaming `commands.author`),
// so this drafts via generateCommand (mirroring SkillBodyEditModal) rather than
// the streaming LibraryCreatorPanel. The user describes the command, the model
// returns a draft, then they either save directly to the chosen scope or hand off
// to the form editor ("edit details"). Offline / no-account → an explicit error.
import { ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import LibraryMarkdownBody from '~/components/library/LibraryMarkdownBody.vue'
import LibraryScopePicker from '~/components/library/LibraryScopePicker.vue'
import type { CommandSeed } from '~/composables/useCommandsPage'
import { useSidecar } from '~/composables/useSidecar'
import { useCommandsStore } from '~/stores/commands'

const props = withDefaults(
  defineProps<{
    open: boolean
    accountId: string | null
    projects: { id: string; name: string }[]
    // Tier preselected when opening from a per-group "+" ('global' or a projectId).
    initialScope?: string
  }>(),
  { initialScope: 'global' },
)

const emit = defineEmits<{
  close: []
  save: [payload: { seed: CommandSeed; scope: string }]
  'edit-details': [seed: CommandSeed]
}>()

const { t } = useI18n()
const sc = useSidecar()
const store = useCommandsStore()

const scope = ref('global')
const prompt = ref('')
const draft = ref<CommandSeed | null>(null)
const isGenerating = ref(false)
const error = ref<string | null>(null)

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9:]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'new-command'

// Reset prompt + draft each time the panel opens.
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
    // No engine / no account: say so rather than passing a locally-derived draft
    // off as the model's output.
    if (!sc.available || !props.accountId) {
      error.value = t('common.aiUnavailable')
      return
    }
    draft.value = await store.generateCommand(text, props.accountId)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isGenerating.value = false
  }
}

const onSave = () => {
  if (!draft.value) return
  emit('save', { seed: draft.value, scope: scope.value })
}

const onEditDetails = () => {
  if (!draft.value) return
  emit('edit-details', draft.value)
}
</script>

<style scoped>
.cpc {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.cpc-hint {
  font-size: var(--fs-sm);
  color: var(--textDim);
  line-height: 1.55;
}
.cpc-promptbox {
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  padding: 11px;
}
.cpc-ta {
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
.cpc-err {
  font-size: var(--fs-sm);
  color: var(--danger);
  background: var(--bgInput);
  border: 1px solid var(--danger);
  border-radius: var(--r-sm);
  padding: 8px 11px;
}
.cpc-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cpc-prow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.cpc-pname {
  font-size: var(--fs-sm);
  font-weight: 500;
  color: var(--text);
}
.cpc-pdesc {
  font-size: var(--fs-sm);
  color: var(--textMuted);
}
.spin {
  animation: cpc-spin 0.9s linear infinite;
}
@keyframes cpc-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
