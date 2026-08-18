<template>
  <LibraryEntityModal
    :open="open"
    :title="t('hooks.creator.title')"
    :lock-scrim="isGenerating"
    :width="560"
    @close="emit('cancel')"
  >
    <div class="hpc">
      <div class="hpc-hint">{{ t('hooks.creator.hint') }}</div>

      <div class="hpc-field">
        <LibraryScopePicker v-model="scope" :projects="projects" />
      </div>

      <div v-if="!draft" class="hpc-promptbox">
        <textarea
          v-model="prompt"
          class="hpc-ta"
          rows="3"
          :disabled="isGenerating"
          :placeholder="t('hooks.creator.placeholder')"
          @keydown.enter.exact.prevent="onGenerate"
        />
      </div>

      <div v-if="error" class="hpc-err">{{ error }}</div>

      <div v-if="draft" class="hpc-preview">
        <div class="hpc-prow">
          <span class="hpc-pname">{{ draft.name }}</span>
          <span class="tag mono">{{ draft.event }}</span>
          <span class="tag" :class="{ acc: draft.runMode === 'blocking' }">
            {{ draft.runMode }}
          </span>
        </div>
        <div class="hpc-pdesc">{{ draft.description }}</div>
        <pre class="codeblk hpc-cmd">{{ draft.command }}</pre>
        <div v-if="matcherText" class="hpc-matcher mono">matcher: {{ matcherText }}</div>
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <template v-if="!draft">
        <button class="btn pri" :disabled="isGenerating || !prompt.trim()" @click="onGenerate">
          <Icon :name="isGenerating ? 'refresh' : 'sparkles'" :class="{ spin: isGenerating }" />
          {{ isGenerating ? t('hooks.creator.generating') : t('hooks.creator.generate') }}
        </button>
      </template>
      <template v-else>
        <button class="btn" @click="resetDraft">
          <Icon name="refresh" />
          {{ t('hooks.creator.regenerate') }}
        </button>
        <button class="btn" @click="onEditDetails">
          <Icon name="edit" />
          {{ t('hooks.creator.editDetails') }}
        </button>
        <button class="btn pri" @click="onSave">
          <Icon name="save" />
          {{ t('hooks.creator.save') }}
        </button>
      </template>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Hook creation panel — one-shot LLM draft (hooks.generate via the store), not a
// streaming author RPC (hooks has no `hooks.author`). Mirrors SkillBodyEditModal's
// generate→preview→apply shape inside LibraryEntityModal. From the preview the
// user can Regenerate, "Edit details" (hand the draft to the full editor), or
// Save directly to the chosen scope. Falls back to a local heuristic draft when
// no sidecar / account so the UX stays usable offline.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import LibraryScopePicker from '~/components/library/LibraryScopePicker.vue'
import { useSidecar } from '~/composables/useSidecar'
import { useHooksStore, type Hook, type HookConfig } from '~/stores/hooks'

const props = withDefaults(
  defineProps<{
    open: boolean
    accountId: string | null
    projects: { id: string; name: string }[]
    // Preselected tier for the scope picker when opened from a per-group "+".
    initialScope?: string
  }>(),
  { initialScope: 'global' },
)

const emit = defineEmits<{
  // Persist the draft to the chosen scope (global → ~/.awog, else projectId).
  save: [hook: Hook]
  // Hand the draft to the full editor for manual tweaks.
  'edit-manually': [hook: Hook]
  cancel: []
}>()

const { t } = useI18n()
const sc = useSidecar()
const store = useHooksStore()

const scope = ref('global')
const prompt = ref('')
const draft = ref<HookConfig | null>(null)
const isGenerating = ref(false)
const error = ref<string | null>(null)

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

const matcherText = computed(() =>
  draft.value && Object.keys(draft.value.matcher).length ? JSON.stringify(draft.value.matcher) : '',
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
    // A hook is executable config — never hand back a keyword-guessed draft as if
    // the model wrote it.
    if (!sc.available || !props.accountId) {
      error.value = t('common.aiUnavailable')
      return
    }
    draft.value = await store.generateHook(text, props.accountId)
  } catch (err) {
    console.warn('[hooks] generate failed', err)
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    isGenerating.value = false
  }
}

// Build a Hook from the config draft + the chosen scope.
const toHook = (cfg: HookConfig): Hook => {
  const id =
    cfg.name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join('-') || 'new-hook'
  const hook: Hook = {
    id,
    name: cfg.name,
    description: cfg.description,
    event: cfg.event,
    matcher: { ...cfg.matcher },
    command: cfg.command,
    cwd: cfg.cwd || '${workspace}',
    timeoutMs: cfg.timeoutMs || 30000,
    runMode: cfg.runMode,
    enabled: true,
    recentRuns: [],
    source: scope.value === 'global' ? 'global' : 'project',
  }
  if (scope.value !== 'global') {
    hook.projectId = scope.value
    hook.trusted = false
  }
  return hook
}

const onSave = () => {
  if (draft.value) emit('save', toHook(draft.value))
}
const onEditDetails = () => {
  if (draft.value) emit('edit-manually', toHook(draft.value))
}
</script>

<style scoped>
.hpc {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.hpc-hint {
  font-size: 0.9231rem;
  color: var(--textDim);
  line-height: 1.55;
}
.hpc-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hpc-promptbox {
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 11px;
}
.hpc-ta {
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
.hpc-err {
  font-size: 0.8846rem;
  color: var(--danger);
  background: var(--bgInput);
  border: 1px solid var(--danger);
  border-radius: 8px;
  padding: 8px 11px;
}
.hpc-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 12px;
}
.hpc-prow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.hpc-pname {
  font-size: 0.9615rem;
  color: var(--text);
  font-weight: 550;
}
.hpc-pdesc {
  font-size: 0.9231rem;
  color: var(--textMuted);
  line-height: 1.55;
}
.hpc-cmd {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.hpc-matcher {
  font-size: 0.8462rem;
  color: var(--textDim);
}
.spin {
  animation: hpc-spin 0.9s linear infinite;
}
@keyframes hpc-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
