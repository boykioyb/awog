<template>
  <div class="oba">
    <p class="ob-lead">{{ t('onboarding.account.desc') }}</p>

    <div v-if="connected.length" class="oba-chips">
      <span v-for="p in connected" :key="p" class="chip oba-ok">
        <Icon name="check" />
        {{ t('onboarding.account.connected', { provider: PROVIDER_LABEL[p] }) }}
      </span>
    </div>

    <template v-if="available">
      <div class="oba-form">
        <label class="oba-label">{{ t('onboarding.account.provider') }}</label>
        <!-- Segmented control (not AppSelect): its teleported menu sits at z-130,
             below this z-250 overlay, so the dropdown would open hidden. -->
        <div class="seg oba-seg">
          <span
            v-for="o in providerOptions"
            :key="o.value"
            :class="{ on: provider === o.value }"
            @click="provider = o.value"
          >
            {{ o.label }}
          </span>
        </div>

        <label class="oba-label">{{ t('onboarding.account.key') }}</label>
        <input
          v-model="apiKey"
          type="password"
          class="keyinp mono"
          :placeholder="t('onboarding.account.keyPlaceholder')"
          autocomplete="off"
          @keydown.enter.prevent="connect"
        />

        <button class="btn pri oba-connect" :disabled="!apiKey.trim() || busy" @click="connect">
          {{ busy ? t('onboarding.account.connecting') : t('onboarding.account.connect') }}
        </button>
      </div>

      <p v-if="error" class="oba-err">{{ t('onboarding.account.error') }}</p>
      <p class="oba-hint">{{ t('onboarding.account.oauthNote') }}</p>
    </template>

    <p v-else class="oba-hint">{{ t('onboarding.account.browserOnly') }}</p>
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

<style scoped>
.oba {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.ob-lead {
  color: var(--textMuted);
  line-height: 1.5;
}
.oba-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.oba-ok {
  color: var(--accent);
  border-color: var(--accentBorder);
}
.oba-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.oba-label {
  font-size: 12px;
  color: var(--textFaint);
  margin-top: 4px;
}
.oba-seg {
  align-self: flex-start;
}
.oba-connect {
  margin-top: 10px;
  align-self: flex-start;
}
.oba-err {
  color: var(--danger);
}
.oba-hint {
  color: var(--textDim);
  line-height: 1.5;
}
</style>
