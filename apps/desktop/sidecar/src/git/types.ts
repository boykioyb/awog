// Sidecar-local Git types. Shape follows docs/features/git-manager.md
// (workspace-rooted, no projectId) — UI store adapts these to its
// per-project shape. Independent of UI types per ADR 0017.

export type GitFileChangeType =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored'
  | 'conflicted'
  | 'type_changed'

export type GitFileStageState = 'staged' | 'unstaged' | 'untracked' | 'conflicted'

export interface GitFileStatus {
  path: string
  oldPath?: string
  changeType: GitFileChangeType
  stageState: GitFileStageState
  isBinary: boolean
  additions?: number
  deletions?: number
}

export interface GitStatus {
  branch: string | null
  detached: boolean
  detachedAt?: string
  upstream: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
  isMerging: boolean
  isRebasing: boolean
  conflictedCount: number
}

export type GitRefKind = 'branch' | 'remote-branch' | 'tag' | 'HEAD' | 'stash'

export interface GitRef {
  name: string
  kind: GitRefKind
}

export interface GitCommit {
  sha: string
  sha7: string
  authorName: string
  authorEmail: string
  authorAt: string
  committerName: string
  committerAt: string
  message: string
  subject: string
  parents: string[]
  refs: GitRef[]
  linkedPhaseId?: string
}

export interface GitBranch {
  name: string
  kind: 'local' | 'remote'
  isCurrent: boolean
  upstream: string | null
  ahead: number
  behind: number
  lastCommitSha: string
  lastCommitSubject: string
  lastCommitAt: string
}

export interface GitStashEntry {
  index: number
  message: string
  createdAt: string
  baseSha: string
  baseBranch: string
}

export interface GitRemote {
  name: string
  fetchUrl: string
  pushUrl: string
}

export type GitDiffLineKind = 'context' | 'add' | 'del' | 'noeol'

export interface GitDiffLine {
  kind: GitDiffLineKind
  oldLineNum?: number
  newLineNum?: number
  content: string
}

export interface GitDiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  header: string
  lines: GitDiffLine[]
}

export interface GitFileDiff {
  path: string
  oldPath?: string
  isBinary: boolean
  isRename: boolean
  hunks: GitDiffHunk[]
  oldFileMode?: string
  newFileMode?: string
}

export interface GitDiff {
  files: GitFileDiff[]
}

// A git repository discovered inside a project/workspace folder. A "project" in
// AWOG may be a container holding several repos in subfolders — see
// `git.discoverRepos` + docs/features/git-manager.md.
export interface GitRepoEntry {
  // Absolute path to the repo root (the dir that contains `.git`).
  path: string
  // basename(path) — display fallback.
  name: string
  // Path relative to the scanned project root; '.' when the root itself is a repo.
  relativePath: string
  // True when path === scanned root (single-repo project).
  isRoot: boolean
  // Current branch (rev-parse --abbrev-ref HEAD) — best-effort, absent on failure.
  branch?: string
  // `remote.origin.url` — best-effort; lets the UI derive a GitHub slug per repo.
  remote?: string
  // Count of tracked working-tree changes (git status --porcelain, untracked
  // excluded) — 0 = clean. Best-effort; absent on failure.
  dirty?: number
}
