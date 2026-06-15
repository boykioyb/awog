import { useGitApi, type GitStreamingOp, type PushParams } from '~/composables/useGitApi'
import { authPayload, gitCodeOf, isUnavailable, wait } from './adapters'
import type { GitActionCtx } from './data'

// Remote synchronisation: fetch / pull / push (+ progress strip), cancel,
// pull-then-push recovery, and the pending-error modal clearers.
export function createGitSync(ctx: GitActionCtx) {
  const {
    isFetching,
    isPulling,
    isPushing,
    progressOp,
    progressPhase,
    progressPct,
    selectedProjectId,
    branchesAll,
    currentBranch,
    ahead,
    hasConflict,
    pendingAuthError,
    pendingPullDivergence,
    pendingPushNonFf,
    pushDialogOpen,
    pushToast,
    resolveWorkspaceRoot,
    loadStatus,
    loadBranches,
    loadHistory,
  } = ctx

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
      await wait(tick)
      progressPct.value = Math.round((i / steps) * 100)
    }
    resetProgress()
  }

  // `silent` = background auto-fetch: no progress strip, no toast, errors
  // swallowed (offline/auth shouldn't nag). Still refreshes branches/status so
  // ahead/behind for main/develop/release stay fresh.
  const fetchRemote = async (remote?: string, opts: { silent?: boolean } = {}) => {
    if (isFetching.value) return
    const silent = opts.silent === true
    isFetching.value = true
    if (!silent) {
      progressOp.value = 'fetch'
      progressPct.value = null
      progressPhase.value = 'starting'
    }
    const root = resolveWorkspaceRoot()
    if (!root) {
      try {
        if (!silent) {
          await runMockProgress('fetch', 1200)
          pushToast('Fetched origin (mock)', 'success')
        }
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
      if (!silent) {
        const n = result.updated.length
        pushToast(
          n > 0 ? `Fetched ${n} ref${n === 1 ? '' : 's'}` : 'Fetched (đã up-to-date)',
          'success',
        )
      }
      await Promise.all([loadBranches({ force: true }), loadStatus()])
    } catch (err) {
      if (isUnavailable(err)) return
      if (silent) return // background: swallow (manual Fetch surfaces real errors)
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

  const push = async (
    opts: { setUpstream?: boolean; force?: boolean; pushTags?: boolean; remote?: string } = {},
  ) => {
    if (isPushing.value) return
    pushDialogOpen.value = false
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
        const remoteLabel = opts.remote ?? 'origin'
        pushToast(
          `Pushed ${pushed} commits to ${remoteLabel}/${currentBranch.value} (mock)`,
          'success',
        )
      } finally {
        isPushing.value = false
        resetProgress()
      }
      return
    }
    try {
      const params: PushParams = {}
      if (opts.setUpstream) params.setUpstream = true
      if (opts.force) params.force = true
      if (opts.pushTags) params.pushTags = true
      if (opts.remote) params.remote = opts.remote
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

  return {
    fetchRemote,
    pull,
    push,
    cancel,
    pullThenPush,
    clearPendingAuthError,
    clearPendingPullDivergence,
    clearPendingPushNonFf,
  }
}
