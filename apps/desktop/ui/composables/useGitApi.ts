// Thin typed wrapper around sidecar git.* RPCs. Shape mirrors
// apps/desktop/sidecar/src/git/types.ts (workspace-rooted, no projectId).
// Store layer adapts these into the per-project view it persists.
import type { GitRepoEntry } from '~/types'
import { useSidecar } from './useSidecar'

export type SidecarGitFileChangeType =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored'
  | 'conflicted'
  | 'type_changed'

export type SidecarGitFileStageState = 'staged' | 'unstaged' | 'untracked' | 'conflicted'

export interface SidecarGitFileStatus {
  path: string
  oldPath?: string
  changeType: SidecarGitFileChangeType
  stageState: SidecarGitFileStageState
  isBinary: boolean
  additions?: number
  deletions?: number
}

export interface SidecarGitStatus {
  branch: string | null
  detached: boolean
  detachedAt?: string
  upstream: string | null
  ahead: number
  behind: number
  files: SidecarGitFileStatus[]
  isMerging: boolean
  isRebasing: boolean
  conflictedCount: number
}

export interface SidecarGitCommit {
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
  refs: Array<{ name: string; kind: 'branch' | 'remote-branch' | 'tag' | 'HEAD' | 'stash' }>
  linkedPhaseId?: string
}

export interface SidecarGitBranch {
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

export interface SidecarGitStashEntry {
  index: number
  message: string
  createdAt: string
  baseSha: string
  baseBranch: string
}

export interface SidecarGitRemote {
  name: string
  fetchUrl: string
  pushUrl: string
}

export interface SidecarGitDiffLine {
  kind: 'context' | 'add' | 'del' | 'noeol'
  oldLineNum?: number
  newLineNum?: number
  content: string
}

export interface SidecarGitDiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  header: string
  lines: SidecarGitDiffLine[]
}

export interface SidecarGitFileDiff {
  path: string
  oldPath?: string
  isBinary: boolean
  isRename: boolean
  hunks: SidecarGitDiffHunk[]
  oldFileMode?: string
  newFileMode?: string
}

export interface SidecarGitDiff {
  files: SidecarGitFileDiff[]
}

export interface CheckInstalledResult {
  installed: boolean
  version: string
  supported: boolean
  required: string
}

export type DiffParams =
  | { kind: 'workingTree'; workspaceRoot: string; path?: string }
  | { kind: 'staged'; workspaceRoot: string; path?: string }
  | { kind: 'commit'; workspaceRoot: string; sha: string }
  | { kind: 'commitRange'; workspaceRoot: string; from: string; to: string }
  | { kind: 'commitVsWorkingTree'; workspaceRoot: string; sha: string }

export interface LogParams {
  workspaceRoot: string
  limit: number
  skip?: number
  ref?: string
  path?: string
}

export interface CommitParams {
  message: string
  amend?: boolean
  signoff?: boolean
}

export interface CommitResult {
  sha: string
  sha7: string
}

export interface BranchCreateParams {
  name: string
  from?: string
  checkout?: boolean
}

export interface BranchCheckoutParams {
  name: string
  force?: boolean
}

export interface BranchDeleteParams {
  name: string
  force?: boolean
  deleteRemote?: boolean
  remote?: string
}

export interface BranchDeleteResult {
  ok: true
  remoteDeleted: boolean
  remoteError?: string
}

export interface CheckoutFileParams {
  path: string
  ref: string
}

export interface FetchParams {
  remote?: string
  prune?: boolean
}

export interface UpdatedRef {
  ref: string
  oldSha: string
  newSha: string
}

export interface FetchResult {
  ok: true
  updated: UpdatedRef[]
}

export interface PullParams {
  strategy: 'ff-only' | 'merge' | 'rebase'
}

export interface PullResult {
  ok: true
  fastForwarded: boolean
  commitsApplied: number
}

export interface PushParams {
  remote?: string
  branch?: string
  setUpstream?: boolean
}

export interface PushResult {
  ok: true
  pushed: number
}

export type GitStreamingOp = 'fetch' | 'pull' | 'push'

export interface StashSaveParams {
  message: string
  includeUntracked?: boolean
}

export interface StashSaveResult {
  ok: true
  index: number
}

export interface StashConflictResult {
  ok: true
  hasConflict: boolean
}

export interface SidecarMergeConflictBlock {
  index: number
  startLine: number
  separatorLine: number
  endLine: number
  ours: string[]
  theirs: string[]
  oursLabel: string
  theirsLabel: string
}

export interface ReadConflictFileResult {
  path: string
  isBinary: boolean
  blocks: SidecarMergeConflictBlock[]
}

export interface ResolveFileParams {
  path: string
  resolutions: Array<{ blockIndex: number; choice: 'ours' | 'theirs' }>
}

export interface ResolveFileBinaryParams {
  path: string
  choice: 'ours' | 'theirs'
}

export interface CompleteMergeParams {
  message?: string
}

export interface TagCreateParams {
  name: string
  sha?: string
  message?: string
  annotated?: boolean
}

export type ResetMode = 'soft' | 'mixed' | 'hard'

export interface CherryPickResult {
  ok: true
  sha: string
  sha7: string
}

export interface RevertCommitResult {
  ok: true
  sha?: string
  sha7?: string
}

export interface FormatPatchResult {
  ok: true
  path?: string
  patch?: string
}

export function useGitApi() {
  const sidecar = useSidecar()
  return {
    checkInstalled: () => sidecar.request<CheckInstalledResult>('git.checkInstalled'),
    discoverRepos: (root: string) =>
      sidecar.request<{ repos: GitRepoEntry[] }>('git.discoverRepos', { root }),
    status: (workspaceRoot: string, opts?: { includeIgnored?: boolean }) =>
      sidecar.request<SidecarGitStatus>('git.status', { workspaceRoot, ...opts }),
    log: (params: LogParams) =>
      sidecar.request<{ commits: SidecarGitCommit[]; hasMore: boolean }>('git.log', params),
    diff: (params: DiffParams) => sidecar.request<SidecarGitDiff>('git.diff', params),
    branchList: (workspaceRoot: string) =>
      sidecar.request<{ branches: SidecarGitBranch[] }>('git.branchList', { workspaceRoot }),
    stashList: (workspaceRoot: string) =>
      sidecar.request<{ stashes: SidecarGitStashEntry[] }>('git.stashList', { workspaceRoot }),
    remoteList: (workspaceRoot: string) =>
      sidecar.request<{ remotes: SidecarGitRemote[] }>('git.remoteList', { workspaceRoot }),
    stageFile: (workspaceRoot: string, paths: string[]) =>
      sidecar.request<{ ok: true }>('git.stageFile', { workspaceRoot, paths }),
    stageHunk: (workspaceRoot: string, path: string, hunkIndex: number) =>
      sidecar.request<{ ok: true }>('git.stageHunk', { workspaceRoot, path, hunkIndex }),
    init: (workspaceRoot: string) => sidecar.request<{ ok: true }>('git.init', { workspaceRoot }),
    unstageFile: (workspaceRoot: string, paths: string[]) =>
      sidecar.request<{ ok: true }>('git.unstageFile', { workspaceRoot, paths }),
    discardFile: (workspaceRoot: string, paths: string[]) =>
      sidecar.request<{ ok: true }>('git.discardFile', { workspaceRoot, paths }),
    commit: (workspaceRoot: string, params: CommitParams) =>
      sidecar.request<CommitResult>('git.commit', { workspaceRoot, ...params }),
    branchCreate: (workspaceRoot: string, params: BranchCreateParams) =>
      sidecar.request<{ ok: true }>('git.branchCreate', { workspaceRoot, ...params }),
    branchCheckout: (workspaceRoot: string, params: BranchCheckoutParams) =>
      sidecar.request<{ ok: true }>('git.branchCheckout', { workspaceRoot, ...params }),
    branchDelete: (workspaceRoot: string, params: BranchDeleteParams) =>
      sidecar.request<BranchDeleteResult>('git.branchDelete', { workspaceRoot, ...params }),
    checkoutFileAtCommit: (workspaceRoot: string, params: CheckoutFileParams) =>
      sidecar.request<{ ok: true }>('git.checkoutFileAtCommit', { workspaceRoot, ...params }),
    fetch: (workspaceRoot: string, params: FetchParams = {}) =>
      sidecar.request<FetchResult>('git.fetch', { workspaceRoot, ...params }),
    pull: (workspaceRoot: string, params: PullParams) =>
      sidecar.request<PullResult>('git.pull', { workspaceRoot, ...params }),
    push: (workspaceRoot: string, params: PushParams = {}) =>
      sidecar.request<PushResult>('git.push', { workspaceRoot, ...params }),
    cancel: (workspaceRoot: string, op: GitStreamingOp) =>
      sidecar.request<{ ok: true }>('git.cancel', { workspaceRoot, op }),
    generateCommitMessage: (workspaceRoot: string, params: { rule: string }) =>
      sidecar.request<{ message: string; model: string; truncated: boolean }>(
        'git.generateCommitMessage',
        { workspaceRoot, ...params },
      ),
    stashSave: (workspaceRoot: string, params: StashSaveParams) =>
      sidecar.request<StashSaveResult>('git.stashSave', { workspaceRoot, ...params }),
    stashPop: (workspaceRoot: string, index: number) =>
      sidecar.request<StashConflictResult>('git.stashPop', { workspaceRoot, index }),
    stashApply: (workspaceRoot: string, index: number) =>
      sidecar.request<StashConflictResult>('git.stashApply', { workspaceRoot, index }),
    stashDrop: (workspaceRoot: string, index: number) =>
      sidecar.request<{ ok: true }>('git.stashDrop', { workspaceRoot, index }),
    readConflictFile: (workspaceRoot: string, path: string) =>
      sidecar.request<ReadConflictFileResult>('git.readConflictFile', { workspaceRoot, path }),
    resolveFile: (workspaceRoot: string, params: ResolveFileParams) =>
      sidecar.request<{ ok: true }>('git.resolveFile', { workspaceRoot, ...params }),
    resolveFileBinary: (workspaceRoot: string, params: ResolveFileBinaryParams) =>
      sidecar.request<{ ok: true }>('git.resolveFileBinary', { workspaceRoot, ...params }),
    mergeAbort: (workspaceRoot: string) =>
      sidecar.request<{ ok: true }>('git.mergeAbort', { workspaceRoot }),
    completeMerge: (workspaceRoot: string, params: CompleteMergeParams = {}) =>
      sidecar.request<CommitResult>('git.completeMerge', { workspaceRoot, ...params }),
    tagCreate: (workspaceRoot: string, params: TagCreateParams) =>
      sidecar.request<{ ok: true }>('git.tagCreate', { workspaceRoot, ...params }),
    checkoutCommit: (workspaceRoot: string, sha: string) =>
      sidecar.request<{ ok: true }>('git.checkoutCommit', { workspaceRoot, sha }),
    cherryPick: (workspaceRoot: string, sha: string) =>
      sidecar.request<CherryPickResult>('git.cherryPick', { workspaceRoot, sha }),
    revertCommit: (workspaceRoot: string, sha: string, opts?: { noCommit?: boolean }) =>
      sidecar.request<RevertCommitResult>('git.revertCommit', {
        workspaceRoot,
        sha,
        ...(opts?.noCommit ? { noCommit: true } : {}),
      }),
    resetTo: (workspaceRoot: string, sha: string, mode: ResetMode) =>
      sidecar.request<{ ok: true }>('git.resetTo', { workspaceRoot, sha, mode }),
    formatPatch: (workspaceRoot: string, sha: string, savePath?: string) =>
      sidecar.request<FormatPatchResult>('git.formatPatch', {
        workspaceRoot,
        sha,
        ...(savePath !== undefined ? { savePath } : {}),
      }),
  }
}
