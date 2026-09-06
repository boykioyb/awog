<template>
  <LibraryEntityModal
    :open="open"
    :title="skill?.id ? t('skills.editor.editTitle') : t('skills.editor.newTitle')"
    :width="640"
    @close="emit('cancel')"
  >
    <div class="ske">
      <!-- Save location (tier) — locked once a skill exists (moving tiers = a new file). -->
      <div class="ske-field">
        <label class="ske-label">{{ t('skills.editor.saveLocation') }}</label>
        <div class="ske-tiers">
          <button
            v-for="opt in sourceOptions"
            :key="opt.value"
            type="button"
            class="chip ske-tier"
            :class="{ on: draft.source === opt.value }"
            :disabled="isExisting"
            @click="draft.source = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
        <div v-if="draft.source === 'project'" class="ske-project">
          <AppSelect
            v-model="draft.projectId"
            :options="projectOptions"
            :placeholder="t('skills.editor.pickProject')"
            width="100%"
          />
        </div>
        <div class="ske-hint">{{ sourceHint }}</div>
      </div>

      <div class="ske-grid">
        <div class="ske-field">
          <label class="ske-label">{{ t('skills.editor.slug') }}</label>
          <input
            class="ske-input mono"
            :value="draft.id"
            placeholder="e.g. code-review"
            spellcheck="false"
            @input="onSlugInput"
          />
          <div class="ske-hint">
            {{ t('skills.editor.slugHint', { slug: draft.id || 'slug' }) }}
          </div>
        </div>
        <div class="ske-field">
          <label class="ske-label">{{ t('skills.editor.icon') }}</label>
          <input v-model="draft.icon" class="ske-input" placeholder="e.g. 🔍" />
        </div>
      </div>

      <div class="ske-field">
        <label class="ske-label">{{ t('skills.editor.name') }}</label>
        <input v-model="draft.name" class="ske-input" :placeholder="t('skills.editor.namePh')" />
      </div>

      <div class="ske-field">
        <label class="ske-label">{{ t('skills.editor.description') }}</label>
        <textarea
          v-model="draft.description"
          class="ske-input ske-ta"
          rows="2"
          :placeholder="t('skills.editor.descPh')"
        />
      </div>

      <div class="ske-field">
        <label class="ske-label">{{ t('skills.editor.body') }}</label>
        <textarea
          v-model="draft.body"
          class="ske-input ske-ta mono"
          rows="12"
          :placeholder="t('skills.editor.bodyPh')"
        />
      </div>

      <div class="ske-grid">
        <div class="ske-field">
          <label class="ske-label">{{ t('skills.editor.globs') }}</label>
          <div class="ske-chips">
            <span v-for="g in draft.globs" :key="g" class="chip mono">
              {{ g }}
              <button class="ske-chipx" @click="draft.globs = draft.globs.filter((x) => x !== g)">
                <Icon name="x" style="width: 10px; height: 10px" />
              </button>
            </span>
          </div>
          <input
            v-model="globInput"
            class="ske-input mono"
            placeholder="e.g. *.test.ts (Enter)"
            @keydown.enter.prevent="addChip('globs', globInput, () => (globInput = ''))"
          />
        </div>
        <div class="ske-field">
          <label class="ske-label">{{ t('skills.editor.alwaysAllow') }}</label>
          <div class="ske-chips">
            <span v-for="tool in draft.alwaysAllow" :key="tool" class="chip">
              {{ tool }}
              <button
                class="ske-chipx"
                @click="draft.alwaysAllow = draft.alwaysAllow.filter((x) => x !== tool)"
              >
                <Icon name="x" style="width: 10px; height: 10px" />
              </button>
            </span>
          </div>
          <input
            v-model="allowInput"
            class="ske-input"
            placeholder="e.g. Bash (Enter)"
            @keydown.enter.prevent="addChip('alwaysAllow', allowInput, () => (allowInput = ''))"
          />
        </div>
      </div>

      <div class="ske-field">
        <label class="ske-label">{{ t('skills.editor.requiredSources') }}</label>
        <div class="ske-chips">
          <span v-for="src in draft.requiredSources" :key="src" class="chip">
            {{ src }}
            <button
              class="ske-chipx"
              @click="draft.requiredSources = draft.requiredSources.filter((x) => x !== src)"
            >
              <Icon name="x" style="width: 10px; height: 10px" />
            </button>
          </span>
        </div>
        <input
          v-model="sourceInput"
          class="ske-input"
          placeholder="e.g. github (Enter)"
          @keydown.enter.prevent="addChip('requiredSources', sourceInput, () => (sourceInput = ''))"
        />
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button class="btn pri" :disabled="!canSave" @click="onSave">
        {{ t('skills.editor.save') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Skill form editor — port of the old UI SkillEditor logic, rendered in
// prototype CSS inside LibraryEntityModal. Save-location tier is locked once the
// skill exists; slug is sanitized to kebab-case. Emits a save payload carrying
// the optional previousId for slug renames.
import { computed, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import type { Skill, SkillSource } from '~/stores/skills'

const props = defineProps<{
  open: boolean
  skill: Skill | null
  projects: { id: string; name: string; path?: string }[]
}>()

const emit = defineEmits<{
  save: [payload: { skill: Skill; previousId?: string }]
  cancel: []
}>()

const { t } = useI18n()

const sourceOptions: { value: SkillSource; label: string }[] = [
  { value: 'global', label: '~/.awog/skills' },
  { value: 'project', label: 'project · .awog/skills' },
]

type Draft = {
  id: string
  source: SkillSource
  projectId: string
  name: string
  description: string
  body: string
  icon: string
  globs: string[]
  alwaysAllow: string[]
  requiredSources: string[]
}

type ChipField = 'globs' | 'alwaysAllow' | 'requiredSources'

const makeDefaults = (): Draft => ({
  id: '',
  source: 'global',
  projectId: '',
  name: '',
  description: '',
  body: '',
  icon: '',
  globs: [],
  alwaysAllow: [],
  requiredSources: [],
})

const fromSkill = (s: Skill): Draft => ({
  id: s.id,
  source: s.source,
  projectId: s.projectId ?? '',
  name: s.name,
  description: s.description,
  body: s.body,
  icon: s.icon ?? '',
  globs: [...(s.globs ?? [])],
  alwaysAllow: [...(s.alwaysAllow ?? [])],
  requiredSources: [...(s.requiredSources ?? [])],
})

const initDraft = (s: Skill | null): Draft => (s ? fromSkill(s) : makeDefaults())

const draft = ref<Draft>(initDraft(props.skill))
const previousId = ref<string | undefined>(props.skill?.id)

const globInput = ref('')
const allowInput = ref('')
const sourceInput = ref('')

// Re-seed the draft each time the modal opens or the target skill changes.
watch(
  () => [props.open, props.skill] as const,
  ([isOpen]) => {
    if (!isOpen) return
    draft.value = initDraft(props.skill)
    previousId.value = props.skill?.id
    globInput.value = ''
    allowInput.value = ''
    sourceInput.value = ''
  },
)

const isExisting = computed(() => !!props.skill)

const projectOptions = computed<AppSelectOption[]>(() =>
  props.projects.map((p) => ({ value: p.id, label: p.path ? `${p.name} (${p.path})` : p.name })),
)

const sourceHint = computed(() => {
  if (draft.value.source === 'global') return t('skills.editor.globalHint')
  const project = props.projects.find((p) => p.id === draft.value.projectId)
  if (!project) return t('skills.editor.projectHintNone', { slug: draft.value.id || 'slug' })
  return t('skills.editor.projectHint', {
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

const onSlugInput = (e: Event) => {
  draft.value.id = (e.target as HTMLInputElement).value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

const canSave = computed(() => {
  if (!draft.value.id) return false
  if (!draft.value.name.trim()) return false
  if (!draft.value.description.trim()) return false
  if (!/^[a-z0-9][a-z0-9-]*$/.test(draft.value.id)) return false
  if (draft.value.source === 'project' && !draft.value.projectId) return false
  return true
})

const addChip = (field: ChipField, value: string, reset: () => void) => {
  const v = value.trim()
  if (!v) return
  if (!draft.value[field].includes(v)) draft.value[field] = [...draft.value[field], v]
  reset()
}

const onSave = () => {
  if (!canSave.value) return
  const skill: Skill = {
    id: draft.value.id,
    source: draft.value.source,
    name: draft.value.name.trim(),
    description: draft.value.description.trim(),
    body: draft.value.body,
  }
  if (draft.value.source === 'project') skill.projectId = draft.value.projectId
  if (draft.value.icon.trim()) skill.icon = draft.value.icon.trim()
  if (draft.value.globs.length > 0) skill.globs = [...draft.value.globs]
  if (draft.value.alwaysAllow.length > 0) skill.alwaysAllow = [...draft.value.alwaysAllow]
  if (draft.value.requiredSources.length > 0)
    skill.requiredSources = [...draft.value.requiredSources]

  const payload: { skill: Skill; previousId?: string } = { skill }
  if (previousId.value && previousId.value !== skill.id) payload.previousId = previousId.value
  emit('save', payload)
}
</script>

<style scoped>
.ske {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.ske-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.ske-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ske-label {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 550;
  color: var(--text);
}
.ske-input {
  width: 100%;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-family: var(--sans);
  outline: none;
}
.ske-input.mono {
  /* mono-ok: the `.mono` opt-in variant — allowed-tools / path */
  font-family: var(--code);
}
.ske-input:focus {
  border-color: var(--accent);
}
.ske-ta {
  resize: vertical;
  min-height: 3rem;
  line-height: var(--lh-md);
}
.ske-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.ske-tiers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ske-tier {
  cursor: pointer;
  background: var(--bgInput);
}
.ske-tier.on {
  color: var(--accent);
  border-color: var(--accentBorder);
  background: var(--accentDim);
}
.ske-tier:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ske-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.ske-chipx {
  display: inline-flex;
  border: 0;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  padding: 0;
}
.ske-chipx:hover {
  color: var(--danger);
}
</style>
