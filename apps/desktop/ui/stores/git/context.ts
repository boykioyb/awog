import type {
  GitBranch,
  GitCommit,
  GitConflictFile,
  GitFileStatus,
  GitRemote,
  GitRepoEntry,
  GitRepoState,
  GitStashEntry,
} from '~/types'
import {
  INITIAL_BRANCHES,
  INITIAL_COMMITS,
  INITIAL_REMOTES,
  INITIAL_STASHES,
  INITIAL_STATUS_FILES,
} from '~/utils/initial-git'
import type { GitStreamingOp, SidecarGitFileStatus } from '~/composables/useGitApi'
import { useSidecar } from '~/composables/useSidecar'
import { DEFAULT_PROJECT_ID, cloneFiles } from './adapters'

// Shared reactive base for the git store: all state refs, derived getters and
// the cross-cutting helpers (toast, project/repo resolution, selection). Each
// action module receives this context (plus the data loaders) so behaviour is
// split by concern without splitting the store's reactive identity. This is a
// cohesive state container — one bounded context — so it stays in one factory.
export function createGitContext() {
  // ─── State ───────────────────────────────────────────────────────────────
  // Mock seed (INITIAL_*) chỉ dành cho browser dev khi KHÔNG có sidecar. Trong
  // Electron app thật (sidecar available) khởi tạo rỗng — nếu seed luôn thì trang
  // Git khi cài đặt mới / chưa có project (selectedProjectId vẫn là 'prj1') sẽ
  // lộ mock data vì getter filter trúng projectId của seed.
  const seedMock = !useSidecar().available
  const selectedProjectId = ref<string>(DEFAULT_PROJECT_ID)
  // Repos discovered inside each project folder (a project may be a container of
  // several repos — see `git.discoverRepos`). Empty/absent → project assumed to
  // be a single repo at its own path (legacy behaviour).
  const reposByProject = ref<Record<string, GitRepoEntry[]>>({})
  // Which discovered repo is active per project (absolute path). Absent → fall
  // back to the project's own path.
  const selectedRepoPathByProject = ref<Record<string, string>>({})
  const branchesAll = ref<GitBranch[]>(seedMock ? [...INITIAL_BRANCHES] : [])
  const commitsAll = ref<GitCommit[]>(seedMock ? [...INITIAL_COMMITS] : [])
  const stashesAll = ref<GitStashEntry[]>(seedMock ? [...INITIAL_STASHES] : [])
  const remotesAll = ref<GitRemote[]>(seedMock ? [...INITIAL_REMOTES] : [])
  const statusFilesAll = ref<GitFileStatus[]>(seedMock ? cloneFiles(INITIAL_STATUS_FILES) : [])
  const selectedFilePath = ref<string | null>(null)
  const selectedCommitHash = ref<string | null>(null)
  const commitMessage = ref<string>('')
  const repoStateByProject = ref<Record<string, GitRepoState>>({})
  const isFetching = ref(false)
  const isPulling = ref(false)
  const isPushing = ref(false)
  const isGeneratingMessage = ref(false)
  const progressPct = ref<number | null>(null)
  const progressOp = ref<GitStreamingOp | null>(null)
  const progressPhase = ref<string | null>(null)
  const toasts = ref<Array<{ id: string; text: string; kind: 'info' | 'success' | 'error' }>>([])

  // Authentication failure surface — UI opens GitAuthErrorModal when set.
  const pendingAuthError = ref<{
    op: GitStreamingOp
    hint: 'ssh-key' | 'https-token' | 'unknown'
    message: string
  } | null>(null)
  // Pull diverged and ff-only refused — UI opens GitPullDivergenceModal.
  const pendingPullDivergence = ref(false)
  // Push rejected as non-fast-forward — UI opens GitPushNonFfModal.
  const pendingPushNonFf = ref(false)

  // Conflict resolver state — live response from `git.readConflictFile` for
  // the file currently focused in the resolver. `null` when no file selected.
  const currentConflictFile = ref<GitConflictFile | null>(null)
  // Track whether HEAD is in the middle of a merge (`.git/MERGE_HEAD` exists)
  // so the toolbar can offer Complete / Abort merge.
  const isMerging = ref(false)
  // Detached HEAD state (AC-42). When detached, branch picker shows the sha7
  // marker and Commit panel warns the user before creating a stranded commit.
  const isDetached = ref(false)
  const detachedAt = ref<string | null>(null)

  // Branches/remotes 5s cache (M7 perf polish).
  const branchesLastFetchedAt = ref<Record<string, number>>({})
  const remotesLastFetchedAt = ref<Record<string, number>>({})

  // Pagination cursor + flag for `loadHistory`. Per-project so switching
  // projects resets the "Load more" affordance.
  const historyHasMoreByProject = ref<Record<string, boolean>>({})
  const isLoadingHistoryMore = ref(false)

  // Pending errors that the UI surfaces via modals. `null` when no pending
  // recovery flow.
  const pendingCheckoutError = ref<{
    branch: string
    files: SidecarGitFileStatus[]
  } | null>(null)
  const pendingDeleteError = ref<{ branch: string } | null>(null)

  // ─── Getters: scoped theo selectedProjectId ──────────────────────────────
  const branches = computed(() =>
    branchesAll.value.filter((b) => b.projectId === selectedProjectId.value),
  )
  const commits = computed(() =>
    commitsAll.value.filter((c) => c.projectId === selectedProjectId.value),
  )
  const stashes = computed(() =>
    stashesAll.value.filter((s) => s.projectId === selectedProjectId.value),
  )
  const remotes = computed(() =>
    remotesAll.value.filter((r) => r.projectId === selectedProjectId.value),
  )
  const statusFiles = computed(() =>
    statusFilesAll.value.filter((f) => f.projectId === selectedProjectId.value),
  )

  const currentBranch = computed(
    () => branches.value.find((b) => b.isCurrent && !b.isRemote)?.name ?? 'main',
  )
  const currentBranchInfo = computed(() => branches.value.find((b) => b.isCurrent && !b.isRemote))
  const ahead = computed(() => currentBranchInfo.value?.ahead ?? 0)
  const behind = computed(() => currentBranchInfo.value?.behind ?? 0)

  const stagedFiles = computed(() => statusFiles.value.filter((f) => f.isStaged && !f.hasConflict))
  const unstagedFiles = computed(() =>
    statusFiles.value.filter((f) => !f.isStaged && !f.hasConflict && f.workTree !== 'untracked'),
  )
  const untrackedFiles = computed(() => statusFiles.value.filter((f) => f.workTree === 'untracked'))
  const conflictedFiles = computed(() => statusFiles.value.filter((f) => f.hasConflict))
  const hasUncommitted = computed(() => statusFiles.value.length > 0)
  const hasConflict = computed(() => conflictedFiles.value.length > 0)
  const isBusy = computed(() => isFetching.value || isPulling.value || isPushing.value)

  const repoState = computed<GitRepoState>(() => {
    const cached = repoStateByProject.value[selectedProjectId.value]
    if (cached === 'no-repo') return 'no-repo'
    if (hasConflict.value) return 'merging'
    return hasUncommitted.value ? 'dirty' : 'clean'
  })

  const historyHasMore = computed(
    () => historyHasMoreByProject.value[selectedProjectId.value] ?? false,
  )

  // Đếm dirty file per project — dùng cho project selector badge.
  const dirtyCountByProject = computed<Record<string, number>>(() =>
    statusFilesAll.value.reduce<Record<string, number>>((acc, f) => {
      acc[f.projectId] = (acc[f.projectId] ?? 0) + 1
      return acc
    }, {}),
  )

  // Repos discovered inside the selected project. Empty for single-repo projects.
  const repos = computed<GitRepoEntry[]>(() => reposByProject.value[selectedProjectId.value] ?? [])

  // Absolute path of the selected project folder (the container). Null in
  // browser dev when the project / sidecar is unavailable.
  const resolveProjectPath = (): string | null => {
    const workspace = useWorkspaceStore()
    const project = workspace.projects.find((p) => p.id === selectedProjectId.value)
    return project?.path ?? null
  }

  // Effective git root: the selected repo within the project, falling back to
  // the project's own path (single-repo / not-yet-discovered). Single source of
  // truth that every git action targets via `resolveWorkspaceRoot()`.
  const currentRepoPath = computed<string | null>(
    () => selectedRepoPathByProject.value[selectedProjectId.value] ?? resolveProjectPath(),
  )

  // Resolve the absolute path git should run in. Null when unavailable (dev /
  // browser without sidecar).
  const resolveWorkspaceRoot = (): string | null => currentRepoPath.value

  // ─── Core helpers ─────────────────────────────────────────────────────────
  const pushToast = (text: string, kind: 'info' | 'success' | 'error' = 'info') => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    toasts.value = [...toasts.value, { id, text, kind }]
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, 3200)
  }

  const setSelectedProject = (id: string) => {
    if (id === selectedProjectId.value) return
    selectedProjectId.value = id
    selectedFilePath.value = null
    selectedCommitHash.value = null
    commitMessage.value = ''
  }

  // Switch the active repo within the current project. Invalidates the
  // per-project caches so the next load re-fetches the new repo (otherwise the
  // branch TTL cache would surface the previous repo's branches).
  const setSelectedRepo = (path: string) => {
    const projectId = selectedProjectId.value
    if (selectedRepoPathByProject.value[projectId] === path) return
    selectedRepoPathByProject.value = { ...selectedRepoPathByProject.value, [projectId]: path }
    selectedFilePath.value = null
    selectedCommitHash.value = null
    commitMessage.value = ''
    const nextBranches = { ...branchesLastFetchedAt.value }
    delete nextBranches[projectId]
    branchesLastFetchedAt.value = nextBranches
    const nextRemotes = { ...remotesLastFetchedAt.value }
    delete nextRemotes[projectId]
    remotesLastFetchedAt.value = nextRemotes
    const nextHistory = { ...historyHasMoreByProject.value }
    delete nextHistory[projectId]
    historyHasMoreByProject.value = nextHistory
  }

  // Mutation helper cho dirty-checkout dialog.
  const clearStatusForCurrentProject = () => {
    statusFilesAll.value = statusFilesAll.value.filter(
      (f) => f.projectId !== selectedProjectId.value,
    )
  }

  return {
    // raw state
    selectedProjectId,
    reposByProject,
    selectedRepoPathByProject,
    branchesAll,
    commitsAll,
    stashesAll,
    remotesAll,
    statusFilesAll,
    selectedFilePath,
    selectedCommitHash,
    commitMessage,
    repoStateByProject,
    isFetching,
    isPulling,
    isPushing,
    isGeneratingMessage,
    progressPct,
    progressOp,
    progressPhase,
    toasts,
    pendingAuthError,
    pendingPullDivergence,
    pendingPushNonFf,
    currentConflictFile,
    isMerging,
    isDetached,
    detachedAt,
    branchesLastFetchedAt,
    remotesLastFetchedAt,
    historyHasMoreByProject,
    isLoadingHistoryMore,
    pendingCheckoutError,
    pendingDeleteError,
    // getters
    branches,
    commits,
    stashes,
    remotes,
    statusFiles,
    currentBranch,
    currentBranchInfo,
    ahead,
    behind,
    stagedFiles,
    unstagedFiles,
    untrackedFiles,
    conflictedFiles,
    hasUncommitted,
    hasConflict,
    isBusy,
    repoState,
    historyHasMore,
    dirtyCountByProject,
    repos,
    currentRepoPath,
    // helpers
    resolveProjectPath,
    resolveWorkspaceRoot,
    pushToast,
    setSelectedProject,
    setSelectedRepo,
    clearStatusForCurrentProject,
  }
}

export type GitContext = ReturnType<typeof createGitContext>
