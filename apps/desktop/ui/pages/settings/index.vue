<template>
  <div class="flex flex-1 overflow-hidden">
    <div
      class="flex-shrink-0 py-4 w-full md:w-56"
      :class="{ 'hidden md:block': mobilePane === 'detail' }"
      :style="{ borderRight: `1px solid ${t.border}`, background: t.bgPanel }"
    >
      <div
        class="px-3 mb-3 text-[11px] uppercase tracking-wider font-medium"
        :style="{ color: t.textDim }"
      >
        Settings
      </div>
      <div class="px-2 space-y-0.5">
        <button
          v-for="s in sections"
          :key="s.id"
          class="w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-[12px] transition"
          :style="{
            background: section === s.id ? t.bgActive : 'transparent',
            color: section === s.id ? t.text : t.textDim,
          }"
          @click="onSelectSection(s.id)"
        >
          <component :is="s.icon" :size="13" />
          {{ s.label }}
        </button>
      </div>
    </div>

    <div
      class="flex-1 overflow-y-auto p-4 md:p-6 max-w-3xl"
      :class="{ 'hidden md:block': mobilePane === 'list' }"
    >
      <button
        class="md:hidden flex items-center gap-1 mb-3 text-xs transition"
        :style="{ color: t.textMuted }"
        @click="mobilePane = 'list'"
      >
        <ChevronLeft :size="14" />
        Back
      </button>
      <!-- Workspace -->
      <div v-if="section === 'workspace'" class="space-y-6">
        <div>
          <h2 class="text-lg font-semibold mb-1" :style="{ color: t.text }">Workspace</h2>
          <div class="text-xs" :style="{ color: t.textDim }">
            Local storage and Git settings for this workspace
          </div>
        </div>
        <div class="space-y-4">
          <SettingsField
            label="Workspace path"
            hint="Filesystem location for agents, workflows, artifacts, and sessions"
          >
            <input
              v-model="settings.workspacePath"
              class="w-full rounded px-2 py-1.5 text-[12px] font-mono"
              :style="inputStyle"
            />
          </SettingsField>
          <SettingsField
            label="Git versioning"
            hint="All artifacts are committed to Git automatically"
            status="enabled"
          />
          <SettingsField
            label="Auto-approve trivial steps"
            hint="Skip approval gates for low-risk phases"
          >
            <AppToggle v-model="settings.autoApprove" />
          </SettingsField>
          <SettingsField
            label="Notifications"
            hint="Show system notifications when a task needs approval"
          >
            <AppToggle v-model="settings.notificationsEnabled" />
          </SettingsField>
        </div>
      </div>

      <!-- Defaults -->
      <div v-else-if="section === 'defaults'" class="space-y-6">
        <div>
          <h2 class="text-lg font-semibold mb-1" :style="{ color: t.text }">Defaults</h2>
          <div class="text-xs" :style="{ color: t.textDim }">
            Default system prompt, instructions, model, and mode used when starting a new session or
            agent
          </div>
        </div>
        <div class="space-y-4">
          <div class="py-3 space-y-2" :style="{ borderBottom: `1px solid ${t.border}` }">
            <div>
              <div class="text-[13px] font-medium" :style="{ color: t.text }">System prompt</div>
              <div class="text-[11px] mt-0.5" :style="{ color: t.textDim }">
                Applied as the base persona for new sessions and agents that don't define their own
              </div>
            </div>
            <textarea
              :value="defaults.systemPrompt"
              rows="5"
              class="w-full rounded px-2 py-1.5 text-[12px] font-mono leading-relaxed"
              :style="inputStyle"
              placeholder="You are an AI teammate in AWOG…"
              @input="
                settings.updateDefaults({
                  systemPrompt: ($event.target as HTMLTextAreaElement).value,
                })
              "
            />
          </div>
          <div class="py-3 space-y-2" :style="{ borderBottom: `1px solid ${t.border}` }">
            <div>
              <div class="text-[13px] font-medium" :style="{ color: t.text }">Instructions</div>
              <div class="text-[11px] mt-0.5" :style="{ color: t.textDim }">
                Always-on user instructions prepended to every request (style guides, project
                conventions)
              </div>
            </div>
            <textarea
              :value="defaults.instructions"
              rows="6"
              class="w-full rounded px-2 py-1.5 text-[12px] font-mono leading-relaxed"
              :style="inputStyle"
              placeholder="- Trả lời tiếng Việt
- Ưu tiên KISS / YAGNI
- Không thêm dependency mới khi chưa có ADR"
              @input="
                settings.updateDefaults({
                  instructions: ($event.target as HTMLTextAreaElement).value,
                })
              "
            />
          </div>
          <SettingsField label="Default provider" hint="Which connection a new session starts with">
            <select
              :value="defaults.provider"
              class="w-full rounded px-2 py-1.5 text-[12px]"
              :style="inputStyle"
              @change="
                onChangeDefaultProvider(($event.target as HTMLSelectElement).value as ProviderName)
              "
            >
              <option v-for="p in PROVIDER_OPTIONS" :key="p.value" :value="p.value">
                {{ p.label }}
              </option>
            </select>
          </SettingsField>
          <SettingsField label="Default model" hint="Models filtered by the selected provider">
            <select
              :value="defaults.modelId"
              class="w-full rounded px-2 py-1.5 text-[12px]"
              :style="inputStyle"
              @change="onChangeDefaultModel(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="m in defaultModels" :key="m.id" :value="m.id">
                {{ m.label }} · {{ m.tier }}
              </option>
            </select>
          </SettingsField>
          <SettingsField
            label="Default mode"
            hint="How autonomous agents act by default in a new session"
          >
            <select
              :value="defaults.mode"
              class="w-full rounded px-2 py-1.5 text-[12px]"
              :style="inputStyle"
              @change="
                settings.updateDefaults({
                  mode: ($event.target as HTMLSelectElement).value as AgentMode,
                })
              "
            >
              <option v-for="m in MODE_OPTIONS" :key="m.value" :value="m.value">
                {{ m.label }} — {{ m.hint }}
              </option>
            </select>
          </SettingsField>
          <SettingsField
            label="Default thinking level"
            hint="Reasoning budget. Disabled levels depend on the selected model."
          >
            <select
              :value="defaults.thinkingLevel"
              class="w-full rounded px-2 py-1.5 text-[12px]"
              :style="inputStyle"
              @change="
                settings.updateDefaults({
                  thinkingLevel: ($event.target as HTMLSelectElement).value as ThinkingLevel,
                })
              "
            >
              <option v-for="lv in defaultLevelOptions" :key="lv" :value="lv">
                {{ LEVEL_LABEL[lv] }}
              </option>
            </select>
          </SettingsField>
        </div>
      </div>

      <!-- Models -->
      <div v-else-if="section === 'models'" class="space-y-6">
        <div>
          <h2 class="text-lg font-semibold mb-1" :style="{ color: t.text }">Models & API Keys</h2>
          <div class="text-xs" :style="{ color: t.textDim }">
            Configure model providers. Keys are stored locally and never sent to Anthropic.
          </div>
        </div>
        <div class="space-y-2">
          <div
            v-for="prov in providers"
            :key="prov.id"
            class="rounded p-3"
            :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
          >
            <div class="flex items-center gap-3 mb-2">
              <div
                class="w-8 h-8 rounded flex items-center justify-center"
                :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
              >
                <Sparkles :size="14" :style="{ color: t.textMuted }" />
              </div>
              <div class="flex-1">
                <div class="text-[13px] font-medium" :style="{ color: t.text }">
                  {{ prov.label }}
                </div>
                <div class="text-[10px]" :style="{ color: t.textDim }">
                  {{ prov.models.join(' · ') }}
                </div>
              </div>
              <div
                class="flex items-center gap-1.5 text-[11px]"
                :style="{
                  color: settings.isProviderConnected(prov.id) ? t.text : t.textDim,
                }"
              >
                <div
                  class="w-1.5 h-1.5 rounded-full"
                  :style="{
                    background: settings.isProviderConnected(prov.id) ? '#22c55e' : t.textFaint,
                  }"
                />
                {{
                  settings.isProviderConnected(prov.id)
                    ? `Connected · ${
                        settings.providers[prov.id].accounts.length
                      } account${settings.providers[prov.id].accounts.length > 1 ? 's' : ''}`
                    : 'Not configured'
                }}
              </div>
            </div>

            <div class="space-y-1.5">
              <div
                v-for="acc in settings.providers[prov.id].accounts"
                :key="acc.id"
                class="rounded p-2"
                :style="{
                  background: t.bgInput,
                  border: `1px solid ${
                    settings.providers[prov.id].activeAccountId === acc.id
                      ? t.borderStrong
                      : t.border
                  }`,
                }"
              >
                <template v-if="!isEditingAccount(prov.id, acc.id)">
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      class="flex items-center justify-center w-4 h-4 rounded-full transition"
                      :style="{
                        border: `1px solid ${t.borderStrong}`,
                        background:
                          settings.providers[prov.id].activeAccountId === acc.id
                            ? t.accent
                            : 'transparent',
                      }"
                      :title="
                        settings.providers[prov.id].activeAccountId === acc.id
                          ? 'Active'
                          : 'Set active'
                      "
                      @click="settings.setActiveAccount(prov.id, acc.id)"
                    >
                      <Check
                        v-if="settings.providers[prov.id].activeAccountId === acc.id"
                        :size="10"
                        :style="{ color: t.accentText }"
                      />
                    </button>
                    <div class="flex-1 min-w-0">
                      <div class="text-[12px] truncate" :style="{ color: t.text }">
                        {{ acc.label }}
                      </div>
                      <div class="text-[10px] font-mono truncate" :style="{ color: t.textDim }">
                        {{ maskKey(acc.apiKey) || 'No key' }}
                      </div>
                    </div>
                    <button
                      type="button"
                      class="px-1.5 py-1 text-[11px] rounded transition flex items-center"
                      :style="iconBtnStyle"
                      title="Edit"
                      @click="onStartEditAccount(prov.id, acc)"
                    >
                      <Pencil :size="12" />
                    </button>
                    <button
                      type="button"
                      class="px-1.5 py-1 text-[11px] rounded transition flex items-center"
                      :style="iconBtnStyle"
                      title="Remove"
                      @click="settings.removeProviderAccount(prov.id, acc.id)"
                    >
                      <Trash2 :size="12" />
                    </button>
                  </div>
                </template>
                <template v-else>
                  <form class="space-y-1.5" @submit.prevent="onSaveEditAccount(prov.id, acc.id)">
                    <input
                      v-model="accountDraft.label"
                      class="w-full rounded px-2 py-1 text-[11px]"
                      :style="inputStyle"
                      placeholder="Label (e.g. Work)"
                      required
                    />
                    <div class="flex items-center gap-1.5">
                      <input
                        v-model="accountDraft.apiKey"
                        :type="revealDraftKey ? 'text' : 'password'"
                        class="flex-1 min-w-0 rounded px-2 py-1 text-[11px] font-mono"
                        :style="inputStyle"
                        placeholder="API key"
                      />
                      <button
                        type="button"
                        class="px-1.5 py-1 rounded text-[11px] flex items-center"
                        :style="iconBtnStyle"
                        :title="revealDraftKey ? 'Hide' : 'Show'"
                        @click="revealDraftKey = !revealDraftKey"
                      >
                        <component :is="revealDraftKey ? EyeOff : Eye" :size="12" />
                      </button>
                    </div>
                    <div class="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        class="px-2 py-1 text-[11px] rounded transition"
                        :style="iconBtnStyle"
                        @click="cancelAccountForm"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        class="px-2 py-1 text-[11px] rounded transition"
                        :style="{ background: t.accent, color: t.accentText, border: 'none' }"
                        :disabled="!accountDraft.label.trim()"
                      >
                        Save
                      </button>
                    </div>
                  </form>
                </template>
              </div>

              <form
                v-if="addingAccountFor === prov.id"
                class="rounded p-2 space-y-1.5"
                :style="{ background: t.bgInput, border: `1px dashed ${t.border}` }"
                @submit.prevent="onCreateAccount(prov.id)"
              >
                <input
                  v-model="accountDraft.label"
                  class="w-full rounded px-2 py-1 text-[11px]"
                  :style="inputStyle"
                  placeholder="Label (e.g. Work)"
                  required
                  autofocus
                />
                <div class="flex items-center gap-1.5">
                  <input
                    v-model="accountDraft.apiKey"
                    :type="revealDraftKey ? 'text' : 'password'"
                    class="flex-1 min-w-0 rounded px-2 py-1 text-[11px] font-mono"
                    :style="inputStyle"
                    placeholder="API key"
                  />
                  <button
                    type="button"
                    class="px-1.5 py-1 rounded text-[11px] flex items-center"
                    :style="iconBtnStyle"
                    :title="revealDraftKey ? 'Hide' : 'Show'"
                    @click="revealDraftKey = !revealDraftKey"
                  >
                    <component :is="revealDraftKey ? EyeOff : Eye" :size="12" />
                  </button>
                </div>
                <div class="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    class="px-2 py-1 text-[11px] rounded transition"
                    :style="iconBtnStyle"
                    @click="cancelAccountForm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    class="px-2 py-1 text-[11px] rounded transition"
                    :style="{ background: t.accent, color: t.accentText, border: 'none' }"
                    :disabled="!accountDraft.label.trim()"
                  >
                    Add account
                  </button>
                </div>
              </form>
              <button
                v-else
                type="button"
                class="w-full rounded px-2 py-1.5 text-[11px] flex items-center gap-1.5 transition"
                :style="{
                  color: t.textDim,
                  border: `1px dashed ${t.border}`,
                  background: 'transparent',
                }"
                @click="onStartAddAccount(prov.id)"
              >
                <Plus :size="12" />
                Add account
              </button>
            </div>
          </div>

          <div
            v-for="cp in settings.customProviders"
            :key="cp.id"
            class="rounded p-3"
            :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
          >
            <template v-if="editingCustomId !== cp.id">
              <div class="flex items-center gap-3 mb-2">
                <div
                  class="w-8 h-8 rounded flex items-center justify-center"
                  :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
                >
                  <Sparkles :size="14" :style="{ color: t.textMuted }" />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-[13px] font-medium truncate" :style="{ color: t.text }">
                    {{ cp.label || 'Untitled provider' }}
                  </div>
                  <div class="text-[10px] truncate" :style="{ color: t.textDim }">
                    {{ cp.baseUrl || 'No base URL' }}
                    {{ cp.models.length ? `· ${cp.models.join(' · ')}` : '' }}
                  </div>
                </div>
                <div
                  class="flex items-center gap-1.5 text-[11px]"
                  :style="{ color: cp.apiKey ? t.text : t.textDim }"
                >
                  <div
                    class="w-1.5 h-1.5 rounded-full"
                    :style="{ background: cp.apiKey ? '#22c55e' : t.textFaint }"
                  />
                  {{ cp.apiKey ? 'Key set' : 'No key' }}
                </div>
                <button
                  type="button"
                  class="px-2 py-1 text-[11px] rounded transition flex items-center"
                  :style="iconBtnStyle"
                  title="Edit"
                  @click="onEditCustom(cp)"
                >
                  <Pencil :size="13" />
                </button>
                <button
                  type="button"
                  class="px-2 py-1 text-[11px] rounded transition flex items-center"
                  :style="iconBtnStyle"
                  title="Remove"
                  @click="onRemoveCustom(cp.id)"
                >
                  <Trash2 :size="13" />
                </button>
              </div>
            </template>
            <template v-else>
              <CustomProviderForm
                v-model="customDraft"
                submit-label="Save"
                @submit="onSaveEditCustom(cp.id)"
                @cancel="cancelCustomForm"
              />
            </template>
          </div>

          <div
            v-if="adding"
            class="rounded p-3"
            :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
          >
            <CustomProviderForm
              v-model="customDraft"
              submit-label="Add provider"
              @submit="onCreateCustom"
              @cancel="cancelCustomForm"
            />
          </div>
          <button
            v-else
            type="button"
            class="w-full rounded p-3 flex items-center gap-3 text-left transition"
            :style="{
              background: t.bgElevated,
              border: `1px dashed ${t.border}`,
            }"
            @click="onStartAddCustom"
          >
            <div
              class="w-8 h-8 rounded flex items-center justify-center"
              :style="{ background: t.bgInput }"
            >
              <Plus :size="14" :style="{ color: t.textDim }" />
            </div>
            <div class="flex-1">
              <div class="text-[13px]" :style="{ color: t.text }">Add a custom provider</div>
              <div class="text-[10px]" :style="{ color: t.textDim }">
                OpenRouter, Ollama, LM Studio, or any OpenAI-compatible endpoint
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- Connectors -->
      <div v-else-if="section === 'connectors'" class="space-y-6">
        <div>
          <h2 class="text-lg font-semibold mb-1" :style="{ color: t.text }">Connectors</h2>
          <div class="text-xs" :style="{ color: t.textDim }">
            External context providers that agents can read from
          </div>
        </div>
        <div class="space-y-2">
          <div
            v-for="p in connectorProviders"
            :key="p.id"
            class="rounded p-3 flex items-center gap-3"
            :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
          >
            <div
              class="w-8 h-8 rounded flex items-center justify-center"
              :style="{ background: t.bgInput, border: `1px solid ${t.border}` }"
            >
              <component :is="p.icon" :size="14" :style="{ color: t.textMuted }" />
            </div>
            <div class="flex-1">
              <div class="text-[13px] font-medium" :style="{ color: t.text }">
                {{ p.label }}
              </div>
              <div class="text-[10px]" :style="{ color: t.textDim }">
                {{
                  settings.contextProviders[p.id as ConnectorId].connected
                    ? 'Authenticated · workspace.example.com'
                    : 'Not connected'
                }}
              </div>
            </div>
            <button
              class="px-3 py-1 text-[11px] rounded transition"
              :style="{
                background: settings.contextProviders[p.id as ConnectorId].connected
                  ? 'transparent'
                  : t.accent,
                color: settings.contextProviders[p.id as ConnectorId].connected
                  ? t.text
                  : t.accentText,
                border: settings.contextProviders[p.id as ConnectorId].connected
                  ? `1px solid ${t.borderStrong}`
                  : 'none',
              }"
              @click="settings.toggleConnector(p.id as ConnectorId)"
            >
              {{
                settings.contextProviders[p.id as ConnectorId].connected ? 'Disconnect' : 'Connect'
              }}
            </button>
          </div>
        </div>
      </div>

      <!-- Appearance -->
      <div v-else-if="section === 'appearance'" class="space-y-6">
        <div>
          <h2 class="text-lg font-semibold mb-1" :style="{ color: t.text }">Appearance</h2>
          <div class="text-xs" :style="{ color: t.textDim }">
            Toggle theme using the icon in the sidebar
          </div>
        </div>
        <div class="text-[12px]" :style="{ color: t.textMuted }">
          Use the moon/sun toggle in the bottom-left of the sidebar to switch between dark and light
          mode.
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Check,
  ChevronLeft,
  Eye,
  EyeOff,
  FolderGit2,
  Key,
  Palette,
  Pencil,
  Plug,
  Plus,
  Sliders,
  Sparkles,
  Trash2,
} from 'lucide-vue-next'
import type { Component } from 'vue'
import type {
  CustomProvider,
  CustomProviderInput,
  ProviderAccount,
  ProviderAccountInput,
} from '~/stores/settings'
import type { AgentMode, ProviderName, ThinkingLevel } from '~/types'
import { CONTEXT_PROVIDERS } from '~/utils/initial-data'
import { LEVEL_LABEL, MODELS, levelsForModel, modelById, modelsForProvider } from '~/utils/models'

type SectionId = 'workspace' | 'defaults' | 'models' | 'connectors' | 'appearance'
type ProviderId = 'anthropic' | 'openai' | 'google'
type ConnectorId = 'notion' | 'jira' | 'slack'

const { t } = useTheme()
const settings = useSettingsStore()

const section = ref<SectionId>('workspace')
const mobilePane = ref<'list' | 'detail'>('list')

const onSelectSection = (id: SectionId) => {
  section.value = id
  mobilePane.value = 'detail'
}

const sections: { id: SectionId; label: string; icon: Component }[] = [
  { id: 'workspace', label: 'Workspace', icon: FolderGit2 },
  { id: 'defaults', label: 'Defaults', icon: Sliders },
  { id: 'models', label: 'Models & API Keys', icon: Key },
  { id: 'connectors', label: 'Connectors', icon: Plug },
  { id: 'appearance', label: 'Appearance', icon: Palette },
]

const MODE_OPTIONS: { value: AgentMode; label: string; hint: string }[] = [
  { value: 'ask', label: 'Ask', hint: 'Read + answer. Never modifies files.' },
  { value: 'plan', label: 'Plan', hint: 'Draft plan + propose patches.' },
  { value: 'accept-edits', label: 'Accept Edits', hint: 'Auto-apply edits, no prompt.' },
  { value: 'execute', label: 'Execute', hint: 'Full autonomy: run tools, edit, commit.' },
]

const PROVIDER_OPTIONS: { value: ProviderName; label: string }[] = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'google', label: 'Google' },
]

const defaults = computed(() => settings.defaults)
const defaultModels = computed(() =>
  modelsForProvider(defaults.value.provider).length > 0
    ? modelsForProvider(defaults.value.provider)
    : MODELS,
)
const defaultLevelOptions = computed(() => levelsForModel(modelById(defaults.value.modelId)))

const onChangeDefaultProvider = (value: ProviderName) => {
  const next = modelsForProvider(value)[0]
  settings.updateDefaults({
    provider: value,
    modelId: next ? next.id : defaults.value.modelId,
  })
}

const onChangeDefaultModel = (id: string) => {
  const allowed = levelsForModel(modelById(id))
  const nextLevel = allowed.includes(defaults.value.thinkingLevel)
    ? defaults.value.thinkingLevel
    : (allowed[0] ?? 'standard')
  settings.updateDefaults({ modelId: id, thinkingLevel: nextLevel })
}

const providers: { id: ProviderId; label: string; models: string[] }[] = [
  { id: 'anthropic', label: 'Anthropic', models: ['Claude Opus', 'Claude Sonnet'] },
  { id: 'openai', label: 'OpenAI', models: ['GPT-5', 'Codex'] },
  { id: 'google', label: 'Google', models: ['Gemini 2.5 Pro'] },
]

const connectorProviders = computed(() =>
  CONTEXT_PROVIDERS.filter((p) =>
    (['notion', 'jira', 'slack'] as const).includes(p.id as ConnectorId),
  ),
)

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none',
}))

const iconBtnStyle = computed(() => ({
  color: t.value.text,
  border: `1px solid ${t.value.borderStrong}`,
  background: 'transparent',
}))

const maskKey = (key: string) => {
  if (!key) return ''
  if (key.length <= 12) return '•'.repeat(key.length)
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}

const emptyAccountDraft = (): ProviderAccountInput => ({ label: '', apiKey: '' })

const accountDraft = ref<ProviderAccountInput>(emptyAccountDraft())
const editingAccount = ref<{ provider: ProviderId; accountId: string } | null>(null)
const addingAccountFor = ref<ProviderId | null>(null)
const revealDraftKey = ref(false)

const isEditingAccount = (provider: ProviderId, accountId: string) =>
  editingAccount.value?.provider === provider && editingAccount.value.accountId === accountId

const cancelAccountForm = () => {
  editingAccount.value = null
  addingAccountFor.value = null
  accountDraft.value = emptyAccountDraft()
  revealDraftKey.value = false
}

const onStartAddAccount = (provider: ProviderId) => {
  editingAccount.value = null
  accountDraft.value = emptyAccountDraft()
  revealDraftKey.value = false
  addingAccountFor.value = provider
}

const onCreateAccount = async (provider: ProviderId) => {
  await settings.addProviderAccount(provider, accountDraft.value)
  cancelAccountForm()
}

const onStartEditAccount = (provider: ProviderId, account: ProviderAccount) => {
  addingAccountFor.value = null
  editingAccount.value = { provider, accountId: account.id }
  accountDraft.value = { label: account.label, apiKey: account.apiKey }
  revealDraftKey.value = false
}

const onSaveEditAccount = async (provider: ProviderId, accountId: string) => {
  await settings.updateProviderAccount(provider, accountId, accountDraft.value)
  cancelAccountForm()
}

const emptyCustomDraft = (): CustomProviderInput => ({
  label: '',
  baseUrl: '',
  apiKey: '',
  models: [],
})

const adding = ref(false)
const editingCustomId = ref<string | null>(null)
const customDraft = ref<CustomProviderInput>(emptyCustomDraft())

const cancelCustomForm = () => {
  adding.value = false
  editingCustomId.value = null
  customDraft.value = emptyCustomDraft()
}

const onStartAddCustom = () => {
  editingCustomId.value = null
  customDraft.value = emptyCustomDraft()
  adding.value = true
}

const onCreateCustom = () => {
  settings.addCustomProvider(customDraft.value)
  cancelCustomForm()
}

const onEditCustom = (cp: CustomProvider) => {
  adding.value = false
  editingCustomId.value = cp.id
  customDraft.value = {
    label: cp.label,
    baseUrl: cp.baseUrl,
    apiKey: cp.apiKey,
    models: [...cp.models],
  }
}

const onSaveEditCustom = (id: string) => {
  settings.updateCustomProvider(id, customDraft.value)
  cancelCustomForm()
}

const onRemoveCustom = (id: string) => {
  settings.removeCustomProvider(id)
  if (editingCustomId.value === id) cancelCustomForm()
}
</script>
