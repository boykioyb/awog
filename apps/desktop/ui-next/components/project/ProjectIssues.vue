<template>
  <div class="ghpane">
    <div class="ghhead">
      <AppSelect
        v-if="repos.length > 1"
        :model-value="repoPath"
        :options="repoOptions"
        width="auto"
        @update:model-value="(v) => emit('set-repo', v)"
      />
      <AppSelect
        :model-value="account || '__active'"
        :options="accountOptions"
        width="170px"
        @update:model-value="onAccount"
      />
      <AppSelect
        :model-value="stateFilter"
        :options="stateOptions"
        width="120px"
        @update:model-value="onState"
      />
      <AppSelect
        :model-value="assignee || '__any'"
        :options="assigneeOptions"
        width="150px"
        @update:model-value="onAssignee"
      />
      <div class="srch" style="flex: 1; min-width: 120px; max-width: 220px">
        <Icon name="search" style="width: 13px; height: 13px" />
        <input :value="search" :placeholder="t('projects.gh.search')" @input="onSearch" />
      </div>
      <button
        class="iconbtn"
        :title="t('projects.gh.refresh')"
        style="width: 30px; height: 30px"
        :disabled="loading"
        @click="emit('refresh')"
      >
        <Icon name="refresh" style="width: 14px; height: 14px" />
      </button>
    </div>

    <div class="ghlist">
      <div v-if="loading && !items.length" class="fd" style="padding: 28px; text-align: center">
        {{ t('projects.gh.loading') }}
      </div>
      <template v-else>
        <div v-for="it in items" :key="it.number" class="ghrow" @click="emit('open', it.number)">
          <div class="ghr1">
            <Icon :name="kind === 'pr' ? 'fork' : 'alert'" style="width: 13px; height: 13px" />
            <span class="ghnum">#{{ it.number }}</span>
            <span class="ghtitle">{{ it.title }}</span>
            <span
              class="ghstate"
              :style="{ color: stateColor(it.state), borderColor: stateColor(it.state) }"
            >
              {{ t('projects.gh.state.' + it.state.toLowerCase()) }}
            </span>
            <span
              v-if="kind === 'pr' && it.isDraft"
              class="ghstate"
              style="color: var(--textDim); border-color: var(--border)"
            >
              {{ t('projects.gh.state.draft') }}
            </span>
            <button
              class="iconbtn ghnewses"
              style="width: 26px; height: 26px; flex: 0 0 auto"
              :title="t('projects.gh.newSession')"
              :aria-label="t('projects.gh.newSession')"
              @click.stop="emit('new-session', it)"
            >
              <Icon name="sessions" style="width: 14px; height: 14px" />
            </button>
          </div>
          <div class="ghr2">
            <span v-if="kind === 'pr' && it.baseRefName" class="mono">
              {{ it.baseRefName }} ← {{ it.headRefName }}
            </span>
            <span
              v-for="l in it.labels"
              :key="l.name"
              class="ghlabel"
              :style="ghLabelStyle(l.color, isDark)"
            >
              {{ l.name }}
            </span>
            <span style="margin-left: auto; font-family: var(--code)">
              {{ it.author.login }} · {{ relativeWhen(it.createdAt) }}
            </span>
          </div>
        </div>
        <div v-if="!items.length" class="empty" style="padding: 36px">
          <span class="ei"><Icon name="git" style="width: 20px; height: 20px" /></span>
          <div class="et">{{ emptyText }}</div>

          <!-- gh CLI not installed → install button + per-OS hint -->
          <div v-if="errorCode === 'GH_NOT_FOUND'" class="ghcta">
            <button class="btn pri sm" @click="emit('install-gh')">
              <Icon name="globe" style="width: 13px; height: 13px" />
              {{ t('projects.gh.installBtn') }}
            </button>
            <code class="ghcmd">{{ installHint }}</code>
          </div>

          <!-- gh installed but not authenticated → copy login command + open guide -->
          <div v-else-if="errorCode === 'GH_NOT_AUTH'" class="ghcta">
            <button class="btn sm" @click="copyLoginCmd">
              <Icon name="copy" style="width: 13px; height: 13px" />
              {{ copied ? t('projects.gh.copied') : t('projects.gh.copyLoginCmd') }}
            </button>
            <button class="btn sm" @click="emit('login-help')">
              <Icon name="help" style="width: 13px; height: 13px" />
              {{ t('projects.gh.loginGuide') }}
            </button>
          </div>
        </div>
        <button v-if="canLoadMore" class="ghmore" :disabled="loading" @click="emit('load-more')">
          {{ loading ? t('projects.gh.loading') : t('projects.gh.loadMore') }}
        </button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// Issues / Pull Requests tab — presentational. Filter chips drive the parent's
// useProjectGh controller via emits; rows bind the live gh.list summaries. The
// account/state/assignee dropdowns are themed AppSelects (WKWebView-safe).
import { computed, ref } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import type { ProjectRepo } from '~/composables/useProjectRepos'
import type {
  GhKind,
  GhListState,
  GhThreadState,
  GhThreadSummary,
} from '~/composables/useProjectGh'
import { ghLabelStyle } from '~/utils/gh-label'

const { isDark } = useTheme()

const props = defineProps<{
  kind: GhKind
  items: GhThreadSummary[]
  loading: boolean
  errorCode: string | null
  stateFilter: GhListState
  assignee: string
  search: string
  account: string
  // App-level default account login ('' = active gh account) the per-project
  // picker inherits — used to label the "inherit" row.
  globalAccount: string
  accounts: string[]
  knownAssignees: string[]
  // GitHub child repos of the project + the selected one (multi-repo workspace).
  repos: ProjectRepo[]
  repoPath: string
  // The plain list came back full → there may be more rows to load.
  canLoadMore: boolean
}>()

const emit = defineEmits<{
  (e: 'open', n: number): void
  (e: 'refresh'): void
  (e: 'set-state', v: GhListState): void
  (e: 'set-assignee', v: string): void
  (e: 'set-account', v: string): void
  (e: 'set-search', v: string): void
  (e: 'set-repo', v: string): void
  (e: 'load-more'): void
  (e: 'new-session', item: GhThreadSummary): void
  (e: 'install-gh'): void
  (e: 'login-help'): void
}>()

const { t } = useI18n()

const STATES: GhListState[] = ['open', 'closed', 'merged', 'all']
const stateOptions = computed<AppSelectOption[]>(() =>
  STATES.filter((s) => props.kind === 'pr' || s !== 'merged').map((s) => ({
    value: s,
    label: t('projects.gh.state.' + s),
  })),
)

const assigneeOptions = computed<AppSelectOption[]>(() => [
  { value: '__any', label: t('projects.gh.assigneeAnyone') },
  { value: '@me', label: t('projects.gh.assigneeMe') },
  ...props.knownAssignees.map((a) => ({ value: a, label: a })),
])

// First row inherits the app-level default (Settings → Git). Its label shows what
// that resolves to so picking "inherit" is informative. Below it: the explicit
// choices (active gh account + each known login) which override per project.
const accountOptions = computed<AppSelectOption[]>(() => {
  const g = props.globalAccount.trim()
  const inheritLabel = t('projects.gh.accountInherit', {
    account: g || t('projects.gh.accountActive'),
  })
  return [
    { value: '__inherit', label: inheritLabel },
    { value: '__active', label: t('projects.gh.accountActive') },
    ...props.accounts.map((a) => ({ value: a, label: a })),
  ]
})

// Repo picker (multi-repo workspace): value = relativePath, label = the repo
// folder name (the owner is the same across a workspace, so the short name is
// clearer + compact; the menu auto-fits so it never scrolls).
const repoOptions = computed<AppSelectOption[]>(() =>
  props.repos.map((r) => ({
    value: r.relativePath,
    label: r.relativePath === '.' ? r.name : r.relativePath,
  })),
)

const emptyText = computed(() => {
  if (props.errorCode === 'GH_NOT_AUTH') return t('projects.gh.errAuth')
  if (props.errorCode === 'GH_NO_REPO') return t('projects.gh.errNoRepo')
  if (props.errorCode && props.errorCode !== 'UNKNOWN' && props.errorCode !== 'GH_NOT_FOUND')
    return t('projects.gh.errGeneric')
  if (props.errorCode === 'GH_NOT_FOUND') return t('projects.gh.errNoGh')
  const key = props.kind === 'pr' ? 'projects.gh.emptyPr' : 'projects.gh.emptyIssue'
  return t(key, { state: props.stateFilter })
})

function stateColor(s: GhThreadState): string {
  return s === 'OPEN' ? 'var(--green)' : s === 'MERGED' ? 'var(--violet)' : 'var(--textDim)'
}

const onState = (v: string) => emit('set-state', v as GhListState)
const onAssignee = (v: string) => emit('set-assignee', v === '__any' ? '' : v)
// '__active' → '' (active gh account); '__inherit' passes through as the override.
const onAccount = (v: string) => emit('set-account', v === '__active' ? '' : v)

// gh CLI install hint + copyable login command for the not-installed / not-authed
// empty states. The brew/winget commands are literal shell commands (not prose).
const LOGIN_CMD = 'gh auth login'
const copied = ref(false)
function copyLoginCmd(): void {
  navigator.clipboard
    ?.writeText(LOGIN_CMD)
    .then(() => {
      copied.value = true
      setTimeout(() => (copied.value = false), 1500)
    })
    .catch(() => {})
}
const installHint = computed<string>(() => {
  const p = (navigator.platform || '').toLowerCase()
  if (p.includes('mac')) return 'brew install gh'
  if (p.includes('win')) return 'winget install GitHub.cli'
  return 'cli.github.com'
})
const onSearch = (e: Event) => emit('set-search', (e.target as HTMLInputElement).value)

// Short relative time for an ISO timestamp: <1h Nm, <24h Nh, <7d Nd, else date.
function relativeWhen(iso: string): string {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(ms).toLocaleDateString()
}
</script>

<style scoped>
.ghmore {
  width: 100%;
  margin-top: 4px;
  padding: 9px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: transparent;
  color: var(--textDim);
  font-size: 1em;
  cursor: pointer;
}
.ghmore:hover:not(:disabled) {
  border-color: var(--borderStrong);
  color: var(--text);
  background: var(--bgHover);
}
.ghmore:disabled {
  opacity: 0.5;
  cursor: default;
}
.ghcta {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.ghcmd {
  padding: 5px 9px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bgInput);
  color: var(--textDim);
  font-family: var(--mono);
  font-size: 12px;
}
</style>
