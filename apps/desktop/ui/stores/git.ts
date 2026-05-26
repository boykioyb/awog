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
  const progressOp = ref<'fetch' | 'pull' | 'push' | null>(null)
  const toasts = ref<Array<{ id: string; text: string; kind: 'info' | 'success' | 'error' }>>([])

  const conflictBlocksByPath = ref<Record<string, GitMergeConflictBlock[]>>({
    [INITIAL_CONFLICT_PATH]: INITIAL_CONFLICT_BLOCKS.map((b) => ({ ...b })),
  })

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

  // ─── Actions ─────────────────────────────────────────────────────────────
  const loadStatus = async () => {
    await latency(120, 280)
  }

  const stageFile = async (path: string) => {
    const file = statusFilesAll.value.find(
      (f) => f.path === path && f.projectId === selectedProjectId.value,
    )
    if (!file || file.hasConflict) return
    file.isStaged = true
    if (file.workTree === 'untracked') {
      file.index = 'added'
      file.workTree = 'clean'
    } else if (file.workTree !== 'clean') {
      file.index = file.workTree
    }
    await latency(80, 160)
  }

  const unstageFile = async (path: string) => {
    const file = statusFilesAll.value.find(
      (f) => f.path === path && f.projectId === selectedProjectId.value,
    )
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
  }

  const discardFile = async (path: string) => {
    await latency(120, 220)
    statusFilesAll.value = statusFilesAll.value.filter(
      (f) => !(f.path === path && f.projectId === selectedProjectId.value),
    )
    if (selectedFilePath.value === path) selectedFilePath.value = null
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
    const projectId = selectedProjectId.value
    const hash = `mock${Date.now().toString(16).slice(-7)}${Math.random().toString(16).slice(2, 6)}`
    const subject = trimmed.split('\n')[0] ?? trimmed
    const body = trimmed.includes('\n') ? trimmed.slice(subject.length + 1).trim() : undefined
    const phaseMatch = trimmed.match(/^\[([^\]]+)\]/)
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
      refs: [currentBranch.value],
      phaseId: phaseMatch?.[1],
    }
    // Strip refs khỏi các commit cũ cùng project.
    commitsAll.value = [
      newCommit,
      ...commitsAll.value.map((c) => (c.projectId === projectId ? { ...c, refs: [] } : c)),
    ]
    statusFilesAll.value = statusFilesAll.value.filter(
      (f) => !(f.projectId === projectId && f.isStaged),
    )
    // Tăng ahead của branch hiện tại.
    branchesAll.value = branchesAll.value.map((b) =>
      b.projectId === projectId && b.isCurrent && !b.isRemote
        ? { ...b, ahead: b.ahead + 1, lastCommit: hash }
        : b,
    )
    commitMessage.value = ''
    pushToast(`Commit ${newCommit.shortHash} tạo thành công`, 'success')
  }

  const amendCommit = async (message: string) => {
    if (commits.value.length === 0) {
      pushToast('Không có commit để amend', 'error')
      return
    }
    await latency(400, 700)
    const projectId = selectedProjectId.value
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
    // Replace commit cũ trong commitsAll.
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
    statusFilesAll.value = statusFilesAll.value.filter(
      (f) => !(f.projectId === projectId && f.isStaged),
    )
    commitMessage.value = ''
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
      const projectId = selectedProjectId.value
      branchesAll.value = branchesAll.value.map((b) =>
        b.projectId === projectId && b.name === 'main' && !b.isRemote
          ? { ...b, behind: b.behind + 1 }
          : b,
      )
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
      const projectId = selectedProjectId.value
      branchesAll.value = branchesAll.value.map((b) =>
        b.projectId === projectId && b.isCurrent && !b.isRemote ? { ...b, behind: 0 } : b,
      )
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
      if (Math.random() < 0.1) {
        pushToast('Push failed: authentication required (mock)', 'error')
        return
      }
      const projectId = selectedProjectId.value
      const pushed = ahead.value
      branchesAll.value = branchesAll.value.map((b) =>
        b.projectId === projectId && b.isCurrent && !b.isRemote ? { ...b, ahead: 0 } : b,
      )
      pushToast(`Pushed ${pushed} commits to origin/${currentBranch.value}`, 'success')
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
    const projectId = selectedProjectId.value
    if (
      branchesAll.value.some((b) => b.projectId === projectId && b.name === trimmed && !b.isRemote)
    ) {
      pushToast(`Branch '${trimmed}' đã tồn tại`, 'error')
      return
    }
    await latency(200, 400)
    const baseCommit = fromRef ?? commits.value[0]?.hash ?? 'HEAD'
    branchesAll.value = [
      ...branchesAll.value,
      {
        projectId,
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
    const projectId = selectedProjectId.value
    const target = branchesAll.value.find(
      (b) => b.projectId === projectId && b.name === name && !b.isRemote,
    )
    if (!target) {
      pushToast(`Branch '${name}' không tồn tại`, 'error')
      return
    }
    await latency(250, 500)
    branchesAll.value = branchesAll.value.map((b) =>
      b.projectId === projectId ? { ...b, isCurrent: !b.isRemote && b.name === name } : b,
    )
    pushToast(`Checked out '${name}'`, 'success')
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

  const deleteBranch = async (name: string) => {
    const projectId = selectedProjectId.value
    if (name === currentBranch.value) {
      pushToast('Không thể xóa branch hiện tại', 'error')
      return
    }
    await latency(150, 300)
    branchesAll.value = branchesAll.value.filter(
      (b) => !(b.projectId === projectId && b.name === name && !b.isRemote),
    )
    pushToast(`Deleted branch '${name}'`, 'success')
  }

  const stashSave = async (message?: string) => {
    if (!hasUncommitted.value) {
      pushToast('Không có thay đổi để stash', 'error')
      return
    }
    await latency(250, 450)
    const projectId = selectedProjectId.value
    const existing = stashesAll.value.filter((s) => s.projectId === projectId)
    const others = stashesAll.value.filter((s) => s.projectId !== projectId)
    const entry: GitStashEntry = {
      projectId,
      index: 0,
      ref: 'stash@{0}',
      message: message?.trim() || `WIP on ${currentBranch.value}`,
      date: new Date().toISOString(),
      branch: currentBranch.value,
    }
    const reindexed = [
      entry,
      ...existing.map((s, i) => ({ ...s, index: i + 1, ref: `stash@{${i + 1}}` })),
    ]
    stashesAll.value = [...reindexed, ...others]
    statusFilesAll.value = statusFilesAll.value.filter((f) => f.projectId !== projectId)
    pushToast(`Stashed changes — ${entry.ref}`, 'success')
  }

  const reindexProjectStashes = (projectId: string) => {
    const list = stashesAll.value.filter((s) => s.projectId === projectId)
    const others = stashesAll.value.filter((s) => s.projectId !== projectId)
    const reindexed = list.map((s, i) => ({ ...s, index: i, ref: `stash@{${i}}` }))
    stashesAll.value = [...reindexed, ...others]
  }

  const stashPop = async (index: number) => {
    const projectId = selectedProjectId.value
    const entry = stashesAll.value.find((s) => s.projectId === projectId && s.index === index)
    if (!entry) return
    await latency(250, 450)
    // Mock: restore 3 file đầu tiên của project nếu hiện đang clean.
    if (!statusFiles.value.length) {
      const sample = INITIAL_STATUS_FILES.filter((f) => f.projectId === projectId).slice(0, 3)
      statusFilesAll.value = [...statusFilesAll.value, ...cloneFiles(sample)]
    }
    stashesAll.value = stashesAll.value.filter(
      (s) => !(s.projectId === projectId && s.index === index),
    )
    reindexProjectStashes(projectId)
    pushToast(`Popped ${entry.ref}`, 'success')
  }

  const stashApply = async (index: number) => {
    const projectId = selectedProjectId.value
    const entry = stashesAll.value.find((s) => s.projectId === projectId && s.index === index)
    if (!entry) return
    await latency(250, 450)
    if (!statusFiles.value.length) {
      const sample = INITIAL_STATUS_FILES.filter((f) => f.projectId === projectId).slice(0, 3)
      statusFilesAll.value = [...statusFilesAll.value, ...cloneFiles(sample)]
    }
    pushToast(`Applied ${entry.ref}`, 'success')
  }

  const stashDrop = async (index: number) => {
    const projectId = selectedProjectId.value
    await latency(150, 280)
    stashesAll.value = stashesAll.value.filter(
      (s) => !(s.projectId === projectId && s.index === index),
    )
    reindexProjectStashes(projectId)
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
      const file = statusFilesAll.value.find(
        (f) => f.path === path && f.projectId === selectedProjectId.value,
      )
      if (file) {
        file.hasConflict = false
        file.isStaged = true
        file.index = 'modified'
        file.workTree = 'clean'
      }
      pushToast(`Resolved ${path}`, 'success')
    }
    await latency(100, 200)
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

  const initRepo = async () => {
    await latency(400, 700)
    const projectId = selectedProjectId.value
    repoStateByProject.value = { ...repoStateByProject.value, [projectId]: 'clean' }
    statusFilesAll.value = statusFilesAll.value.filter((f) => f.projectId !== projectId)
    pushToast('Initialized empty Git repository (mock)', 'success')
  }

  const generateCommitMessage = async () => {
    if (isGeneratingMessage.value) return
    if (stagedFiles.value.length === 0) {
      pushToast('Stage ít nhất 1 file trước khi generate', 'error')
      return
    }
    isGeneratingMessage.value = true
    try {
      await latency(700, 1200)
      const files = stagedFiles.value
      const scope = (() => {
        if (files.some((f) => f.path.includes('/auth/'))) return 'auth'
        if (files.some((f) => f.path.includes('/billing/') || f.path.includes('/invoice'))) {
          return 'billing'
        }
        if (files.some((f) => f.path.includes('/retry/') || f.path.includes('/race')))
          return 'retry'
        if (files.some((f) => f.path.includes('/loyalty/') || f.path.includes('/rewards/'))) {
          return 'loyalty'
        }
        if (files.some((f) => f.path.includes('/components/'))) return 'ui'
        if (files.some((f) => f.path.startsWith('docs/'))) return 'docs'
        if (files.some((f) => f.path.startsWith('tests/'))) return 'test'
        return 'core'
      })()
      const added = files.filter((f) => f.index === 'added').length
      const modified = files.filter((f) => f.index === 'modified').length
      const deleted = files.filter((f) => f.index === 'deleted').length
      let verb = 'update'
      if (added > modified && added > deleted) verb = 'add'
      else if (deleted > modified) verb = 'remove'
      const summary = files
        .slice(0, 3)
        .map((f) => {
          const base = f.path.split('/').pop() ?? f.path
          return base.replace(/\.(vue|ts|md|tsx?|py|go)$/, '')
        })
        .join(', ')
      const subject = `${verb}(${scope}): ${summary}${files.length > 3 ? ` and ${files.length - 3} more` : ''}`
      const bodyLines = [
        '',
        `Mock-generated for ${files.length} staged file(s):`,
        ...files.slice(0, 5).map((f) => `- ${f.index}: ${f.path}`),
        files.length > 5 ? `- …and ${files.length - 5} more` : '',
      ].filter(Boolean)
      commitMessage.value = `${subject}\n${bodyLines.join('\n')}`
      pushToast('Generated commit message (mock)', 'success')
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
    toasts,
    conflictBlocksByPath,
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
    // actions
    setSelectedProject,
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
    renameBranch,
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
    generateCommitMessage,
    triggerAutoCommitDemo,
    clearStatusForCurrentProject,
  }
})
