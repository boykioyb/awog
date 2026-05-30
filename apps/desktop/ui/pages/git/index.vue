<template>
  <div class="flex flex-1 overflow-hidden flex-col">
    <!-- Git not installed / unsupported version banner (M7) -->
    <GitNotInstalledBanner
      v-if="gitInstallStatus && (!gitInstallStatus.installed || !gitInstallStatus.supported)"
      :installed="gitInstallStatus.installed"
      :version="gitInstallStatus.version"
      :required="gitInstallStatus.required"
    />
    <template v-else>
      <GitPageHeader
        :projects="projects"
        :current-project="currentProject"
        :current-dirty-count="currentDirtyCount"
        :dirty-count-by-project="store.dirtyCountByProject"
        :selected-project-id="store.selectedProjectId"
        :local-branches="localBranches"
        :current-branch="store.currentBranch"
        :ahead="store.ahead"
        :behind="store.behind"
        :has-conflict="store.hasConflict"
        :has-uncommitted="store.hasUncommitted"
        :is-merging="store.isMerging"
        @select-project="(id: string) => store.setSelectedProject(id)"
        @switch-branch="switchBranch"
        @complete-merge="onCompleteMerge"
        @request-abort-merge="pendingAbort = true"
      />

      <ConfirmDeleteModal
        v-if="pendingAbort"
        title="Abort merge?"
        description="Working tree sẽ về state trước merge. Tất cả thay đổi chưa commit của merge này sẽ mất. Tiếp tục?"
        @confirm="onConfirmAbort"
        @cancel="pendingAbort = false"
      />

      <GitTabBar
        :active-tab="activeTab"
        :has-uncommitted="store.hasUncommitted"
        :has-conflict="store.hasConflict"
        @update:active-tab="(tab: GitTab) => (activeTab = tab)"
      />

      <!-- Detached HEAD warning banner (AC-42) -->
      <GitDetachedHeadBanner v-if="store.isDetached" :detached-at="store.detachedAt" />

      <!-- Empty state for no-repo -->
      <GitNoRepoEmpty v-if="store.repoState === 'no-repo'" @init="store.initRepo()" />

      <!-- Changes tab -->
      <GitChangesTab
        v-else-if="activeTab === 'changes'"
        :current-diff="currentDiff"
        :selected-conflict-path="selectedConflictPath"
        :can-stage-selected-hunk="canStageSelectedHunk"
        @stage-hunk="onStageHunk"
      />

      <!-- History tab -->
      <GitHistoryTab v-else-if="activeTab === 'history'" :detail="commitDetail" />

      <!-- Branches tab -->
      <MasterDetailShell
        v-else-if="activeTab === 'branches'"
        selected-id="_tab"
        list-width="24rem"
        disable-mobile
        resizable
        storage-key="awog.git.list-width.branches"
      >
        <template #list>
          <GitBranchList />
        </template>
        <template #detail>
          <div class="flex-1 overflow-hidden p-6" :style="{ color: t.textDim }">
            <div class="text-xs">Click branch để checkout. Right-click cho thêm action.</div>
          </div>
        </template>
      </MasterDetailShell>

      <!-- Stash tab -->
      <MasterDetailShell
        v-else-if="activeTab === 'stash'"
        selected-id="_tab"
        list-width="24rem"
        disable-mobile
        resizable
        storage-key="awog.git.list-width.stash"
      >
        <template #list>
          <GitStashList />
        </template>
        <template #detail>
          <div class="flex-1 overflow-hidden p-6" :style="{ color: t.textDim }">
            <div class="text-xs">Stash sẽ apply file vào working tree khi pop / apply.</div>
          </div>
        </template>
      </MasterDetailShell>

      <!-- Remotes tab -->
      <MasterDetailShell
        v-else-if="activeTab === 'remotes'"
        selected-id="_tab"
        list-width="24rem"
        disable-mobile
        resizable
        storage-key="awog.git.list-width.remotes"
      >
        <template #list>
          <GitRemoteList />
        </template>
        <template #detail>
          <div class="flex-1 overflow-hidden p-6" :style="{ color: t.textDim }">
            <div class="text-xs">Cấu hình add/remove remote chưa có trong v1.</div>
          </div>
        </template>
      </MasterDetailShell>

      <!-- Dirty-tree checkout modal — lifted from GitBranchList so the branch
           picker dropdown in the header also triggers the same flow. -->
      <GitDirtyCheckoutModal
        :open="store.pendingCheckoutError !== null"
        :target-branch="store.pendingCheckoutError?.branch ?? ''"
        :files="store.pendingCheckoutError?.files ?? []"
        @close="store.clearPendingCheckoutError()"
        @force="onForceCheckout"
        @stash-and-checkout="onStashAndCheckout"
      />

      <!-- Remote ops modals (M4) -->
      <GitAuthErrorModal :error="store.pendingAuthError" @close="store.clearPendingAuthError" />
      <GitPullDivergenceModal
        :open="store.pendingPullDivergence"
        @close="store.clearPendingPullDivergence"
        @choose-merge="onChooseMerge"
        @choose-rebase="onChooseRebase"
      />
      <GitPushNonFfModal
        :open="store.pendingPushNonFf"
        @close="store.clearPendingPushNonFf"
        @pull-then-push="onPullThenPush"
      />

      <!-- Toast container -->
      <div
        v-if="store.toasts.length > 0"
        class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-[360px]"
      >
        <div
          v-for="toast in store.toasts"
          :key="toast.id"
          class="px-3 py-2 rounded text-xs shadow-lg"
          :style="toastStyle(toast.kind)"
        >
          {{ toast.text }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { GitBranch, GitCommit, GitFileDiff, GitFileStatus, Project } from '~/types'
import type { CheckInstalledResult } from '~/composables/useGitApi'
import type { GitTab } from '~/components/git/git-tabs'

const { t } = useTheme()
const store = useGitStore()
const workspace = useWorkspaceStore()

// Bootstrap: probe sidecar for `git --version`. Blocks `/git` page if missing
// or unsupported (< 2.20). Other pages still usable.
const gitInstallStatus = ref<CheckInstalledResult | null>(null)

const activeTab = ref<GitTab>('changes')
const currentDiff = ref<GitFileDiff | null>(null)
const commitDetail = ref<{ commit: GitCommit; files: GitFileDiff[] } | null>(null)
const pendingAbort = ref(false)

const projects = computed(() => workspace.projects)
const currentProject = computed(() =>
  projects.value.find((p: Project) => p.id === store.selectedProjectId),
)
const currentDirtyCount = computed(() => store.dirtyCountByProject[store.selectedProjectId] ?? 0)
const localBranches = computed(() => store.branches.filter((b: GitBranch) => !b.isRemote))

const selectedConflictPath = computed(() => {
  const path = store.selectedFilePath
  if (!path) return null
  const file = store.statusFiles.find((f: GitFileStatus) => f.path === path)
  return file?.hasConflict ? path : null
})

// Allow Stage-hunk only when the currently selected file is in the unstaged
// section (working-tree diff). Staged files show a different diff source so
// hunk indices wouldn't match the unstaged patch the sidecar rebuilds.
const canStageSelectedHunk = computed(() => {
  const path = store.selectedFilePath
  if (!path) return false
  const file = store.statusFiles.find((f: GitFileStatus) => f.path === path)
  return !!file && !file.isStaged && !file.hasConflict
})

const onStageHunk = async (hunkIndex: number) => {
  const path = store.selectedFilePath
  if (!path) return
  await store.stageHunk(path, hunkIndex)
  // Re-fetch the diff so the staged lines disappear from the working-tree view.
  currentDiff.value = await store.loadDiff(path)
}

const onChooseMerge = async () => {
  store.clearPendingPullDivergence()
  await store.pull('merge')
}
const onChooseRebase = async () => {
  store.clearPendingPullDivergence()
  await store.pull('rebase')
}
const onPullThenPush = async () => {
  await store.pullThenPush('merge')
}

const onCompleteMerge = async () => {
  await store.completeMerge()
}
const onConfirmAbort = async () => {
  pendingAbort.value = false
  await store.mergeAbort()
}

// Always try the checkout. The store catches a DIRTY_TREE error from the
// sidecar and sets `pendingCheckoutError`, which opens GitDirtyCheckoutModal
// (mounted at page level so this works from both the header dropdown and the
// Branches tab).
const switchBranch = async (name: string, isCurrent: boolean) => {
  if (isCurrent) return
  await store.checkoutBranch(name)
}

const onForceCheckout = async () => {
  const pending = store.pendingCheckoutError
  if (!pending) return
  store.clearPendingCheckoutError()
  await store.checkoutBranch(pending.branch, { force: true })
}

const onStashAndCheckout = async () => {
  const pending = store.pendingCheckoutError
  if (!pending) return
  store.clearPendingCheckoutError()
  await store.stashSave(`auto-stash before checkout to ${pending.branch}`, true)
  await store.checkoutBranch(pending.branch)
}

const toastStyle = (kind: 'info' | 'success' | 'error') => {
  if (kind === 'success') {
    return {
      background: t.value.infoBg,
      color: t.value.info,
      border: `1px solid ${t.value.infoBorder}`,
    }
  }
  if (kind === 'error') {
    return {
      background: t.value.dangerBg,
      color: t.value.danger,
      border: `1px solid ${t.value.dangerBorder}`,
    }
  }
  return {
    background: t.value.bgPanel,
    color: t.value.text,
    border: `1px solid ${t.value.border}`,
  }
}

// Reactively load diff for selected file in Changes tab.
watch(
  () => store.selectedFilePath,
  async (path: string | null) => {
    if (!path) {
      currentDiff.value = null
      return
    }
    currentDiff.value = await store.loadDiff(path)
  },
  { immediate: true },
)

// Reactively load commit detail in History tab.
watch(
  () => store.selectedCommitHash,
  async (hash: string | null) => {
    if (!hash) {
      commitDetail.value = null
      return
    }
    commitDetail.value = await store.loadCommit(hash)
  },
  { immediate: true },
)

// Reset diff/commit detail when project changes.
watch(
  () => store.selectedProjectId,
  () => {
    currentDiff.value = null
    commitDetail.value = null
    const first = store.commits[0]
    if (first) store.selectCommit(first.hash)
  },
)

// Bootstrap status on mount + subscribe to external git events from sidecar.
let unsubscribe: (() => void) | null = null
onMounted(async () => {
  // Probe Git CLI first — short-circuit page if missing/unsupported.
  try {
    gitInstallStatus.value = await useGitApi().checkInstalled()
  } catch {
    // Sidecar unavailable (browser dev) — pretend installed so dev UX stays
    // functional with mock data.
    gitInstallStatus.value = { installed: true, version: 'mock', supported: true, required: '2.20' }
  }
  if (!gitInstallStatus.value.installed || !gitInstallStatus.value.supported) return

  // Hydrate projects first — store defaults to mock id `'prj1'`, so without a
  // real project selected `resolveWorkspaceRoot()` returns null and every read
  // falls back to mock data. Auto-select first real project when current
  // selection isn't in the hydrated list.
  if (workspace.projects.length === 0) {
    await workspace.hydrateProjectsFromSidecar()
  }
  const hasSelected = workspace.projects.some((p: Project) => p.id === store.selectedProjectId)
  if (!hasSelected && workspace.projects.length > 0) {
    store.setSelectedProject(workspace.projects[0]!.id)
  }

  await Promise.all([
    store.loadStatus(),
    store.loadHistory(),
    store.loadBranches(),
    store.loadStashes(),
    store.loadRemotes(),
  ])
  const first = store.commits[0]
  if (!store.selectedCommitHash && first) {
    store.selectCommit(first.hash)
  }
  unsubscribe = await store.subscribe()
})
onUnmounted(() => {
  if (unsubscribe) unsubscribe()
  unsubscribe = null
})

definePageMeta({ title: 'Git' })
</script>
