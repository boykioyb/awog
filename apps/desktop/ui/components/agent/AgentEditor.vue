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
        <AppSelect v-model="saveTo" mono>
          <option v-for="opt in saveToOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </AppSelect>
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
        <textarea
          v-model="draft.description"
          :rows="2"
          placeholder="When to use this agent — one sentence shown in pickers."
          class="w-full rounded px-2 py-1.5 text-[1em] leading-relaxed resize-y min-h-[3rem]"
          :style="inputStyle"
        />
        <div class="text-[1em] mt-1" :style="{ color: t.textDim }">
          Required by Claude Code subagent format.
        </div>
      </Field>

      <Field label="Provider">
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="p in PROVIDERS"
            :key="p.id"
            type="button"
            :disabled="!isProviderConnected(p.id)"
            class="px-3 py-1.5 rounded text-[1em] transition disabled:cursor-not-allowed"
            :style="providerBtnStyle(p.id)"
            :title="isProviderConnected(p.id) ? '' : 'Connect this provider in Settings first'"
            @click="selectProvider(p.id)"
          >
            {{ p.label }}
          </button>
        </div>
        <div class="text-[1em] mt-1" :style="{ color: t.textDim }">
          Providers without a connected account are disabled. The model list is filtered to the
          selected provider.
        </div>
      </Field>

      <Field label="Account">
        <AppSelect v-model="accountSelect" mono :disabled="providerAccounts.length === 0">
          <option v-for="a in providerAccounts" :key="a.id" :value="a.id">
            {{ a.label }}{{ a.id === activeAccountId ? ' (active)' : '' }}
          </option>
        </AppSelect>
        <div class="text-[1em] mt-1" :style="{ color: t.textDim }">
          Which {{ providerLabel }} account this agent uses. Defaults to the active account; pick
          another to pin this agent to it.
        </div>
      </Field>

      <Field label="Model">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          <button
            v-for="m in modelOptions"
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
            Connections
            <template v-if="ws.mcpServers.length > 0">· {{ mcpCountLabel }}</template>
          </label>
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
            No connections yet — add one on the Connections page.
          </div>
        </div>
      </div>
    </div>
  </EditorShell>
</template>

<script setup lang="ts">
import { Sparkles } from 'lucide-vue-next'
import type { Agent, AgentSource, ProviderName } from '~/types'
import { MODELS, modelById } from '~/utils/models'

const props = defineProps<{
  agent: Agent | null
}>()

const emit = defineEmits<{
  save: [agent: Agent]
  cancel: []
}>()

const { t } = useTheme()
const ws = useWorkspaceStore()
const settings = useSettingsStore()

// Provider picker (ADR 0026). Only providers with a connected account are
// selectable; the model grid below is filtered to the chosen provider.
const PROVIDERS: { id: ProviderName; label: string }[] = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'google', label: 'Google' },
]

const isProviderConnected = (p: ProviderName): boolean => settings.isProviderConnected(p)

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
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  systemPrompt: '',
  role: '',
})

const initDraft = (): Agent => {
  if (props.agent) {
    return {
      ...props.agent,
      ...(props.agent.tools ? { tools: [...props.agent.tools] } : {}),
      ...(props.agent.mcpServerIds ? { mcpServerIds: [...props.agent.mcpServerIds] } : {}),
    }
  }
  return makeDefaults()
}

const draft = ref<Agent>(initDraft())
const original = ref<Agent>(initDraft())

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
  ws.projects.forEach((p) => {
    out.push({
      value: `project-claude:${p.id}`,
      label: `${p.name} · .claude/agents/`,
    })
    out.push({
      value: `project-agents:${p.id}`,
      label: `${p.name} · .agents/agents/`,
    })
  })
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

// Models filtered to the agent's provider (local-tier models are never agent
// providers, so they fall out naturally).
const providerModels = computed(() => MODELS.filter((m) => m.provider === draft.value.provider))

// Switching provider resets the model to the first of the new provider so the
// stored model always belongs to the selected provider, and clears the account
// override (an account of provider A is meaningless for provider B).
const selectProvider = (p: ProviderName) => {
  if (draft.value.provider === p) return
  draft.value.provider = p
  draft.value.model = MODELS.find((m) => m.provider === p)?.id ?? ''
  delete draft.value.accountId
}

// Accounts available for the selected provider (from the credentials store).
const providerAccounts = computed(() => settings.providers[draft.value.provider]?.accounts ?? [])

const providerLabel = computed(
  () => PROVIDERS.find((p) => p.id === draft.value.provider)?.label ?? draft.value.provider,
)

// Id of the provider's active account — used to tag it "(active)" in the list
// instead of repeating it as a separate "Active account (...)" default option.
const activeAccountId = computed(() => settings.activeAccount(draft.value.provider)?.id ?? '')

// No "inherit" sentinel in the UI — when the agent hasn't pinned an account,
// show the provider's active account as selected. Storage still keeps accountId
// undefined unless the user picks a different one (so an unpinned agent keeps
// following the active account; runtime falls back to active when unset).
const accountSelect = computed<string>({
  get: () => draft.value.accountId ?? activeAccountId.value,
  set: (v) => {
    if (v && v !== activeAccountId.value) draft.value.accountId = v
    else delete draft.value.accountId
  },
})

// The account this agent will actually use (pinned id, or provider's active).
const selectedAccount = computed(
  () => providerAccounts.value.find((a) => a.id === accountSelect.value) ?? null,
)

// Custom Anthropic-compatible endpoints (ADR 0026 Phase B) carry their own model
// ids; built-in providers use the static MODELS catalog. The model grid binds to
// this so picking a custom account swaps in its model list.
const modelOptions = computed<{ id: string; label: string; vendor: string }[]>(() => {
  const custom = selectedAccount.value?.models
  if (custom && custom.length) {
    // Custom endpoint ids OR a curated built-in subset. Keep catalog label/vendor
    // for known ids; fall back to a bare entry for genuinely-custom ids.
    const vendor = selectedAccount.value?.label ?? 'Custom endpoint'
    return custom.map((id) => {
      const def = modelById(id)
      return def ? { id: def.id, label: def.label, vendor: def.vendor } : { id, label: id, vendor }
    })
  }
  return providerModels.value.map((m) => ({ id: m.id, label: m.label, vendor: m.vendor }))
})

// Keep draft.model valid as the option set changes (provider / account switch).
// Lazy by design — never clobbers a freshly-loaded agent's stored model.
watch(modelOptions, (opts) => {
  if (opts.length && !opts.some((o) => o.id === draft.value.model)) {
    draft.value.model = opts[0]!.id
  }
})

const providerBtnStyle = (p: ProviderName) => {
  const active = draft.value.provider === p
  if (active) {
    return {
      background: t.value.bgActive,
      color: t.value.text,
      border: `1px solid ${t.value.borderFocus}`,
    }
  }
  if (!isProviderConnected(p)) {
    return {
      background: t.value.bgInput,
      color: t.value.textFaint,
      border: `1px solid ${t.value.border}`,
      opacity: 0.55,
    }
  }
  return {
    background: t.value.bgInput,
    color: t.value.textDim,
    border: `1px solid ${t.value.border}`,
  }
}

// Claude Code subagent requires name + description. role is AWOG-only and
// optional. model defaults to claude-sonnet-4-6 in makeDefaults.
const canSave = computed(() => !!(draft.value.name && draft.value.description && draft.value.model))

const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(original.value))

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

// undefined = inherit (no per-agent filter) → agent sees every enabled server.
// [] = explicit none. A list = whitelist. Shown only when servers exist.
const mcpCountLabel = computed(() => {
  const ids = draft.value.mcpServerIds
  if (ids === undefined) return 'inherit (all enabled)'
  if (ids.length === 0) return 'none'
  return `${ids.length} allowed`
})

const onSave = () => {
  if (!canSave.value) return
  emit('save', { ...draft.value })
}
</script>
