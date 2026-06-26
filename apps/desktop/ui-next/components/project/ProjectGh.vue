<template>
  <div class="projmain">
    <ProjectIssues
      :kind="kind"
      :items="gh.visibleItems.value"
      :loading="gh.loading.value"
      :error-code="gh.errorCode.value"
      :state-filter="gh.stateFilter.value"
      :assignee="gh.assigneeFilter.value"
      :search="gh.searchQuery.value"
      :account="gh.account.value"
      :accounts="accountLogins"
      :known-assignees="gh.knownAssignees.value"
      :repos="repos"
      :repo-path="selectedRepoPath"
      :can-load-more="gh.canLoadMore.value"
      @open="gh.open"
      @refresh="gh.refresh"
      @set-state="gh.setStateFilter"
      @set-assignee="gh.setAssigneeFilter"
      @set-account="gh.setAccount"
      @set-search="gh.setSearch"
      @set-repo="(v) => (selectedRepoPath = v)"
      @load-more="gh.loadMore"
      @new-session="onNewSession"
    />
    <ProjectGhDrawer
      v-if="gh.drawerOpen.value"
      :thread="gh.selected.value"
      :kind="kind"
      :loading="gh.detailLoading.value"
      :width="400"
      :view-lang="gh.viewLang.value"
      :segment="gh.segmentTranslation"
      @close="gh.closeDrawer"
      @set-lang="gh.setViewLang"
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
  useProjectGh,
  type GhAccount,
  type GhKind,
  type GhThreadSummary,
} from '~/composables/useProjectGh'
import { useSidecar } from '~/composables/useSidecar'
import { useSessionsStore } from '~/stores/sessions'

const props = defineProps<{ projectId: string; kind: GhKind; repos: ProjectRepo[] }>()

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

// Start a new session in this project seeded with the issue/PR as context, then
// jump to it. The seed lands in the composer draft (editable) rather than auto-
// sending; the URL uses the SELECTED repo's slug (multi-repo workspace).
async function onNewSession(item: GhThreadSummary): Promise<void> {
  const slug = selectedRepo.value?.ghSlug ?? null
  const path = props.kind === 'pr' ? 'pull' : 'issues'
  const url = slug ? `https://github.com/${slug}/${path}/${item.number}` : ''
  const kindWord = props.kind === 'pr' ? 'pull request' : 'issue'
  const seed =
    t('projects.gh.newSessionSeed', {
      kind: kindWord,
      number: item.number,
      title: item.title,
    }) + (url ? `\n${url}` : '')
  const id = sessions.create(props.projectId)
  sessions.rename(id, `#${item.number} ${item.title}`)
  if (url) sessions.setAboutGh(id, url)
  sessions.setDraft(id, seed)
  await navigateTo('/sessions')
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
