import type { GitCommit, GitFileDiff } from '~/types'
import { useGitApi, type SidecarGitFileStatus } from '~/composables/useGitApi'
import { useSidecar } from '~/composables/useSidecar'
import type { SidecarError } from '~/composables/useSidecar'
import { INITIAL_BINARY_PATH, INITIAL_FILE_DIFFS, buildAutoCommit } from '~/utils/initial-git'
import { adaptDiff, gitCodeOf, isUnavailable, latency } from './adapters'
import type { GitActionCtx } from './data'

// Commit-level history actions (right-click menu on the history table): checkout
// / cherry-pick / revert / reset / save-patch, plus diff + commit loaders the
// Diff panel binds to.
export function createGitHistory(ctx: GitActionCtx) {
  const {
    selectedProjectId,
    commits,
    commitsAll,
    statusFilesAll,
    pendingCheckoutError,
    pushToast,
    resolveWorkspaceRoot,
    loadStatus,
    loadHistory,
    loadBranches,
  } = ctx

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
      // Real app (sidecar) chỉ thiếu root khi chưa chọn project — trả rỗng, không mock.
      if (useSidecar().available) return []
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
    if (useSidecar().available) return { path, isBinary: false, hunks: [] }
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
      // Real app: nếu không khớp commit metadata thì trả null, không lộ mock diff.
      // Browser dev (no sidecar) rơi xuống mock bên dưới để giữ UX.
      if (useSidecar().available) return null
    }
    await latency(150, 300)
    const found = commits.value.find((c) => c.hash === hash || c.shortHash === hash.slice(0, 7))
    const commitRef = found ?? commits.value[0]
    if (!commitRef) return null
    const sampleDiff = Object.values(INITIAL_FILE_DIFFS).slice(0, 2)
    return { commit: commitRef, files: sampleDiff }
  }

  const triggerAutoCommitDemo = async () => {
    await latency(200, 400)
    const projectId = selectedProjectId.value
    const c = buildAutoCommit(projectId, commits.value[0]?.hash)
    commitsAll.value = [c, ...commitsAll.value]
    pushToast(`Auto-commit ${c.shortHash} từ phase ${c.phaseId ?? '?'}`, 'info')
  }

  return {
    checkoutCommit,
    cherryPick,
    revertCommit,
    resetTo,
    savePatch,
    loadDiffCommitVsWorkingTree,
    loadDiff,
    loadCommit,
    triggerAutoCommitDemo,
  }
}
