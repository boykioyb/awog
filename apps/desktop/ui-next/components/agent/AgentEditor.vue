<template>
  <LibraryEntityModal
    :open="open"
    :title="agent?.id ? t('agents.editor.editTitle') : t('agents.editor.newTitle')"
    :width="680"
    @close="emit('cancel')"
  >
    <div class="age">
      <!-- Save location (tier) — locked once an agent exists (moving tiers = a new file). -->
      <div class="age-field">
        <label class="age-label">{{ t('agents.editor.saveLocation') }}</label>
        <div class="age-tiers">
          <button
            v-for="opt in sourceOptions"
            :key="opt.value"
            type="button"
            class="chip age-tier"
            :class="{ on: draft.source === opt.value }"
            :disabled="isExisting"
            @click="setSource(opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
        <div v-if="draft.source === 'project'" class="age-project">
          <AppSelect
            v-model="draft.projectId"
            :options="projectOptions"
            :placeholder="t('agents.editor.pickProject')"
            width="100%"
          />
        </div>
        <div class="age-hint">{{ sourceHint }}</div>
      </div>

      <div class="age-grid">
        <div class="age-field">
          <label class="age-label">{{ t('agents.editor.slug') }}</label>
          <input
            class="age-input mono"
            :value="draft.id"
            placeholder="e.g. tech-lead"
            spellcheck="false"
            @input="onSlugInput"
          />
          <div class="age-hint">
            {{ t('agents.editor.slugHint', { slug: draft.id || 'slug' }) }}
          </div>
        </div>
        <div class="age-field">
          <label class="age-label">{{ t('agents.editor.role') }}</label>
          <input
            v-model="draft.role"
            class="age-input mono"
            :placeholder="t('agents.editor.rolePh')"
          />
          <div class="age-hint">{{ t('agents.editor.roleHint') }}</div>
        </div>
      </div>

      <div class="age-field">
        <label class="age-label">{{ t('agents.editor.name') }}</label>
        <input v-model="draft.name" class="age-input" :placeholder="t('agents.editor.namePh')" />
      </div>

      <div class="age-field">
        <label class="age-label">{{ t('agents.editor.description') }}</label>
        <textarea
          v-model="draft.description"
          class="age-input age-ta"
          rows="2"
          :placeholder="t('agents.editor.descPh')"
        />
        <div class="age-hint">{{ t('agents.editor.descHint') }}</div>
      </div>

      <div class="age-grid">
        <div class="age-field">
          <label class="age-label">{{ t('agents.editor.provider') }}</label>
          <AppSelect v-model="providerSelect" :options="providerOptions" width="100%" />
        </div>
        <div class="age-field">
          <label class="age-label">{{ t('agents.editor.model') }}</label>
          <AppSelect v-model="draft.model" :options="modelOptions" width="100%" />
        </div>
      </div>

      <div class="age-field">
        <label class="age-label">{{ t('agents.editor.account') }}</label>
        <AppSelect
          v-model="accountSelect"
          :options="accountOptions"
          :placeholder="t('agents.editor.accountActive')"
          width="100%"
        />
        <div class="age-hint">{{ t('agents.editor.accountHint') }}</div>
      </div>

      <div class="age-field">
        <label class="age-label">{{ t('agents.editor.systemPrompt') }}</label>
        <textarea
          v-model="draft.systemPrompt"
          class="age-input age-ta mono"
          rows="8"
          :placeholder="t('agents.editor.systemPromptPh')"
        />
      </div>

      <!-- Tools whitelist (chip input). Empty = full toolset. -->
      <div class="age-field">
        <label class="age-label">{{ t('agents.editor.tools') }}</label>
        <div v-if="draft.tools.length" class="age-chips">
          <span
            v-for="tool in draft.tools"
            :key="tool"
            class="chip"
            :class="{ mono: tool.startsWith('mcp__') }"
          >
            {{ tool }}
            <button
              class="age-chipx"
              :title="t('agents.editor.removeTool')"
              @click="draft.tools = draft.tools.filter((x) => x !== tool)"
            >
              <Icon name="x" style="width: 9px; height: 9px" />
            </button>
          </span>
        </div>
        <input
          v-model="toolInput"
          class="age-input mono"
          :placeholder="t('agents.editor.toolsPh')"
          @keydown.enter.prevent="addTool"
        />
        <div class="age-hint">{{ t('agents.editor.toolsHint') }}</div>
      </div>

      <!-- Connections (MCP) whitelist — checkbox list. Unticked = inherit. -->
      <div class="age-field">
        <label class="age-label">
          {{ t('agents.editor.connections') }}
          <span class="age-count">{{ mcpCountLabel }}</span>
        </label>
        <div class="age-mcp">
          <label
            v-for="s in mcpServers"
            :key="s.id"
            class="age-mcprow"
            :class="{ on: isMcpAllowed(s.id) }"
          >
            <input
              type="checkbox"
              :checked="isMcpAllowed(s.id)"
              class="age-cbx"
              @change="toggleMcpServer(s.id)"
            />
            <span class="age-mcpname mono">{{ s.name }}</span>
          </label>
          <div v-if="mcpServers.length === 0" class="age-mcpempty">
            {{ t('agents.editor.connectionsEmpty') }}
          </div>
        </div>
        <div class="age-hint">{{ t('agents.editor.connectionsHint') }}</div>
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      <button class="btn pri" :disabled="!canSave" @click="onSave">
        {{ agent?.id ? t('agents.editor.save') : t('agents.editor.create') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Agent form editor — port of the old UI AgentEditor logic, rendered in
// prototype CSS inside LibraryEntityModal. Save-location tier is locked once the
// agent exists; slug is sanitized to kebab-case. Provider/model/account selectors
// use AppSelect; the MCP whitelist is a checkbox list; the tools whitelist is a
// chip input (empty = full toolset). NOTE: no skills picker — agent.skillIds was
// removed project-wide (skills live on Workflow nodes only). Emits a save payload
// carrying the optional previousId for slug renames.
import { computed, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { PROVIDERS, modelsForProvider } from './agent-display'
import { useSettingsStore } from '~/stores/settings'
import type { Agent, AgentSource } from '~/stores/agents'
import type { ProviderName } from '~/stores/settings'

const props = defineProps<{
  open: boolean
  agent: Agent | null
  projects: { id: string; name: string; path?: string }[]
  mcpServers: { id: string; name: string }[]
}>()

const emit = defineEmits<{
  save: [payload: { agent: Agent; previousId?: string }]
  cancel: []
}>()

const { t } = useI18n()
const settings = useSettingsStore()

const sourceOptions: { value: AgentSource; label: string }[] = [
  { value: 'global', label: '~/.awog/agents' },
  { value: 'project', label: 'project · .awog/agents' },
]

type Draft = {
  id: string
  source: AgentSource
  projectId: string
  name: string
  description: string
  provider: ProviderName
  accountId: string
  model: string
  systemPrompt: string
  role: string
  tools: string[]
  mcpServerIds: string[]
  // Sentinel: false = inherit session MCP (no per-agent filter); true = explicit
  // whitelist (even when empty). Mirrors the old UI's undefined-vs-array logic.
  mcpExplicit: boolean
}

const makeDefaults = (): Draft => ({
  id: '',
  source: 'global',
  projectId: '',
  name: '',
  description: '',
  provider: 'anthropic',
  accountId: '',
  model: 'claude-sonnet-5',
  systemPrompt: '',
  role: '',
  tools: [],
  mcpServerIds: [],
  mcpExplicit: false,
})

const fromAgent = (a: Agent): Draft => ({
  id: a.id,
  source: a.source,
  projectId: a.projectId ?? '',
  name: a.name,
  description: a.description,
  provider: a.provider,
  accountId: a.accountId ?? '',
  model: a.model,
  systemPrompt: a.systemPrompt,
  role: a.role,
  tools: [...(a.tools ?? [])],
  mcpServerIds: [...(a.mcpServerIds ?? [])],
  mcpExplicit: Array.isArray(a.mcpServerIds),
})

const initDraft = (a: Agent | null): Draft => (a ? fromAgent(a) : makeDefaults())

const draft = ref<Draft>(initDraft(props.agent))
const previousId = ref<string | undefined>(props.agent?.id)
const toolInput = ref('')

// Re-seed the draft each time the modal opens or the target agent changes.
watch(
  () => [props.open, props.agent] as const,
  ([isOpen]) => {
    if (!isOpen) return
    draft.value = initDraft(props.agent)
    previousId.value = props.agent?.id
    toolInput.value = ''
  },
)

const isExisting = computed(() => !!props.agent)

const projectOptions = computed<AppSelectOption[]>(() =>
  props.projects.map((p) => ({ value: p.id, label: p.path ? `${p.name} (${p.path})` : p.name })),
)

const setSource = (source: AgentSource) => {
  if (isExisting.value) return
  draft.value.source = source
  if (source === 'project') {
    if (!draft.value.projectId) draft.value.projectId = props.projects[0]?.id ?? ''
  } else {
    draft.value.projectId = ''
  }
}

const sourceHint = computed(() => {
  if (draft.value.source === 'global') return t('agents.editor.globalHint')
  const project = props.projects.find((p) => p.id === draft.value.projectId)
  if (!project) return t('agents.editor.projectHintNone', { slug: draft.value.id || 'slug' })
  return t('agents.editor.projectHint', {
    path: project.path ?? project.name,
    slug: draft.value.id || 'slug',
  })
})

const onSlugInput = (e: Event) => {
  draft.value.id = (e.target as HTMLInputElement).value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// --- provider / model / account ------------------------------------------
const providerOptions = computed<AppSelectOption[]>(() =>
  PROVIDERS.map((p) => ({
    value: p.id,
    label: settings.isProviderConnected(p.id)
      ? p.label
      : t('agents.editor.providerNotConnected', { provider: p.label }),
  })),
)

const providerSelect = computed<string>({
  get: () => draft.value.provider,
  set: (v) => {
    const next = v as ProviderName
    if (draft.value.provider === next) return
    draft.value.provider = next
    // Reset the model to the first of the new provider so the stored model
    // always belongs to the selected provider; clear the account override.
    draft.value.model = modelsForProvider(next)[0]?.id ?? ''
    draft.value.accountId = ''
  },
})

const modelOptions = computed<AppSelectOption[]>(() =>
  modelsForProvider(draft.value.provider).map((m) => ({ value: m.id, label: m.label })),
)

// Keep draft.model valid when the provider option set changes.
watch(modelOptions, (opts) => {
  if (opts.length && !opts.some((o) => o.value === draft.value.model)) {
    draft.value.model = opts[0]!.value
  }
})

// Accounts for the selected provider (from the settings store).
const providerAccounts = computed(() => settings.providers[draft.value.provider]?.accounts ?? [])
const activeAccountId = computed(() => settings.activeAccount(draft.value.provider)?.id ?? '')

const accountOptions = computed<AppSelectOption[]>(() =>
  providerAccounts.value.map((a) => ({
    value: a.id,
    label: a.id === activeAccountId.value ? `${a.label} (active)` : a.label,
  })),
)

// No "inherit" sentinel — when the agent hasn't pinned an account, show the
// provider's active account as selected. Storage keeps accountId empty unless
// the user picks a different one.
const accountSelect = computed<string>({
  get: () => draft.value.accountId || activeAccountId.value,
  set: (v) => {
    draft.value.accountId = v && v !== activeAccountId.value ? v : ''
  },
})

// --- tools ----------------------------------------------------------------
const addTool = () => {
  const v = toolInput.value.trim()
  if (!v) return
  if (!draft.value.tools.includes(v)) draft.value.tools = [...draft.value.tools, v]
  toolInput.value = ''
}

// --- MCP whitelist --------------------------------------------------------
const isMcpAllowed = (id: string): boolean =>
  draft.value.mcpExplicit && draft.value.mcpServerIds.includes(id)

const toggleMcpServer = (id: string) => {
  const current = draft.value.mcpServerIds
  const next = current.includes(id) ? current.filter((s) => s !== id) : [...current, id]
  draft.value.mcpServerIds = next
  // Any toggle moves the agent into explicit-whitelist mode; an emptied list is
  // still explicit (= "none") until the user closes & re-opens with no list.
  draft.value.mcpExplicit = true
}

const mcpCountLabel = computed(() => {
  if (!draft.value.mcpExplicit) return t('agents.editor.mcpInherit')
  if (draft.value.mcpServerIds.length === 0) return t('agents.editor.mcpNone')
  return t('agents.editor.mcpAllowed', { n: draft.value.mcpServerIds.length })
})

// --- save -----------------------------------------------------------------
const canSave = computed(() => {
  if (!draft.value.id) return false
  if (!draft.value.name.trim()) return false
  if (!draft.value.description.trim()) return false
  if (!draft.value.model) return false
  if (!/^[a-z0-9][a-z0-9-]*$/.test(draft.value.id)) return false
  if (draft.value.source === 'project' && !draft.value.projectId) return false
  return true
})

const onSave = () => {
  if (!canSave.value) return
  const agent: Agent = {
    id: draft.value.id,
    source: draft.value.source,
    name: draft.value.name.trim(),
    description: draft.value.description.trim(),
    provider: draft.value.provider,
    model: draft.value.model,
    systemPrompt: draft.value.systemPrompt,
    role: draft.value.role.trim(),
  }
  if (draft.value.source === 'project') agent.projectId = draft.value.projectId
  if (draft.value.accountId) agent.accountId = draft.value.accountId
  if (draft.value.tools.length > 0) agent.tools = [...draft.value.tools]
  // Only persist mcpServerIds when explicit AND non-empty: an empty array is
  // dropped so AGENT.md doesn't serialize "explicit none" (matches old UI).
  if (draft.value.mcpExplicit && draft.value.mcpServerIds.length > 0) {
    agent.mcpServerIds = [...draft.value.mcpServerIds]
  }

  const payload: { agent: Agent; previousId?: string } = { agent }
  if (previousId.value && previousId.value !== agent.id) payload.previousId = previousId.value
  emit('save', payload)
}
</script>

<style scoped>
.age {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.age-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.age-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.age-label {
  font-size: var(--fs-sm);
  font-weight: 550;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 8px;
}
.age-count {
  font-size: var(--fs-xs);
  font-weight: 400;
  color: var(--textDim);
  font-variant-numeric: tabular-nums;
}
.age-input {
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
.age-input.mono {
  /* mono-ok: the `.mono` opt-in variant — tool names / model ids */
  font-family: var(--code);
}
.age-input:focus {
  border-color: var(--accent);
}
.age-ta {
  resize: vertical;
  min-height: 3rem;
  line-height: 1.55;
}
.age-hint {
  font-size: var(--fs-xs);
  color: var(--textDim);
  line-height: 1.5;
}
.age-tiers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.age-tier {
  cursor: pointer;
  background: var(--bgInput);
}
.age-tier.on {
  color: var(--accent);
  border-color: var(--accentBorder);
  background: var(--accentDim);
}
.age-tier:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.age-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.age-chipx {
  display: inline-flex;
  border: 0;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  padding: 0;
}
.age-chipx:hover {
  color: var(--danger);
}
.age-mcp {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  padding: 6px;
}
.age-mcprow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--r-xs);
  cursor: pointer;
}
.age-mcprow.on {
  background: var(--bgActive);
}
.age-cbx {
  accent-color: var(--accent);
}
.age-mcpname {
  font-size: var(--fs-sm);
  font-weight: 500;
  color: var(--text);
}
.age-mcpempty {
  font-size: var(--fs-sm);
  color: var(--textFaint);
  text-align: center;
  padding: 12px 0;
}
</style>
