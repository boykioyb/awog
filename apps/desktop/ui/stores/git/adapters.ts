import type {
  GitBranch,
  GitCommit,
  GitDiffLine,
  GitDiffLineKind,
  GitFileDiff,
  GitFileStatus,
  GitFileStatusCode,
  GitRemote,
  GitStashEntry,
} from '~/types'
import type {
  SidecarGitBranch,
  SidecarGitCommit,
  SidecarGitFileDiff,
  SidecarGitFileStatus,
  SidecarGitRemote,
  SidecarGitStashEntry,
} from '~/composables/useGitApi'
import { SidecarError, SidecarUnavailableError } from '~/composables/useSidecar'

// ─── Constants ─────────────────────────────────────────────────────────────

export const DEFAULT_PROJECT_ID = 'prj1'

// Branches/remotes 5s cache (M7 perf polish). Avoids re-spawning git on every
// tab switch / project reselect when nothing changed externally.
export const CACHE_TTL_MS = 5_000

// Default page size for `loadHistory` pagination.
export const HISTORY_PAGE_SIZE = 100

const SIDECAR_CHANGE_TO_UI: Record<string, GitFileStatusCode> = {
  added: 'added',
  modified: 'modified',
  deleted: 'deleted',
  renamed: 'renamed',
  copied: 'copied',
  untracked: 'untracked',
  conflicted: 'conflicted',
  type_changed: 'modified',
  ignored: 'modified',
}

// ─── Timing helpers (mock latency in browser-dev) ───────────────────────────

export const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

export const latency = (min = 250, max = 700) => wait(Math.floor(min + Math.random() * (max - min)))

export const cloneFiles = (files: GitFileStatus[]): GitFileStatus[] => files.map((f) => ({ ...f }))

// ─── Adapters: sidecar shape → UI per-project shape ─────────────────────────

export function adaptFile(projectId: string, f: SidecarGitFileStatus): GitFileStatus {
  const code = SIDECAR_CHANGE_TO_UI[f.changeType] ?? 'modified'
  const isStaged = f.stageState === 'staged'
  const hasConflict = f.stageState === 'conflicted'
  const out: GitFileStatus = {
    projectId,
    path: f.path,
    index: isStaged ? code : 'clean',
    workTree: isStaged ? 'clean' : code,
    isBinary: f.isBinary,
    isStaged,
    hasConflict,
  }
  if (f.oldPath !== undefined) out.oldPath = f.oldPath
  return out
}

export function adaptCommit(projectId: string, c: SidecarGitCommit): GitCommit {
  const { subject } = c
  const body = c.message.length > subject.length ? c.message.slice(subject.length).trimStart() : ''
  const refs: GitCommit['refs'] = c.refs.map((r) => ({ kind: r.kind, name: r.name }))
  const out: GitCommit = {
    projectId,
    hash: c.sha,
    shortHash: c.sha7,
    authorName: c.authorName,
    authorEmail: c.authorEmail,
    date: c.authorAt,
    subject,
    parents: c.parents,
    refs,
  }
  if (body) out.body = body
  if (c.linkedPhaseId !== undefined) out.phaseId = c.linkedPhaseId
  return out
}

export function adaptBranch(projectId: string, b: SidecarGitBranch): GitBranch {
  const out: GitBranch = {
    projectId,
    name: b.name,
    isCurrent: b.isCurrent,
    isRemote: b.kind === 'remote',
    ahead: b.ahead,
    behind: b.behind,
    lastCommit: b.lastCommitSha,
  }
  if (b.upstream) out.upstream = b.upstream
  return out
}

export function adaptStash(projectId: string, s: SidecarGitStashEntry): GitStashEntry {
  return {
    projectId,
    index: s.index,
    ref: `stash@{${s.index}}`,
    message: s.message,
    date: s.createdAt,
    branch: s.baseBranch,
  }
}

export function adaptRemote(projectId: string, r: SidecarGitRemote): GitRemote {
  return {
    projectId,
    name: r.name,
    fetchUrl: r.fetchUrl,
    pushUrl: r.pushUrl,
  }
}

export function adaptDiff(d: SidecarGitFileDiff): GitFileDiff {
  const hunks = d.hunks.map((h) => ({
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    header: h.header,
    lines: h.lines.map<GitDiffLine>((ln) => {
      // UI's GitDiffLineKind has no `noeol` — collapse into context.
      const kind: GitDiffLineKind = ln.kind === 'noeol' ? 'context' : ln.kind
      return { kind, text: ln.content }
    }),
  }))
  const out: GitFileDiff = {
    path: d.path,
    isBinary: d.isBinary,
    hunks,
  }
  if (d.oldPath !== undefined) out.oldPath = d.oldPath
  return out
}

// ─── Error classifiers ──────────────────────────────────────────────────────

// In browser dev mode the sidecar is unavailable — read actions become no-ops
// and the mock seed remains intact.
export function isUnavailable(err: unknown): boolean {
  return err instanceof SidecarUnavailableError
}

// Extract a git error code (DIRTY_TREE / UNMERGED / …) from an RPC error.
export function gitCodeOf(err: unknown): string | null {
  if (!(err instanceof SidecarError)) return null
  const data = err.data as { gitCode?: string } | undefined
  return data?.gitCode ?? null
}

export type AuthHint = 'ssh-key' | 'https-token' | 'unknown'

// Extract a structured auth/git error payload from an RPC error.
export function authPayload(err: unknown): { hint: AuthHint; message: string } | null {
  if (!(err instanceof SidecarError)) return null
  const data = err.data as { gitCode?: string; hint?: AuthHint; stderrSanitized?: string }
  if (data?.gitCode !== 'AUTH_FAILED') return null
  return {
    hint: data.hint ?? 'unknown',
    message: data.stderrSanitized ?? err.message,
  }
}
