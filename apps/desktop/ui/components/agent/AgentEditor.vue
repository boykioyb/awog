<template>
  <EditorShell
    :title="agent?.id ? 'Edit Agent' : 'New Agent'"
    :dirty="dirty"
    :can-save="canSave"
    :save-label="agent?.id ? 'Save changes' : 'Create agent'"
    @save="onSave"
    @cancel="emit('cancel')"
  >
    <template v-if="agent" #header-actions-extra>
      <button
        type="button"
        class="px-2.5 py-1.5 text-[1em] rounded inline-flex items-center gap-1.5 transition"
        :style="{ color: t.textMuted, border: `1px solid ${t.border}` }"
        title="Revise the whole agent (name / description / model / role / system prompt) via an LLM prompt"
        @click="onEditWithLlm"
      >
        <Sparkles :size="11" />
        Edit agent with LLM
      </button>
    </template>

    <div
      v-if="agent?.id"
      class="flex items-center gap-2 text-[1em] -mt-5 mb-6"
      :style="{ color: t.textDim }"
    >
      <span class="font-mono">{{ agent.id }}.md</span>
      <span :style="{ color: t.textFaint }">·</span>
      <span class="font-mono">{{ sourceDirLabel }}</span>
    </div>

    <div class="space-y-5">
      <Field v-if="!agent" label="Save to">
        <select
          v-model="saveTo"
          class="w-full rounded px-2 py-1.5 text-[1em] font-mono"
          :style="inputStyle"
        >
          <option v-for="opt in saveToOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
        <div class="text-[1em] mt-1" :style="{ color: t.textDim }">
          Tier determines where the AGENT.md is written (Sprint 3 C3). Default is global
          (~/.awog/agents/). Project tiers commit-able via git.
        </div>
      </Field>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Name" class="sm:col-span-2">
          <input
            v-model="draft.name"
            placeholder="e.g. Tax Consultant, SEO Specialist"
            class="w-full rounded px-2 py-1.5 text-[1em]"
            :style="inputStyle"
          />
        </Field>
        <Field label="Role tag">
          <input
            v-model="draft.role"
            placeholder="DevOps, BA, Security..."
            class="w-full rounded px-2 py-1.5 text-[1em] font-mono"
            :style="inputStyle"
          />
          <div class="text-[1em] mt-1" :style="{ color: t.textDim }">
            Short label shown on the badge (optional)
          </div>
        </Field>
      </div>

      <Field label="Description">
        <input
          v-model="draft.description"
          placeholder="When to use this agent — one sentence shown in pickers."
          class="w-full rounded px-2 py-1.5 text-[1em]"
          :style="inputStyle"
        />
        <div class="text-[1em] mt-1" :style="{ color: t.textDim }">
          Required by Claude Code subagent format.
        </div>
      </Field>

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
                <div class="text-[1em]" :style="{ color: t.text }">{{ m.label }}</div>
                <div class="text-[1em]" :style="{ color: t.textDim }">{{ m.vendor }}</div>
              </div>
            </div>
          </button>
        </div>
      </Field>

      <div>
        <label
          class="text-[1em] uppercase tracking-wider font-medium mb-1.5 block"
          :style="{ color: t.textDim }"
        >
          System Prompt
        </label>
        <textarea
          v-model="draft.systemPrompt"
          :rows="4"
          placeholder="You are a... Define the agent's role, personality, and how it should approach tasks."
          class="w-full rounded px-2 py-1.5 text-[1em] leading-relaxed resize-y min-h-[6rem]"
          :style="inputStyle"
        />
      </div>

      <AgentBodyEditModal
        v-if="llmEditing && agent"
        :agent="draftAsAgent"
        :anchor="llmEditAnchor"
        @apply="onApplyLlmEdit"
        @cancel="llmEditing = false"
      />

      <div>
        <div class="flex items-center justify-between mb-1.5">
          <label
            class="text-[1em] uppercase tracking-wider font-medium"
            :style="{ color: t.textDim }"
          >
            Skills · {{ draft.skillIds.length }} selected
          </label>
          <SearchInput v-model="skillSearch" placeholder="Filter skills..." class="w-44" />
        </div>
        <div
          class="rounded p-2 max-h-72 overflow-y-auto space-y-0.5"
          :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
        >
          <label
            v-for="s in filteredSkills"
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
              <div class="text-[1em] font-mono" :style="{ color: t.text }">{{ s.name }}</div>
              <div class="text-[1em] leading-snug" :style="{ color: t.textDim }">
                {{ s.description }}
              </div>
            </div>
          </label>
          <div
            v-if="filteredSkills.length === 0"
            class="text-[1em] py-4 text-center"
            :style="{ color: t.textFaint }"
          >
            <template v-if="ws.skills.length === 0">No skills yet — create one first</template>
            <template v-else>No skills match "{{ skillSearch }}"</template>
          </div>
        </div>
      </div>

      <div>
        <div class="flex items-center justify-between mb-1.5">
          <label
            class="text-[1em] uppercase tracking-wider font-medium"
            :style="{ color: t.textDim }"
          >
            MCP Servers · {{ activeMcpCount }} {{ activeMcpCount === 1 ? 'allowed' : 'allowed' }}
          </label>
          <span class="text-[1em]" :style="{ color: t.textFaint }">
            {{ mcpPickerHint }}
          </span>
        </div>
        <div
          class="rounded p-2 space-y-0.5"
          :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
        >
          <label
            v-for="s in ws.mcpServers"
            :key="s.id"
            class="flex items-start gap-2 px-1.5 py-1.5 rounded cursor-pointer transition"
            :style="{
              background: isMcpAllowed(s.id) ? t.bgActive : 'transparent',
              opacity: s.enabled ? 1 : 0.55,
            }"
          >
            <input
              type="checkbox"
              :checked="isMcpAllowed(s.id)"
              :style="{ accentColor: t.accent, marginTop: '2px' }"
              @change="toggleMcpServer(s.id)"
            />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="text-[1em] font-mono" :style="{ color: t.text }">{{ s.name }}</span>
                <span
                  v-if="!s.enabled"
                  class="text-[1em] uppercase tracking-wider px-1 py-0.5 rounded"
                  :style="{
                    color: t.textFaint,
                    background: t.bgPanel,
                    border: `1px solid ${t.border}`,
                  }"
                >
                  disabled
                </span>
              </div>
              <div class="text-[1em] leading-snug truncate" :style="{ color: t.textDim }">
                {{ s.description || `${s.transport} · ${s.tools.length} tool(s)` }}
              </div>
            </div>
          </label>
          <div
            v-if="ws.mcpServers.length === 0"
            class="text-[1em] py-4 text-center"
            :style="{ color: t.textFaint }"
          >
            No MCP servers yet — add one in Settings → MCP Servers.
          </div>
        </div>
      </div>
    </div>
  </EditorShell>
</template>

<script setup lang="ts">
import { Sparkles } from 'lucide-vue-next'
import type { Agent, AgentSource, Skill } from '~/types'
import { MODELS } from '~/utils/models'

const props = defineProps<{
  agent: Agent | null
}>()

const emit = defineEmits<{
  save: [agent: Agent]
  cancel: []
}>()

const { t } = useTheme()
const ws = useWorkspaceStore()

const SOURCE_DIR_LABEL: Record<AgentSource, string> = {
  global: '~/.awog/agents/',
  'user-claude': '~/.claude/agents/',
  'user-agents': '~/.agents/agents/',
  'project-claude': '.claude/agents/',
  'project-agents': '.agents/agents/',
}

const sourceDirLabel = computed(() =>
  props.agent ? SOURCE_DIR_LABEL[props.agent.source] : SOURCE_DIR_LABEL.global,
)

const makeDefaults = (): Agent => ({
  // New agents created via Editor (not LLM creator) default to global tier.
  // Project-tier authoring is done through the chat-style creator which lets
  // the LLM pick the path. ADR 0015 pha 1 scope.
  id: '',
  source: 'global',
  name: '',
  description: '',
  model: 'claude-sonnet-4-6',
  systemPrompt: '',
  role: '',
  skillIds: [],
})

const initDraft = (): Agent => {
  if (props.agent) {
    return {
      ...props.agent,
      skillIds: [...props.agent.skillIds],
      ...(props.agent.tools ? { tools: [...props.agent.tools] } : {}),
      ...(props.agent.mcpServerIds ? { mcpServerIds: [...props.agent.mcpServerIds] } : {}),
    }
  }
  return makeDefaults()
}

const draft = ref<Agent>(initDraft())
const original = ref<Agent>(initDraft())
const skillSearch = ref('')

// "Save to" tier picker for NEW agents (Sprint 3 C3). Composite value
// "<source>" for user tiers, "<source>:<projectId>" for project tiers.
// Parsed on change to update draft.source + draft.projectId. Hidden when
// editing an existing agent (source/projectId immutable after creation
// without a copy-and-delete migration which we don't expose pha 2).
interface SaveToOption {
  value: string
  label: string
}

const saveToOptions = computed<SaveToOption[]>(() => {
  const out: SaveToOption[] = [
    { value: 'global', label: '~/.awog/agents/  (AWOG-native, default)' },
    { value: 'user-claude', label: '~/.claude/agents/  (Claude Code SDK)' },
    { value: 'user-agents', label: '~/.agents/agents/  (Craft Agents)' },
  ]
  for (const p of ws.projects) {
    out.push({
      value: `project-claude:${p.id}`,
      label: `${p.name} · .claude/agents/`,
    })
    out.push({
      value: `project-agents:${p.id}`,
      label: `${p.name} · .agents/agents/`,
    })
  }
  return out
})

const saveTo = computed<string>({
  get() {
    if (draft.value.source === 'project-claude' || draft.value.source === 'project-agents') {
      return `${draft.value.source}:${draft.value.projectId ?? ''}`
    }
    return draft.value.source
  },
  set(value: string) {
    const [source, projectId] = value.split(':') as [Agent['source'], string | undefined]
    draft.value.source = source
    if (source === 'project-claude' || source === 'project-agents') {
      draft.value.projectId = projectId
    } else {
      delete draft.value.projectId
    }
  },
})

// LLM-edit modal state. Only available when editing an existing agent (the
// modal needs an Agent with id, source, projectId to round-trip metadata).
const llmEditing = ref(false)
const llmEditAnchor = ref<{ top: number; left: number } | null>(null)

// AgentBodyEditModal expects a full Agent. We pass the current draft so the
// LLM sees the user's unsaved edits as context, but the modal preserves
// id/source/projectId from props.agent on apply.
const draftAsAgent = computed<Agent>(() => ({ ...draft.value }))

const onEditWithLlm = (e: MouseEvent) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  llmEditAnchor.value = { top: rect.bottom + 8, left: rect.left }
  llmEditing.value = true
}

const onApplyLlmEdit = (updated: Agent) => {
  // Replace draft content but keep storage metadata (id/source/projectId) from
  // the original — those come from the saved Agent, not the LLM draft.
  draft.value = {
    ...updated,
    id: draft.value.id,
    source: draft.value.source,
    ...(draft.value.projectId ? { projectId: draft.value.projectId } : {}),
  }
  llmEditing.value = false
}

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

// Claude Code subagent requires name + description. role is AWOG-only and
// optional. model defaults to claude-sonnet-4-6 in makeDefaults.
const canSave = computed(() => !!(draft.value.name && draft.value.description && draft.value.model))

const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(original.value))

const toggleSkill = (id: string) => {
  draft.value.skillIds = draft.value.skillIds.includes(id)
    ? draft.value.skillIds.filter((s) => s !== id)
    : [...draft.value.skillIds, id]
}

// MCP picker: undefined mcpServerIds = "inherit session" (no per-agent filter).
// User ticks a server → flip to explicit whitelist mode. Empty array means
// "explicitly none" — still per-agent restriction, but allows zero servers.
const isMcpAllowed = (id: string): boolean => {
  const ids = draft.value.mcpServerIds
  // Unset = inherit; treat every server as allowed in the UI's "selected" sense
  // would be misleading. Show as NOT ticked so user knows current behaviour
  // is "no per-agent filter". Tick = explicit add.
  return Array.isArray(ids) && ids.includes(id)
}

const toggleMcpServer = (id: string) => {
  const current = draft.value.mcpServerIds ?? []
  const next = current.includes(id) ? current.filter((s) => s !== id) : [...current, id]
  if (next.length === 0) {
    // Drop the field entirely so AGENT.md doesn't serialize an empty array
    // (interpreted as "inherit session" upstream, matches initial state).
    delete draft.value.mcpServerIds
  } else {
    draft.value.mcpServerIds = next
  }
}

const activeMcpCount = computed(() => draft.value.mcpServerIds?.length ?? 0)

const mcpPickerHint = computed(() => {
  const ids = draft.value.mcpServerIds
  if (ids === undefined) return 'inherit session — all enabled MCP servers available'
  if (ids.length === 0) return 'explicit empty — no MCP servers for this agent'
  return 'agent-restricted whitelist'
})

const onSave = () => {
  if (!canSave.value) return
  emit('save', { ...draft.value })
}
</script>
