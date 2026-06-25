<template>
  <div class="ghpane">
    <div class="ghhead">
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
          </div>
          <div class="ghr2">
            <span v-if="kind === 'pr' && it.baseRefName" class="mono">
              {{ it.baseRefName }} ← {{ it.headRefName }}
            </span>
            <span v-for="l in it.labels" :key="l.name" class="ghlabel" :style="labelStyle(l.color)">
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
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// Issues / Pull Requests tab — presentational. Filter chips drive the parent's
// useProjectGh controller via emits; rows bind the live gh.list summaries. The
// account/state/assignee dropdowns are themed AppSelects (WKWebView-safe).
import { computed } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import type {
  GhKind,
  GhListState,
  GhThreadState,
  GhThreadSummary,
} from '~/composables/useProjectGh'

const props = defineProps<{
  kind: GhKind
  items: GhThreadSummary[]
  loading: boolean
  errorCode: string | null
  stateFilter: GhListState
  assignee: string
  search: string
  account: string
  accounts: string[]
  knownAssignees: string[]
}>()

const emit = defineEmits<{
  (e: 'open', n: number): void
  (e: 'refresh'): void
  (e: 'set-state', v: GhListState): void
  (e: 'set-assignee', v: string): void
  (e: 'set-account', v: string): void
  (e: 'set-search', v: string): void
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

const accountOptions = computed<AppSelectOption[]>(() => [
  { value: '__active', label: t('projects.gh.accountActive') },
  ...props.accounts.map((a) => ({ value: a, label: a })),
])

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

function labelStyle(color: string): Record<string, string> {
  const c = color ? `#${color}` : 'var(--textDim)'
  return { color: c, borderColor: c }
}

const onState = (v: string) => emit('set-state', v as GhListState)
const onAssignee = (v: string) => emit('set-assignee', v === '__any' ? '' : v)
const onAccount = (v: string) => emit('set-account', v === '__active' ? '' : v)
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
