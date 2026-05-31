import { defineStore } from 'pinia'
import type {
  GitBranch,
  GitCommit,
  GitConflictFile,
  GitDiffLine,
  GitDiffLineKind,
  GitFileDiff,
  GitFileStatus,
  GitFileStatusCode,
  GitRemote,
  GitRepoState,
  GitStashEntry,
} from '~/types'
import {
  INITIAL_BINARY_PATH,
  INITIAL_BRANCHES,
  INITIAL_COMMITS,
  INITIAL_FILE_DIFFS,
  INITIAL_REMOTES,
  INITIAL_STASHES,
  INITIAL_STATUS_FILES,
  buildAutoCommit,
} from '~/utils/initial-git'
import {
  useGitApi,
  type GitStreamingOp,
  type SidecarGitBranch,
  type SidecarGitCommit,
  type SidecarGitFileDiff,
  type SidecarGitFileStatus,
  type SidecarGitRemote,
  type SidecarGitStashEntry,
} from '~/composables/useGitApi'
import { useSettingsStore } from '~/stores/settings'
import { SidecarError, SidecarUnavailableError, useSidecar } from '~/composables/useSidecar'

// TODO(sidecar): mutation actions vẫn mock — M2..M5 sẽ wire stage/unstage/commit/...
const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
const latency = (min = 250, max = 700) => wait(Math.floor(min + Math.random() * (max - min)))

// ─── Adapters: sidecar shape → UI per-project shape ────────────────────────

const SIDECAR_CHANGE_TO_UI: Record<string, GitFileStatusCode> = {
  added: 'added',
  modified: 'modified',
  deleted: 'deleted',
  renamed: 'renamed',
  copied: 'copied',
  untracked: 'untracked',
  conflicted: 'conflicted',
  type_changed: 'modified',
  ignored: 'modified',
}

function adaptFile(projectId: string, f: SidecarGitFileStatus): GitFileStatus {
  const code = SIDECAR_CHANGE_TO_UI[f.changeType] ?? 'modified'
  const isStaged = f.stageState === 'staged'
  const hasConflict = f.stageState === 'conflicted'
  const out: GitFileStatus = {
    projectId,
    path: f.path,
    index: isStaged ? code : 'clean',
    workTree: isStaged ? 'clean' : code,
    isBinary: f.isBinary,
    isStaged,
    hasConflict,
  }
  if (f.oldPath !== undefined) out.oldPath = f.oldPath
  return out
}

function adaptCommit(projectId: string, c: SidecarGitCommit): GitCommit {
  const { subject } = c
  const body = c.message.length > subject.length ? c.message.slice(subject.length).trimStart() : ''
  const refs: GitCommit['refs'] = c.refs.map((r) => ({ kind: r.kind, name: r.name }))
  const out: GitCommit = {
    projectId,
    hash: c.sha,
    shortHash: c.sha7,
    authorName: c.authorName,
    authorEmail: c.authorEmail,
    date: c.authorAt,
    subject,
    parents: c.parents,
    refs,
  }
  if (body) out.body = body
  if (c.linkedPhaseId !== undefined) out.phaseId = c.linkedPhaseId
  return out
}

function adaptBranch(projectId: string, b: SidecarGitBranch): GitBranch {
  const out: GitBranch = {
    projectId,
    name: b.name,
    isCurrent: b.isCurrent,
    isRemote: b.kind === 'remote',
    ahead: b.ahead,
    behind: b.behind,
    lastCommit: b.lastCommitSha,
  }
  if (b.upstream) out.upstream = b.upstream
  return out
}

function adaptStash(projectId: string, s: SidecarGitStashEntry): GitStashEntry {
  return {
    projectId,
    index: s.index,
    ref: `stash@{${s.index}}`,
    message: s.message,
    date: s.createdAt,
    branch: s.baseBranch,
  }
}

function adaptRemote(projectId: string, r: SidecarGitRemote): GitRemote {
  return {
    projectId,
    name: r.name,
    fetchUrl: r.fetchUrl,
    pushUrl: r.pushUrl,
  }
}

function adaptDiff(d: SidecarGitFileDiff): GitFileDiff {
  const hunks = d.hunks.map((h) => ({
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    header: h.header,
    lines: h.lines.map<GitDiffLine>((ln) => {
      // UI's GitDiffLineKind has no `noeol` — collapse into context.
      const kind: GitDiffLineKind = ln.kind === 'noeol' ? 'context' : ln.kind
      return { kind, text: ln.content }
    }),
  }))
  const out: GitFileDiff = {
    path: d.path,
    isBinary: d.isBinary,
    hunks,
  }
  if (d.oldPath !== undefined) out.oldPath = d.oldPath
  return out
}

// In browser dev mode the sidecar is unavailable — read actions become no-ops
// and the mock seed remains intact.
function isUnavailable(err: unknown): boolean {
  return err instanceof SidecarUnavailableError
}

// Extract a git error code (DIRTY_TREE / UNMERGED / …) from an RPC error.
function gitCodeOf(err: unknown): string | null {
  if (!(err instanceof SidecarError)) return null
  const data = err.data as { gitCode?: string } | undefined
  return data?.gitCode ?? null
}

const cloneFiles = (files: GitFileStatus[]): GitFileStatus[] => files.map((f) => ({ ...f }))

const DEFAULT_PROJECT_ID = 'prj1'

export const useGitStore = defineStore('git', () => {
  // ─── State ───────────────────────────────────────────────────────────────
  const selectedProjectId = ref<string>(DEFAULT_PROJECT_ID)
  const branchesAll = ref<GitBranch[]>([...INITIAL_BRANCHES])
  const commitsAll = ref<GitCommit[]>([...INITIAL_COMMITS])
  const stashesAll = ref<GitStashEntry[]>([...INITIAL_STASHES])
  const remotesAll = ref<GitRemote[]>([...INITIAL_REMOTES])
  const statusFilesAll = ref<GitFileStatus[]>(cloneFiles(INITIAL_STATUS_FILES))
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

  // Branches/remotes 5s cache (M7 perf polish). Avoids re-spawning git on
  // every tab switch / project reselect when nothing changed externally.
  const CACHE_TTL_MS = 5_000
  const branchesLastFetchedAt = ref<Record<string, number>>({})
  const remotesLastFetchedAt = ref<Record<string, number>>({})

  // Pagination cursor + flag for `loadHistory`. Per-project so switching
  // projects resets the "Load more" affordance.
  const HISTORY_PAGE_SIZE = 100
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

  // ─── Helpers ─────────────────────────────────────────────────────────────
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

  // Resolve the absolute path of the currently selected project. Returns
  // null when the project does not exist (dev / browser without sidecar).
  const resolveWorkspaceRoot = (): string | null => {
    const workspace = useWorkspaceStore()
    const project = workspace.projects.find((p) => p.id === selectedProjectId.value)
    return project?.path ?? null
  }

  // ─── Actions ─────────────────────────────────────────────────────────────
  const loadStatus = async () => {
    const projectId = selectedProjectId.value
    const root = resolveWorkspaceRoot()
    if (!root) {
      // Mock seed still owns the state; pretend we're loading.
      await latency(80, 160)
      return
    }
    // Instrumentation: log slow status fetches. Spec target: < 200ms for
    // repos ≤ 2k files (AC-43). Best-effort, not asserted.
    const startedAt = performance.now()
    try {
      const api = useGitApi()
      const result = await api.status(root)
      const adapted = result.files.map((f) => adaptFile(projectId, f))
      statusFilesAll.value = [
        ...statusFilesAll.value.filter((f) => f.projectId !== projectId),
        ...adapted,
      ]
      isMerging.value = result.isMerging
      isDetached.value = result.detached
      detachedAt.value = result.detachedAt ?? null
      // Clear no-repo cache flag if previously set — repo now reachable.
      if (repoStateByProject.value[projectId] === 'no-repo') {
        const next = { ...repoStateByProject.value }
        delete next[projectId]
        repoStateByProject.value = next
      }
      const elapsed = performance.now() - startedAt
      if (elapsed > 1000) {
        // eslint-disable-next-line no-console
        console.warn('[git] loadStatus slow', { ms: Math.round(elapsed), root })
      }
    } catch (err) {
      if (isUnavailable(err)) return
      if (gitCodeOf(err) === 'NO_REPO') {
        repoStateByProject.value = {
          ...repoStateByProject.value,
          [projectId]: 'no-repo',
        }
        // Wipe stale files from a previous repo at the same path.
        statusFilesAll.value = statusFilesAll.value.filter((f) => f.projectId !== projectId)
        isMerging.value = false
        isDetached.value = false
        detachedAt.value = null
        return
      }
      throw err
    }
  }

  // History pagination semantics:
  //   - default call (no opts) → fresh load, replace the project's commits.
  //   - `{ append: true, skip: N }` → load more, append to the existing list.
  // Sidecar's `git.log` already returns `hasMore` so we can keep a stateful
  // flag the UI binds to a "Load more" button.
  const loadHistory = async (opts: { limit?: number; skip?: number; append?: boolean } = {}) => {
    const projectId = selectedProjectId.value
    const root = resolveWorkspaceRoot()
    if (!root) return
    const limit = opts.limit ?? HISTORY_PAGE_SIZE
    try {
      const api = useGitApi()
      const params: { workspaceRoot: string; limit: number; skip?: number } = {
        workspaceRoot: root,
        limit,
      }
      if (opts.skip !== undefined) params.skip = opts.skip
      const result = await api.log(params)
      const adapted = result.commits.map((c) => adaptCommit(projectId, c))
      if (opts.append) {
        commitsAll.value = [...commitsAll.value, ...adapted]
      } else {
        commitsAll.value = [
          ...commitsAll.value.filter((c) => c.projectId !== projectId),
          ...adapted,
        ]
      }
      historyHasMoreByProject.value = {
        ...historyHasMoreByProject.value,
        [projectId]: result.hasMore,
      }
    } catch (err) {
      if (!isUnavailable(err)) throw err
    }
  }

  const loadMoreHistory = async () => {
    if (isLoadingHistoryMore.value) return
    const projectId = selectedProjectId.value
    if (!historyHasMoreByProject.value[projectId]) return
    isLoadingHistoryMore.value = true
    try {
      const existing = commitsAll.value.filter((c) => c.projectId === projectId).length
      await loadHistory({ skip: existing, append: true })
    } finally {
      isLoadingHistoryMore.value = false
    }
  }

  const loadBranches = async (opts: { force?: boolean } = {}) => {
    const projectId = selectedProjectId.value
    const root = resolveWorkspaceRoot()
    if (!root) return
    if (!opts.force) {
      const last = branchesLastFetchedAt.value[projectId] ?? 0
      if (Date.now() - last < CACHE_TTL_MS) return
    }
    try {
      const api = useGitApi()
      const result = await api.branchList(root)
      const adapted = result.branches.map((b) => adaptBranch(projectId, b))
      branchesAll.value = [
        ...branchesAll.value.filter((b) => b.projectId !== projectId),
        ...adapted,
      ]
      branchesLastFetchedAt.value = {
        ...branchesLastFetchedAt.value,
        [projectId]: Date.now(),
      }
    } catch (err) {
      if (!isUnavailable(err)) throw err
    }
  }

  const loadStashes = async () => {
    const projectId = selectedProjectId.value
    const root = resolveWorkspaceRoot()
    if (!root) return
    try {
      const api = useGitApi()
      const result = await api.stashList(root)
      const adapted = result.stashes.map((s) => adaptStash(projectId, s))
      stashesAll.value = [...stashesAll.value.filter((s) => s.projectId !== projectId), ...adapted]
    } catch (err) {
      if (!isUnavailable(err)) throw err
    }
  }

  const loadRemotes = async (opts: { force?: boolean } = {}) => {
    const projectId = selectedProjectId.value
    const root = resolveWorkspaceRoot()
    if (!root) return
    if (!opts.force) {
      const last = remotesLastFetchedAt.value[projectId] ?? 0
      if (Date.now() - last < CACHE_TTL_MS) return
    }
    try {
      const api = useGitApi()
      const result = await api.remoteList(root)
      const adapted = result.remotes.map((r) => adaptRemote(projectId, r))
      remotesAll.value = [...remotesAll.value.filter((r) => r.projectId !== projectId), ...adapted]
      remotesLastFetchedAt.value = {
        ...remotesLastFetchedAt.value,
        [projectId]: Date.now(),
      }
    } catch (err) {
      if (!isUnavailable(err)) throw err
    }
  }

  // Snapshot a file's current state so we can roll back the optimistic update
  // if the IPC call fails.
  const snapshotFile = (path: string): GitFileStatus | null => {
    const file = statusFilesAll.value.find(
      (f) => f.path === path && f.projectId === selectedProjectId.value,
    )
    return file ? { ...file } : null
  }

  const restoreFile = (snapshot: GitFileStatus): void => {
    const idx = statusFilesAll.value.findIndex(
      (f) => f.path === snapshot.path && f.projectId === snapshot.projectId,
    )
    if (idx >= 0) statusFilesAll.value[idx] = { ...snapshot }
    else statusFilesAll.value = [...statusFilesAll.value, { ...snapshot }]
  }

  const stageFile = async (path: string) => {
    const file = statusFilesAll.value.find(
      (f) => f.path === path && f.projectId === selectedProjectId.value,
    )
    if (!file || file.hasConflict) return
    const snapshot = snapshotFile(path)
    // Optimistic — mirror what git add will produce.
    file.isStaged = true
    if (file.workTree === 'untracked') {
      file.index = 'added'
      file.workTree = 'clean'
    } else if (file.workTree !== 'clean') {
      file.index = file.workTree
    }

    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(80, 160)
      return
    }
    try {
      await useGitApi().stageFile(root, [path])
    } catch (err) {
      if (isUnavailable(err)) return
      if (snapshot) restoreFile(snapshot)
      pushToast(`Stage thất bại: ${path}`, 'error')
      throw err
    }
  }

  const unstageFile = async (path: string) => {
    const file = statusFilesAll.value.find(
      (f) => f.path === path && f.projectId === selectedProjectId.value,
    )
    if (!file) return
    const snapshot = snapshotFile(path)
    file.isStaged = false
    if (file.index === 'added') {
      file.workTree = 'untracked'
      file.index = 'clean'
    } else if (file.index !== 'clean') {
      file.workTree = file.index
      file.index = 'clean'
    }

    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(80, 160)
      return
    }
    try {
      await useGitApi().unstageFile(root, [path])
    } catch (err) {
      if (isUnavailable(err)) return
      if (snapshot) restoreFile(snapshot)
      pushToast(`Unstage thất bại: ${path}`, 'error')
      throw err
    }
  }

  const discardFile = async (path: string) => {
    const snapshot = snapshotFile(path)
    // Optimistic remove — after discard the file is gone from `git status`.
    statusFilesAll.value = statusFilesAll.value.filter(
      (f) => !(f.path === path && f.projectId === selectedProjectId.value),
    )
    if (selectedFilePath.value === path) selectedFilePath.value = null

    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(120, 220)
      return
    }
    try {
      await useGitApi().discardFile(root, [path])
    } catch (err) {
      if (isUnavailable(err)) return
      if (snapshot) restoreFile(snapshot)
      pushToast(`Discard thất bại: ${path}`, 'error')
      throw err
    }
  }

  const selectFile = (path: string | null) => {
    selectedFilePath.value = path
  }

  const selectCommit = (hash: string | null) => {
    selectedCommitHash.value = hash
  }

  const setCommitMessage = (msg: string) => {
    commitMessage.value = msg
  }

  // Mock-only commit path used when sidecar is unavailable (browser dev). Keeps
  // the prototype UX intact for screenshots / demos.
  const commitMock = (message: string, amend: boolean): void => {
    const trimmed = message.trim()
    const projectId = selectedProjectId.value
    const hash = `mock${Date.now().toString(16).slice(-7)}${Math.random().toString(16).slice(2, 6)}`
    const subject = trimmed.split('\n')[0] ?? trimmed
    const body = trimmed.includes('\n') ? trimmed.slice(subject.length + 1).trim() : undefined
    const phaseMatch = trimmed.match(/^\[([^\]]+)\]/)
    if (amend) {
      const previous = commits.value[0]
      if (!previous) return
      const updated: GitCommit = {
        ...previous,
        hash,
        shortHash: hash.slice(0, 7),
        subject,
        body: body ?? previous.body,
        date: new Date().toISOString(),
      }
      const idx = commitsAll.value.findIndex(
        (c) => c.projectId === projectId && c.hash === previous.hash,
      )
      if (idx >= 0) {
        commitsAll.value = [
          ...commitsAll.value.slice(0, idx),
          updated,
          ...commitsAll.value.slice(idx + 1),
        ]
      }
    } else {
      const parentHash = commits.value[0]?.hash
      const newCommit: GitCommit = {
        projectId,
        hash,
        shortHash: hash.slice(0, 7),
        authorName: 'Local Developer',
        authorEmail: 'dev@awog.local',
        date: new Date().toISOString(),
        subject,
        body,
        parents: parentHash ? [parentHash] : [],
        refs: [
          { kind: 'HEAD', name: currentBranch.value },
          { kind: 'branch', name: currentBranch.value },
        ],
        phaseId: phaseMatch?.[1],
      }
      commitsAll.value = [
        newCommit,
        ...commitsAll.value.map((c) => (c.projectId === projectId ? { ...c, refs: [] } : c)),
      ]
      branchesAll.value = branchesAll.value.map((b) =>
        b.projectId === projectId && b.isCurrent && !b.isRemote
          ? { ...b, ahead: b.ahead + 1, lastCommit: hash }
          : b,
      )
    }
    statusFilesAll.value = statusFilesAll.value.filter(
      (f) => !(f.projectId === projectId && f.isStaged),
    )
  }

  const runCommit = async (message: string, amend: boolean) => {
    const trimmed = message.trim()
    if (!trimmed && !amend) {
      pushToast('Commit message không được rỗng', 'error')
      return
    }
    if (!amend && stagedFiles.value.length === 0) {
      pushToast('Không có thay đổi để commit', 'error')
      return
    }
    if (amend && commits.value.length === 0) {
      pushToast('Không có commit để amend', 'error')
      return
    }
    const root = resolveWorkspaceRoot()
    if (!root) {
      // Fallback to mock path so dev-mode UI still feels responsive.
      await latency(400, 700)
      commitMock(message, amend)
      commitMessage.value = ''
      const verb = amend ? 'Amended' : 'Commit'
      pushToast(`${verb} (mock) tạo thành công`, 'success')
      return
    }
    try {
      const params: { message: string; amend?: boolean } = { message: trimmed }
      if (amend) params.amend = true
      const result = await useGitApi().commit(root, params)
      commitMessage.value = ''
      const verb = amend ? 'Amended' : 'Commit'
      pushToast(`${verb} ${result.sha7}`, 'success')
      // Re-sync from filesystem — sidecar already emitted git:status:changed,
      // but explicit refresh keeps history list in sync immediately.
      await Promise.all([loadStatus(), loadHistory()])
    } catch (err) {
      if (isUnavailable(err)) {
        commitMock(message, amend)
        commitMessage.value = ''
        return
      }
      const msg = err instanceof Error ? err.message : 'Commit thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  const commit = (message: string) => runCommit(message, false)
  const amendCommit = (message: string) => runCommit(message, true)

  const resetProgress = () => {
    progressPct.value = null
    progressPhase.value = null
    progressOp.value = null
  }

  // Mock progress walker used when sidecar is unavailable (dev / browser).
  const runMockProgress = async (op: GitStreamingOp, duration: number) => {
    progressOp.value = op
    progressPhase.value = 'mock'
    progressPct.value = 0
    const steps = 12
    const tick = duration / steps
    for (let i = 1; i <= steps; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await wait(tick)
      progressPct.value = Math.round((i / steps) * 100)
    }
    resetProgress()
  }

  // Extract a structured auth/git error payload from an RPC error.
  type AuthHint = 'ssh-key' | 'https-token' | 'unknown'
  const authPayload = (err: unknown): { hint: AuthHint; message: string } | null => {
    if (!(err instanceof SidecarError)) return null
    const data = err.data as { gitCode?: string; hint?: AuthHint; stderrSanitized?: string }
    if (data?.gitCode !== 'AUTH_FAILED') return null
    return {
      hint: data.hint ?? 'unknown',
      message: data.stderrSanitized ?? err.message,
    }
  }

  const fetchRemote = async (remote?: string) => {
    if (isFetching.value) return
    isFetching.value = true
    progressOp.value = 'fetch'
    progressPct.value = null
    progressPhase.value = 'starting'
    const root = resolveWorkspaceRoot()
    if (!root) {
      try {
        await runMockProgress('fetch', 1200)
        pushToast('Fetched origin (mock)', 'success')
      } finally {
        isFetching.value = false
        resetProgress()
      }
      return
    }
    try {
      const params: { remote?: string } = {}
      if (remote !== undefined) params.remote = remote
      const result = await useGitApi().fetch(root, params)
      const n = result.updated.length
      pushToast(
        n > 0 ? `Fetched ${n} ref${n === 1 ? '' : 's'}` : 'Fetched (đã up-to-date)',
        'success',
      )
      await Promise.all([loadBranches({ force: true }), loadStatus()])
    } catch (err) {
      if (isUnavailable(err)) return
      const auth = authPayload(err)
      if (auth) {
        pendingAuthError.value = { op: 'fetch', hint: auth.hint, message: auth.message }
        return
      }
      const msg = err instanceof Error ? err.message : 'Fetch thất bại'
      pushToast(msg, 'error')
    } finally {
      isFetching.value = false
      resetProgress()
    }
  }

  const pull = async (strategy: 'ff-only' | 'merge' | 'rebase' = 'ff-only') => {
    if (isPulling.value) return
    isPulling.value = true
    progressOp.value = 'pull'
    progressPct.value = null
    progressPhase.value = 'starting'
    const root = resolveWorkspaceRoot()
    if (!root) {
      try {
        await runMockProgress('pull', 1500)
        const projectId = selectedProjectId.value
        branchesAll.value = branchesAll.value.map((b) =>
          b.projectId === projectId && b.isCurrent && !b.isRemote ? { ...b, behind: 0 } : b,
        )
        pushToast(`Pulled origin/${currentBranch.value} (mock fast-forward)`, 'success')
      } finally {
        isPulling.value = false
        resetProgress()
      }
      return
    }
    try {
      const result = await useGitApi().pull(root, { strategy })
      const verb = result.fastForwarded ? 'fast-forward' : strategy
      const n = result.commitsApplied
      pushToast(
        n > 0 ? `Pulled ${n} commit${n === 1 ? '' : 's'} (${verb})` : `Đã up-to-date (${verb})`,
        'success',
      )
      await Promise.all([loadStatus(), loadHistory(), loadBranches({ force: true })])
    } catch (err) {
      if (isUnavailable(err)) return
      const auth = authPayload(err)
      if (auth) {
        pendingAuthError.value = { op: 'pull', hint: auth.hint, message: auth.message }
        return
      }
      const code = gitCodeOf(err)
      if (code === 'NOT_FAST_FORWARD') {
        pendingPullDivergence.value = true
        return
      }
      if (code === 'MERGE_CONFLICT') {
        // Refresh status so conflict files appear in the list — actual resolver
        // wiring lands in M5.
        await loadStatus().catch(() => undefined)
        pushToast('Có conflict — mở Conflict Resolver', 'error')
        return
      }
      const msg = err instanceof Error ? err.message : 'Pull thất bại'
      pushToast(msg, 'error')
    } finally {
      isPulling.value = false
      resetProgress()
    }
  }

  const push = async (setUpstream = false) => {
    if (isPushing.value) return
    isPushing.value = true
    progressOp.value = 'push'
    progressPct.value = null
    progressPhase.value = 'starting'
    const root = resolveWorkspaceRoot()
    if (!root) {
      try {
        await runMockProgress('push', 1800)
        const projectId = selectedProjectId.value
        const pushed = ahead.value
        branchesAll.value = branchesAll.value.map((b) =>
          b.projectId === projectId && b.isCurrent && !b.isRemote ? { ...b, ahead: 0 } : b,
        )
        pushToast(`Pushed ${pushed} commits to origin/${currentBranch.value} (mock)`, 'success')
      } finally {
        isPushing.value = false
        resetProgress()
      }
      return
    }
    try {
      const params: { setUpstream?: boolean } = {}
      if (setUpstream) params.setUpstream = true
      const result = await useGitApi().push(root, params)
      const n = result.pushed
      pushToast(n > 0 ? `Pushed ${n} ref${n === 1 ? '' : 's'}` : 'Push thành công', 'success')
      await loadBranches({ force: true })
    } catch (err) {
      if (isUnavailable(err)) return
      const auth = authPayload(err)
      if (auth) {
        pendingAuthError.value = { op: 'push', hint: auth.hint, message: auth.message }
        return
      }
      const code = gitCodeOf(err)
      if (code === 'NOT_FAST_FORWARD') {
        pendingPushNonFf.value = true
        return
      }
      const msg = err instanceof Error ? err.message : 'Push thất bại'
      pushToast(msg, 'error')
    } finally {
      isPushing.value = false
      resetProgress()
    }
  }

  const cancel = async (op: GitStreamingOp) => {
    const root = resolveWorkspaceRoot()
    if (!root) {
      resetProgress()
      isFetching.value = false
      isPulling.value = false
      isPushing.value = false
      pushToast(`${op} cancelled (mock)`, 'info')
      return
    }
    try {
      await useGitApi().cancel(root, op)
      pushToast(`${op} cancel requested`, 'info')
    } catch (err) {
      if (isUnavailable(err)) return
      const msg = err instanceof Error ? err.message : 'Cancel thất bại'
      pushToast(msg, 'error')
    }
  }

  // Pull-then-push helper for Flow 2 (non-ff push recovery). Best-effort: if
  // pull fails (auth / conflict) we surface the original failure and abort —
  // user can retry manually.
  const pullThenPush = async (strategy: 'ff-only' | 'merge' | 'rebase' = 'merge') => {
    pendingPushNonFf.value = false
    await pull(strategy)
    // Only retry push if pull succeeded (no pending modals popped).
    if (pendingAuthError.value || pendingPullDivergence.value) return
    if (hasConflict.value) return
    await push()
  }

  const clearPendingAuthError = () => {
    pendingAuthError.value = null
  }
  const clearPendingPullDivergence = () => {
    pendingPullDivergence.value = false
  }
  const clearPendingPushNonFf = () => {
    pendingPushNonFf.value = false
  }

  // Mock fallback used when sidecar is unavailable (browser dev / Storybook).
  const createBranchMock = (projectId: string, name: string, fromRef?: string) => {
    const baseCommit = fromRef ?? commits.value[0]?.hash ?? 'HEAD'
    branchesAll.value = [
      ...branchesAll.value,
      {
        projectId,
        name,
        isCurrent: false,
        isRemote: false,
        ahead: 0,
        behind: 0,
        lastCommit: baseCommit,
      },
    ]
  }

  const createBranch = async (name: string, fromRef?: string, checkout = false) => {
    const trimmed = name.trim()
    if (!trimmed) {
      pushToast('Branch name không được rỗng', 'error')
      return
    }
    const projectId = selectedProjectId.value
    if (
      branchesAll.value.some((b) => b.projectId === projectId && b.name === trimmed && !b.isRemote)
    ) {
      pushToast(`Branch '${trimmed}' đã tồn tại`, 'error')
      return
    }
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(200, 400)
      createBranchMock(projectId, trimmed, fromRef)
      pushToast(`Created branch '${trimmed}' (mock)`, 'success')
      return
    }
    try {
      const params: { name: string; from?: string; checkout?: boolean } = {
        name: trimmed,
        checkout,
      }
      if (fromRef) params.from = fromRef
      await useGitApi().branchCreate(root, params)
      await Promise.all([loadBranches({ force: true }), loadStatus()])
      pushToast(`Created branch '${trimmed}'`, 'success')
    } catch (err) {
      if (isUnavailable(err)) {
        createBranchMock(projectId, trimmed, fromRef)
        pushToast(`Created branch '${trimmed}' (mock)`, 'success')
        return
      }
      const msg = err instanceof Error ? err.message : 'Create branch thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  const checkoutBranchMock = (projectId: string, name: string) => {
    branchesAll.value = branchesAll.value.map((b) =>
      b.projectId === projectId ? { ...b, isCurrent: !b.isRemote && b.name === name } : b,
    )
  }

  const checkoutBranch = async (name: string, opts: { force?: boolean } = {}) => {
    const projectId = selectedProjectId.value
    const target = branchesAll.value.find(
      (b) => b.projectId === projectId && b.name === name && !b.isRemote,
    )
    // Mock-only path tolerates missing branch entries; sidecar path defers to
    // git which has the authoritative list.
    const root = resolveWorkspaceRoot()
    if (!root) {
      if (!target) {
        pushToast(`Branch '${name}' không tồn tại`, 'error')
        return
      }
      await latency(250, 500)
      checkoutBranchMock(projectId, name)
      pushToast(`Checked out '${name}' (mock)`, 'success')
      return
    }
    try {
      const params: { name: string; force?: boolean } = { name }
      if (opts.force) params.force = true
      await useGitApi().branchCheckout(root, params)
      // loadHistory too — commit refs[] (HEAD pointer) is decoration-time, so
      // skipping the refresh leaves the HEAD badge on the previous branch tip.
      await Promise.all([loadBranches({ force: true }), loadStatus(), loadHistory()])
      pushToast(`Checked out '${name}'`, 'success')
    } catch (err) {
      if (isUnavailable(err)) {
        checkoutBranchMock(projectId, name)
        pushToast(`Checked out '${name}' (mock)`, 'success')
        return
      }
      // Dirty-tree refusal surfaces as a structured error with the file list —
      // expose it so the UI can open GitDirtyCheckoutModal.
      if (gitCodeOf(err) === 'DIRTY_TREE') {
        const data = (err as SidecarError).data as { files?: SidecarGitFileStatus[] } | undefined
        pendingCheckoutError.value = {
          branch: name,
          files: data?.files ?? [],
        }
        return
      }
      const msg = err instanceof Error ? err.message : 'Checkout thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  const clearPendingCheckoutError = () => {
    pendingCheckoutError.value = null
  }

  const renameBranch = async (oldName: string, newName: string) => {
    const trimmed = newName.trim()
    if (!trimmed) {
      pushToast('Branch name không được rỗng', 'error')
      return
    }
    if (trimmed === oldName) return
    const projectId = selectedProjectId.value
    if (
      branchesAll.value.some((b) => b.projectId === projectId && b.name === trimmed && !b.isRemote)
    ) {
      pushToast(`Branch '${trimmed}' đã tồn tại`, 'error')
      return
    }
    await latency(150, 300)
    branchesAll.value = branchesAll.value.map((b) =>
      b.projectId === projectId && b.name === oldName && !b.isRemote ? { ...b, name: trimmed } : b,
    )
    pushToast(`Renamed '${oldName}' → '${trimmed}'`, 'success')
  }

  const deleteBranchMock = (projectId: string, name: string) => {
    branchesAll.value = branchesAll.value.filter(
      (b) => !(b.projectId === projectId && b.name === name && !b.isRemote),
    )
  }

  const deleteBranch = async (
    name: string,
    opts: { force?: boolean; deleteRemote?: boolean } = {},
  ) => {
    const projectId = selectedProjectId.value
    if (name === currentBranch.value) {
      pushToast('Không thể xóa branch hiện tại', 'error')
      return
    }
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(150, 300)
      deleteBranchMock(projectId, name)
      pushToast(`Deleted branch '${name}' (mock)`, 'success')
      return
    }
    try {
      const params: { name: string; force?: boolean; deleteRemote?: boolean } = { name }
      if (opts.force) params.force = true
      if (opts.deleteRemote) params.deleteRemote = true
      const result = await useGitApi().branchDelete(root, params)
      await loadBranches({ force: true })
      if (opts.deleteRemote) {
        if (result.remoteDeleted) {
          pushToast(`Deleted branch '${name}' + origin/${name}`, 'success')
        } else {
          pushToast(
            `Deleted local '${name}', remote delete failed${result.remoteError ? `: ${result.remoteError}` : ''}`,
            'error',
          )
        }
      } else {
        pushToast(`Deleted branch '${name}'`, 'success')
      }
    } catch (err) {
      if (isUnavailable(err)) {
        deleteBranchMock(projectId, name)
        pushToast(`Deleted branch '${name}' (mock)`, 'success')
        return
      }
      // Not-fully-merged → ask user to force.
      if (gitCodeOf(err) === 'UNMERGED') {
        pendingDeleteError.value = { branch: name }
        return
      }
      const msg = err instanceof Error ? err.message : 'Delete branch thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  const clearPendingDeleteError = () => {
    pendingDeleteError.value = null
  }

  // Mock helpers for browser-only dev. Sidecar path owns the canonical state.
  const reindexProjectStashes = (projectId: string) => {
    const list = stashesAll.value.filter((s) => s.projectId === projectId)
    const others = stashesAll.value.filter((s) => s.projectId !== projectId)
    const reindexed = list.map((s, i) => ({ ...s, index: i, ref: `stash@{${i}}` }))
    stashesAll.value = [...reindexed, ...others]
  }

  const stashSaveMock = (projectId: string, message: string) => {
    const existing = stashesAll.value.filter((s) => s.projectId === projectId)
    const others = stashesAll.value.filter((s) => s.projectId !== projectId)
    const entry: GitStashEntry = {
      projectId,
      index: 0,
      ref: 'stash@{0}',
      message,
      date: new Date().toISOString(),
      branch: currentBranch.value,
    }
    stashesAll.value = [
      entry,
      ...existing.map((s, i) => ({ ...s, index: i + 1, ref: `stash@{${i + 1}}` })),
      ...others,
    ]
    statusFilesAll.value = statusFilesAll.value.filter((f) => f.projectId !== projectId)
  }

  const stashSave = async (message?: string, includeUntracked = true) => {
    const trimmed = (message ?? '').trim() || `WIP on ${currentBranch.value}`
    const projectId = selectedProjectId.value
    const root = resolveWorkspaceRoot()
    if (!root) {
      if (!hasUncommitted.value) {
        pushToast('Không có thay đổi để stash', 'error')
        return
      }
      await latency(250, 450)
      stashSaveMock(projectId, trimmed)
      pushToast(`Stashed changes — stash@{0} (mock)`, 'success')
      return
    }
    try {
      const result = await useGitApi().stashSave(root, {
        message: trimmed,
        includeUntracked,
      })
      await Promise.all([loadStashes(), loadStatus()])
      pushToast(`Stashed changes — stash@{${result.index}}`, 'success')
    } catch (err) {
      if (isUnavailable(err)) {
        stashSaveMock(projectId, trimmed)
        pushToast(`Stashed changes (mock)`, 'success')
        return
      }
      if (gitCodeOf(err) === 'INVALID_PATH') {
        // Sidecar maps "No local changes to save" onto this code — keep the
        // copy clearer than the raw stderr.
        pushToast('Không có thay đổi để stash', 'error')
        return
      }
      const msg = err instanceof Error ? err.message : 'Stash thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  const stashPop = async (index: number) => {
    const projectId = selectedProjectId.value
    const root = resolveWorkspaceRoot()
    if (!root) {
      const entry = stashesAll.value.find((s) => s.projectId === projectId && s.index === index)
      if (!entry) return
      await latency(250, 450)
      if (!statusFiles.value.length) {
        const sample = INITIAL_STATUS_FILES.filter((f) => f.projectId === projectId).slice(0, 3)
        statusFilesAll.value = [...statusFilesAll.value, ...cloneFiles(sample)]
      }
      stashesAll.value = stashesAll.value.filter(
        (s) => !(s.projectId === projectId && s.index === index),
      )
      reindexProjectStashes(projectId)
      pushToast(`Popped stash@{${index}} (mock)`, 'success')
      return
    }
    try {
      const result = await useGitApi().stashPop(root, index)
      await Promise.all([loadStashes(), loadStatus()])
      if (result.hasConflict) {
        pushToast(`Pop có conflict — stash@{${index}} vẫn còn, mở Conflict Resolver`, 'error')
      } else {
        pushToast(`Popped stash@{${index}}`, 'success')
      }
    } catch (err) {
      if (isUnavailable(err)) return
      const msg = err instanceof Error ? err.message : 'Stash pop thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  const stashApply = async (index: number) => {
    const root = resolveWorkspaceRoot()
    if (!root) {
      const projectId = selectedProjectId.value
      await latency(250, 450)
      if (!statusFiles.value.length) {
        const sample = INITIAL_STATUS_FILES.filter((f) => f.projectId === projectId).slice(0, 3)
        statusFilesAll.value = [...statusFilesAll.value, ...cloneFiles(sample)]
      }
      pushToast(`Applied stash@{${index}} (mock)`, 'success')
      return
    }
    try {
      const result = await useGitApi().stashApply(root, index)
      await loadStatus()
      if (result.hasConflict) {
        pushToast(`Apply có conflict — mở Conflict Resolver`, 'error')
      } else {
        pushToast(`Applied stash@{${index}}`, 'success')
      }
    } catch (err) {
      if (isUnavailable(err)) return
      const msg = err instanceof Error ? err.message : 'Stash apply thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  const stashDrop = async (index: number) => {
    const projectId = selectedProjectId.value
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(150, 280)
      stashesAll.value = stashesAll.value.filter(
        (s) => !(s.projectId === projectId && s.index === index),
      )
      reindexProjectStashes(projectId)
      pushToast('Stash dropped (mock)', 'success')
      return
    }
    try {
      await useGitApi().stashDrop(root, index)
      await loadStashes()
      pushToast(`Dropped stash@{${index}}`, 'success')
    } catch (err) {
      if (isUnavailable(err)) return
      const msg = err instanceof Error ? err.message : 'Stash drop thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  // ─── Commit-level history actions (right-click menu on history table) ────

  const createTag = async (
    name: string,
    sha?: string,
    opts: { message?: string; annotated?: boolean } = {},
  ) => {
    const trimmed = name.trim()
    if (!trimmed) {
      pushToast('Tag name không được rỗng', 'error')
      return
    }
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(150, 300)
      pushToast(`Created tag '${trimmed}' (mock)`, 'success')
      return
    }
    try {
      const params: { name: string; sha?: string; message?: string; annotated?: boolean } = {
        name: trimmed,
      }
      if (sha) params.sha = sha
      if (opts.message !== undefined) params.message = opts.message
      if (opts.annotated !== undefined) params.annotated = opts.annotated
      await useGitApi().tagCreate(root, params)
      await loadHistory()
      pushToast(`Created tag '${trimmed}'`, 'success')
    } catch (err) {
      if (isUnavailable(err)) {
        pushToast(`Created tag '${trimmed}' (mock)`, 'success')
        return
      }
      const msg = err instanceof Error ? err.message : 'Tag thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  const checkoutCommit = async (sha: string) => {
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(200, 400)
      pushToast(`Checked out ${sha.slice(0, 7)} (detached, mock)`, 'success')
      return
    }
    try {
      await useGitApi().checkoutCommit(root, sha)
      // Re-fetch log too — commit refs[] decoration (HEAD pointer especially)
      // is computed at log time, so a stale list keeps the HEAD badge on the
      // old commit until we re-load.
      await Promise.all([loadStatus(), loadBranches({ force: true }), loadHistory()])
      pushToast(`Checked out ${sha.slice(0, 7)} (detached HEAD)`, 'success')
    } catch (err) {
      if (isUnavailable(err)) return
      if (gitCodeOf(err) === 'DIRTY_TREE') {
        const data = (err as SidecarError).data as { files?: SidecarGitFileStatus[] } | undefined
        // Reuse the same modal pathway as branch checkout. The "branch"
        // displayed is the commit sha7 — the modal copy is generic enough to
        // work for detached-HEAD checkouts.
        pendingCheckoutError.value = {
          branch: sha.slice(0, 7),
          files: data?.files ?? [],
        }
        return
      }
      const msg = err instanceof Error ? err.message : 'Checkout commit thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  const cherryPick = async (sha: string) => {
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(200, 400)
      pushToast(`Cherry-picked ${sha.slice(0, 7)} (mock)`, 'success')
      return
    }
    try {
      const result = await useGitApi().cherryPick(root, sha)
      await Promise.all([loadStatus(), loadHistory(), loadBranches({ force: true })])
      pushToast(`Cherry-picked ${sha.slice(0, 7)} → ${result.sha7}`, 'success')
    } catch (err) {
      if (isUnavailable(err)) return
      if (gitCodeOf(err) === 'MERGE_CONFLICT') {
        await loadStatus().catch(() => undefined)
        pushToast('Cherry-pick có conflict — mở Conflict Resolver', 'error')
        return
      }
      const msg = err instanceof Error ? err.message : 'Cherry-pick thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  const revertCommit = async (sha: string, opts: { noCommit?: boolean } = {}) => {
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(200, 400)
      pushToast(`Reverted ${sha.slice(0, 7)} (mock)`, 'success')
      return
    }
    try {
      const result = await useGitApi().revertCommit(root, sha, opts)
      await Promise.all([loadStatus(), loadHistory(), loadBranches({ force: true })])
      const tail = result.sha7 ? ` → ${result.sha7}` : ' (staged, not yet committed)'
      pushToast(`Reverted ${sha.slice(0, 7)}${tail}`, 'success')
    } catch (err) {
      if (isUnavailable(err)) return
      if (gitCodeOf(err) === 'MERGE_CONFLICT') {
        await loadStatus().catch(() => undefined)
        pushToast('Revert có conflict — mở Conflict Resolver', 'error')
        return
      }
      const msg = err instanceof Error ? err.message : 'Revert thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  const resetTo = async (sha: string, mode: 'soft' | 'mixed' | 'hard') => {
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(200, 400)
      pushToast(`Reset --${mode} to ${sha.slice(0, 7)} (mock)`, 'success')
      return
    }
    try {
      await useGitApi().resetTo(root, sha, mode)
      await Promise.all([loadStatus(), loadHistory(), loadBranches({ force: true })])
      pushToast(`Reset --${mode} → ${sha.slice(0, 7)}`, 'success')
    } catch (err) {
      if (isUnavailable(err)) return
      const msg = err instanceof Error ? err.message : 'Reset thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  const savePatch = async (sha: string, savePath: string): Promise<string | null> => {
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(150, 300)
      pushToast(`Saved patch (mock) → ${savePath}`, 'success')
      return savePath
    }
    try {
      const result = await useGitApi().formatPatch(root, sha, savePath)
      pushToast(`Saved patch → ${result.path ?? savePath}`, 'success')
      return result.path ?? savePath
    } catch (err) {
      if (isUnavailable(err)) return null
      const msg = err instanceof Error ? err.message : 'Save patch thất bại'
      pushToast(msg, 'error')
      return null
    }
  }

  const loadDiffCommitVsWorkingTree = async (sha: string): Promise<GitFileDiff[]> => {
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(120, 220)
      return Object.values(INITIAL_FILE_DIFFS).slice(0, 2)
    }
    try {
      const api = useGitApi()
      const result = await api.diff({ kind: 'commitVsWorkingTree', workspaceRoot: root, sha })
      return result.files.map(adaptDiff)
    } catch (err) {
      if (isUnavailable(err)) return []
      const msg = err instanceof Error ? err.message : 'Compare thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  const loadDiff = async (path: string): Promise<GitFileDiff> => {
    const root = resolveWorkspaceRoot()
    if (root) {
      try {
        const api = useGitApi()
        const file = statusFilesAll.value.find(
          (f) => f.path === path && f.projectId === selectedProjectId.value,
        )
        // Staged files diff differently from working-tree changes.
        const kind = file?.isStaged ? 'staged' : 'workingTree'
        const result = await api.diff({ kind, workspaceRoot: root, path })
        const first = result.files[0]
        if (first) return adaptDiff(first)
        return { path, isBinary: false, hunks: [] }
      } catch (err) {
        if (!isUnavailable(err)) throw err
      }
    }
    // Fallback to mock fixtures when sidecar is unavailable (dev / browser).
    await latency(120, 220)
    const found = INITIAL_FILE_DIFFS[path]
    if (found) return found
    if (path === INITIAL_BINARY_PATH) {
      return { path, isBinary: true, hunks: [] }
    }
    return {
      path,
      isBinary: false,
      hunks: [
        {
          oldStart: 1,
          oldLines: 1,
          newStart: 1,
          newLines: 1,
          header: `@@ -1,1 +1,1 @@`,
          lines: [
            { kind: 'del', text: 'old content' },
            { kind: 'add', text: 'new content' },
          ],
        },
      ],
    }
  }

  const loadCommit = async (
    hash: string,
  ): Promise<{ commit: GitCommit; files: GitFileDiff[] } | null> => {
    const root = resolveWorkspaceRoot()
    if (root) {
      try {
        const api = useGitApi()
        const result = await api.diff({ kind: 'commit', workspaceRoot: root, sha: hash })
        const known = commits.value.find((c) => c.hash === hash || c.shortHash === hash.slice(0, 7))
        if (known) {
          return { commit: known, files: result.files.map(adaptDiff) }
        }
        // Commit metadata not yet in store; fall through to mock to keep UX.
      } catch (err) {
        if (!isUnavailable(err)) throw err
      }
    }
    await latency(150, 300)
    const found = commits.value.find((c) => c.hash === hash || c.shortHash === hash.slice(0, 7))
    const commitRef = found ?? commits.value[0]
    if (!commitRef) return null
    const sampleDiff = Object.values(INITIAL_FILE_DIFFS).slice(0, 2)
    return { commit: commitRef, files: sampleDiff }
  }

  // Subscribe to sidecar `git:status:changed` notifications. The watcher in
  // sidecar/git/watcher.ts emits these whenever .git/HEAD, .git/index or
  // .git/refs/** change externally (user using `git` from a terminal).
  let statusRefreshTimer: ReturnType<typeof setTimeout> | null = null
  const subscribe = async (): Promise<() => void> => {
    const sidecar = useSidecar()
    if (!sidecar.available) return () => undefined
    try {
      const unlisten = await sidecar.onEvent((evt) => {
        // Notification arrives in two shapes depending on transport:
        //   - via `sidecar-event` channel: { type, payload }
        //   - via JSON-RPC method `git:<...>`: payload itself
        // We accept either; sniff with the helper below.
        const typed = evt as unknown as { type?: string; payload?: unknown; method?: string }
        const evtType = typed.type ?? typed.method ?? null
        if (!evtType) return

        // Streaming progress for fetch/pull/push.
        const progressMatch = /^git:(fetch|pull|push):progress$/.exec(evtType)
        if (progressMatch) {
          const op = progressMatch[1] as GitStreamingOp
          const payload = typed.payload as { phase?: string; pct?: number | null } | undefined
          progressOp.value = op
          progressPhase.value = payload?.phase ?? null
          progressPct.value = payload?.pct ?? null
          return
        }

        if (evtType === 'git:status:changed') {
          // Debounce burst (multiple .git files updated in one operation).
          if (statusRefreshTimer) clearTimeout(statusRefreshTimer)
          statusRefreshTimer = setTimeout(() => {
            statusRefreshTimer = null
            loadStatus().catch(() => undefined)
          }, 200)
        }
      })
      return () => {
        if (statusRefreshTimer) clearTimeout(statusRefreshTimer)
        unlisten()
      }
    } catch (err) {
      if (isUnavailable(err)) return () => undefined
      throw err
    }
  }

  // Fetch + parse conflict markers for a file. Stores result in
  // `currentConflictFile` so the resolver UI binds reactively.
  const loadConflictFile = async (path: string) => {
    const root = resolveWorkspaceRoot()
    if (!root) {
      // Browser dev: render minimal mock so the resolver UI is interactable.
      await latency(80, 160)
      currentConflictFile.value = {
        path,
        isBinary: false,
        blocks: [
          {
            index: 0,
            startLine: 1,
            separatorLine: 3,
            endLine: 5,
            ours: ['// mock ours'],
            theirs: ['// mock theirs'],
            oursLabel: 'HEAD',
            theirsLabel: 'origin/main',
          },
        ],
      }
      return
    }
    try {
      const result = await useGitApi().readConflictFile(root, path)
      currentConflictFile.value = {
        path: result.path,
        isBinary: result.isBinary,
        blocks: result.blocks,
      }
    } catch (err) {
      if (isUnavailable(err)) return
      if (gitCodeOf(err) === 'ENCODING_UNSUPPORTED') {
        pushToast('Encoding không hỗ trợ — mở external editor', 'error')
        currentConflictFile.value = null
        return
      }
      const msg = err instanceof Error ? err.message : 'Load conflict file thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  const clearConflictFile = () => {
    currentConflictFile.value = null
  }

  const resolveConflict = async (
    path: string,
    resolutions: Array<{ blockIndex: number; choice: 'ours' | 'theirs' }>,
  ) => {
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(150, 250)
      const file = statusFilesAll.value.find(
        (f) => f.path === path && f.projectId === selectedProjectId.value,
      )
      if (file) {
        file.hasConflict = false
        file.isStaged = true
        file.index = 'modified'
        file.workTree = 'clean'
      }
      currentConflictFile.value = null
      pushToast(`Resolved ${path} (mock)`, 'success')
      return
    }
    try {
      await useGitApi().resolveFile(root, { path, resolutions })
      currentConflictFile.value = null
      await loadStatus()
      pushToast(`Resolved ${path}`, 'success')
    } catch (err) {
      if (isUnavailable(err)) return
      if (gitCodeOf(err) === 'ENCODING_UNSUPPORTED') {
        pushToast('Encoding không hỗ trợ — mở external editor', 'error')
        return
      }
      const msg = err instanceof Error ? err.message : 'Resolve thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  const resolveConflictBinary = async (path: string, choice: 'ours' | 'theirs') => {
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(150, 250)
      currentConflictFile.value = null
      pushToast(`Resolved ${path} (${choice}, mock)`, 'success')
      return
    }
    try {
      await useGitApi().resolveFileBinary(root, { path, choice })
      currentConflictFile.value = null
      await loadStatus()
      pushToast(`Resolved ${path} (${choice})`, 'success')
    } catch (err) {
      if (isUnavailable(err)) return
      const msg = err instanceof Error ? err.message : 'Resolve binary thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  const mergeAbort = async () => {
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(200, 350)
      isMerging.value = false
      currentConflictFile.value = null
      statusFilesAll.value = statusFilesAll.value.filter(
        (f) => !(f.projectId === selectedProjectId.value && f.hasConflict),
      )
      pushToast('Merge aborted (mock)', 'success')
      return
    }
    try {
      await useGitApi().mergeAbort(root)
      currentConflictFile.value = null
      await Promise.all([loadStatus(), loadHistory(), loadBranches({ force: true })])
      pushToast('Merge aborted', 'success')
    } catch (err) {
      if (isUnavailable(err)) return
      const msg = err instanceof Error ? err.message : 'Merge abort thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  const completeMerge = async (message?: string) => {
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(300, 500)
      isMerging.value = false
      currentConflictFile.value = null
      pushToast('Merge completed (mock)', 'success')
      return
    }
    try {
      const params: { message?: string } = {}
      if (message && message.trim().length > 0) params.message = message.trim()
      const result = await useGitApi().completeMerge(root, params)
      currentConflictFile.value = null
      await Promise.all([loadStatus(), loadHistory(), loadBranches({ force: true })])
      pushToast(`Merge completed (${result.sha7})`, 'success')
    } catch (err) {
      if (isUnavailable(err)) return
      if (gitCodeOf(err) === 'MERGE_CONFLICT') {
        pushToast('Vẫn còn conflict chưa resolve', 'error')
        return
      }
      const msg = err instanceof Error ? err.message : 'Complete merge thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  const revertFile = async (path: string, commitHash?: string) => {
    await latency(200, 400)
    const projectId = selectedProjectId.value
    const file = statusFilesAll.value.find((f) => f.path === path && f.projectId === projectId)
    if (file) {
      file.isStaged = true
      file.index = 'modified'
      file.workTree = 'clean'
    } else {
      statusFilesAll.value = [
        ...statusFilesAll.value,
        {
          projectId,
          path,
          index: 'modified',
          workTree: 'clean',
          isBinary: false,
          isStaged: true,
          hasConflict: false,
        },
      ]
    }
    pushToast(`Reverted ${path}${commitHash ? ` from ${commitHash.slice(0, 7)}` : ''}`, 'success')
  }

  // Per-file revert against an arbitrary ref (spec AC Flow 6). Wires
  // `git checkout <ref> -- <path>` via sidecar. Caller is responsible for the
  // confirm UX; this action assumes intent.
  const checkoutFileAtCommit = async (path: string, ref: string) => {
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(200, 400)
      pushToast(`Reverted ${path} from ${ref.slice(0, 7)} (mock)`, 'success')
      return
    }
    try {
      await useGitApi().checkoutFileAtCommit(root, { path, ref })
      await loadStatus()
      pushToast(`Reverted ${path} from ${ref.slice(0, 7)}`, 'success')
    } catch (err) {
      if (isUnavailable(err)) {
        pushToast(`Reverted ${path} (mock)`, 'success')
        return
      }
      const msg = err instanceof Error ? err.message : 'Revert file thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  const initRepo = async () => {
    const projectId = selectedProjectId.value
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(400, 700)
      repoStateByProject.value = { ...repoStateByProject.value, [projectId]: 'clean' }
      statusFilesAll.value = statusFilesAll.value.filter((f) => f.projectId !== projectId)
      pushToast('Initialized empty Git repository (mock)', 'success')
      return
    }
    try {
      await useGitApi().init(root)
      // Clear no-repo flag + reload from disk (status now succeeds).
      const next = { ...repoStateByProject.value }
      delete next[projectId]
      repoStateByProject.value = next
      await Promise.all([
        loadStatus(),
        loadHistory(),
        loadBranches({ force: true }),
        loadRemotes({ force: true }),
      ])
      pushToast('Initialized empty Git repository', 'success')
    } catch (err) {
      if (isUnavailable(err)) return
      const msg = err instanceof Error ? err.message : 'Init thất bại'
      pushToast(msg, 'error')
    }
  }

  // Stage a single hunk of a file (AC-04). Sidecar builds the minimal patch
  // and runs `git apply --cached`. No optimistic update — diff is recomputed
  // by the panel after the `git:status:changed` echo.
  const stageHunk = async (path: string, hunkIndex: number) => {
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(120, 220)
      pushToast(`Staged hunk #${hunkIndex} (mock)`, 'success')
      return
    }
    try {
      await useGitApi().stageHunk(root, path, hunkIndex)
      await loadStatus()
      pushToast(`Staged hunk #${hunkIndex + 1}`, 'success')
    } catch (err) {
      if (isUnavailable(err)) return
      const msg = err instanceof Error ? err.message : 'Stage hunk thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  const generateCommitMessage = async () => {
    if (isGeneratingMessage.value) return
    if (stagedFiles.value.length === 0) {
      pushToast('Stage ít nhất 1 file trước khi generate', 'error')
      return
    }
    const root = resolveWorkspaceRoot()
    if (!root) {
      pushToast('Chưa chọn project', 'error')
      return
    }
    isGeneratingMessage.value = true
    try {
      const settings = useSettingsStore()
      const rule = settings.git.commitMessageRule
      const result = await useGitApi().generateCommitMessage(root, { rule })
      commitMessage.value = result.message
      pushToast(
        result.truncated
          ? `Generated commit message (${result.model}, diff truncated)`
          : `Generated commit message (${result.model})`,
        'success',
      )
    } catch (err) {
      if (isUnavailable(err)) {
        pushToast('Sidecar chưa sẵn sàng — không thể gọi AI', 'error')
        return
      }
      const msg = err instanceof Error ? err.message : 'Generate thất bại'
      pushToast(msg, 'error')
    } finally {
      isGeneratingMessage.value = false
    }
  }

  const triggerAutoCommitDemo = async () => {
    await latency(200, 400)
    const projectId = selectedProjectId.value
    const c = buildAutoCommit(projectId, commits.value[0]?.hash)
    commitsAll.value = [c, ...commitsAll.value]
    pushToast(`Auto-commit ${c.shortHash} từ phase ${c.phaseId ?? '?'}`, 'info')
  }

  // ─── Mutation helper cho dirty-checkout dialog ──────────────────────────
  const clearStatusForCurrentProject = () => {
    statusFilesAll.value = statusFilesAll.value.filter(
      (f) => f.projectId !== selectedProjectId.value,
    )
  }

  return {
    // state
    selectedProjectId,
    selectedFilePath,
    selectedCommitHash,
    commitMessage,
    isFetching,
    isPulling,
    isPushing,
    isGeneratingMessage,
    progressPct,
    progressOp,
    progressPhase,
    toasts,
    currentConflictFile,
    isMerging,
    isDetached,
    detachedAt,
    pendingCheckoutError,
    pendingDeleteError,
    pendingAuthError,
    pendingPullDivergence,
    pendingPushNonFf,
    isLoadingHistoryMore,
    // getters
    branches,
    commits,
    stashes,
    remotes,
    statusFiles,
    currentBranch,
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
    dirtyCountByProject,
    historyHasMore,
    // actions
    setSelectedProject,
    loadStatus,
    loadHistory,
    loadMoreHistory,
    loadBranches,
    loadStashes,
    loadRemotes,
    subscribe,
    stageFile,
    stageHunk,
    unstageFile,
    discardFile,
    selectFile,
    selectCommit,
    setCommitMessage,
    commit,
    amendCommit,
    fetchRemote,
    pull,
    push,
    cancel,
    pullThenPush,
    clearPendingAuthError,
    clearPendingPullDivergence,
    clearPendingPushNonFf,
    createBranch,
    checkoutBranch,
    renameBranch,
    deleteBranch,
    stashSave,
    stashPop,
    stashApply,
    stashDrop,
    loadDiff,
    loadCommit,
    loadConflictFile,
    clearConflictFile,
    resolveConflict,
    resolveConflictBinary,
    mergeAbort,
    completeMerge,
    revertFile,
    checkoutFileAtCommit,
    clearPendingCheckoutError,
    clearPendingDeleteError,
    initRepo,
    generateCommitMessage,
    triggerAutoCommitDemo,
    clearStatusForCurrentProject,
    createTag,
    checkoutCommit,
    cherryPick,
    revertCommit,
    resetTo,
    savePatch,
    loadDiffCommitVsWorkingTree,
  }
})
