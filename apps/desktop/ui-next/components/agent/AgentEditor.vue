<template>
  <LibraryEntityModal
    :open="open"
    :title="agent?.id ? t('agents.editor.editTitle') : t('agents.editor.newTitle')"
    :width="680"
    @close="emit('cancel')"
  >
    <div class="age">
      <!-- Agents are global roles (~/.awog/agents) — no tier picker. An existing
           project-tier agent keeps its location silently (source preserved). -->
      <div class="age-grid">
        <div class="age-field">
          <label class="age-label">{{ t('agents.editor.slug') }}</label>
          <Input
            :model-value="draft.id"
            placeholder="e.g. tech-lead"
            spellcheck="false"
            class="mono"
            @update:model-value="onSlugInput"
          />
          <div class="age-hint">
            {{ t('agents.editor.slugHint', { slug: draft.id || 'slug' }) }}
          </div>
        </div>
        <div class="age-field">
          <label class="age-label">{{ t('agents.editor.role') }}</label>
          <Input v-model="draft.role" :placeholder="t('agents.editor.rolePh')" class="mono" />
          <div class="age-hint">{{ t('agents.editor.roleHint') }}</div>
        </div>
      </div>

      <div class="age-field">
        <label class="age-label">{{ t('agents.editor.name') }}</label>
        <Input v-model="draft.name" :placeholder="t('agents.editor.namePh')" />
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

      <!-- Whitelists — shared pickers (same components the detail tabs render
           inline). Empty model = unrestricted / inherit session. -->
      <div class="age-field">
        <label class="age-label">{{ t('agents.editor.tools') }}</label>
        <AgentToolsPicker
          :model-value="draft.tools"
          :servers="mcpServers"
          @update:model-value="(v) => (draft.tools = v ?? [])"
        />
      </div>

      <div class="age-field">
        <label class="age-label">
          {{ t('agents.editor.connections') }}
          <span class="age-count">{{ mcpCountLabel }}</span>
        </label>
        <AgentConnectionsPicker
          :model-value="mcpModel"
          :servers="mcpServers"
          @update:model-value="(v) => (mcpModel = v)"
        />
      </div>

      <div class="age-field">
        <label class="age-label">
          {{ t('agents.editor.skills') }}
          <span class="age-count">{{ skillCountLabel }}</span>
        </label>
        <AgentSkillsPicker
          :model-value="draft.skillIds"
          :skills="skills"
          @update:model-value="(v) => (draft.skillIds = v ?? [])"
        />
      </div>

      <div class="age-field">
        <label class="age-label">
          {{ t('agents.editor.repos') }}
          <span class="age-count">{{ repoCountLabel }}</span>
        </label>
        <AgentReposPicker
          :model-value="draft.repos"
          :projects="projects"
          @update:model-value="(v) => (draft.repos = v ?? [])"
        />
      </div>
    </div>

    <template #footer>
      <Button variant="outline" @click="emit('cancel')">{{ t('common.cancel') }}</Button>
      <Button :disabled="!canSave" variant="default" @click="onSave">
        {{ agent?.id ? t('agents.editor.save') : t('agents.editor.create') }}
      </Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Agent form editor — port of the old UI AgentEditor logic, rendered in
// prototype CSS inside LibraryEntityModal. Agents are global roles — new agents
// always write to ~/.awog/agents; a legacy project-tier agent keeps its
// source/projectId silently (no tier picker in the form). Slug is sanitized to
// kebab-case. Provider/model/account selectors use AppSelect; the four
// whitelists (tools/connections/skills/repos) use the shared Agent*Picker
// components — the same ones the detail tabs render for inline editing.
// Emits a save payload carrying the optional previousId for slug renames.
import { computed, ref, watch } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import AgentToolsPicker from '~/components/agent/AgentToolsPicker.vue'
import AgentConnectionsPicker from '~/components/agent/AgentConnectionsPicker.vue'
import AgentSkillsPicker from '~/components/agent/AgentSkillsPicker.vue'
import AgentReposPicker from '~/components/agent/AgentReposPicker.vue'
import { PROVIDERS, modelsForProvider } from './agent-display'
import { useSettingsStore } from '~/stores/settings'
import type { Agent, AgentSource } from '~/stores/agents'
import type { ProviderName } from '~/stores/settings'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const props = defineProps<{
  open: boolean
  agent: Agent | null
  projects: { id: string; name: string; path?: string }[]
  mcpServers: { id: string; name: string }[]
  skills: { id: string; name: string; description?: string; source?: string; projectId?: string }[]
}>()

const emit = defineEmits<{
  save: [payload: { agent: Agent; previousId?: string }]
  cancel: []
}>()

const { t } = useI18n()
const settings = useSettingsStore()

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
  skillIds: string[]
  repos: string[]
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
  skillIds: [],
  repos: [],
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
  skillIds: [...(a.skillIds ?? [])],
  repos: [...(a.repos ?? [])],
})

const initDraft = (a: Agent | null): Draft => (a ? fromAgent(a) : makeDefaults())

const draft = ref<Draft>(initDraft(props.agent))
const previousId = ref<string | undefined>(props.agent?.id)

// Re-seed the draft each time the modal opens or the target agent changes.
watch(
  () => [props.open, props.agent] as const,
  ([isOpen]) => {
    if (!isOpen) return
    draft.value = initDraft(props.agent)
    previousId.value = props.agent?.id
  },
)

const onSlugInput = (v: string) => {
  draft.value.id = v
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

// --- whitelists -------------------------------------------------------------
// The four Agent*Picker components model `string[] | undefined` (undefined =
// unrestricted/inherit). Draft keeps plain arrays + the mcpExplicit sentinel;
// this computed maps the sentinel across the picker boundary. Toggling any row
// moves the agent into explicit mode; emptying it returns to inherit (the
// serializer drops empty arrays anyway, so "explicit none" never persisted).
const mcpModel = computed<string[] | undefined>({
  get: () => (draft.value.mcpExplicit ? draft.value.mcpServerIds : undefined),
  set: (v) => {
    draft.value.mcpExplicit = v !== undefined
    draft.value.mcpServerIds = v ?? []
  },
})

const mcpCountLabel = computed(() => {
  if (!draft.value.mcpExplicit) return t('agents.editor.mcpInherit')
  if (draft.value.mcpServerIds.length === 0) return t('agents.editor.mcpNone')
  return t('agents.editor.mcpAllowed', { n: draft.value.mcpServerIds.length })
})

const skillCountLabel = computed(() =>
  draft.value.skillIds.length === 0
    ? t('agents.editor.skillsAll')
    : t('agents.editor.skillsAllowed', { n: draft.value.skillIds.length }),
)

const repoCountLabel = computed(() =>
  draft.value.repos.length === 0
    ? t('agents.editor.reposAll')
    : t('agents.editor.reposAllowed', { n: draft.value.repos.length }),
)

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
  // Skills + repos whitelists: persisted only when non-empty — an empty list
  // means "unrestricted", same as the field being absent.
  if (draft.value.skillIds.length > 0) agent.skillIds = [...draft.value.skillIds]
  if (draft.value.repos.length > 0) agent.repos = [...draft.value.repos]

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
  line-height: var(--lh-sm);
  font-weight: 550;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 8px;
}
.age-count {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
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
  line-height: var(--lh-sm);
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
  line-height: var(--lh-md);
}
.age-hint {
  font-size: var(--fs-xs);
  color: var(--textDim);
  line-height: var(--lh-sm);
}
/* Whitelist list/chip styles live in assets/css/agent-whitelist.css (.awp-*) —
   shared with the pickers the detail tabs render inline. */
</style>
