<template>
  <LibraryEntityModal
    :open="open"
    :title="skill?.id ? t('skills.editor.editTitle') : t('skills.editor.newTitle')"
    :width="640"
    @close="emit('cancel')"
  >
    <div class="flex flex-col gap-4">
      <!-- Save location (tier) — locked once a skill exists (moving tiers = a new file). -->
      <div class="flex flex-col gap-1.5">
        <Label class="text-sm font-medium text-foreground">
          {{ t('skills.editor.saveLocation') }}
        </Label>
        <ToggleGroup
          type="single"
          :spacing="1"
          class="self-start rounded-lg bg-muted p-0.5"
          :model-value="draft.source"
          :disabled="isExisting"
          @update:model-value="(v) => v && (draft.source = v as SkillSource)"
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
            :placeholder="t('skills.editor.pickProject')"
            width="100%"
          />
        </div>
        <div class="text-xs text-dim">{{ sourceHint }}</div>
      </div>

      <div class="grid grid-cols-2 gap-3.5">
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">{{ t('skills.editor.slug') }}</Label>
          <Input
            :model-value="draft.id"
            placeholder="e.g. code-review"
            spellcheck="false"
            class="font-mono"
            @update:model-value="onSlugInput"
          />
          <div class="text-xs text-dim">
            {{ t('skills.editor.slugHint', { slug: draft.id || 'slug' }) }}
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">{{ t('skills.editor.icon') }}</Label>
          <Input v-model="draft.icon" placeholder="e.g. 🔍" />
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <Label class="text-sm font-medium text-foreground">{{ t('skills.editor.name') }}</Label>
        <Input v-model="draft.name" :placeholder="t('skills.editor.namePh')" />
      </div>

      <div class="flex flex-col gap-1.5">
        <Label class="text-sm font-medium text-foreground">
          {{ t('skills.editor.description') }}
        </Label>
        <Textarea
          v-model="draft.description"
          class="min-h-12 resize-y"
          rows="2"
          :placeholder="t('skills.editor.descPh')"
        />
      </div>

      <div class="flex flex-col gap-1.5">
        <Label class="text-sm font-medium text-foreground">{{ t('skills.editor.body') }}</Label>
        <!-- mono-ok: nội dung dạng file/code người dùng sửa như code -->
        <Textarea
          v-model="draft.body"
          class="min-h-12 resize-y font-mono"
          rows="12"
          :placeholder="t('skills.editor.bodyPh')"
        />
      </div>

      <div class="grid grid-cols-2 gap-3.5">
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">{{ t('skills.editor.globs') }}</Label>
          <div class="flex flex-wrap gap-1">
            <!-- mono-ok: glob path -->
            <Badge
              v-for="g in draft.globs"
              :key="g"
              variant="outline"
              class="font-mono text-muted-foreground"
            >
              {{ g }}
              <Button
                variant="ghost"
                size="iconSm"
                class="size-4 text-dim hover:bg-transparent hover:text-destructive"
                @click="draft.globs = draft.globs.filter((x) => x !== g)"
              >
                <Icon name="x" class="size-2.5!" />
              </Button>
            </Badge>
          </div>
          <Input
            v-model="globInput"
            placeholder="e.g. *.test.ts (Enter)"
            class="font-mono"
            @keydown.enter.prevent="addChip('globs', globInput, () => (globInput = ''))"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">
            {{ t('skills.editor.alwaysAllow') }}
          </Label>
          <div class="flex flex-wrap gap-1">
            <Badge
              v-for="tool in draft.alwaysAllow"
              :key="tool"
              variant="outline"
              class="text-muted-foreground"
            >
              {{ tool }}
              <Button
                variant="ghost"
                size="iconSm"
                class="size-4 text-dim hover:bg-transparent hover:text-destructive"
                @click="draft.alwaysAllow = draft.alwaysAllow.filter((x) => x !== tool)"
              >
                <Icon name="x" class="size-2.5!" />
              </Button>
            </Badge>
          </div>
          <Input
            v-model="allowInput"
            placeholder="e.g. Bash (Enter)"
            @keydown.enter.prevent="addChip('alwaysAllow', allowInput, () => (allowInput = ''))"
          />
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <Label class="text-sm font-medium text-foreground">
          {{ t('skills.editor.requiredSources') }}
        </Label>
        <div class="flex flex-wrap gap-1">
          <Badge
            v-for="src in draft.requiredSources"
            :key="src"
            variant="outline"
            class="text-muted-foreground"
          >
            {{ src }}
            <Button
              variant="ghost"
              size="iconSm"
              class="size-4 text-dim hover:bg-transparent hover:text-destructive"
              @click="draft.requiredSources = draft.requiredSources.filter((x) => x !== src)"
            >
              <Icon name="x" class="size-2.5!" />
            </Button>
          </Badge>
        </div>
        <Input
          v-model="sourceInput"
          placeholder="e.g. github (Enter)"
          @keydown.enter.prevent="addChip('requiredSources', sourceInput, () => (sourceInput = ''))"
        />
      </div>
    </div>

    <template #footer>
      <Button variant="outline" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
      <Button :disabled="!canSave" variant="default" @click="onSave">
        {{ t('skills.editor.save') }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Skill form editor — port of the old UI SkillEditor logic, rendered
// inside LibraryEntityModal. Save-location tier is locked once the
// skill exists; slug is sanitized to kebab-case. Emits a save payload carrying
// the optional previousId for slug renames.
import { computed, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import type { Skill, SkillSource } from '~/stores/skills'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

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

// Segmented control chọn tier (cùng kiểu LibraryMarkdownBody).
const SEG_ITEM =
  'h-6 px-2 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm'

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

const onSlugInput = (v: string) => {
  draft.value.id = v
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
