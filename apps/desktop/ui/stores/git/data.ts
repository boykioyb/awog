import { useGitApi, type GitStreamingOp } from '~/composables/useGitApi'
import { useSidecar } from '~/composables/useSidecar'
import {
  CACHE_TTL_MS,
  HISTORY_PAGE_SIZE,
  adaptBranch,
  adaptCommit,
  adaptFile,
  adaptRemote,
  adaptStash,
  gitCodeOf,
  isUnavailable,
  latency,
} from './adapters'
import type { GitContext } from './context'

// Read-side actions: load status / history / branches / stashes / remotes,
// repo discovery + init, and the live `git:status:changed` subscription. These
// loaders are shared infrastructure — every write action re-syncs through them,
// so they are merged into the context handed to the other action modules.
export function createGitData(ctx: GitContext) {
  const {
    selectedProjectId,
    statusFilesAll,
    commitsAll,
    branchesAll,
    stashesAll,
    remotesAll,
    reposByProject,
    selectedRepoPathByProject,
    repoStateByProject,
    isMerging,
    isDetached,
    detachedAt,
    branchesLastFetchedAt,
    remotesLastFetchedAt,
    historyHasMoreByProject,
    isLoadingHistoryMore,
    progressOp,
    progressPhase,
    progressPct,
    pushToast,
    resolveProjectPath,
    resolveWorkspaceRoot,
  } = ctx

  // Scan the selected project folder for git repos (up to 2 levels deep). A
  // project may be a container of several repos with no `.git` at its root —
  // discovery lets the header show a repo picker. Best-effort: failures leave
  // `repos` empty so loading falls back to the project root (single-repo).
  const discoverRepos = async () => {
    const projectId = selectedProjectId.value
    const root = resolveProjectPath()
    if (!root) return
    try {
      const api = useGitApi()
      const result = await api.discoverRepos(root)
      reposByProject.value = { ...reposByProject.value, [projectId]: result.repos }
      // Keep the current selection if it still exists; else prefer the root
      // repo, else the first discovered one.
      const current = selectedRepoPathByProject.value[projectId]
      const stillValid = current !== undefined && result.repos.some((r) => r.path === current)
      if (!stillValid) {
        const next = (result.repos.find((r) => r.isRoot) ?? result.repos[0])?.path
        const map = { ...selectedRepoPathByProject.value }
        if (next) map[projectId] = next
        else delete map[projectId]
        selectedRepoPathByProject.value = map
      }
    } catch (err) {
      if (isUnavailable(err)) return

      console.warn('[git] discoverRepos failed', err)
    }
  }

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
      // Re-scan so the freshly initialised root repo appears in the picker.
      await discoverRepos()
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

  return {
    discoverRepos,
    loadStatus,
    loadHistory,
    loadMoreHistory,
    loadBranches,
    loadStashes,
    loadRemotes,
    subscribe,
    initRepo,
  }
}

export type GitData = ReturnType<typeof createGitData>

// Full context handed to every write-action module: shared state/getters/helpers
// plus the read-side loaders (so writes can re-sync after mutating).
export type GitActionCtx = GitContext & GitData
