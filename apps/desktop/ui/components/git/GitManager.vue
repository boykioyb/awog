<template>
  <div class="flex flex-1 overflow-hidden">
    <!-- Git not installed / unsupported version banner (M7) -->
    <GitNotInstalledBanner
      v-if="gitInstallStatus && (!gitInstallStatus.installed || !gitInstallStatus.supported)"
      :installed="gitInstallStatus.installed"
      :version="gitInstallStatus.version"
      :required="gitInstallStatus.required"
    />
    <template v-else>
      <!-- ─── Left sidebar (Sublime Merge style) ───────────────────────── -->
      <GitSidebar
        :selected="selected"
        :dirty-count="currentDirtyCount"
        @update:selected="onSelectSection"
        @create-branch="showCreateBranch = true"
        @save-stash="showSaveStash = true"
        @context-branch="onBranchContext"
      />

      <!-- ─── Main pane ────────────────────────────────────────────────── -->
      <div class="flex flex-col flex-1 overflow-hidden">
        <GitPageHeader
          :projects="projects"
          :current-project="currentProject"
          :current-dirty-count="currentDirtyCount"
          :dirty-count-by-project="store.dirtyCountByProject"
          :selected-project-id="store.selectedProjectId"
          :repos="store.repos"
          :selected-repo-path="store.currentRepoPath"
          :local-branches="localBranches"
          :current-branch="store.currentBranch"
          :has-conflict="store.hasConflict"
          :is-merging="store.isMerging"
          @select-project="onSelectProject"
          @select-repo="onSelectRepo"
          @switch-branch="switchBranch"
          @complete-merge="onCompleteMerge"
          @request-abort-merge="pendingAbort = true"
        />

        <GitDetachedHeadBanner v-if="store.isDetached" :detached-at="store.detachedAt" />

        <GitNoRepoEmpty v-if="store.repoState === 'no-repo'" @init="store.initRepo()" />

        <template v-else>
          <!-- Local Changes -->
          <GitChangesTab
            v-if="selected.kind === 'local-changes'"
            :current-diff="currentDiff"
            :selected-conflict-path="selectedConflictPath"
            :can-stage-selected-hunk="canStageSelectedHunk"
            @stage-hunk="onStageHunk"
          />

          <!-- Commit history (All Commits / branch / tag) -->
          <GitHistoryTab v-else-if="isHistorySection" :detail="commitDetail" />

          <!-- Remote detail -->
          <GitRemoteDetailPane v-else-if="selected.kind === 'remote'" :name="selected.name" />

          <!-- Stash detail -->
          <GitStashDetailPane v-else-if="selected.kind === 'stash'" :index="selected.index" />

          <!-- Fallback (submodule / unknown) -->
          <div v-else class="flex-1 overflow-hidden p-6 text-[1em]" :style="{ color: t.textDim }">
            {{ tr('git.sidebar.empty') }}
          </div>
        </template>
      </div>

      <!-- ─── Modals ───────────────────────────────────────────────────── -->
      <ConfirmDeleteModal
        v-if="pendingAbort"
        :title="tr('git.abort_merge.title')"
        :description="tr('git.abort_merge.description')"
        @confirm="onConfirmAbort"
        @cancel="pendingAbort = false"
      />

      <GitBranchNameModal
        :open="showCreateBranch"
        :title="tr('git.branches.create_title')"
        :submit-label="tr('git.branches.create_submit')"
        placeholder="branch-name"
        from-label="HEAD"
        :model-value="newBranchName"
        @update:model-value="newBranchName = $event"
        @close="showCreateBranch = false"
        @submit="onCreateBranch"
      />

      <BaseModal
        :open="showSaveStash"
        :title="tr('git.stash.title_save')"
        size="sm"
        @close="showSaveStash = false"
      >
        <div class="p-4">
          <input
            v-model="newStashMessage"
            :placeholder="tr('git.stash.placeholder')"
            class="w-full rounded text-[1em] px-2 py-1.5"
            :style="{
              background: t.bgInput,
              color: t.text,
              border: `1px solid ${t.border}`,
              outline: 'none',
            }"
            @keydown.enter="onSaveStash"
          />
        </div>
        <template #footer>
          <button
            class="px-3 py-1.5 text-[1em] rounded transition"
            :style="{ color: t.textMuted }"
            @click="showSaveStash = false"
          >
            {{ tr('common.cancel') }}
          </button>
          <button
            class="px-3 py-1.5 text-[1em] rounded font-medium transition"
            :style="{ background: t.accent, color: t.accentText }"
            @click="onSaveStash"
          >
            {{ tr('common.save') }}
          </button>
        </template>
      </BaseModal>

      <GitBranchContextMenu
        :open="branchMenu !== null"
        :position="branchMenu ?? { x: 0, y: 0 }"
        :branch-name="branchMenu?.name ?? ''"
        :is-remote="branchMenu?.isRemote ?? false"
        :is-current="branchMenu?.isCurrent ?? false"
        @close="branchMenu = null"
        @checkout="onMenuCheckout"
        @checkout-as-local="onMenuCheckoutAsLocal"
        @create-from="onMenuCreateFrom"
        @rename="onMenuRename"
        @copy="copyToClipboard"
        @fetch="store.fetchRemote()"
        @delete="(name: string) => (pendingBranchDelete = name)"
      />

      <GitBranchNameModal
        :open="renameTarget !== null"
        :title="tr('git.branches.rename_title')"
        :submit-label="tr('git.branches.rename_submit')"
        placeholder="new-branch-name"
        :from-label="renameTarget ?? ''"
        :model-value="renameValue"
        @update:model-value="renameValue = $event"
        @close="renameTarget = null"
        @submit="onRename"
      />

      <ConfirmDeleteModal
        v-if="pendingBranchDelete"
        :title="tr('git.delete_branch.title')"
        :description="tr('git.delete_branch.description', { name: pendingBranchDelete })"
        @confirm="onConfirmBranchDelete"
        @cancel="onCancelBranchDelete"
      >
        <template #extra>
          <label
            class="flex items-center gap-2 text-[1em] cursor-pointer select-none"
            :style="{ color: t.text }"
          >
            <input
              v-model="deleteRemoteToo"
              type="checkbox"
              class="cursor-pointer"
              :style="{ accentColor: t.danger }"
            />
            <span>
              {{ tr('git.delete_branch.also_delete_remote', { name: pendingBranchDelete }) }}
            </span>
          </label>
        </template>
      </ConfirmDeleteModal>

      <ConfirmDeleteModal
        v-if="store.pendingDeleteError"
        :title="tr('git.delete_branch.force_title')"
        :description="
          tr('git.delete_branch.force_description', {
            name: store.pendingDeleteError.branch,
          })
        "
        @confirm="onForceBranchDelete"
        @cancel="store.clearPendingDeleteError()"
      />

      <GitDirtyCheckoutModal
        :open="store.pendingCheckoutError !== null"
        :target-branch="store.pendingCheckoutError?.branch ?? ''"
        :files="store.pendingCheckoutError?.files ?? []"
        @close="store.clearPendingCheckoutError()"
        @force="onForceCheckout"
        @stash-and-checkout="onStashAndCheckout"
      />

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
      <GitPushModal :open="store.pushDialogOpen" @close="store.pushDialogOpen = false" />

      <!-- Toast container -->
      <div
        v-if="store.toasts.length > 0"
        class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-[360px]"
      >
        <div
          v-for="toast in store.toasts"
          :key="toast.id"
          class="px-3 py-2 rounded text-[1em] shadow-lg"
          :style="toastStyle(toast.kind)"
        >
          {{ toast.text }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { GitBranch, GitCommit, GitFileDiff, GitFileStatus, Project } from '~/types'
import type { CheckInstalledResult } from '~/composables/useGitApi'
import type { GitSection } from '~/components/git/git-section'
import { isValidGitRef } from '~/utils/branch-tree'

// Optional project to pin (modal mode opened from a Session). In page mode the
// prop is absent and bootstrap falls back to the previously selected project /
// first project — preserving the standalone Git page behaviour exactly.
const props = withDefaults(defineProps<{ projectId?: string | null }>(), {
  projectId: null,
})

const { t } = useTheme()
const { t: tr } = useI18n()
const store = useGitStore()
const workspace = useWorkspaceStore()

// ─── Bootstrap ───────────────────────────────────────────────────────────
const gitInstallStatus = ref<CheckInstalledResult | null>(null)

// ─── Sidebar selection state ─────────────────────────────────────────────
const selected = ref<GitSection>({ kind: 'local-changes' })

const isHistorySection = computed(
  () =>
    selected.value.kind === 'all-commits' ||
    selected.value.kind === 'branch' ||
    selected.value.kind === 'tag',
)

const onSelectSection = (s: GitSection) => {
  selected.value = s
}

// ─── Page-level state from old layout ────────────────────────────────────
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
  currentDiff.value = await store.loadDiff(path)
}

// ─── Remote ops handlers ─────────────────────────────────────────────────
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

// ─── Branch create / rename / delete via sidebar ─────────────────────────
const showCreateBranch = ref(false)
const newBranchName = ref('')
const createFromRef = ref<string>('')

const onCreateBranch = async (value: string) => {
  const name = value.trim()
  if (!isValidGitRef(name)) return
  await store.createBranch(name, createFromRef.value || undefined)
  newBranchName.value = ''
  createFromRef.value = ''
  showCreateBranch.value = false
}

type BranchMenu = {
  x: number
  y: number
  name: string
  isRemote: boolean
  isCurrent: boolean
}
const branchMenu = ref<BranchMenu | null>(null)
const renameTarget = ref<string | null>(null)
const renameValue = ref('')
const pendingBranchDelete = ref<string | null>(null)
const deleteRemoteToo = ref(false)

const MENU_WIDTH = 200
const MENU_HEIGHT = 220
const onBranchContext = (e: MouseEvent, branch: GitBranch) => {
  const maxX = window.innerWidth - MENU_WIDTH - 8
  const maxY = window.innerHeight - MENU_HEIGHT - 8
  branchMenu.value = {
    x: Math.min(e.clientX, maxX),
    y: Math.min(e.clientY, maxY),
    name: branch.name,
    isRemote: branch.isRemote,
    isCurrent: branch.isCurrent,
  }
}

const onMenuCheckout = async (name: string, isCurrent: boolean) => {
  branchMenu.value = null
  if (isCurrent) return
  await store.checkoutBranch(name)
}

const onMenuCheckoutAsLocal = async (remoteName: string) => {
  branchMenu.value = null
  const localName = remoteName.replace(/^origin\//, '')
  await store.createBranch(localName, remoteName)
  await store.checkoutBranch(localName)
}

const onMenuCreateFrom = (fromRef: string) => {
  branchMenu.value = null
  createFromRef.value = fromRef
  showCreateBranch.value = true
}

const onMenuRename = (name: string) => {
  branchMenu.value = null
  renameTarget.value = name
  renameValue.value = name
}

const onRename = async (value: string) => {
  const oldName = renameTarget.value
  if (!oldName) return
  const next = value.trim()
  if (!isValidGitRef(next)) return
  await store.renameBranch(oldName, next)
  renameTarget.value = null
  renameValue.value = ''
}

const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // ignore (insecure context)
  }
}

const onConfirmBranchDelete = async () => {
  if (pendingBranchDelete.value) {
    const opts: { deleteRemote?: boolean } = {}
    if (deleteRemoteToo.value) opts.deleteRemote = true
    await store.deleteBranch(pendingBranchDelete.value, opts)
  }
  pendingBranchDelete.value = null
  deleteRemoteToo.value = false
}
const onCancelBranchDelete = () => {
  pendingBranchDelete.value = null
  deleteRemoteToo.value = false
}

const onForceBranchDelete = async () => {
  const pending = store.pendingDeleteError
  if (!pending) return
  store.clearPendingDeleteError()
  const opts: { force: true; deleteRemote?: boolean } = { force: true }
  if (deleteRemoteToo.value) opts.deleteRemote = true
  await store.deleteBranch(pending.branch, opts)
  deleteRemoteToo.value = false
}

// ─── Stash save via sidebar ──────────────────────────────────────────────
const showSaveStash = ref(false)
const newStashMessage = ref('')

const onSaveStash = async () => {
  await store.stashSave(newStashMessage.value)
  newStashMessage.value = ''
  showSaveStash.value = false
}

// ─── Toast style helper ──────────────────────────────────────────────────
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

// ─── Diff / commit detail watchers ───────────────────────────────────────
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

// ─── Project / repo switching ────────────────────────────────────────────
// A project may hold several git repos; both switches re-discover (project
// only) and reload every section against the new target.
const resetDetail = () => {
  currentDiff.value = null
  commitDetail.value = null
}

const reloadAll = async () => {
  await Promise.all([
    store.loadStatus(),
    store.loadHistory(),
    store.loadBranches({ force: true }),
    store.loadStashes(),
    store.loadRemotes(),
  ])
  const first = store.commits[0]
  if (!store.selectedCommitHash && first) store.selectCommit(first.hash)
}

const onSelectProject = async (id: string) => {
  if (id === store.selectedProjectId) return
  store.setSelectedProject(id)
  resetDetail()
  await store.discoverRepos()
  await reloadAll()
}

const onSelectRepo = async (path: string) => {
  store.setSelectedRepo(path)
  resetDetail()
  await reloadAll()
}

// ─── Background auto-fetch ────────────────────────────────────────────────
// Keeps remote-tracking refs (origin/main, origin/develop, origin/release, …)
// fresh so ahead/behind is accurate without clicking Fetch. Silent — no toast.
// Interval configurable in Settings → Workspace (0 disables).
const { git: gitSettings } = useGitSettings()
let autoFetchTimer: ReturnType<typeof setInterval> | null = null

const runAutoFetch = () => {
  if (gitSettings.value.autoFetchIntervalMs <= 0) return
  if (store.isBusy) return
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
  store.fetchRemote(undefined, { silent: true }).catch(() => undefined)
}

const armAutoFetch = () => {
  if (autoFetchTimer) {
    clearInterval(autoFetchTimer)
    autoFetchTimer = null
  }
  const ms = gitSettings.value.autoFetchIntervalMs
  if (ms > 0) autoFetchTimer = setInterval(runAutoFetch, ms)
}

// Fetch again when the user returns to the app (cheap, guarded, silent).
const onWindowFocus = () => runAutoFetch()

watch(() => gitSettings.value.autoFetchIntervalMs, armAutoFetch)

// ─── Bootstrap ───────────────────────────────────────────────────────────
let unsubscribe: (() => void) | null = null
onMounted(async () => {
  try {
    gitInstallStatus.value = await useGitApi().checkInstalled()
  } catch {
    gitInstallStatus.value = {
      installed: true,
      version: 'mock',
      supported: true,
      required: '2.20',
    }
  }
  if (!gitInstallStatus.value.installed || !gitInstallStatus.value.supported) return

  if (workspace.projects.length === 0) {
    await workspace.hydrateProjectsFromSidecar()
  }
  // Modal mode: pin to the Session's project when it exists. Page mode (no
  // prop) keeps the previous selection or falls back to the first project.
  if (props.projectId && workspace.projects.some((p: Project) => p.id === props.projectId)) {
    store.setSelectedProject(props.projectId)
  } else {
    const hasSelected = workspace.projects.some((p: Project) => p.id === store.selectedProjectId)
    if (!hasSelected && workspace.projects.length > 0) {
      store.setSelectedProject(workspace.projects[0]!.id)
    }
  }

  // Discover repos inside the selected project before loading so the effective
  // git root targets a real repo (a project may be a container of repos).
  await store.discoverRepos()
  await reloadAll()
  unsubscribe = await store.subscribe()

  // Initial silent fetch on open, then on the configured interval + on focus.
  runAutoFetch()
  armAutoFetch()
  window.addEventListener('focus', onWindowFocus)
})
onUnmounted(() => {
  if (unsubscribe) unsubscribe()
  unsubscribe = null
  if (autoFetchTimer) {
    clearInterval(autoFetchTimer)
    autoFetchTimer = null
  }
  window.removeEventListener('focus', onWindowFocus)
})
</script>
