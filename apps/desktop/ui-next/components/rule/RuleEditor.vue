<template>
  <LibraryEntityModal
    :open="open"
    :title="rule?.id ? t('rules.editor.editTitle') : t('rules.editor.newTitle')"
    :width="640"
    @close="emit('cancel')"
  >
    <div class="flex flex-col gap-4">
      <!-- Save location (tier) — locked once a rule exists (moving tiers = a new file). -->
      <div class="flex flex-col gap-1.5">
        <Label class="text-sm font-medium text-foreground">
          {{ t('rules.editor.saveLocation') }}
        </Label>
        <ToggleGroup
          type="single"
          :spacing="1"
          class="self-start rounded-lg bg-muted p-0.5"
          :model-value="draft.source"
          :disabled="isExisting"
          @update:model-value="(v) => v && (draft.source = v as RuleSource)"
        >
          <ToggleGroupItem
            v-for="opt in sourceOptions"
            :key="opt.value"
            :value="opt.value"
            :class="SEG_ITEM"
          >
            {{ opt.label }}
          </ToggleGroupItem>
        </ToggleGroup>
        <div v-if="draft.source === 'project'">
          <AppSelect
            v-model="draft.projectId"
            :options="projectOptions"
            :placeholder="t('rules.editor.pickProject')"
            width="100%"
          />
        </div>
        <div class="text-xs text-dim">{{ sourceHint }}</div>
      </div>

      <div class="grid grid-cols-2 gap-3.5">
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">{{ t('rules.editor.slug') }}</Label>
          <Input
            :model-value="draft.id"
            :disabled="isImported"
            placeholder="e.g. security"
            spellcheck="false"
            class="font-mono"
            @update:model-value="onSlugInput"
          />
          <div class="text-xs text-dim">
            {{ t('rules.editor.slugHint', { slug: draft.id || 'slug' }) }}
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">{{ t('rules.editor.name') }}</Label>
          <Input
            v-model="draft.name"
            :disabled="isImported"
            :placeholder="t('rules.editor.namePh')"
          />
        </div>
      </div>

      <div v-if="!isImported" class="flex flex-col gap-1.5">
        <Label class="text-sm font-medium text-foreground">
          {{ t('rules.editor.description') }}
        </Label>
        <Textarea
          v-model="draft.description"
          class="min-h-12 resize-y"
          rows="2"
          :placeholder="t('rules.editor.descPh')"
        />
      </div>

      <div v-if="!isImported" class="flex flex-col gap-1.5">
        <Label class="text-sm font-medium text-foreground">{{ t('rules.editor.globs') }}</Label>
        <Input v-model="globsText" :placeholder="t('rules.editor.globsPh')" class="font-mono" />
        <div class="text-xs text-dim">{{ t('rules.editor.globsHint') }}</div>
      </div>

      <div class="flex flex-col gap-1.5">
        <Label class="text-sm font-medium text-foreground">{{ t('rules.editor.body') }}</Label>
        <!-- mono-ok: nội dung dạng file/code người dùng sửa như code -->
        <Textarea
          v-model="draft.body"
          class="min-h-12 resize-y font-mono"
          rows="12"
          :placeholder="t('rules.editor.bodyPh')"
        />
      </div>

      <div v-if="!isImported" class="flex items-center gap-1.5">
        <span class="text-sm font-medium text-foreground">{{ t('rules.editor.enabled') }}</span>
        <span class="flex-1" />
        <Switch :checked="draft.enabled" @update:checked="(v: boolean) => (draft.enabled = v)" />
      </div>
    </div>

    <template #footer>
      <Button variant="outline" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
      <Button :disabled="!canSave" variant="default" @click="onSave">
        {{ t('rules.editor.save') }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Rule form editor — port of the old UI RuleEditor logic, rendered
// inside LibraryEntityModal. Save-location tier is locked once the rule
// exists; slug is sanitized to kebab-case and auto-derived from the name while
// creating. Globs edit as a comma-separated string, stored as string[]. Imported
// (read-only) rules expose only the body. Emits a save payload carrying the
// optional previousId for slug renames.
import { computed, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import type { Rule, RuleSource } from '~/stores/rules'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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

// Segmented control chọn tier (cùng kiểu LibraryMarkdownBody).
const SEG_ITEM =
  'h-6 px-2 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm'

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

const onSlugInput = (v: string) => {
  slugTouched = true
  draft.value.id = slugify(v)
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
