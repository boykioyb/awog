<template>
  <div class="projmain">
    <ProjectIssues
      :kind="kind"
      :items="gh.visibleItems.value"
      :loading="gh.loading.value"
      :revalidating="gh.revalidating.value"
      :error-code="gh.errorCode.value"
      :state-filter="gh.stateFilter.value"
      :assignee="gh.assigneeFilter.value"
      :reviewer="gh.reviewerFilter.value"
      :search="gh.searchQuery.value"
      :account="gh.account.value"
      :global-account="gh.globalAccount.value"
      :accounts="accountLogins"
      :known-assignees="gh.knownAssignees.value"
      :known-reviewers="gh.knownReviewers.value"
      :repos="repos"
      :repo-path="selectedRepoPath"
      :can-load-more="gh.canLoadMore.value"
      @open="gh.open"
      @prefetch="gh.prefetchThread"
      @refresh="() => gh.refresh({ force: true })"
      @set-state="gh.setStateFilter"
      @set-assignee="gh.setAssigneeFilter"
      @set-reviewer="gh.setReviewerFilter"
      @set-account="gh.setAccount"
      @set-search="gh.setSearch"
      @set-repo="(v) => (selectedRepoPath = v)"
      @load-more="gh.loadMore"
      @new-session="onNewSession"
      @install-gh="onInstallGh"
      @login-help="onLoginHelp"
    />
    <ProjectGhDrawer
      v-if="gh.drawerOpen.value"
      ref="drawerRef"
      :thread="gh.selected.value"
      :kind="kind"
      :loading="gh.detailLoading.value"
      :reviews-loading="gh.reviewsLoading.value"
      :width="400"
      :view-lang="gh.viewLang.value"
      :segment="gh.segmentTranslation"
      :comment-draft="gh.commentDraft.value"
      :posting="gh.posting.value"
      :enhancing="gh.enhancing.value"
      :translating="gh.translatingDraft.value"
      :can-undo="gh.canUndoDraft.value"
      :reviewing="gh.reviewing.value"
      :review-error="gh.reviewError.value"
      :reviewed="gh.reviewed.value"
      :diff-files="gh.diffFiles.value"
      :diff-loading="gh.diffLoading.value"
      :commits="gh.commits.value"
      :commits-loading="gh.commitsLoading.value"
      @close="gh.closeDrawer"
      @refresh="gh.refreshThread"
      @set-lang="gh.setViewLang"
      @load-diff="onLoadDiff"
      @load-commits="onLoadCommits"
      @submit-comment="onSubmitComment"
      @enhance="gh.enhanceDraft"
      @translate="gh.translateDraft"
      @undo="gh.undoDraft"
      @approve="gh.approvePr"
      @update:comment-draft="(v) => (gh.commentDraft.value = v)"
      @reply="onReply"
    />
  </div>
</template>

<script setup lang="ts">
// GitHub Issues / PR tab — wires the useProjectGh controller (live gh.* RPC) and
// composes the presentational list + drawer. Loads the gh CLI account roster once
// for the account picker. `kind` selects issues vs pull requests. `repos` is the
// project's GitHub child repos (multi-repo workspace) — the user picks which one
// the issues/PRs come from; the selected repo's relativePath scopes every gh call.
import { computed, onMounted, ref, watch } from 'vue'
import ProjectGhDrawer from './ProjectGhDrawer.vue'
import ProjectIssues from './ProjectIssues.vue'
import type { ProjectRepo } from '~/composables/useProjectRepos'
import {
  prefetchGhList,
  useProjectGh,
  type GhAccount,
  type GhKind,
  type GhThreadSummary,
} from '~/composables/useProjectGh'
import { useSidecar } from '~/composables/useSidecar'
import { useSessionsStore } from '~/stores/sessions'

const props = withDefaults(
  defineProps<{
    projectId: string
    kind: GhKind
    repos: ProjectRepo[]
    // Deep link: open this issue/PR's drawer as soon as the tab is up (a GitHub
    // notification toast). Null = no target.
    openNumber?: number | null
  }>(),
  { openNumber: null },
)

const sc = useSidecar()
const { t } = useI18n()
const sessions = useSessionsStore()

// Selected child repo (relativePath). Default to the first GitHub repo; '.' (root)
// when the project is itself a single repo. Re-resolves if the repo list changes.
const selectedRepoPath = ref<string>(props.repos[0]?.relativePath ?? '.')
watch(
  () => props.repos,
  (next) => {
    if (!next.some((r) => r.relativePath === selectedRepoPath.value)) {
      selectedRepoPath.value = next[0]?.relativePath ?? '.'
    }
  },
)

const selectedRepo = computed(() =>
  props.repos.find((r) => r.relativePath === selectedRepoPath.value),
)

// Getters (not values) so the controller re-fetches when the tab swaps issue ↔ pr
// or the selected child repo changes.
const gh = useProjectGh(
  () => props.projectId,
  () => props.kind,
  () => (selectedRepoPath.value === '.' ? undefined : selectedRepoPath.value),
)

// Warm the OTHER tab (Issues ↔ PR) for whichever repo is selected, so switching
// tabs — or picking another repo and then switching — paints from cache. Skipped
// when that list is already fresh (the prefetcher checks the same cache).
watch(
  () => selectedRepoPath.value,
  (path) => {
    void prefetchGhList({
      projectId: props.projectId,
      kind: props.kind === 'pr' ? 'issue' : 'pr',
      ...(path === '.' ? {} : { repoPath: path }),
    })
  },
  { immediate: true },
)

// Deep-link target (notification toast) → open its drawer. `immediate` covers the
// tab being mounted BY the deep link; the watcher covers a second toast arriving
// while the tab is already up.
watch(
  () => props.openNumber,
  (n) => {
    if (n != null) void gh.open(n)
  },
  { immediate: true },
)

// Drawer ref → focus the composer after a Reply prefills the draft.
const drawerRef = ref<{ focusComposer: () => void } | null>(null)

// Fetch + reveal the open PR's diff (idempotent in the controller).
function onLoadDiff(): void {
  const n = gh.selected.value?.number
  if (n != null) void gh.loadDiff(n)
}

// Fetch the open PR's commit list the first time the Commits tab opens (idempotent).
function onLoadCommits(): void {
  const n = gh.selected.value?.number
  if (n != null) void gh.loadCommits(n)
}

// Post the composer draft as a comment, then refetch the thread (controller).
function onSubmitComment(): void {
  const n = gh.selected.value?.number
  if (n != null) void gh.postComment(n)
}

// Reply = a new comment quoting the parent. Build a markdown blockquote of the
// quoted body ("> @author wrote:" + each line prefixed) + two newlines, then focus
// the composer ready to type the reply below it.
function onReply(payload: { author: string; body: string }): void {
  const quoted = payload.body
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')
  const header = t('projects.drawer.replyQuote', { author: payload.author })
  gh.commentDraft.value = `> ${header}\n${quoted}\n\n`
  drawerRef.value?.focusComposer()
}

// Start a new session in this project seeded with the issue/PR as context, then
// jump to it. The seed lands in the composer draft (editable) rather than auto-
// sending; the URL uses the SELECTED repo's slug (multi-repo workspace).
async function onNewSession(item: GhThreadSummary): Promise<void> {
  const slug = selectedRepo.value?.ghSlug ?? null
  const path = props.kind === 'pr' ? 'pull' : 'issues'
  const url = slug ? `https://github.com/${slug}/${path}/${item.number}` : ''
  const kindWord = props.kind === 'pr' ? 'pull request' : 'issue'

  // Capture the issue/PR body ONCE here so the session carries it as context — the
  // model gets the full description in the first message instead of re-fetching it.
  const full = await gh.fetchThread(item.number)

  const lead = t('projects.gh.newSessionSeed', {
    kind: kindWord,
    number: item.number,
    title: item.title,
  })
  const parts = [lead]
  if (url) parts.push(url)
  if (full?.body?.trim()) parts.push('', '---', '', full.body.trim())
  const seed = parts.join('\n')

  // create() returns null when the quota guard blocks new sessions (Settings →
  // Quota warning). Bail out — the guard already surfaced the reason.
  const id = sessions.create(props.projectId)
  if (id == null) return
  sessions.rename(id, `#${item.number} ${item.title}`)
  if (url) sessions.setAboutGh(id, url)
  sessions.setDraft(id, seed)
  await navigateTo('/sessions')
}

// gh not installed / not authenticated → open the official install + auth docs in
// the browser (login is interactive, so we point the user at the gh CLI flow).
function onInstallGh(): void {
  void sc.openExternal('https://cli.github.com/')
}
function onLoginHelp(): void {
  void sc.openExternal('https://cli.github.com/manual/gh_auth_login')
}

// gh CLI accounts (login only — never a token). Best-effort; empty in browser-dev.
const accountLogins = ref<string[]>([])
onMounted(async () => {
  if (!sc.available) return
  try {
    const res = await sc.request<{ accounts: GhAccount[] }>('gh.accounts', {})
    accountLogins.value = res.accounts.map((a) => a.login)
  } catch {
    accountLogins.value = []
  }
})
</script>
