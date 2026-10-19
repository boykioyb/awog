<template>
  <Card class="gap-3 p-3.5 shadow-none">
    <SettingsProviderCardHeader
      :title="t('settingsModels.catalog.title')"
      :desc="t('settingsModels.catalog.intro')"
    >
      <template #icon>
        <Icon name="agents" class="size-4 text-info" />
      </template>
    </SettingsProviderCardHeader>

    <SettingsSeg v-model="providerId" :options="providerOptions" class="self-start" />

    <div class="flex items-center gap-2">
      <span class="min-w-0 flex-1 text-sm text-dim">{{ metaText }}</span>
      <Button
        v-if="customized"
        type="button"
        :title="t('settingsModels.catalog.resetTitle')"
        variant="outline"
        size="sm"
        @click="onReset"
      >
        {{ t('settingsModels.catalog.reset') }}
      </Button>
      <Button
        type="button"
        :disabled="!available || loading"
        variant="default"
        size="sm"
        @click="onFetch"
      >
        <Icon
          name="refresh"
          class="size-3.5"
          :class="{ 'animate-spin motion-reduce:animate-none': loading }"
        />
        {{ loading ? t('settingsModels.catalog.fetching') : t('settingsModels.catalog.fetch') }}
      </Button>
    </div>

    <div v-if="!hasAccount" class="-mt-1 text-sm text-dim">
      {{ t('settingsModels.catalog.needAccount') }}
    </div>
    <Alert
      v-if="error"
      variant="destructive"
      class="border-destructive/50 bg-destructive/10 px-2.5 py-1.5"
    >
      <AlertDescription>{{ t('settingsModels.catalog.fetchError') }}</AlertDescription>
    </Alert>

    <Separator />
    <div class="flex flex-col gap-0.5">
      <label
        v-for="m in models"
        :key="m.id"
        class="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-accent"
      >
        <div class="flex min-w-0 flex-1 flex-col gap-px">
          <span class="text-foreground">{{ m.name }}</span>
          <!-- mono-ok: id model -->
          <span class="font-mono text-sm text-faint">{{ m.id }}</span>
        </div>
        <Badge v-if="sourceLabel(m.source)" variant="outline" class="shrink-0 text-dim">
          {{ sourceLabel(m.source) }}
        </Badge>
        <SettingsTog
          :model-value="isEnabled(provider, m.id)"
          @update:model-value="toggle(provider, m.id)"
        />
      </label>
      <div v-if="!models.length" class="px-1 py-2 text-sm text-dim">
        {{ t('settingsModels.catalog.empty') }}
      </div>
    </div>
  </Card>
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
