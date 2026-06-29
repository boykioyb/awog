<template>
  <div>
    <SettingsPaneHeader :title="t('settings.git.heading')" />

    <SettingsField
      :name="t('settings.git.ghAccount.name')"
      :desc="t('settings.git.ghAccount.desc')"
    >
      <AppSelect
        :model-value="githubAccount || '__active'"
        :options="ghAccountOptions"
        width="200px"
        @update:model-value="onGithubAccount"
      />
    </SettingsField>

    <SettingsField
      :name="t('settings.git.autoCommit.name')"
      :desc="t('settings.git.autoCommit.desc')"
    >
      <SettingsTog v-model="autoCommitPerPhase" />
    </SettingsField>

    <SettingsField :name="t('settings.git.coAuthor.name')" :desc="t('settings.git.coAuthor.desc')">
      <SettingsTog v-model="commitCoAuthor" />
    </SettingsField>

    <SettingsField
      block
      :name="t('settings.git.template.name')"
      :desc="t('settings.git.template.desc')"
    >
      <input
        v-model="autoCommitMessageTemplate"
        class="keyinp mono"
        :placeholder="t('settings.git.template.placeholder')"
      />
      <div class="fd" style="margin-top: 2px">{{ t('settings.git.template.tokens') }}</div>
    </SettingsField>

    <SettingsField :name="t('settings.git.scope.name')" :desc="t('settings.git.scope.desc')">
      <SettingsSeg v-model="autoCommitScope" :options="scopeOptions" />
    </SettingsField>

    <SettingsField
      :name="t('settings.git.autoStash.name')"
      :desc="t('settings.git.autoStash.desc')"
    >
      <SettingsTog v-model="autoStashDirtyBeforeTask" />
    </SettingsField>

    <SettingsField
      :name="t('settings.git.dirtyPolicy.name')"
      :desc="t('settings.git.dirtyPolicy.desc')"
    >
      <SettingsSeg v-model="dirtyTaskPolicy" :options="dirtyPolicyOptions" />
    </SettingsField>

    <SettingsField
      :name="t('settings.git.autoFetch.name')"
      :desc="t('settings.git.autoFetch.desc')"
    >
      <SettingsTog v-model="autoFetchEnabled" />
    </SettingsField>

    <SettingsField
      v-if="autoFetchEnabled"
      :name="t('settings.git.fetchInterval.name')"
      :desc="t('settings.git.fetchInterval.desc')"
    >
      <SettingsSeg v-model="autoFetchIntervalMs" :options="fetchIntervalOptions" />
    </SettingsField>

    <SettingsField
      block
      :name="t('settings.git.commitRule.name')"
      :desc="t('settings.git.commitRule.desc')"
    >
      <textarea
        v-model="commitMessageRule"
        class="keyinp mono"
        rows="12"
        style="resize: vertical; min-height: 16rem"
      />
      <div style="margin-top: 6px; display: flex; justify-content: flex-end">
        <button class="btn sm" type="button" @click="resetCommitRule">
          {{ t('settings.git.commitRule.reset') }}
        </button>
      </div>
    </SettingsField>
  </div>
</template>

<script setup lang="ts">
// Git panel — ports setSecHtml('git'), extended to functional parity with the
// legacy SettingsGitSection. Wired to the settings store's `git` slice. Seg/tog/
// textarea controls write through `updateGit` / `resetGitCommitRule` via computed
// get/set proxies, so store state is only ever mutated inside the store actions.
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import type { GhAccount } from '~/composables/useProjectGh'
import type { AutoCommitScope, DirtyTaskPolicy } from '~/stores/settings'

const { t } = useI18n()
const settings = useSettingsStore()
const { git, githubAccount } = storeToRefs(settings)
const sc = useSidecar()

// App-level default GitHub (gh CLI) account. '__active' (empty stored value) =
// follow gh's active account. Per-project Issue/PR pickers inherit this default.
const ghLogins = ref<string[]>([])
onMounted(async () => {
  if (!sc.available) return
  try {
    const res = await sc.request<{ accounts: GhAccount[] }>('gh.accounts', {})
    ghLogins.value = res.accounts.map((a) => a.login)
  } catch {
    ghLogins.value = []
  }
})
const ghAccountOptions = computed<AppSelectOption[]>(() => [
  { value: '__active', label: t('settings.git.ghAccount.active') },
  ...ghLogins.value.map((a) => ({ value: a, label: a })),
])
const onGithubAccount = (v: string) => settings.setGithubAccount(v === '__active' ? '' : v)

// Default interval used when auto-fetch is toggled back on (5 minutes).
const DEFAULT_FETCH_INTERVAL_MS = 300_000

const scopeOptions = computed(() => [
  { label: t('settings.git.scope.workspace'), value: 'workspace' },
  { label: t('settings.git.scope.artifacts'), value: 'artifacts-only' },
])
const dirtyPolicyOptions = computed(() => [
  { label: t('settings.git.dirtyPolicy.warn'), value: 'warn' },
  { label: t('settings.git.dirtyPolicy.autoStash'), value: 'auto-stash' },
])
const fetchIntervalOptions = [
  { label: '3', value: '180000' },
  { label: '5', value: '300000' },
  { label: '10', value: '600000' },
  { label: '15', value: '900000' },
] as const

const autoCommitPerPhase = computed<boolean>({
  get: () => git.value.autoCommitPerPhase,
  set: (autoCommitPerPhase) => settings.updateGit({ autoCommitPerPhase }),
})
const commitCoAuthor = computed<boolean>({
  get: () => git.value.commitCoAuthor,
  set: (commitCoAuthor) => settings.updateGit({ commitCoAuthor }),
})
const autoCommitMessageTemplate = computed<string>({
  get: () => git.value.autoCommitMessageTemplate,
  set: (autoCommitMessageTemplate) => settings.updateGit({ autoCommitMessageTemplate }),
})
const autoCommitScope = computed<string>({
  get: () => git.value.autoCommitScope,
  set: (value) => settings.updateGit({ autoCommitScope: value as AutoCommitScope }),
})
const autoStashDirtyBeforeTask = computed<boolean>({
  get: () => git.value.autoStashDirtyBeforeTask,
  set: (autoStashDirtyBeforeTask) => settings.updateGit({ autoStashDirtyBeforeTask }),
})
const dirtyTaskPolicy = computed<string>({
  get: () => git.value.dirtyTaskPolicy,
  set: (value) => settings.updateGit({ dirtyTaskPolicy: value as DirtyTaskPolicy }),
})

// Toggle on/off maps to a positive interval (default 5 min) vs 0 (disabled).
const autoFetchEnabled = computed<boolean>({
  get: () => git.value.autoFetchIntervalMs > 0,
  set: (on) => settings.updateGit({ autoFetchIntervalMs: on ? DEFAULT_FETCH_INTERVAL_MS : 0 }),
})
// Seg stores the interval as a string; the store keeps it as a number of ms.
const autoFetchIntervalMs = computed<string>({
  get: () => String(git.value.autoFetchIntervalMs),
  set: (value) => settings.updateGit({ autoFetchIntervalMs: Number(value) }),
})

const commitMessageRule = computed<string>({
  get: () => git.value.commitMessageRule,
  set: (commitMessageRule) => settings.updateGit({ commitMessageRule }),
})
const resetCommitRule = () => settings.resetGitCommitRule()
</script>
