<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-lg font-semibold mb-1" :style="{ color: t.text }">Defaults</h2>
      <div class="text-[1em]" :style="{ color: t.textDim }">
        Default system prompt, instructions, model, and mode used when starting a new session or
        agent
      </div>
    </div>
    <div class="space-y-4">
      <div class="py-3 space-y-2" :style="{ borderBottom: `1px solid ${t.border}` }">
        <div>
          <div class="text-[1em] font-medium" :style="{ color: t.text }">System prompt</div>
          <div class="text-[1em] mt-0.5" :style="{ color: t.textDim }">
            Applied as the base persona for new sessions and agents that don't define their own
          </div>
        </div>
        <textarea
          :value="defaults.systemPrompt"
          rows="5"
          class="w-full rounded px-2 py-1.5 text-[1em] font-mono leading-relaxed"
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
          <div class="text-[1em] font-medium" :style="{ color: t.text }">Instructions</div>
          <div class="text-[1em] mt-0.5" :style="{ color: t.textDim }">
            Always-on user instructions prepended to every request (style guides, project
            conventions)
          </div>
        </div>
        <textarea
          :value="defaults.instructions"
          rows="6"
          class="w-full rounded px-2 py-1.5 text-[1em] font-mono leading-relaxed"
          :style="inputStyle"
          placeholder="- Reply in English
- Prefer KISS / YAGNI
- Do not add new dependencies without an ADR"
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
          class="w-full rounded px-2 py-1.5 text-[1em]"
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
          class="w-full rounded px-2 py-1.5 text-[1em]"
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
          class="w-full rounded px-2 py-1.5 text-[1em]"
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
          class="w-full rounded px-2 py-1.5 text-[1em]"
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
</template>

<script setup lang="ts">
import type { AgentMode, ProviderName, ThinkingLevel } from '~/types'
import { LEVEL_LABEL, MODELS, levelsForModel, modelById, modelsForProvider } from '~/utils/models'

const { t } = useTheme()
const settings = useSettingsStore()

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

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none',
}))

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
    : (allowed[0] ?? 'low')
  settings.updateDefaults({ modelId: id, thinkingLevel: nextLevel })
}
</script>
