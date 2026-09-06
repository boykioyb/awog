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

    <SettingsField :name="t('settings.git.ghNotify.name')" :desc="t('settings.git.ghNotify.desc')">
      <SettingsTog v-model="ghNotifyEnabled" />
    </SettingsField>

    <SettingsField
      v-if="ghNotifyEnabled"
      :name="t('settings.git.ghNotifyInterval.name')"
      :desc="t('settings.git.ghNotifyInterval.desc')"
    >
      <SettingsSeg v-model="ghNotifyIntervalMs" :options="notifyIntervalOptions" />
    </SettingsField>

    <!-- Per-project opt-in: the inbox spans every repo, so nothing is surfaced
         until the user names the projects worth interrupting them for. -->
    <SettingsField
      v-if="ghNotifyEnabled"
      block
      :name="t('settings.git.ghNotifyProjects.name')"
      :desc="t('settings.git.ghNotifyProjects.desc')"
    >
      <div v-if="!projectRows.length" class="fd">
        {{ t('settings.git.ghNotifyProjects.none') }}
      </div>
      <div v-else class="ghnp">
        <label v-for="p in projectRows" :key="p.id" class="ghnp-row">
          <input
            type="checkbox"
            :checked="ghNotifyProjectIds.includes(p.id)"
            @change="toggleNotifyProject(p.id)"
          />
          <span class="ghnp-name">{{ p.name }}</span>
          <span v-if="p.slug" class="ghnp-slug mono">{{ p.slug }}</span>
        </label>
      </div>
      <div v-if="ghNotifyEnabled && !ghNotifyProjectIds.length" class="fd" style="margin-top: 6px">
        {{ t('settings.git.ghNotifyProjects.empty') }}
      </div>

      <!-- Diagnostic: polling fails silently by design, so this is the only way
           to see gh auth / project-mapping problems. Channel + toast placement
           live in Settings → Notifications. -->
      <div class="ghnp-check">
        <button class="btn sm" type="button" :disabled="checking" @click="onCheckNotifications">
          <Icon name="scan" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{
            checking
              ? t('settings.git.ghNotifyCheck.running')
              : t('settings.git.ghNotifyCheck.action')
          }}
        </button>
        <span v-if="checkText" class="fd">{{ checkText }}</span>
      </div>
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
import { githubSlugFromRemote } from '~/components/project/data'
import { checkGhNotifications, type GhNotifyCheck } from '~/composables/useGhNotifications'
import type { GhAccount } from '~/composables/useProjectGh'
import { useProjectsStore } from '~/stores/projects'
import type { AutoCommitScope, DirtyTaskPolicy } from '~/stores/settings'

const { t } = useI18n()
const settings = useSettingsStore()
const { git, githubAccount, githubNotify } = storeToRefs(settings)
const projectsStore = useProjectsStore()
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

// ── GitHub notifications (docs/features/github-notifications.md) ─────────────
// 60s is GitHub's documented minimum poll interval for the notifications API —
// the poller floors at it regardless of what is stored here.
const notifyIntervalOptions = [
  { label: '1', value: '60000' },
  { label: '2', value: '120000' },
  { label: '5', value: '300000' },
  { label: '10', value: '600000' },
] as const

const ghNotifyEnabled = computed<boolean>({
  get: () => githubNotify.value.enabled,
  set: (enabled) => (githubNotify.value.enabled = enabled),
})
const ghNotifyIntervalMs = computed<string>({
  get: () => String(githubNotify.value.intervalMs),
  set: (value) => (githubNotify.value.intervalMs = Number(value)),
})
const ghNotifyProjectIds = computed<string[]>(() => githubNotify.value.projectIds)

// Every project is listed (a multi-repo container has no remote of its own, yet
// still holds GitHub repos); the slug is shown when it can be derived, as a hint
// of what the row will actually watch.
const projectRows = computed(() =>
  [...projectsStore.projects]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, name: p.name, slug: githubSlugFromRemote(p.gitRemote) })),
)

// Connection check — the poller swallows its errors on purpose (a toast every
// minute for "gh not authed" would be worse than the missing feature), so this
// is where those problems become visible. It fetches once and reports; it does
// NOT toast (toast look/placement belongs to Appearance).
const checking = ref(false)
const checkResult = ref<GhNotifyCheck | null>(null)
const checkText = computed<string>(() => {
  const r = checkResult.value
  if (!r) return ''
  if (r.status === 'no-projects') return t('settings.git.ghNotifyCheck.noProjects')
  if (r.status === 'offline') return t('settings.git.ghNotifyCheck.offline')
  if (r.status === 'error') return t('settings.git.ghNotifyCheck.error', { message: r.message })
  return t('settings.git.ghNotifyCheck.ok', { matched: r.matched, total: r.total })
})
async function onCheckNotifications(): Promise<void> {
  if (checking.value) return
  checking.value = true
  try {
    checkResult.value = await checkGhNotifications()
  } finally {
    checking.value = false
  }
}

function toggleNotifyProject(id: string): void {
  const current = githubNotify.value.projectIds
  githubNotify.value.projectIds = current.includes(id)
    ? current.filter((x) => x !== id)
    : [...current, id]
}
</script>

<style scoped>
/* Connection check row under the project list. */
.ghnp-check {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  flex-wrap: wrap;
}

/* Per-project opt-in list. Scrolls once it outgrows the field so the panel keeps
   its rhythm with many projects. */
.ghnp {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 6px;
}
.ghnp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: var(--r-xs);
  cursor: pointer;
}
.ghnp-row:hover {
  background: var(--bgHover);
}
.ghnp-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ghnp-slug {
  color: var(--textDim);
  font-size: 12px;
  line-height: 18px;
}
</style>
