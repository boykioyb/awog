<template>
  <LibraryEntityModal
    :open="open"
    :title="command ? t('commands.editor.editTitle') : t('commands.editor.newTitle')"
    :width="640"
    @close="emit('cancel')"
  >
    <div class="cme">
      <!-- Save location (tier) — locked once a command exists (moving tiers = a new file). -->
      <div class="cme-field">
        <label class="cme-label">{{ t('commands.editor.saveLocation') }}</label>
        <div class="cme-tiers">
          <button
            v-for="opt in sourceOptions"
            :key="opt.value"
            type="button"
            class="chip cme-tier"
            :class="{ on: draft.source === opt.value }"
            :disabled="isExisting"
            @click="draft.source = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
        <div v-if="draft.source === 'project'" class="cme-project">
          <AppSelect
            v-model="draft.projectId"
            :options="projectOptions"
            :placeholder="t('commands.editor.pickProject')"
            width="100%"
          />
        </div>
        <div class="cme-hint">{{ sourceHint }}</div>
      </div>

      <div class="cme-grid">
        <div class="cme-field">
          <label class="cme-label">{{ t('commands.editor.slug') }}</label>
          <div class="cme-slug">
            <span class="cme-slash mono">/</span>
            <input
              class="cme-input mono"
              :value="draft.id"
              :placeholder="t('commands.editor.slugPh')"
              spellcheck="false"
              :disabled="isExisting"
              @input="onSlugInput"
            />
          </div>
          <div class="cme-hint">
            {{ t('commands.editor.slugHint', { slug: draft.id || 'slug' }) }}
          </div>
        </div>
        <div class="cme-field">
          <label class="cme-label">{{ t('commands.editor.name') }}</label>
          <input
            v-model="draft.name"
            class="cme-input"
            :placeholder="t('commands.editor.namePh')"
          />
        </div>
      </div>

      <div class="cme-field">
        <label class="cme-label">{{ t('commands.editor.description') }}</label>
        <textarea
          v-model="draft.description"
          class="cme-input cme-ta"
          rows="2"
          :placeholder="t('commands.editor.descPh')"
        />
      </div>

      <div class="cme-grid">
        <div class="cme-field">
          <label class="cme-label">{{ t('commands.editor.argumentHint') }}</label>
          <input
            v-model="draft.argumentHint"
            class="cme-input mono"
            :placeholder="t('commands.editor.argumentHintPh')"
          />
        </div>
        <div class="cme-field">
          <label class="cme-label">{{ t('commands.editor.model') }}</label>
          <input
            v-model="draft.model"
            class="cme-input mono"
            :placeholder="t('commands.editor.modelPh')"
          />
        </div>
      </div>

      <div class="cme-field">
        <label class="cme-label">{{ t('commands.editor.allowedTools') }}</label>
        <input
          v-model="draft.allowedTools"
          class="cme-input mono"
          :placeholder="t('commands.editor.allowedToolsPh')"
        />
      </div>

      <div class="cme-field">
        <label class="cme-label">{{ t('commands.editor.template') }}</label>
        <textarea
          v-model="draft.body"
          class="cme-input cme-ta mono"
          rows="10"
          :placeholder="t('commands.editor.templatePh')"
        />
        <div class="cme-hint">{{ t('commands.editor.templateHint') }}</div>
      </div>

      <div v-if="!isImported" class="cme-field cme-toggle-field">
        <label class="cme-label">{{ t('commands.editor.enabled') }}</label>
        <button
          class="seg cme-seg"
          type="button"
          role="switch"
          :aria-checked="draft.enabled"
          @click="draft.enabled = !draft.enabled"
        >
          <span :class="{ on: draft.enabled }">{{ t('commands.detail.on') }}</span>
          <span :class="{ on: !draft.enabled }">{{ t('commands.detail.off') }}</span>
        </button>
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button class="btn pri" :disabled="!canSave" @click="onSave">
        {{ t('commands.editor.save') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Command form editor — port of the old UI CommandEditor logic, rendered in
// prototype CSS inside LibraryEntityModal. Save-location tier + slug are locked
// once the command exists. A fresh editor can be seeded from the AI creator's
// "edit details" hand-off. Emits the assembled Command on save.
import { computed, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import type { CommandSeed } from '~/composables/useCommandsPage'
import type { Command, CommandSource } from '~/stores/commands'

const props = defineProps<{
  open: boolean
  command: Command | null
  // Seed for a fresh command opened from the AI creator ("edit details").
  seed?: CommandSeed | null
  projects: { id: string; name: string; path?: string }[]
}>()

const emit = defineEmits<{
  save: [command: Command]
  cancel: []
}>()

const { t } = useI18n()

const sourceOptions: { value: CommandSource; label: string }[] = [
  { value: 'global', label: '~/.awog/commands' },
  { value: 'project', label: 'project · .awog/commands' },
]

type Draft = {
  id: string
  source: CommandSource
  projectId: string
  name: string
  description: string
  body: string
  argumentHint: string
  allowedTools: string
  model: string
  enabled: boolean
}

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9:]+/g, '-')
    .replace(/^-+|-+$/g, '')

const makeDefaults = (): Draft => ({
  id: '',
  source: 'global',
  projectId: '',
  name: '',
  description: '',
  body: '',
  argumentHint: '',
  allowedTools: '',
  model: '',
  enabled: true,
})

const fromCommand = (c: Command): Draft => ({
  id: c.id,
  source: c.source ?? 'global',
  projectId: c.projectId ?? '',
  name: c.name,
  description: c.description,
  body: c.body,
  argumentHint: c.argumentHint ?? '',
  allowedTools: c.allowedTools ?? '',
  model: c.model ?? '',
  enabled: c.enabled,
})

const fromSeed = (s: CommandSeed): Draft => ({
  ...makeDefaults(),
  id: slugify(s.name),
  name: s.name,
  description: s.description,
  argumentHint: s.argumentHint,
  body: s.body,
})

const initDraft = (c: Command | null, seed?: CommandSeed | null): Draft =>
  c ? fromCommand(c) : seed ? fromSeed(seed) : makeDefaults()

const draft = ref<Draft>(initDraft(props.command, props.seed))
// While creating, auto-derive the slug from the name until the user types one.
let slugTouched = false

// Re-seed the draft each time the modal opens or the target command changes.
watch(
  () => [props.open, props.command, props.seed] as const,
  ([isOpen]) => {
    if (!isOpen) return
    slugTouched = false
    draft.value = initDraft(props.command, props.seed)
  },
)

const isExisting = computed(() => !!props.command)
const isImported = computed(() => props.command?.readOnly === true)

const projectOptions = computed<AppSelectOption[]>(() =>
  props.projects.map((p) => ({ value: p.id, label: p.path ? `${p.name} (${p.path})` : p.name })),
)

const sourceHint = computed(() => {
  if (draft.value.source === 'global') return t('commands.editor.globalHint')
  const project = props.projects.find((p) => p.id === draft.value.projectId)
  if (!project) return t('commands.editor.projectHintNone', { slug: draft.value.id || 'slug' })
  return t('commands.editor.projectHint', {
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
  slugTouched = true
  draft.value.id = slugify((e.target as HTMLInputElement).value)
}

// Auto-derive the slug from the name while creating + the slug is untouched.
watch(
  () => draft.value.name,
  (name) => {
    if (!isExisting.value && !slugTouched) draft.value.id = slugify(name)
  },
)

const canSave = computed(() => {
  if (!draft.value.id) return false
  if (!draft.value.name.trim()) return false
  if (!draft.value.body.trim()) return false
  if (draft.value.source === 'project' && !draft.value.projectId) return false
  return true
})

const onSave = () => {
  if (!canSave.value) return
  const command: Command = {
    id: draft.value.id,
    source: draft.value.source,
    name: draft.value.name.trim(),
    description: draft.value.description.trim(),
    body: draft.value.body,
    enabled: draft.value.enabled,
  }
  if (draft.value.source === 'project') command.projectId = draft.value.projectId
  if (draft.value.argumentHint.trim()) command.argumentHint = draft.value.argumentHint.trim()
  if (draft.value.allowedTools.trim()) command.allowedTools = draft.value.allowedTools.trim()
  if (draft.value.model.trim()) command.model = draft.value.model.trim()
  // Preserve the imported flag so the sidecar keeps writing the CC source file.
  if (props.command?.readOnly) command.readOnly = true
  emit('save', command)
}
</script>

<style scoped>
.cme {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.cme-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.cme-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cme-label {
  font-size: var(--fs-sm);
  font-weight: 550;
  color: var(--text);
}
.cme-input {
  width: 100%;
  padding: 7px 10px;
  border-radius: var(--r-sm);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-sm);
  font-family: var(--sans);
  outline: none;
}
.cme-input.mono {
  font-family: var(--code);
}
.cme-input:focus {
  border-color: var(--accent);
}
.cme-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.cme-ta {
  resize: vertical;
  min-height: 3rem;
  line-height: 1.55;
}
.cme-hint {
  font-size: var(--fs-xs);
  color: var(--textDim);
}
.cme-tiers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.cme-tier {
  cursor: pointer;
  background: var(--bgInput);
}
.cme-tier.on {
  color: var(--accent);
  border-color: var(--accentBorder);
  background: var(--accentDim);
}
.cme-tier:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.cme-slug {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cme-slash {
  color: var(--textDim);
  font-size: var(--fs-sm);
}
.cme-toggle-field {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}
.cme-seg {
  cursor: pointer;
}
</style>
