import { defineStore } from 'pinia'
import type {
  GitBranch,
  GitCommit,
  GitConflictResolutionChoice,
  GitFileDiff,
  GitFileStatus,
  GitMergeConflictBlock,
  GitRemote,
  GitRepoState,
  GitStashEntry,
} from '~/types'
import {
  INITIAL_BINARY_PATH,
  INITIAL_BRANCHES,
  INITIAL_COMMITS,
  INITIAL_CONFLICT_BLOCKS,
  INITIAL_CONFLICT_PATH,
  INITIAL_FILE_DIFFS,
  INITIAL_REMOTES,
  INITIAL_STASHES,
  INITIAL_STATUS_FILES,
  buildAutoCommit,
} from '~/utils/initial-git'

// TODO(sidecar): mọi action mock dùng setTimeout — sẽ wrap qua useGitApi() khi sidecar có.
const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
const latency = (min = 250, max = 700) => wait(Math.floor(min + Math.random() * (max - min)))

const cloneFiles = (files: GitFileStatus[]): GitFileStatus[] => files.map((f) => ({ ...f }))

export const useGitStore = defineStore('git', () => {
  // ─── State ───────────────────────────────────────────────────────────────
  const currentBranch = ref<string>('feature/git-manager')
  const branches = ref<GitBranch[]>([...INITIAL_BRANCHES])
  const commits = ref<GitCommit[]>([...INITIAL_COMMITS])
  const stashes = ref<GitStashEntry[]>([...INITIAL_STASHES])
  const remotes = ref<GitRemote[]>([...INITIAL_REMOTES])
  const statusFiles = ref<GitFileStatus[]>(cloneFiles(INITIAL_STATUS_FILES))
  const selectedFilePath = ref<string | null>(null)
  const selectedCommitHash = ref<string | null>(null)
  const commitMessage = ref<string>('')
  const repoState = ref<GitRepoState>('dirty')
  const isFetching = ref(false)
  const isPulling = ref(false)
  const isPushing = ref(false)
  const progressPct = ref<number | null>(null)
  const progressOp = ref<'fetch' | 'pull' | 'push' | null>(null)
  const ahead = ref<number>(2)
  const behind = ref<number>(0)
  const toasts = ref<Array<{ id: string; text: string; kind: 'info' | 'success' | 'error' }>>([])

  // Mock conflict file content (chỉ 1 file để demo resolver).
  const conflictBlocksByPath = ref<Record<string, GitMergeConflictBlock[]>>({
    [INITIAL_CONFLICT_PATH]: INITIAL_CONFLICT_BLOCKS.map((b) => ({ ...b })),
  })

  // ─── Getters ─────────────────────────────────────────────────────────────
  const stagedFiles = computed(() => statusFiles.value.filter((f) => f.isStaged && !f.hasConflict))
  const unstagedFiles = computed(() =>
    statusFiles.value.filter((f) => !f.isStaged && !f.hasConflict && f.workTree !== 'untracked'),
  )
  const untrackedFiles = computed(() => statusFiles.value.filter((f) => f.workTree === 'untracked'))
  const conflictedFiles = computed(() => statusFiles.value.filter((f) => f.hasConflict))
  const hasUncommitted = computed(() => statusFiles.value.length > 0)
  const hasConflict = computed(() => conflictedFiles.value.length > 0)
  const isBusy = computed(() => isFetching.value || isPulling.value || isPushing.value)

  // ─── Helpers ─────────────────────────────────────────────────────────────
  const pushToast = (text: string, kind: 'info' | 'success' | 'error' = 'info') => {
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    toasts.value = [...toasts.value, { id, text, kind }]
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, 3200)
  }

  const refreshRepoState = () => {
    if (repoState.value === 'no-repo') return
    if (hasConflict.value) {
      repoState.value = 'merging'
      return
    }
    repoState.value = hasUncommitted.value ? 'dirty' : 'clean'
  }

  // ─── Actions ─────────────────────────────────────────────────────────────
  const loadStatus = async () => {
    await latency(120, 280)
    refreshRepoState()
  }

  const stageFile = async (path: string) => {
    const file = statusFiles.value.find((f) => f.path === path)
    if (!file || file.hasConflict) return
    file.isStaged = true
    if (file.workTree === 'untracked') {
      file.index = 'added'
      file.workTree = 'clean'
    } else if (file.workTree !== 'clean') {
      file.index = file.workTree
    }
    await latency(80, 160)
    refreshRepoState()
  }

  const unstageFile = async (path: string) => {
    const file = statusFiles.value.find((f) => f.path === path)
    if (!file) return
    file.isStaged = false
    if (file.index === 'added') {
      file.workTree = 'untracked'
      file.index = 'clean'
    } else if (file.index !== 'clean') {
      file.workTree = file.index
      file.index = 'clean'
    }
    await latency(80, 160)
    refreshRepoState()
  }

  const discardFile = async (path: string) => {
    await latency(120, 220)
    statusFiles.value = statusFiles.value.filter((f) => f.path !== path)
    if (selectedFilePath.value === path) selectedFilePath.value = null
    refreshRepoState()
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

  const commit = async (message: string) => {
    const trimmed = message.trim()
    if (!trimmed) {
      pushToast('Commit message không được rỗng', 'error')
      return
    }
    if (stagedFiles.value.length === 0) {
      pushToast('Không có thay đổi để commit', 'error')
      return
    }
    await latency(400, 700)
    const hash = `mock${Date.now().toString(16).slice(-7)}${Math.random().toString(16).slice(2, 6)}`
    const subject = trimmed.split('\n')[0] ?? trimmed
    const body = trimmed.includes('\n') ? trimmed.slice(subject.length + 1).trim() : undefined
    const phaseMatch = trimmed.match(/^\[([^\]]+)\]/)
    const newCommit: GitCommit = {
      hash,
      shortHash: hash.slice(0, 7),
      authorName: 'Local Developer',
      authorEmail: 'dev@awog.local',
      date: new Date().toISOString(),
      subject,
      body,
      parents: commits.value[0] ? [commits.value[0].hash] : [],
      refs: [currentBranch.value],
      phaseId: phaseMatch?.[1],
    }
    commits.value = [newCommit, ...commits.value.map((c) => ({ ...c, refs: [] }))]
    statusFiles.value = statusFiles.value.filter((f) => !f.isStaged)
    commitMessage.value = ''
    ahead.value += 1
    refreshRepoState()
    pushToast(`Commit ${newCommit.shortHash} tạo thành công`, 'success')
  }

  const amendCommit = async (message: string) => {
    if (commits.value.length === 0) {
      pushToast('Không có commit để amend', 'error')
      return
    }
    await latency(400, 700)
    const trimmed = message.trim()
    const previous = commits.value[0]
    if (!previous) return
    const hash = `mock${Date.now().toString(16).slice(-7)}${Math.random().toString(16).slice(2, 6)}`
    const subject = (trimmed || previous.subject).split('\n')[0] ?? previous.subject
    const updated: GitCommit = {
      ...previous,
      hash,
      shortHash: hash.slice(0, 7),
      subject,
      body: trimmed.includes('\n') ? trimmed.slice(subject.length + 1).trim() : previous.body,
      date: new Date().toISOString(),
    }
    commits.value = [updated, ...commits.value.slice(1)]
    statusFiles.value = statusFiles.value.filter((f) => !f.isStaged)
    commitMessage.value = ''
    refreshRepoState()
    pushToast(`Amended commit ${updated.shortHash}`, 'success')
  }

  const runProgress = async (op: 'fetch' | 'pull' | 'push', duration: number) => {
    progressOp.value = op
    progressPct.value = 0
    const steps = 12
    const tick = duration / steps
    for (let i = 1; i <= steps; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await wait(tick)
      progressPct.value = Math.round((i / steps) * 100)
    }
    progressPct.value = null
    progressOp.value = null
  }

  const fetchRemote = async () => {
    if (isFetching.value) return
    isFetching.value = true
    try {
      await runProgress('fetch', 1200)
      // Mock: pretend a remote moved forward 1 commit on main.
      behind.value = currentBranch.value === 'main' ? 1 : behind.value
      pushToast('Fetched origin (mock)', 'success')
    } finally {
      isFetching.value = false
    }
  }

  const pull = async () => {
    if (isPulling.value) return
    isPulling.value = true
    try {
      await runProgress('pull', 1500)
      behind.value = 0
      pushToast(`Pulled origin/${currentBranch.value} (mock fast-forward)`, 'success')
    } finally {
      isPulling.value = false
    }
  }

  const push = async () => {
    if (isPushing.value) return
    isPushing.value = true
    try {
      await runProgress('push', 1800)
      // Mock 10% chance of auth error to demo failure UX.
      if (Math.random() < 0.1) {
        pushToast('Push failed: authentication required (mock)', 'error')
        return
      }
      pushToast(`Pushed ${ahead.value} commits to origin/${currentBranch.value}`, 'success')
      ahead.value = 0
    } finally {
      isPushing.value = false
    }
  }

  const createBranch = async (name: string, fromRef?: string) => {
    const trimmed = name.trim()
    if (!trimmed) {
      pushToast('Branch name không được rỗng', 'error')
      return
    }
    if (branches.value.some((b) => b.name === trimmed && !b.isRemote)) {
      pushToast(`Branch '${trimmed}' đã tồn tại`, 'error')
      return
    }
    await latency(200, 400)
    const baseCommit = fromRef ?? commits.value[0]?.hash ?? 'HEAD'
    branches.value = [
      ...branches.value,
      {
        name: trimmed,
        isCurrent: false,
        isRemote: false,
        ahead: 0,
        behind: 0,
        lastCommit: baseCommit,
      },
    ]
    pushToast(`Created branch '${trimmed}'`, 'success')
  }

  const checkoutBranch = async (name: string) => {
    const target = branches.value.find((b) => b.name === name && !b.isRemote)
    if (!target) {
      pushToast(`Branch '${name}' không tồn tại`, 'error')
      return
    }
    await latency(250, 500)
    branches.value = branches.value.map((b) => ({
      ...b,
      isCurrent: !b.isRemote && b.name === name,
    }))
    currentBranch.value = name
    ahead.value = target.ahead
    behind.value = target.behind
    pushToast(`Checked out '${name}'`, 'success')
  }

  const deleteBranch = async (name: string) => {
    if (name === currentBranch.value) {
      pushToast('Không thể xóa branch hiện tại', 'error')
      return
    }
    await latency(150, 300)
    branches.value = branches.value.filter((b) => !(b.name === name && !b.isRemote))
    pushToast(`Deleted branch '${name}'`, 'success')
  }

  const stashSave = async (message?: string) => {
    if (!hasUncommitted.value) {
      pushToast('Không có thay đổi để stash', 'error')
      return
    }
    await latency(250, 450)
    const index = stashes.value.length
    const entry: GitStashEntry = {
      index,
      ref: `stash@{${index}}`,
      message: message?.trim() || `WIP on ${currentBranch.value}`,
      date: new Date().toISOString(),
      branch: currentBranch.value,
    }
    stashes.value = [entry, ...stashes.value.map((s) => ({ ...s, index: s.index + 1 }))]
    statusFiles.value = []
    refreshRepoState()
    pushToast(`Stashed changes — ${entry.ref}`, 'success')
  }

  const stashPop = async (index: number) => {
    const entry = stashes.value.find((s) => s.index === index)
    if (!entry) return
    await latency(250, 450)
    // Mock: restore vài file thay vì restore từ stash thật.
    if (statusFiles.value.length === 0) {
      statusFiles.value = cloneFiles(INITIAL_STATUS_FILES.slice(0, 3))
    }
    stashes.value = stashes.value
      .filter((s) => s.index !== index)
      .map((s, i) => ({ ...s, index: i, ref: `stash@{${i}}` }))
    refreshRepoState()
    pushToast(`Popped ${entry.ref}`, 'success')
  }

  const stashApply = async (index: number) => {
    const entry = stashes.value.find((s) => s.index === index)
    if (!entry) return
    await latency(250, 450)
    if (statusFiles.value.length === 0) {
      statusFiles.value = cloneFiles(INITIAL_STATUS_FILES.slice(0, 3))
    }
    refreshRepoState()
    pushToast(`Applied ${entry.ref}`, 'success')
  }

  const stashDrop = async (index: number) => {
    await latency(150, 280)
    stashes.value = stashes.value
      .filter((s) => s.index !== index)
      .map((s, i) => ({ ...s, index: i, ref: `stash@{${i}}` }))
    pushToast('Stash dropped', 'success')
  }

  const loadDiff = async (path: string): Promise<GitFileDiff> => {
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
    await latency(150, 300)
    const found = commits.value.find((c) => c.hash === hash || c.shortHash === hash.slice(0, 7))
    const commitRef = found ?? commits.value[0]
    if (!commitRef) return null
    const sampleDiff = Object.values(INITIAL_FILE_DIFFS).slice(0, 2)
    return { commit: commitRef, files: sampleDiff }
  }

  const resolveConflict = async (
    path: string,
    blockIndex: number,
    resolution: GitConflictResolutionChoice,
  ) => {
    const blocks = conflictBlocksByPath.value[path]
    if (!blocks) return
    const updated = blocks.map((b, i) => (i === blockIndex ? { ...b, resolution } : b))
    conflictBlocksByPath.value = { ...conflictBlocksByPath.value, [path]: updated }
    const allResolved = updated.every((b) => b.resolution !== 'unresolved')
    if (allResolved) {
      const file = statusFiles.value.find((f) => f.path === path)
      if (file) {
        file.hasConflict = false
        file.isStaged = true
        file.index = 'modified'
        file.workTree = 'clean'
      }
      refreshRepoState()
      pushToast(`Resolved ${path}`, 'success')
    }
    await latency(100, 200)
  }

  const revertFile = async (path: string, commitHash?: string) => {
    await latency(200, 400)
    const file = statusFiles.value.find((f) => f.path === path)
    if (file) {
      file.isStaged = true
      file.index = 'modified'
      file.workTree = 'clean'
    } else {
      statusFiles.value = [
        ...statusFiles.value,
        {
          path,
          index: 'modified',
          workTree: 'clean',
          isBinary: false,
          isStaged: true,
          hasConflict: false,
        },
      ]
    }
    refreshRepoState()
    pushToast(`Reverted ${path}${commitHash ? ` from ${commitHash.slice(0, 7)}` : ''}`, 'success')
  }

  const initRepo = async () => {
    await latency(400, 700)
    repoState.value = 'clean'
    statusFiles.value = []
    pushToast('Initialized empty Git repository (mock)', 'success')
  }

  const triggerAutoCommitDemo = async () => {
    // TODO: cross-link Agent Trace — hiện chỉ mock 1 commit có phaseId.
    await latency(200, 400)
    const c = buildAutoCommit(commits.value[0]?.hash)
    commits.value = [c, ...commits.value]
    pushToast(`Auto-commit ${c.shortHash} từ phase ${c.phaseId ?? '?'}`, 'info')
  }

  return {
    // state
    currentBranch,
    branches,
    commits,
    stashes,
    remotes,
    statusFiles,
    selectedFilePath,
    selectedCommitHash,
    commitMessage,
    repoState,
    isFetching,
    isPulling,
    isPushing,
    progressPct,
    progressOp,
    ahead,
    behind,
    toasts,
    conflictBlocksByPath,
    // getters
    stagedFiles,
    unstagedFiles,
    untrackedFiles,
    conflictedFiles,
    hasUncommitted,
    hasConflict,
    isBusy,
    // actions
    loadStatus,
    stageFile,
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
    createBranch,
    checkoutBranch,
    deleteBranch,
    stashSave,
    stashPop,
    stashApply,
    stashDrop,
    loadDiff,
    loadCommit,
    resolveConflict,
    revertFile,
    initRepo,
    triggerAutoCommitDemo,
  }
})
