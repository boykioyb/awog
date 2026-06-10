import type { GitCommit, GitFileStatus } from '~/types'
import { useGitApi } from '~/composables/useGitApi'
import { useSettingsStore } from '~/stores/settings'
import { isUnavailable, latency } from './adapters'
import type { GitActionCtx } from './data'

// Working-tree mutations: stage / unstage / discard / hunk-stage, selection,
// commit (+ amend) and AI commit-message generation.
export function createGitStaging(ctx: GitActionCtx) {
  const {
    statusFilesAll,
    selectedProjectId,
    selectedFilePath,
    selectedCommitHash,
    commitMessage,
    isGeneratingMessage,
    stagedFiles,
    commits,
    commitsAll,
    branchesAll,
    currentBranch,
    pushToast,
    resolveWorkspaceRoot,
    loadStatus,
    loadHistory,
  } = ctx

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

  // Discard one or more paths in a single IPC round-trip. `git.discardFile`
  // already batches (checkout tracked + unlink untracked), so bulk discard
  // (section "discard all", folder discard) reuses it — no new RPC needed.
  const discardPaths = async (paths: string[]) => {
    if (paths.length === 0) return
    const projectId = selectedProjectId.value
    const pathSet = new Set(paths)
    // Snapshot every matched file so we can roll back the optimistic removal.
    const snapshots = statusFilesAll.value
      .filter((f) => pathSet.has(f.path) && f.projectId === projectId)
      .map((f) => ({ ...f }))
    statusFilesAll.value = statusFilesAll.value.filter(
      (f) => !(pathSet.has(f.path) && f.projectId === projectId),
    )
    if (selectedFilePath.value && pathSet.has(selectedFilePath.value)) selectedFilePath.value = null

    const root = resolveWorkspaceRoot()
    if (!root) {
      await latency(120, 220)
      return
    }
    try {
      await useGitApi().discardFile(root, paths)
    } catch (err) {
      if (isUnavailable(err)) return
      statusFilesAll.value = [...statusFilesAll.value, ...snapshots]
      pushToast(
        paths.length === 1
          ? `Discard thất bại: ${paths[0]}`
          : `Discard thất bại: ${paths.length} file`,
        'error',
      )
      throw err
    }
  }

  const discardFile = (path: string) => discardPaths([path])

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

  return {
    stageFile,
    unstageFile,
    discardFile,
    discardPaths,
    selectFile,
    selectCommit,
    setCommitMessage,
    commit,
    amendCommit,
    stageHunk,
    generateCommitMessage,
  }
}
