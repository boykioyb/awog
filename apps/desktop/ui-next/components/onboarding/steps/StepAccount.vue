<template>
  <div class="flex flex-col gap-4">
    <p class="text-muted-foreground">{{ t('onboarding.account.desc') }}</p>

    <div v-if="connected.length" class="flex flex-wrap gap-2">
      <Badge
        v-for="p in connected"
        :key="p"
        variant="outline"
        class="border-selected-border text-primary"
      >
        <Icon name="check" />
        {{ t('onboarding.account.connected', { provider: PROVIDER_LABEL[p] }) }}
      </Badge>
    </div>

    <template v-if="available">
      <div class="flex flex-col gap-2">
        <label class="mt-1 text-sm text-faint">{{ t('onboarding.account.provider') }}</label>
        <SettingsSeg v-model="providerValue" :options="providerOptions" class="self-start" />

        <label class="mt-1 text-sm text-faint">{{ t('onboarding.account.key') }}</label>
        <!-- mono-ok: API key -->
        <Input
          v-model="apiKey"
          type="password"
          :placeholder="t('onboarding.account.keyPlaceholder')"
          autocomplete="off"
          class="flex-1 font-mono"
          @keydown.enter.prevent="connect"
        />

        <Button
          :disabled="!apiKey.trim() || busy"
          class="mt-2.5 self-start"
          variant="default"
          @click="connect"
        >
          {{ busy ? t('onboarding.account.connecting') : t('onboarding.account.connect') }}
        </Button>
      </div>

      <p v-if="error" class="text-destructive">{{ t('onboarding.account.error') }}</p>
      <p class="text-dim">{{ t('onboarding.account.oauthNote') }}</p>
    </template>

    <p v-else class="text-dim">{{ t('onboarding.account.browserOnly') }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSettingsStore, type ProviderName } from '~/stores/settings'
import { useSidecar } from '~/composables/useSidecar'

// Account step — self-contained API-key quick-connect (avoids nesting the Settings
// modal, which would sit below this overlay). OAuth/Codex stay in Settings; this
// step only needs to get a new user to ≥1 working account. The key goes straight
// to the sidecar via addApiKeyAccount and never lands in onboarding state.
const { t } = useI18n()
const settings = useSettingsStore()
const sidecar = useSidecar()
const available = sidecar.available

const PROVIDER_LABEL: Record<ProviderName, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
}
const providerOptions: { value: ProviderName; label: string }[] = (
  Object.keys(PROVIDER_LABEL) as ProviderName[]
).map((value) => ({ value, label: PROVIDER_LABEL[value] }))

const provider = ref<ProviderName>('anthropic')
// SettingsSeg giữ model kiểu string — cầu nối sang union ProviderName.
const providerValue = computed<string>({
  get: () => provider.value,
  set: (value) => {
    provider.value = value as ProviderName
  },
})
const apiKey = ref('')
const busy = ref(false)
const error = ref(false)

const connected = computed<ProviderName[]>(() =>
  (Object.keys(PROVIDER_LABEL) as ProviderName[]).filter(
    (p) => settings.providers[p].accounts.length > 0,
  ),
)

const connect = async () => {
  const key = apiKey.value.trim()
  if (!key || busy.value) return
  busy.value = true
  error.value = false
  try {
    await settings.addApiKeyAccount({ apiKey: key, provider: provider.value })
    apiKey.value = ''
  } catch (err) {
    console.warn('[onboarding] addApiKey failed', err)
    error.value = true
  } finally {
    busy.value = false
  }
}
</script>
