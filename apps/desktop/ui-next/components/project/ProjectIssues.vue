<template>
  <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
    <div class="flex flex-none flex-wrap items-center gap-2 border-b px-3.5 py-2.5">
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
      <!-- Reviewer is PR-only (issues have no review requests). -->
      <AppSelect
        v-if="kind === 'pr'"
        :model-value="reviewer || '__any'"
        :options="reviewerOptions"
        width="150px"
        @update:model-value="onReviewer"
      />
      <div class="relative max-w-55 min-w-30 flex-1">
        <Icon
          name="search"
          class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          class="h-ctrl-sm pl-8"
          :model-value="search"
          :placeholder="t('projects.gh.search')"
          @update:model-value="onSearch"
        />
      </div>
      <Button
        :title="t('projects.gh.refresh')"
        :aria-label="t('projects.gh.refresh')"
        :disabled="loading"
        variant="outline"
        size="iconMd"
        @click="emit('refresh')"
      >
        <!-- gh.list đang chạy → xoay icon refresh. -->
        <Icon
          name="refresh"
          class="size-3.5"
          :class="{ 'animate-spin motion-reduce:animate-none': loading || revalidating }"
        />
      </Button>
    </div>

    <!-- Re-fetch over an already-loaded list: dim the rows (the spinning button
         carries the "working" signal) instead of swapping them for a skeleton.
         Vẫn tương tác được: pointer-events-none sẽ giết luôn cuộn (đây là vùng cuộn). -->
    <div
      class="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-3 transition-opacity duration-150 motion-reduce:transition-none"
      :class="{ 'opacity-50': loading && items.length > 0 }"
    >
      <ProjectGhListSkeleton v-if="loading && !items.length" />
      <template v-else>
        <!-- Mỗi hàng là một card nổi (nền card + viền + bo góc); hover chỉ đậm viền.
             Hàng mới mount thì fade + trượt lên, so le theo index (animation-delay inline).
             Nút "phiên mới" chỉ hiện khi hover hàng / focus bàn phím. -->
        <div
          v-for="(it, i) in items"
          :key="it.number"
          class="group/row cursor-pointer rounded-lg border bg-card px-3 py-2.5 animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-200 ease-out hover:border-input motion-reduce:animate-none"
          :style="{ animationDelay: rowDelay(i) }"
          @click="emit('open', it.number)"
          @mouseenter="onRowHover(it.number)"
          @mouseleave="cancelRowHover"
        >
          <div class="flex items-center gap-2 text-base">
            <Icon :name="kind === 'pr' ? 'fork' : 'alert'" class="size-3.5 flex-none text-dim" />
            <span class="flex-none text-xs text-dim tabular-nums">#{{ it.number }}</span>
            <span class="min-w-0 flex-1 truncate font-medium">{{ it.title }}</span>
            <Badge variant="outline" :class="[STATE_CHIP, stateClass(it.state)]">
              {{ t('projects.gh.state.' + it.state.toLowerCase()) }}
            </Badge>
            <Badge
              v-if="kind === 'pr' && it.isDraft"
              variant="outline"
              :class="[STATE_CHIP, 'border-border text-dim']"
            >
              {{ t('projects.gh.state.draft') }}
            </Badge>
            <Button
              :title="t('projects.gh.newSession')"
              :aria-label="t('projects.gh.newSession')"
              class="size-6.5 flex-none opacity-0 transition-opacity group-hover/row:opacity-100 hover:border-selected-border hover:text-primary focus-visible:opacity-100"
              variant="outline"
              size="iconSm"
              @click.stop="emit('new-session', it)"
            >
              <Icon name="sessions" class="size-3.5" />
            </Button>
          </div>
          <div class="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <!-- mono-ok: tên nhánh git -->
            <span v-if="kind === 'pr' && it.baseRefName" class="font-mono">
              {{ it.baseRefName }} ← {{ it.headRefName }}
            </span>
            <!-- Who is on the review: pending requests first, then verdicts. -->
            <Badge
              v-for="r in it.reviewers"
              :key="r.login"
              variant="outline"
              :class="['rounded-sm px-1.5 py-0', reviewerMeta(r.state).cls]"
              :title="t('projects.gh.reviewState.' + reviewerMeta(r.state).key, { login: r.login })"
            >
              <Icon :name="reviewerMeta(r.state).icon" class="size-3" />
              {{ r.login }}
            </Badge>
            <!-- Màu nhãn là dữ liệu GitHub (hex của label), không phải token theme. -->
            <span
              v-for="l in it.labels"
              :key="l.name"
              class="rounded-sm border px-1.5 text-xs"
              :style="ghLabelStyle(l.color, isDark)"
            >
              {{ l.name }}
            </span>
            <span class="ml-auto tabular-nums">
              {{ it.author.login }} · {{ relativeWhen(it.createdAt) }}
            </span>
          </div>
        </div>
        <div
          v-if="!items.length"
          class="flex flex-col items-center justify-center gap-3.5 p-9 text-center text-dim"
        >
          <span class="grid size-12 place-items-center rounded-xl border bg-card text-dim">
            <Icon name="git" class="size-5" />
          </span>
          <div class="text-lg text-muted-foreground">{{ emptyText }}</div>

          <!-- gh CLI not installed → install button + per-OS hint -->
          <div
            v-if="errorCode === 'GH_NOT_FOUND'"
            class="mt-3.5 flex flex-wrap items-center justify-center gap-2"
          >
            <Button variant="default" size="sm" @click="emit('install-gh')">
              <Icon name="globe" class="size-3.5" />
              {{ t('projects.gh.installBtn') }}
            </Button>
            <!-- mono-ok: lệnh shell cài gh -->
            <code class="rounded-sm border bg-muted px-2 py-1 font-mono text-sm text-dim">
              {{ installHint }}
            </code>
          </div>

          <!-- gh installed but not authenticated → copy login command + open guide -->
          <div
            v-else-if="errorCode === 'GH_NOT_AUTH'"
            class="mt-3.5 flex flex-wrap items-center justify-center gap-2"
          >
            <Button variant="outline" size="sm" @click="copyLoginCmd">
              <Icon name="copy" class="size-3.5" />
              {{ copied ? t('projects.gh.copied') : t('projects.gh.copyLoginCmd') }}
            </Button>
            <Button variant="outline" size="sm" @click="emit('login-help')">
              <Icon name="help" class="size-3.5" />
              {{ t('projects.gh.loginGuide') }}
            </Button>
          </div>
        </div>
        <Button
          v-if="canLoadMore"
          variant="outline"
          class="mt-1 w-full font-normal text-dim"
          :disabled="loading"
          @click="emit('load-more')"
        >
          {{ loading ? t('projects.gh.loading') : t('projects.gh.loadMore') }}
        </Button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// Issues / Pull Requests tab — presentational. Filter chips drive the parent's
// useProjectGh controller via emits; rows bind the live gh.list summaries. The
// account/state/assignee/reviewer dropdowns are themed AppSelects (WKWebView-safe);
// reviewer only renders for pull requests.
import { computed, onBeforeUnmount, ref } from 'vue'
import AppSelect, { type AppSelectOption } from '~/components/common/AppSelect.vue'
import ProjectGhListSkeleton from '~/components/project/ProjectGhListSkeleton.vue'
import type { ProjectRepo } from '~/composables/useProjectRepos'
import type {
  GhKind,
  GhListState,
  GhReviewerState,
  GhThreadState,
  GhThreadSummary,
} from '~/composables/useProjectGh'
import { ghLabelStyle } from '~/utils/gh-label'
import Badge from '~/components/ui/badge/Badge.vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

// Chỉ đọc chế độ sáng/tối để chọn cách vẽ nhãn GitHub (màu nhãn là dữ liệu từ
// GitHub, ghLabelStyle cần biết nền sáng hay tối) — không dùng để tô token theme.
// theme-ok: isDark chọn cách vẽ nhãn GitHub (màu nhãn là dữ liệu)
const { isDark } = useTheme()

const props = defineProps<{
  kind: GhKind
  items: GhThreadSummary[]
  loading: boolean
  // A silent re-fetch behind already-painted rows — spins the refresh glyph only
  // (no skeleton, no dim: the rows on screen stay readable).
  revalidating: boolean
  errorCode: string | null
  stateFilter: GhListState
  assignee: string
  // PR-only requested-reviewer filter ('' = any reviewer).
  reviewer: string
  search: string
  account: string
  // App-level default account login ('' = active gh account) the per-project
  // picker inherits — used to label the "inherit" row.
  globalAccount: string
  accounts: string[]
  knownAssignees: string[]
  knownReviewers: string[]
  // GitHub child repos of the project + the selected one (multi-repo workspace).
  repos: ProjectRepo[]
  repoPath: string
  // The plain list came back full → there may be more rows to load.
  canLoadMore: boolean
}>()

const emit = defineEmits<{
  (e: 'open', n: number): void
  (e: 'prefetch', n: number): void
  (e: 'refresh'): void
  (e: 'set-state', v: GhListState): void
  (e: 'set-assignee', v: string): void
  (e: 'set-reviewer', v: string): void
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

// Known logins seen on the loaded rows + the active filter — which the narrowing
// it caused may have removed from that list, so the trigger never renders blank.
function loginOptions(known: string[], active: string): AppSelectOption[] {
  const set = new Set(known)
  if (active && active !== '@me') set.add(active)
  return [...set].sort((a, b) => a.localeCompare(b)).map((l) => ({ value: l, label: l }))
}

const assigneeOptions = computed<AppSelectOption[]>(() => [
  { value: '__any', label: t('projects.gh.assigneeAnyone') },
  { value: '@me', label: t('projects.gh.assigneeMe') },
  ...loginOptions(props.knownAssignees, props.assignee),
])

// Requested-reviewer picker (PR-only) — mirrors the assignee one; "any reviewer"
// labels the empty state so the two dropdowns stay distinguishable at a glance.
const reviewerOptions = computed<AppSelectOption[]>(() => [
  { value: '__any', label: t('projects.gh.reviewerAny') },
  { value: '@me', label: t('projects.gh.assigneeMe') },
  ...loginOptions(props.knownReviewers, props.reviewer),
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

// Per review-state chip look: icon + class màu + i18n key. Pending/commented/dismissed
// stay quiet (dim text, neutral border) so approved / changes-requested — the two
// states that need action — are the ones that read at a glance.
const QUIET = 'border-border text-dim'
const REVIEWER_META: Record<GhReviewerState, { icon: string; cls: string; key: string }> = {
  PENDING: { icon: 'clock', cls: QUIET, key: 'pending' },
  APPROVED: { icon: 'check', cls: 'border-success text-success', key: 'approved' },
  CHANGES_REQUESTED: {
    icon: 'x',
    cls: 'border-destructive text-destructive',
    key: 'changesRequested',
  },
  COMMENTED: { icon: 'message', cls: QUIET, key: 'commented' },
  DISMISSED: { icon: 'minus', cls: QUIET, key: 'dismissed' },
}
const reviewerMeta = (s: GhReviewerState) => REVIEWER_META[s]

// Chip trạng thái thread: chữ + viền cùng một màu.
const STATE_CHIP = 'flex-none rounded-sm px-1.5 py-0 capitalize'
function stateClass(s: GhThreadState): string {
  if (s === 'OPEN') return 'border-success text-success'
  return s === 'MERGED' ? 'border-lavender text-lavender' : 'border-dim text-dim'
}

const onState = (v: string) => emit('set-state', v as GhListState)
const onAssignee = (v: string) => emit('set-assignee', v === '__any' ? '' : v)
const onReviewer = (v: string) => emit('set-reviewer', v === '__any' ? '' : v)
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
const onSearch = (v: string) => emit('set-search', v)

// Hover intent → warm the row's detail so the click after it opens from cache.
// The delay keeps a cursor sweeping across the list from firing a gh call per row.
const HOVER_INTENT_MS = 140
let hoverTimer: ReturnType<typeof setTimeout> | null = null
function cancelRowHover(): void {
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverTimer = null
}
function onRowHover(n: number): void {
  cancelRowHover()
  hoverTimer = setTimeout(() => emit('prefetch', n), HOVER_INTENT_MS)
}
onBeforeUnmount(cancelRowHover)

// Staggered reveal for freshly mounted rows. Vue reuses the DOM of rows that
// survive a re-fetch (keyed by number), so only genuinely new rows animate. The
// delay is capped so "Load more" (index 50+) doesn't wait out a long ramp.
const STAGGER_MS = 22
const STAGGER_MAX = 9
const rowDelay = (i: number): string => `${Math.min(i, STAGGER_MAX) * STAGGER_MS}ms`

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
