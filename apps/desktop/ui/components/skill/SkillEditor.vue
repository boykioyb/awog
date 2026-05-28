<template>
  <EditorShell
    :title="skill?.id ? 'Edit Skill' : 'New Skill'"
    :dirty="dirty"
    :can-save="canSave"
    @save="onSave"
    @cancel="emit('cancel')"
  >
    <div class="space-y-4">
      <Field label="Save location">
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="opt in sourceOptions"
            :key="opt.value"
            type="button"
            :disabled="isExistingSkill"
            class="text-[11px] px-2 py-1 rounded font-mono transition"
            :style="sourceButtonStyle(opt.value === draft.source)"
            @click="draft.source = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
        <div v-if="isProjectSource(draft.source)" class="mt-2">
          <select
            v-model="draft.projectId"
            class="w-full rounded px-2 py-1.5 text-xs"
            :style="inputStyle"
            :disabled="isExistingSkill"
          >
            <option value="" disabled>— pick a project —</option>
            <option v-for="p in ws.projects" :key="p.id" :value="p.id">
              {{ p.name }} ({{ p.path }})
            </option>
          </select>
        </div>
        <div class="text-[10px] mt-1.5" :style="{ color: t.textDim }">
          {{ sourceHint }}
        </div>
      </Field>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Slug">
          <input
            :value="draft.id"
            placeholder="e.g. code-review"
            class="w-full rounded px-2 py-1.5 text-xs font-mono"
            :style="inputStyle"
            @input="
              (e: Event) =>
                (draft.id = (e.target as HTMLInputElement).value
                  .toLowerCase()
                  .replace(/[^a-z0-9-]/g, '-')
                  .replace(/-+/g, '-')
                  .replace(/^-|-$/g, ''))
            "
          />
          <div class="text-[10px] mt-1" :style="{ color: t.textDim }">
            Folder name on disk · invoke with /{{ draft.id || 'slug' }}
          </div>
        </Field>
        <Field label="Icon (emoji)">
          <input
            v-model="draft.icon"
            placeholder="e.g. 🔍"
            class="w-full rounded px-2 py-1.5 text-xs"
            :style="inputStyle"
          />
        </Field>
      </div>

      <Field label="Name">
        <input
          v-model="draft.name"
          placeholder="Display name shown in the skill list"
          class="w-full rounded px-2 py-1.5 text-xs"
          :style="inputStyle"
        />
      </Field>

      <Field label="Description">
        <textarea
          v-model="draft.description"
          :rows="2"
          placeholder="One-sentence summary used in the picker"
          class="w-full rounded px-2 py-1.5 text-[12px] resize-none"
          :style="inputStyle"
        />
      </Field>

      <Field label="Instructions (SKILL.md body)">
        <textarea
          v-model="draft.body"
          :rows="12"
          placeholder="Markdown instructions injected into the agent's system prompt when this skill is active"
          class="w-full rounded px-2 py-1.5 text-[12px] font-mono leading-relaxed resize-none"
          :style="inputStyle"
        />
      </Field>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Auto-trigger globs">
          <div class="flex flex-wrap gap-1 mb-1.5">
            <span
              v-for="g in draft.globs"
              :key="g"
              class="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1 font-mono"
              :style="chipStyle"
            >
              {{ g }}
              <button
                :style="{ color: t.textDim }"
                @click="draft.globs = draft.globs.filter((x) => x !== g)"
              >
                <X :size="9" />
              </button>
            </span>
          </div>
          <input
            v-model="globInput"
            placeholder="e.g. *.test.ts (Enter to add)"
            class="w-full rounded px-2 py-1.5 text-[11px] font-mono"
            :style="inputStyle"
            @keydown.enter.prevent="addChip('globs', globInput, () => (globInput = ''))"
          />
        </Field>
        <Field label="Always-allow tools">
          <div class="flex flex-wrap gap-1 mb-1.5">
            <span
              v-for="tool in draft.alwaysAllow"
              :key="tool"
              class="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
              :style="chipStyle"
            >
              {{ tool }}
              <button
                :style="{ color: t.textDim }"
                @click="draft.alwaysAllow = draft.alwaysAllow.filter((x) => x !== tool)"
              >
                <X :size="9" />
              </button>
            </span>
          </div>
          <input
            v-model="allowInput"
            placeholder="e.g. Bash (Enter to add)"
            class="w-full rounded px-2 py-1.5 text-[11px]"
            :style="inputStyle"
            @keydown.enter.prevent="addChip('alwaysAllow', allowInput, () => (allowInput = ''))"
          />
        </Field>
      </div>

      <Field label="Required sources">
        <div class="flex flex-wrap gap-1 mb-1.5">
          <span
            v-for="src in draft.requiredSources"
            :key="src"
            class="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
            :style="chipStyle"
          >
            {{ src }}
            <button
              :style="{ color: t.textDim }"
              @click="draft.requiredSources = draft.requiredSources.filter((x) => x !== src)"
            >
              <X :size="9" />
            </button>
          </span>
        </div>
        <input
          v-model="sourceInput"
          placeholder="e.g. github (Enter to add)"
          class="w-full rounded px-2 py-1.5 text-[11px]"
          :style="inputStyle"
          @keydown.enter.prevent="addChip('requiredSources', sourceInput, () => (sourceInput = ''))"
        />
      </Field>
    </div>
  </EditorShell>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { X } from 'lucide-vue-next'
import type { Skill, SkillSource } from '~/types'
import type { SkillDraft as GeneratedSkillDraft } from '~/composables/useSkillGenerator'

const props = defineProps<{
  skill: Skill | null
  initialDraft?: GeneratedSkillDraft | null
}>()

const emit = defineEmits<{
  save: [payload: { skill: Skill; previousId?: string }]
  cancel: []
}>()

const { t } = useTheme()
const ws = useWorkspaceStore()
const sessions = useSessionsStore()

const sourceOptions: { value: SkillSource; label: string; group: 'user' | 'project' }[] = [
  { value: 'global', label: '~/.awog/skills', group: 'user' },
  { value: 'user-claude', label: '~/.claude/skills', group: 'user' },
  { value: 'user-agents', label: '~/.agents/skills', group: 'user' },
  { value: 'project-claude', label: 'project · .claude/skills', group: 'project' },
  { value: 'project-agents', label: 'project · .agents/skills', group: 'project' },
]

const PROJECT_SOURCES: SkillSource[] = ['project-claude', 'project-agents']
const isProjectSource = (s: SkillSource): boolean => PROJECT_SOURCES.includes(s)

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

const defaultProjectId = (): string =>
  sessions.selectedSession?.projectId ?? ws.projects[0]?.id ?? ''

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

const fromGenerated = (g: GeneratedSkillDraft): Draft => ({
  id: g.id ?? '',
  source: 'global',
  projectId: '',
  name: g.name,
  description: g.description,
  body: g.body,
  icon: g.icon ?? '',
  globs: [...(g.globs ?? [])],
  alwaysAllow: [...(g.alwaysAllow ?? [])],
  requiredSources: [...(g.requiredSources ?? [])],
})

const initDraft = (s: Skill | null, seed: GeneratedSkillDraft | null | undefined): Draft => {
  if (s) return fromSkill(s)
  if (seed) return fromGenerated(seed)
  return makeDefaults()
}

const draft = ref<Draft>(initDraft(props.skill, props.initialDraft))
const original = ref<Draft>(initDraft(props.skill, props.initialDraft))
const previousId = ref<string | undefined>(props.skill?.id)

const globInput = ref('')
const allowInput = ref('')
const sourceInput = ref('')

watch(
  () => props.skill,
  (s) => {
    draft.value = initDraft(s, props.initialDraft)
    original.value = initDraft(s, props.initialDraft)
    previousId.value = s?.id
    globInput.value = ''
    allowInput.value = ''
    sourceInput.value = ''
  },
)

const inputStyle = computed<CSSProperties>(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none',
}))

const chipStyle = computed<CSSProperties>(() => ({
  background: t.value.bgInput,
  color: t.value.textMuted,
  border: `1px solid ${t.value.border}`,
}))

const isExistingSkill = computed(() => !!props.skill)

const sourceButtonStyle = (active: boolean): CSSProperties => ({
  background: active ? t.value.accent : t.value.bgInput,
  color: active ? t.value.accentText : t.value.textMuted,
  border: `1px solid ${active ? t.value.accent : t.value.border}`,
  cursor: isExistingSkill.value ? 'not-allowed' : 'pointer',
  opacity: isExistingSkill.value && !active ? 0.4 : 1,
})

const USER_HINT: Partial<Record<SkillSource, string>> = {
  global: '~/.awog/skills/ — AWOG-native, available across all projects.',
  'user-claude': '~/.claude/skills/ — shared with Claude Code SDK installs.',
  'user-agents': '~/.agents/skills/ — shared with Craft Agents installs.',
}

const sourceHint = computed(() => {
  const userHint = USER_HINT[draft.value.source]
  if (userHint) return `Saved to ${userHint}`
  const project = ws.projects.find((p) => p.id === draft.value.projectId)
  const sub = draft.value.source === 'project-claude' ? '.claude/skills' : '.agents/skills'
  if (!project) {
    return `Pick a project — file will be written to <project>/${sub}/${draft.value.id || 'slug'}/SKILL.md`
  }
  return `Saved to ${project.path}/${sub}/${draft.value.id || 'slug'}/SKILL.md`
})

// Default project pre-fill the moment user switches to a project tier
watch(
  () => draft.value.source,
  (source) => {
    if (isProjectSource(source) && !draft.value.projectId) {
      draft.value.projectId = defaultProjectId()
    }
  },
)

const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(original.value))

const canSave = computed(() => {
  if (!draft.value.id) return false
  if (!draft.value.name.trim()) return false
  if (!draft.value.description.trim()) return false
  if (!/^[a-z0-9][a-z0-9-]*$/.test(draft.value.id)) return false
  if (isProjectSource(draft.value.source) && !draft.value.projectId) return false
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
  if (isProjectSource(draft.value.source)) skill.projectId = draft.value.projectId
  if (draft.value.icon.trim()) skill.icon = draft.value.icon.trim()
  if (draft.value.globs.length > 0) skill.globs = [...draft.value.globs]
  if (draft.value.alwaysAllow.length > 0) skill.alwaysAllow = [...draft.value.alwaysAllow]
  if (draft.value.requiredSources.length > 0) {
    skill.requiredSources = [...draft.value.requiredSources]
  }
  const payload: { skill: Skill; previousId?: string } = { skill }
  if (previousId.value && previousId.value !== skill.id) payload.previousId = previousId.value
  emit('save', payload)
}
</script>
