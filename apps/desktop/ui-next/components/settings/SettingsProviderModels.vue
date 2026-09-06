<template>
  <div class="pcard smcatalog">
    <div class="pcardtop">
      <span class="rx">
        <Icon
          name="agents"
          style="width: var(--icon-md); height: var(--icon-md); color: var(--blue)"
        />
      </span>
      <div class="pcardinfo">
        <div class="rt">{{ t('settingsModels.catalog.title') }}</div>
        <div class="rd">{{ t('settingsModels.catalog.intro') }}</div>
      </div>
    </div>

    <SettingsSeg v-model="providerId" :options="providerOptions" />

    <div class="smcatbar">
      <span class="fd smcatmeta">{{ metaText }}</span>
      <button
        v-if="customized"
        class="btn sm"
        type="button"
        :title="t('settingsModels.catalog.resetTitle')"
        @click="onReset"
      >
        {{ t('settingsModels.catalog.reset') }}
      </button>
      <button
        class="btn sm pri smcatfetch"
        type="button"
        :disabled="!available || loading"
        @click="onFetch"
      >
        <Icon
          name="refresh"
          :class="{ spin: loading }"
          style="width: var(--icon-sm); height: var(--icon-sm)"
        />
        {{ loading ? t('settingsModels.catalog.fetching') : t('settingsModels.catalog.fetch') }}
      </button>
    </div>

    <div v-if="!hasAccount" class="fd smcathint">
      {{ t('settingsModels.catalog.needAccount') }}
    </div>
    <div v-if="error" class="pcarderror">{{ t('settingsModels.catalog.fetchError') }}</div>

    <div class="smcatlist">
      <label v-for="m in models" :key="m.id" class="smcatrow">
        <div class="smcatinfo">
          <span class="smcatname">{{ m.name }}</span>
          <span class="smcatid mono">{{ m.id }}</span>
        </div>
        <span v-if="sourceLabel(m.source)" class="chip smcatsrc">{{ sourceLabel(m.source) }}</span>
        <SettingsTog
          :model-value="isEnabled(provider, m.id)"
          @update:model-value="toggle(provider, m.id)"
        />
      </label>
      <div v-if="!models.length" class="fd smcatempty">{{ t('settingsModels.catalog.empty') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Settings → "Available models": the per-provider catalog surface (spec:
// docs/features/provider-model-catalog.md). One provider at a time (seg switch);
// each model gets an enable/disable toggle that drives every picker, plus a Fetch
// button that pulls the latest list live from the provider (Pi catalog + live
// /v1/models). State lives in the single provider-model source (useProviderModels).
import SettingsSeg from '~/components/settings/SettingsSeg.vue'
import SettingsTog from '~/components/settings/SettingsTog.vue'
import { PROVIDERS } from '~/components/agent/agent-display'
import { useProviderModels, type ModelSource } from '~/composables/useProviderModels'
import { useSettingsStore, type ProviderName } from '~/stores/settings'
import { useSidecar } from '~/composables/useSidecar'

const { t } = useI18n()
const settings = useSettingsStore()
const { available } = useSidecar()
const { all, shown, status, isEnabled, isCustomized, toggle, reset, load } = useProviderModels()

const providerOptions = PROVIDERS.map((p) => ({ label: p.label, value: p.id }))
const providerId = ref<string>('anthropic')
const provider = computed(() => providerId.value as ProviderName)

const models = computed(() => all(provider.value))
const shownCount = computed(() => shown(provider.value).length)
const customized = computed(() => isCustomized(provider.value))
const st = computed(() => status[provider.value])
const loading = computed(() => st.value.loading)
const error = computed(() => !!st.value.error)

// The account whose credential authenticates the live fetch: the provider's active
// account, else its first connected account.
const accountId = computed(() => {
  const cfg = settings.providers[provider.value]
  return cfg.activeAccountId ?? cfg.accounts[0]?.id
})
const hasAccount = computed(() => !!accountId.value)

const metaText = computed(() => {
  const count = t('settingsModels.catalog.count', {
    shown: shownCount.value,
    total: models.value.length,
  })
  if (!st.value.fetchedAt) return `${count} · ${t('settingsModels.catalog.never')}`
  const when = new Date(st.value.fetchedAt).toLocaleString()
  const updated = t('settingsModels.catalog.updated', { when })
  const live = st.value.live ? ` · ${t('settingsModels.catalog.live')}` : ''
  return `${count} · ${updated}${live}`
})

// A micro-badge marking freshly-fetched ids ('pi' = the bundled catalog, no badge).
const sourceLabel = (source: ModelSource): string => {
  if (source === 'api') return t('settingsModels.catalog.source.api')
  if (source === 'both') return t('settingsModels.catalog.source.both')
  return ''
}

const onFetch = () => {
  // Live only when an account is present (needed for /v1/models auth); otherwise a
  // Pi-catalog refresh still surfaces any models newer than the bundled seed.
  void load(provider.value, { live: hasAccount.value, accountId: accountId.value })
}

const onReset = () => reset(provider.value)
</script>

<style scoped>
.smcatalog {
  gap: 12px;
}
.smcatbar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.smcatmeta {
  flex: 1;
  min-width: 0;
}
.smcatfetch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.spin {
  animation: smcatspin 0.9s linear infinite;
}
@keyframes smcatspin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
.smcathint {
  margin-top: -4px;
}
.smcatlist {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-top: 1px solid var(--border);
  padding-top: 8px;
}
.smcatrow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 4px;
  border-radius: var(--r-sm);
  cursor: pointer;
}
.smcatrow:hover {
  background: var(--bgHover);
}
.smcatinfo {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.smcatname {
  font-size: 1em;
  color: var(--text);
}
.smcatid {
  font-size: 12px;
  line-height: 18px;
  color: var(--textFaint);
}
.smcatsrc {
  flex: 0 0 auto;
  font-size: 12px;
  line-height: 18px;
  color: var(--textDim);
}
.smcatempty {
  padding: 8px 4px;
}
</style>
