<template>
  <SettingsField
    :name="t('settings.git.prReviewLlm.name')"
    :desc="t('settings.git.prReviewLlm.desc')"
  >
    <SettingsTog v-model="custom" />
  </SettingsField>

  <SettingsField
    v-if="custom"
    block
    :name="t('settings.git.prReviewLlm.pick')"
    :desc="t('settings.git.prReviewLlm.pickDesc')"
  >
    <div class="prl">
      <div class="prl-row">
        <span class="prl-label">{{ t('settings.git.prReviewLlm.provider') }}</span>
        <SettingsSeg v-model="provider" :options="PROVIDER_OPTIONS" />
      </div>
      <div class="prl-row">
        <span class="prl-label">{{ t('settings.git.prReviewLlm.account') }}</span>
        <AppSelect v-model="accountId" :options="accountOptions" width="240px" />
      </div>
      <div class="prl-row">
        <span class="prl-label">{{ t('settings.git.prReviewLlm.model') }}</span>
        <AppSelect v-model="modelId" :options="modelOptions" width="240px" />
      </div>
      <div class="prl-row">
        <span class="prl-label">{{ t('settings.git.prReviewLlm.effort') }}</span>
        <SettingsSeg v-model="level" :options="levelOptions" />
      </div>
      <div v-if="accountInherits" class="fd">
        {{ t('settings.git.prReviewLlm.accountSessionHint') }}
      </div>
    </div>
  </SettingsField>
</template>

<script setup lang="ts">
// Settings → Git: the account / model / effort the PR detail's "Start review"
// session runs on. Off (the default) = that session inherits what any new session
// in the project would get; on = these pickers win, applied right after create()
// via sessions.applyLlmConfig.
//
// Same provider→account→model reconciliation as the per-project LLM defaults
// (useProjectLlmDefaults), kept local because this config has no project and no
// MCP whitelist — a review reads a diff, it doesn't need a different tool surface.
import { computed } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import { THINKING_LEVELS, type ThinkingLevel } from '~/composables/useSessionsData'
import { providerModelDisplayName, providerModelIds } from '~/composables/useProviderModels'
import { PR_REVIEW_ACCOUNT_INHERIT, type PrReviewLlm } from '~/stores/settings'
import type { ProviderName } from '~/types'

const { t } = useI18n()
const settings = useSettingsStore()
const { git } = storeToRefs(settings)

const PROVIDER_OPTIONS = [
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Google', value: 'google' },
] as const

const cfg = computed<PrReviewLlm | undefined>(() => git.value.prReviewLlm)

// Turning the override on seeds it from the app defaults, so the pickers open on
// something valid instead of empty.
const seed = (): PrReviewLlm => ({
  provider: settings.defaults.provider,
  modelId: settings.defaults.modelId,
  level: settings.defaults.thinkingLevel,
})
const patch = (p: Partial<PrReviewLlm>): void => {
  settings.updateGit({ prReviewLlm: { ...(cfg.value ?? seed()), ...p } })
}

const custom = computed<boolean>({
  get: () => !!cfg.value,
  set: (on) => settings.updateGit({ prReviewLlm: on ? seed() : undefined }),
})

const currentProvider = computed<ProviderName>(
  () => cfg.value?.provider ?? settings.defaults.provider,
)

// Account follows the session → the provider seg only picks WHICH catalog the
// model comes from, and the model lands only if the session's own account serves
// it (see sessions.applyLlmConfig).
const accountInherits = computed(() => cfg.value?.accountId === PR_REVIEW_ACCOUNT_INHERIT)

// Models the CUSTOM endpoint serves (its own curated list) else the shared
// provider catalog — mirrors useProjectLlmDefaults.availableModelIds.
const availableModelIds = computed<string[]>(() => {
  const conf = settings.providers[currentProvider.value]
  const id = cfg.value?.accountId ?? conf?.activeAccountId ?? null
  const acct = conf?.accounts.find((a) => a.id === id)
  if (acct?.baseURL && acct.models?.length) return acct.models
  return providerModelIds(currentProvider.value)
})

// Keep the model valid whenever provider/account moves: an id the picked account
// doesn't serve would leave the select blank (and the session on a stale model).
const validModelId = (want: string, ids: string[]): string =>
  ids.includes(want) ? want : (ids[0] ?? want)

const provider = computed<string>({
  get: () => currentProvider.value,
  set: (v) => {
    const next = v as ProviderName
    if (next === currentProvider.value) return
    const ids = providerModelIds(next)
    patch({
      provider: next,
      // Only a PINNED account belongs to one provider and has to be dropped;
      // "follow the session" survives a provider change.
      accountId: accountInherits.value ? PR_REVIEW_ACCOUNT_INHERIT : undefined,
      modelId: validModelId(cfg.value?.modelId ?? settings.defaults.modelId, ids),
    })
  },
})

const accountId = computed<string>({
  get: () => cfg.value?.accountId ?? '__active',
  set: (v) => {
    const id = v === '__active' ? undefined : v
    const conf = settings.providers[currentProvider.value]
    const acct = conf?.accounts.find((a) => a.id === (id ?? conf.activeAccountId))
    const ids =
      acct?.baseURL && acct.models?.length ? acct.models : providerModelIds(currentProvider.value)
    patch({
      accountId: id,
      modelId: validModelId(cfg.value?.modelId ?? settings.defaults.modelId, ids),
    })
  },
})

const modelId = computed<string>({
  get: () => cfg.value?.modelId ?? settings.defaults.modelId,
  set: (modelId) => patch({ modelId }),
})

const level = computed<string>({
  get: () => cfg.value?.level ?? settings.defaults.thinkingLevel,
  set: (v) => patch({ level: v as ThinkingLevel }),
})

const accountOptions = computed<AppSelectOption[]>(() => [
  { value: PR_REVIEW_ACCOUNT_INHERIT, label: t('settings.git.prReviewLlm.accountSession') },
  { value: '__active', label: t('settings.git.prReviewLlm.accountActive') },
  ...(settings.providers[currentProvider.value]?.accounts ?? []).map((a) => ({
    value: a.id,
    label: a.label || a.fingerprint,
  })),
])

const modelOptions = computed<AppSelectOption[]>(() =>
  availableModelIds.value.map((id) => ({ value: id, label: providerModelDisplayName(id) })),
)

const levelOptions = computed(() =>
  THINKING_LEVELS.map((lv) => ({ label: t('common.thinking.' + lv), value: lv })),
)
</script>

<style scoped>
.prl {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.prl-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.prl-label {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
</style>
