<template>
  <EditorShell
    :title="agent?.id ? 'Edit Agent' : 'New Agent'"
    :dirty="dirty"
    :can-save="canSave"
    :save-label="agent?.id ? 'Save changes' : 'Create agent'"
    @save="onSave"
    @cancel="emit('cancel')"
  >
    <div v-if="agent?.id" class="text-[10px] font-mono -mt-5 mb-6" :style="{ color: t.textDim }">
      {{ agent.id }}
    </div>

    <div class="space-y-5">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Name" class="sm:col-span-2">
          <input
            v-model="draft.name"
            placeholder="e.g. Tax Consultant, SEO Specialist"
            class="w-full rounded px-2 py-1.5 text-xs"
            :style="inputStyle"
          />
        </Field>
        <Field label="Role tag">
          <input
            v-model="draft.role"
            placeholder="DevOps, BA, Security..."
            class="w-full rounded px-2 py-1.5 text-xs font-mono"
            :style="inputStyle"
          />
          <div class="text-[10px] mt-1" :style="{ color: t.textDim }">
            Short label shown on the badge
          </div>
        </Field>
      </div>

      <Field label="Model">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          <button
            v-for="m in MODELS"
            :key="m.id"
            class="text-left px-3 py-2 rounded transition"
            :style="{
              background: draft.model === m.id ? t.bgActive : t.bgInput,
              border: `1px solid ${draft.model === m.id ? t.borderFocus : t.border}`,
            }"
            @click="draft.model = m.id"
          >
            <div class="flex items-center gap-2">
              <div
                class="rounded-full flex-shrink-0 flex items-center justify-center"
                :style="{
                  width: '14px',
                  height: '14px',
                  border: `1.5px solid ${draft.model === m.id ? t.accent : t.borderStrong}`,
                }"
              >
                <div
                  v-if="draft.model === m.id"
                  class="rounded-full"
                  :style="{ width: '6px', height: '6px', background: t.accent }"
                />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-[12px]" :style="{ color: t.text }">{{ m.label }}</div>
                <div class="text-[10px]" :style="{ color: t.textDim }">{{ m.vendor }}</div>
              </div>
            </div>
          </button>
        </div>
      </Field>

      <Field label="System Prompt">
        <textarea
          v-model="draft.systemPrompt"
          :rows="4"
          placeholder="You are a... Define the agent's role, personality, and how it should approach tasks."
          class="w-full rounded px-2 py-1.5 text-[12px] leading-relaxed resize-none"
          :style="inputStyle"
        />
      </Field>

      <div>
        <div class="flex items-center justify-between mb-1.5">
          <label
            class="text-[10px] uppercase tracking-wider font-medium"
            :style="{ color: t.textDim }"
          >
            Skills · {{ draft.skillIds.length }} selected
          </label>
          <SearchInput v-model="skillSearch" placeholder="Filter skills..." class="w-44" />
        </div>
        <div
          class="rounded p-2 max-h-72 overflow-y-auto space-y-3"
          :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
        >
          <div v-for="[category, catSkills] in skillsByCategory" :key="category">
            <div
              class="text-[10px] uppercase tracking-wider font-medium mb-1.5 px-1"
              :style="{ color: t.textDim }"
            >
              {{ category }}
            </div>
            <div class="space-y-0.5">
              <label
                v-for="s in catSkills"
                :key="s.id"
                class="flex items-start gap-2 px-1.5 py-1.5 rounded cursor-pointer transition"
                :style="{
                  background: draft.skillIds.includes(s.id) ? t.bgActive : 'transparent',
                }"
              >
                <input
                  type="checkbox"
                  :checked="draft.skillIds.includes(s.id)"
                  :style="{ accentColor: t.accent, marginTop: '2px' }"
                  @change="toggleSkill(s.id)"
                />
                <div class="flex-1 min-w-0">
                  <div class="text-[11px] font-mono" :style="{ color: t.text }">{{ s.name }}</div>
                  <div class="text-[10px] leading-snug" :style="{ color: t.textDim }">
                    {{ s.description }}
                  </div>
                </div>
              </label>
            </div>
          </div>
          <div
            v-if="filteredSkills.length === 0"
            class="text-[11px] py-4 text-center"
            :style="{ color: t.textFaint }"
          >
            No skills match "{{ skillSearch }}"
          </div>
        </div>
      </div>

      <Field label="Context Providers">
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="p in CONTEXT_PROVIDERS"
            :key="p.id"
            class="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] transition"
            :style="{
              background: draft.context.includes(p.id) ? t.accent : t.bgInput,
              color: draft.context.includes(p.id) ? t.accentText : t.textMuted,
              border: `1px solid ${draft.context.includes(p.id) ? t.accent : t.border}`,
            }"
            @click="toggleContext(p.id)"
          >
            <component :is="p.icon" :size="11" />
            {{ p.label }}
          </button>
        </div>
      </Field>
    </div>
  </EditorShell>
</template>

<script setup lang="ts">
import type { Agent, Skill, SkillCategory } from '~/types'
import type { AgentDraft } from '~/composables/useAgentGenerator'
import { CONTEXT_PROVIDERS } from '~/utils/initial-data'
import { MODELS } from '~/utils/models'

const props = defineProps<{
  agent: Agent | null
  initialDraft?: AgentDraft | null
}>()

const emit = defineEmits<{
  save: [agent: Agent]
  cancel: []
}>()

const { t } = useTheme()
const ws = useWorkspaceStore()

const makeDefaults = (): Agent => ({
  id: '',
  name: '',
  role: '',
  model: 'claude-sonnet-4-6',
  skillIds: [],
  context: ['artifacts'],
  systemPrompt: '',
})

const initDraft = (): Agent => {
  if (props.agent) {
    return {
      ...props.agent,
      skillIds: [...props.agent.skillIds],
      context: [...props.agent.context],
    }
  }
  if (props.initialDraft) {
    return {
      id: '',
      ...props.initialDraft,
      skillIds: [...props.initialDraft.skillIds],
      context: [...props.initialDraft.context],
    }
  }
  return makeDefaults()
}

const draft = ref<Agent>(initDraft())
const original = ref<Agent>(initDraft())
const skillSearch = ref('')

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none' as const,
}))

const filteredSkills = computed<Skill[]>(() => {
  const q = skillSearch.value.toLowerCase()
  if (!q) return ws.skills
  return ws.skills.filter(
    (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
  )
})

const skillsByCategory = computed<[SkillCategory, Skill[]][]>(() => {
  const map = new Map<SkillCategory, Skill[]>()
  filteredSkills.value.forEach((s) => {
    const arr = map.get(s.category) || []
    arr.push(s)
    map.set(s.category, arr)
  })
  return Array.from(map.entries())
})

const canSave = computed(() => !!(draft.value.name && draft.value.role && draft.value.model))

const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(original.value))

const toggleSkill = (id: string) => {
  draft.value.skillIds = draft.value.skillIds.includes(id)
    ? draft.value.skillIds.filter((s) => s !== id)
    : [...draft.value.skillIds, id]
}

const toggleContext = (ctx: string) => {
  draft.value.context = draft.value.context.includes(ctx)
    ? draft.value.context.filter((c) => c !== ctx)
    : [...draft.value.context, ctx]
}

const onSave = () => {
  if (!canSave.value) return
  emit('save', { ...draft.value })
}
</script>
