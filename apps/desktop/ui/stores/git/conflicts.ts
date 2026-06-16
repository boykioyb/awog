import { useGitApi } from '~/composables/useGitApi'
import { gitCodeOf, isUnavailable, latency } from './adapters'
import type { GitActionCtx } from './data'

// Conflict resolver + merge lifecycle: load/clear the focused conflict file,
// resolve (text + binary), abort / complete a merge, and per-file revert.
export function createGitConflicts(ctx: GitActionCtx) {
  const {
    selectedProjectId,
    statusFilesAll,
    currentConflictFile,
    isMerging,
    isRebasing,
    pushToast,
    resolveWorkspaceRoot,
    loadStatus,
    loadHistory,
    loadBranches,
  } = ctx

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

  // Abort the in-progress operation. Dispatches by git state: a rebase aborts
  // with `rebase --abort`, everything else (merge / cherry-pick / revert) with
  // `merge --abort`. Per ADR 0040.
  const mergeAbort = async () => {
    const rebasing = isRebasing.value
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(200, 350)
      isMerging.value = false
      isRebasing.value = false
      currentConflictFile.value = null
      statusFilesAll.value = statusFilesAll.value.filter(
        (f) => !(f.projectId === selectedProjectId.value && f.hasConflict),
      )
      pushToast(rebasing ? 'Rebase aborted (mock)' : 'Merge aborted (mock)', 'success')
      return
    }
    try {
      if (rebasing) await useGitApi().rebaseAbort(root)
      else await useGitApi().mergeAbort(root)
      currentConflictFile.value = null
      await Promise.all([loadStatus(), loadHistory(), loadBranches({ force: true })])
      pushToast(rebasing ? 'Rebase aborted' : 'Merge aborted', 'success')
    } catch (err) {
      if (isUnavailable(err)) return
      const msg =
        err instanceof Error
          ? err.message
          : rebasing
            ? 'Rebase abort thất bại'
            : 'Merge abort thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  // Finalize the in-progress operation once conflicts are resolved. A rebase
  // resumes with `rebase --continue`; a merge/cherry-pick/revert finishes with
  // `git commit` (the optional message applies to merge only). Per ADR 0040.
  const completeMerge = async (message?: string) => {
    const rebasing = isRebasing.value
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(300, 500)
      isMerging.value = false
      isRebasing.value = false
      currentConflictFile.value = null
      pushToast(rebasing ? 'Rebase continued (mock)' : 'Merge completed (mock)', 'success')
      return
    }
    try {
      let sha7: string
      if (rebasing) {
        sha7 = (await useGitApi().rebaseContinue(root)).sha7
      } else {
        const params: { message?: string } = {}
        if (message && message.trim().length > 0) params.message = message.trim()
        sha7 = (await useGitApi().completeMerge(root, params)).sha7
      }
      currentConflictFile.value = null
      await Promise.all([loadStatus(), loadHistory(), loadBranches({ force: true })])
      pushToast(rebasing ? `Rebase continued (${sha7})` : `Merge completed (${sha7})`, 'success')
    } catch (err) {
      if (isUnavailable(err)) return
      if (gitCodeOf(err) === 'MERGE_CONFLICT') {
        pushToast('Vẫn còn conflict chưa resolve', 'error')
        return
      }
      const msg =
        err instanceof Error
          ? err.message
          : rebasing
            ? 'Rebase continue thất bại'
            : 'Complete merge thất bại'
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

  return {
    loadConflictFile,
    clearConflictFile,
    resolveConflict,
    resolveConflictBinary,
    mergeAbort,
    completeMerge,
    revertFile,
    checkoutFileAtCommit,
  }
}
