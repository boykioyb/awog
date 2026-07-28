<template>
  <div>
    <SettingsPaneHeader :title="t('settings.defaults.heading')" />

    <SettingsField
      block
      :name="t('settingsDefaults.systemPrompt.name')"
      :desc="t('settingsDefaults.systemPrompt.desc')"
    >
      <textarea
        v-model="systemPrompt"
        class="keyinp"
        rows="5"
        :placeholder="t('settingsDefaults.systemPrompt.placeholder')"
        style="resize: vertical; min-height: 7rem; font-family: var(--sans)"
      />
    </SettingsField>

    <SettingsField
      block
      :name="t('settingsDefaults.instructions.name')"
      :desc="t('settingsDefaults.instructions.desc')"
    >
      <textarea
        v-model="instructions"
        class="keyinp"
        rows="6"
        :placeholder="t('settingsDefaults.instructions.placeholder')"
        style="resize: vertical; min-height: 8rem; font-family: var(--sans)"
      />
    </SettingsField>

    <SettingsField
      :name="t('settingsDefaults.provider.name')"
      :desc="t('settingsDefaults.provider.desc')"
    >
      <SettingsSeg v-model="provider" :options="PROVIDER_OPTIONS" />
    </SettingsField>

    <SettingsField
      :name="t('settingsDefaults.model.name')"
      :desc="t('settingsDefaults.model.desc')"
    >
      <AppSelect v-model="modelId" :options="modelOptions" />
    </SettingsField>

    <SettingsProjectModelDefault />

    <SettingsField
      :name="t('settings.defaults.mode.name')"
      :desc="t('settings.defaults.mode.desc')"
    >
      <SettingsSeg v-model="mode" :options="modeOptions" />
    </SettingsField>

    <SettingsField
      :name="t('settings.defaults.thinking.name')"
      :desc="t('settings.defaults.thinking.desc')"
    >
      <SettingsSeg v-model="thinkingLevel" :options="thinkingOptions" />
    </SettingsField>

    <SettingsField
      :name="t('settings.defaults.sendKey.name')"
      :desc="t('settings.defaults.sendKey.desc')"
    >
      <SettingsSeg v-model="composerSendKey" :options="['Enter', '⇧Enter']" />
    </SettingsField>

    <!-- Translation model (selection-to-translate, docs/features/selection-translate.md) -->
    <div class="sech">{{ t('settingsDefaults.translate.heading') }}</div>

    <SettingsField
      :name="t('settingsDefaults.translate.follow.name')"
      :desc="t('settingsDefaults.translate.follow.desc')"
    >
      <SettingsTog v-model="trFollowAppDefault" />
    </SettingsField>

    <template v-if="!trFollowAppDefault">
      <SettingsField
        :name="t('settingsDefaults.translate.provider.name')"
        :desc="t('settingsDefaults.translate.provider.desc')"
      >
        <SettingsSeg v-model="trProvider" :options="PROVIDER_OPTIONS" />
      </SettingsField>

      <SettingsField
        :name="t('settingsDefaults.translate.account.name')"
        :desc="t('settingsDefaults.translate.account.desc')"
      >
        <AppSelect v-model="trAccountId" :options="trAccountOptions" />
      </SettingsField>

      <SettingsField
        :name="t('settingsDefaults.translate.model.name')"
        :desc="t('settingsDefaults.translate.model.desc')"
      >
        <AppSelect
          v-model="trModelId"
          :options="trModelOptions"
          :placeholder="t('settingsDefaults.translate.model.ph')"
        />
      </SettingsField>
    </template>
  </div>
</template>

<script setup lang="ts">
// Defaults panel — ports setSecHtml('defaults'). Wired to the settings store's
// `defaults` slice (+ appearance.composerSendKey). Seg/textarea controls write
// through the store actions via computed get/set proxies, so store state stays
// mutated only inside updateDefaults/updateAppearance (encapsulation).
import {
  PROVIDER_DISPLAY,
  modelIdFromDisplay,
  modelsForProvider,
  type ThinkingLevel,
} from '~/composables/useSessionsData'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import { useTranslateSettings } from '~/composables/useTranslateSettings'
import type { AgentMode, ProviderName } from '~/stores/settings'

const { t } = useI18n()
const settings = useSettingsStore()
const { defaults, appearance } = storeToRefs(settings)

// Translation-model section (selection-to-translate). Account/model pickers show
// only when NOT following the app default.
const {
  followAppDefault: trFollowAppDefault,
  provider: trProvider,
  accountId: trAccountId,
  modelId: trModelId,
  accounts: trAccounts,
  availableModelIds: trAvailableModelIds,
  modelLabel: trModelLabel,
} = useTranslateSettings()

const trAccountOptions = computed<AppSelectOption[]>(() => [
  { value: '__active', label: t('settingsDefaults.translate.account.active') },
  ...trAccounts.value.map((a) => ({ value: a.id, label: a.label || a.fingerprint })),
])
const trModelOptions = computed<AppSelectOption[]>(() =>
  trAvailableModelIds.value.map((id) => ({ value: id, label: trModelLabel(id) })),
)

// Provider id ↔ display (seg stores the engine id; label is the proper noun).
const PROVIDER_OPTIONS = [
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Google', value: 'google' },
] as const

// Mode + thinking labels are descriptive → through t(); seg stores the engine value.
const modeOptions = computed(() => [
  { label: t('settings.defaults.mode.ask'), value: 'ask' },
  { label: t('settings.defaults.mode.plan'), value: 'plan' },
  { label: t('settingsDefaults.mode.acceptEdits'), value: 'accept-edits' },
  { label: t('settings.defaults.mode.execute'), value: 'execute' },
])
const thinkingOptions = computed(() => [
  { label: t('settings.defaults.thinking.low'), value: 'low' },
  { label: t('settings.defaults.thinking.medium'), value: 'medium' },
  { label: t('settings.defaults.thinking.high'), value: 'high' },
  { label: t('settings.defaults.thinking.max'), value: 'max' },
])

// First model id of a provider — used to reset the model when the provider changes.
const firstModelIdOf = (provider: ProviderName): string =>
  modelIdFromDisplay(modelsForProvider(PROVIDER_DISPLAY[provider] ?? 'Anthropic')[0] ?? '')

// Current provider's models as { label: display, value: engine id }.
const modelOptions = computed(() =>
  modelsForProvider(PROVIDER_DISPLAY[defaults.value.provider] ?? 'Anthropic').map((display) => ({
    label: display,
    value: modelIdFromDisplay(display),
  })),
)

const systemPrompt = computed({
  get: () => defaults.value.systemPrompt,
  set: (systemPrompt: string) => settings.updateDefaults({ systemPrompt }),
})
const instructions = computed({
  get: () => defaults.value.instructions,
  set: (instructions: string) => settings.updateDefaults({ instructions }),
})
const provider = computed<string>({
  get: () => defaults.value.provider,
  set: (value) => {
    const provider = value as ProviderName
    settings.updateDefaults({ provider, modelId: firstModelIdOf(provider) })
  },
})
const modelId = computed<string>({
  get: () => defaults.value.modelId,
  set: (modelId) => settings.updateDefaults({ modelId }),
})
const mode = computed<string>({
  get: () => defaults.value.mode,
  set: (value) => settings.updateDefaults({ mode: value as AgentMode }),
})
const thinkingLevel = computed<string>({
  get: () => defaults.value.thinkingLevel,
  set: (value) => settings.updateDefaults({ thinkingLevel: value as ThinkingLevel }),
})
const composerSendKey = computed<string>({
  get: () => (appearance.value.composerSendKey === 'shift-enter' ? '⇧Enter' : 'Enter'),
  set: (value) =>
    settings.updateAppearance({ composerSendKey: value === '⇧Enter' ? 'shift-enter' : 'enter' }),
})
</script>
