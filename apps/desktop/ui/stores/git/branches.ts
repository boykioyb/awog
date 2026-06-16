import type { GitStashEntry } from '~/types'
import { useGitApi, type SidecarGitFileStatus } from '~/composables/useGitApi'
import type { SidecarError } from '~/composables/useSidecar'
import { INITIAL_STATUS_FILES } from '~/utils/initial-git'
import { cloneFiles, gitCodeOf, isUnavailable, latency } from './adapters'
import type { GitActionCtx } from './data'

// Ref management: branch create / checkout / rename / delete, stash
// save / pop / apply / drop, and tag creation.
export function createGitBranches(ctx: GitActionCtx) {
  const {
    branchesAll,
    commits,
    currentBranch,
    selectedProjectId,
    stashesAll,
    statusFiles,
    statusFilesAll,
    hasUncommitted,
    pendingCheckoutError,
    pendingDeleteError,
    pushToast,
    resolveWorkspaceRoot,
    loadBranches,
    loadStatus,
    loadHistory,
    loadStashes,
  } = ctx

  // ─── Branches ──────────────────────────────────────────────────────────────

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

  // ─── Stashes ─────────────────────────────────────────────────────────────

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

  // ─── Tags ────────────────────────────────────────────────────────────────

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

  // ─── Merge / Rebase ────────────────────────────────────────────────────────

  // Merge `branch` into the current HEAD. Conflicts route into the Conflict
  // Resolver (same as cherry-pick): the next loadStatus surfaces `isMerging` +
  // conflicted files so the resolver opens. Per ADR 0040.
  const merge = async (branch: string) => {
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(200, 400)
      pushToast(`Merged ${branch} (mock)`, 'success')
      return
    }
    try {
      const result = await useGitApi().merge(root, branch)
      await Promise.all([loadStatus(), loadHistory(), loadBranches({ force: true })])
      pushToast(
        result.fastForward
          ? `Fast-forwarded to ${branch} (${result.sha7})`
          : `Merged ${branch} → ${result.sha7}`,
        'success',
      )
    } catch (err) {
      if (isUnavailable(err)) return
      if (gitCodeOf(err) === 'MERGE_CONFLICT') {
        await loadStatus().catch(() => undefined)
        pushToast('Merge có conflict — mở Conflict Resolver', 'error')
        return
      }
      const msg = err instanceof Error ? err.message : 'Merge thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  // Rebase the current branch onto `onto`. Conflicts route into the Conflict
  // Resolver, which finalizes via `rebase --continue|--abort` (see conflicts.ts).
  const rebase = async (onto: string) => {
    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(200, 400)
      pushToast(`Rebased onto ${onto} (mock)`, 'success')
      return
    }
    try {
      const result = await useGitApi().rebase(root, onto)
      await Promise.all([loadStatus(), loadHistory(), loadBranches({ force: true })])
      pushToast(`Rebased ${currentBranch.value} onto ${onto} → ${result.sha7}`, 'success')
    } catch (err) {
      if (isUnavailable(err)) return
      if (gitCodeOf(err) === 'MERGE_CONFLICT') {
        await loadStatus().catch(() => undefined)
        pushToast('Rebase có conflict — mở Conflict Resolver', 'error')
        return
      }
      const msg = err instanceof Error ? err.message : 'Rebase thất bại'
      pushToast(msg, 'error')
      throw err
    }
  }

  return {
    createBranch,
    checkoutBranch,
    renameBranch,
    deleteBranch,
    clearPendingCheckoutError,
    clearPendingDeleteError,
    stashSave,
    stashPop,
    stashApply,
    stashDrop,
    createTag,
    merge,
    rebase,
  }
}
