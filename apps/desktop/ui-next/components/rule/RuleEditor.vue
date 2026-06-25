<template>
  <LibraryEntityModal
    :open="open"
    :title="rule?.id ? t('rules.editor.editTitle') : t('rules.editor.newTitle')"
    :width="640"
    @close="emit('cancel')"
  >
    <div class="rle">
      <!-- Save location (tier) — locked once a rule exists (moving tiers = a new file). -->
      <div class="rle-field">
        <label class="rle-label">{{ t('rules.editor.saveLocation') }}</label>
        <div class="rle-tiers">
          <button
            v-for="opt in sourceOptions"
            :key="opt.value"
            type="button"
            class="chip rle-tier"
            :class="{ on: draft.source === opt.value }"
            :disabled="isExisting"
            @click="draft.source = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
        <div v-if="draft.source === 'project'" class="rle-project">
          <AppSelect
            v-model="draft.projectId"
            :options="projectOptions"
            :placeholder="t('rules.editor.pickProject')"
            width="100%"
          />
        </div>
        <div class="rle-hint">{{ sourceHint }}</div>
      </div>

      <div class="rle-grid">
        <div class="rle-field">
          <label class="rle-label">{{ t('rules.editor.slug') }}</label>
          <input
            class="rle-input mono"
            :value="draft.id"
            :disabled="isImported"
            placeholder="e.g. security"
            spellcheck="false"
            @input="onSlugInput"
          />
          <div class="rle-hint">
            {{ t('rules.editor.slugHint', { slug: draft.id || 'slug' }) }}
          </div>
        </div>
        <div class="rle-field">
          <label class="rle-label">{{ t('rules.editor.name') }}</label>
          <input
            v-model="draft.name"
            class="rle-input"
            :disabled="isImported"
            :placeholder="t('rules.editor.namePh')"
          />
        </div>
      </div>

      <div v-if="!isImported" class="rle-field">
        <label class="rle-label">{{ t('rules.editor.description') }}</label>
        <textarea
          v-model="draft.description"
          class="rle-input rle-ta"
          rows="2"
          :placeholder="t('rules.editor.descPh')"
        />
      </div>

      <div v-if="!isImported" class="rle-field">
        <label class="rle-label">{{ t('rules.editor.globs') }}</label>
        <input
          v-model="globsText"
          class="rle-input mono"
          :placeholder="t('rules.editor.globsPh')"
        />
        <div class="rle-hint">{{ t('rules.editor.globsHint') }}</div>
      </div>

      <div class="rle-field">
        <label class="rle-label">{{ t('rules.editor.body') }}</label>
        <textarea
          v-model="draft.body"
          class="rle-input rle-ta mono"
          rows="12"
          :placeholder="t('rules.editor.bodyPh')"
        />
      </div>

      <div v-if="!isImported" class="rle-field rle-togrow">
        <span class="rle-label">{{ t('rules.editor.enabled') }}</span>
        <span style="flex: 1" />
        <span
          class="tog2"
          :class="{ off: !draft.enabled }"
          @click="draft.enabled = !draft.enabled"
        />
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button class="btn pri" :disabled="!canSave" @click="onSave">
        {{ t('rules.editor.save') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Rule form editor — port of the old UI RuleEditor logic, rendered in prototype
// CSS inside LibraryEntityModal. Save-location tier is locked once the rule
// exists; slug is sanitized to kebab-case and auto-derived from the name while
// creating. Globs edit as a comma-separated string, stored as string[]. Imported
// (read-only) rules expose only the body. Emits a save payload carrying the
// optional previousId for slug renames.
import { computed, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import type { Rule, RuleSource } from '~/stores/rules'

const props = defineProps<{
  open: boolean
  rule: Rule | null
  projects: { id: string; name: string; path?: string }[]
}>()

const emit = defineEmits<{
  save: [payload: { rule: Rule; previousId?: string }]
  cancel: []
}>()

const { t } = useI18n()

const sourceOptions: { value: RuleSource; label: string }[] = [
  { value: 'global', label: '~/.awog/rules' },
  { value: 'project', label: 'project · .awog/rules' },
]

type Draft = {
  id: string
  source: RuleSource
  projectId: string
  name: string
  description: string
  body: string
  enabled: boolean
  globs: string[]
}

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const makeDefaults = (): Draft => ({
  id: '',
  source: 'global',
  projectId: '',
  name: '',
  description: '',
  body: '',
  enabled: true,
  globs: [],
})

const fromRule = (r: Rule): Draft => ({
  id: r.id,
  source: r.source,
  projectId: r.projectId ?? '',
  name: r.name,
  description: r.description,
  body: r.body,
  enabled: r.enabled,
  globs: [...(r.globs ?? [])],
})

const initDraft = (r: Rule | null): Draft => (r ? fromRule(r) : makeDefaults())

const draft = ref<Draft>(initDraft(props.rule))
const previousId = ref<string | undefined>(props.rule?.id)

// Auto-derive slug from name while creating, until the user types a custom slug.
let slugTouched = false

// Glob patterns edit as a comma-separated string; stored as string[].
const globsText = computed<string>({
  get: () => draft.value.globs.join(', '),
  set: (v) => {
    draft.value.globs = v
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  },
})

// Re-seed the draft each time the modal opens or the target rule changes.
watch(
  () => [props.open, props.rule] as const,
  ([isOpen]) => {
    if (!isOpen) return
    slugTouched = false
    draft.value = initDraft(props.rule)
    previousId.value = props.rule?.id
  },
)

const isExisting = computed(() => !!props.rule)
const isImported = computed(() => props.rule?.readOnly === true)

const projectOptions = computed<AppSelectOption[]>(() =>
  props.projects.map((p) => ({ value: p.id, label: p.path ? `${p.name} (${p.path})` : p.name })),
)

const sourceHint = computed(() => {
  if (draft.value.source === 'global') return t('rules.editor.globalHint')
  const project = props.projects.find((p) => p.id === draft.value.projectId)
  if (!project) return t('rules.editor.projectHintNone', { slug: draft.value.id || 'slug' })
  return t('rules.editor.projectHint', {
    path: project.path ?? project.name,
    slug: draft.value.id || 'slug',
  })
})

// Pre-fill the first project when switching to the project tier.
watch(
  () => draft.value.source,
  (source) => {
    if (source === 'project' && !draft.value.projectId) {
      draft.value.projectId = props.projects[0]?.id ?? ''
    }
  },
)

watch(
  () => draft.value.name,
  (name) => {
    if (!isExisting.value && !slugTouched) draft.value.id = slugify(name)
  },
)

const onSlugInput = (e: Event) => {
  slugTouched = true
  draft.value.id = slugify((e.target as HTMLInputElement).value)
}

const canSave = computed(() => {
  if (!draft.value.id) return false
  if (!draft.value.name.trim()) return false
  if (!draft.value.body.trim()) return false
  if (!/^[a-z0-9][a-z0-9-]*$/.test(draft.value.id)) return false
  if (draft.value.source === 'project' && !draft.value.projectId) return false
  return true
})

const onSave = () => {
  if (!canSave.value) return
  const rule: Rule = {
    id: draft.value.id,
    source: draft.value.source,
    name: draft.value.name.trim(),
    description: draft.value.description.trim(),
    body: draft.value.body,
    enabled: draft.value.enabled,
  }
  if (draft.value.source === 'project') rule.projectId = draft.value.projectId
  if (draft.value.globs.length > 0) rule.globs = [...draft.value.globs]
  if (props.rule?.readOnly) rule.readOnly = true

  const payload: { rule: Rule; previousId?: string } = { rule }
  if (previousId.value && previousId.value !== rule.id) payload.previousId = previousId.value
  emit('save', payload)
}
</script>

<style scoped>
.rle {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.rle-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.rle-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rle-togrow {
  flex-direction: row;
  align-items: center;
}
.rle-label {
  font-size: 0.8846rem;
  font-weight: 550;
  color: var(--text);
}
.rle-input {
  width: 100%;
  padding: 7px 10px;
  border-radius: 8px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 0.9615rem;
  font-family: var(--sans);
  outline: none;
}
.rle-input.mono {
  font-family: var(--code);
}
.rle-input:focus {
  border-color: var(--accent);
}
.rle-input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.rle-ta {
  resize: vertical;
  min-height: 3rem;
  line-height: 1.55;
}
.rle-hint {
  font-size: 0.8462rem;
  color: var(--textDim);
}
.rle-tiers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.rle-tier {
  cursor: pointer;
  background: var(--bgInput);
}
.rle-tier.on {
  color: var(--accent);
  border-color: var(--accentBorder);
  background: var(--accentDim);
}
.rle-tier:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
