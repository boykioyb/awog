// Pure parsers — no I/O. Each function takes raw stdout and returns typed
// records matching `./types.ts`. The runner is responsible for argv shape.
import type {
  GitBranch,
  GitCommit,
  GitDiffHunk,
  GitDiffLine,
  GitDiffLineKind,
  GitFileDiff,
  GitFileStatus,
  GitFileChangeType,
  GitFileStageState,
  GitRef,
  GitRemote,
  GitStashEntry,
} from './types.js'

// ─── porcelain v2 ──────────────────────────────────────────────────────────

export interface PorcelainParsed {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  detached: boolean
  detachedAt?: string
  files: GitFileStatus[]
}

function changeTypeOf(code: string): GitFileChangeType {
  switch (code) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'type_changed'
    default:
      return 'modified'
  }
}

type XyEntry = { changeType: GitFileChangeType; stageState: GitFileStageState }

// Map a porcelain XY status pair (`MM`, `A.`, `.D`, `DD`, ...) to one OR TWO
// entries. A file can be changed on BOTH sides at once (e.g. `MM` = staged edit
// + further unstaged edit, after staging a hunk) — emitting one entry per
// non-clean side makes it appear in BOTH the Staged and Changes sections
// (partial staging) instead of collapsing to one and vanishing from the other.
// Porcelain v2 spec: https://git-scm.com/docs/git-status#_changed_tracked_entries
function mapXyEntries(xy: string): XyEntry[] {
  const x = xy[0] ?? '.'
  const y = xy[1] ?? '.'
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
    return [{ changeType: 'conflicted', stageState: 'conflicted' }]
  }
  const clean = (c: string) => c === '.' || c === ' '
  const out: XyEntry[] = []
  if (!clean(x)) out.push({ changeType: changeTypeOf(x), stageState: 'staged' })
  if (!clean(y)) out.push({ changeType: changeTypeOf(y), stageState: 'unstaged' })
  // Defensive: a listed entry should never be clean on both sides.
  if (out.length === 0) out.push({ changeType: changeTypeOf(x), stageState: 'unstaged' })
  return out
}

// `git status --porcelain=v2 -z --branch` output:
// Header lines start with '#'. Entry kinds: '1' (changed), '2' (rename/copy),
// 'u' (unmerged), '?' (untracked), '!' (ignored). Entries are NUL-terminated;
// `2` records have an extra NUL separating <newPath>\0<oldPath>.
export function parsePorcelainV2(stdout: string): PorcelainParsed {
  const parsed: PorcelainParsed = {
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    detached: false,
    files: [],
  }
  if (!stdout) return parsed

  // Split on NUL but iterate token-by-token because `2` records consume two.
  const tokens = stdout.split('\0')
  let i = 0
  while (i < tokens.length) {
    const line = tokens[i]!
    if (line === '') {
      i += 1
      continue
    }
    if (line.startsWith('# ')) {
      const rest = line.slice(2)
      if (rest.startsWith('branch.head ')) {
        const head = rest.slice('branch.head '.length).trim()
        if (head === '(detached)') {
          parsed.detached = true
        } else {
          parsed.branch = head
        }
      } else if (rest.startsWith('branch.oid ')) {
        const oid = rest.slice('branch.oid '.length).trim()
        if (parsed.detached && oid !== '(initial)') parsed.detachedAt = oid.slice(0, 7)
      } else if (rest.startsWith('branch.upstream ')) {
        parsed.upstream = rest.slice('branch.upstream '.length).trim()
      } else if (rest.startsWith('branch.ab ')) {
        const ab = rest.slice('branch.ab '.length).trim().split(' ')
        const aheadStr = ab[0] ?? '+0'
        const behindStr = ab[1] ?? '-0'
        parsed.ahead = Number.parseInt(aheadStr.replace('+', ''), 10) || 0
        parsed.behind = Number.parseInt(behindStr.replace('-', ''), 10) || 0
      }
      i += 1
      continue
    }

    const kind = line[0]
    if (kind === '1') {
      // "1 <xy> <sub> <mH> <mI> <mW> <hH> <hI> <path>"
      const parts = line.split(' ')
      const xy = parts[1] ?? '..'
      const path = parts.slice(8).join(' ')
      for (const e of mapXyEntries(xy)) {
        parsed.files.push({
          path,
          changeType: e.changeType,
          stageState: e.stageState,
          isBinary: false,
        })
      }
      i += 1
      continue
    }

    if (kind === '2') {
      // "2 <xy> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>" + "\0<origPath>"
      const parts = line.split(' ')
      const xy = parts[1] ?? '..'
      const path = parts.slice(9).join(' ')
      const oldPath = tokens[i + 1] ?? ''
      for (const e of mapXyEntries(xy)) {
        const entry: GitFileStatus = {
          path,
          changeType: e.changeType,
          stageState: e.stageState,
          isBinary: false,
        }
        // oldPath describes the index-side rename/copy → attach to the staged entry.
        if (oldPath && e.stageState === 'staged') entry.oldPath = oldPath
        parsed.files.push(entry)
      }
      i += 2
      continue
    }

    if (kind === 'u') {
      // "u <xy> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>"
      const parts = line.split(' ')
      const path = parts.slice(10).join(' ')
      parsed.files.push({
        path,
        changeType: 'conflicted',
        stageState: 'conflicted',
        isBinary: false,
      })
      i += 1
      continue
    }

    if (kind === '?') {
      const path = line.slice(2)
      parsed.files.push({
        path,
        changeType: 'untracked',
        stageState: 'untracked',
        isBinary: false,
      })
      i += 1
      continue
    }

    if (kind === '!') {
      const path = line.slice(2)
      parsed.files.push({
        path,
        changeType: 'ignored',
        stageState: 'unstaged',
        isBinary: false,
      })
      i += 1
      continue
    }

    i += 1
  }
  return parsed
}

// ─── log ───────────────────────────────────────────────────────────────────

// Format: %H\0%h\0%an\0%ae\0%aI\0%cn\0%cI\0%P\0%D\0%s\0%b followed by \x1E.
// %D = ref decoration emitted by `git log --decorate=full` — comma-space
// separated entries like `HEAD -> refs/heads/main`, `refs/tags/v1.0`,
// `refs/remotes/origin/main`, `refs/stash`.
const LOG_RECORD_SEP = '\x1e'
const PHASE_TAG_RE = /^\[([^\]]+)\]/

// Parse one entry from `%D` (decoration). Returns null when the token is empty
// or not a recognized ref namespace (defensive — git can emit `tag: ` aliases).
function parseDecorationToken(raw: string): GitRef | null {
  const token = raw.trim()
  if (!token) return null
  // `HEAD` alone (detached HEAD with no branch attached).
  if (token === 'HEAD') return { kind: 'HEAD', name: 'HEAD' }
  // `HEAD -> refs/heads/<branch>` — surface as a HEAD chip so the UI can hint
  // the current branch. The branch itself is emitted in a sibling token, so
  // we don't double-emit a branch here.
  const headArrow = /^HEAD -> (.+)$/.exec(token)
  if (headArrow) {
    const target = headArrow[1] ?? ''
    const branchName = target.startsWith('refs/heads/')
      ? target.slice('refs/heads/'.length)
      : target
    return { kind: 'HEAD', name: branchName }
  }
  // `tag: refs/tags/<name>` with `--decorate=full`.
  const tagMatch = /^tag: (?:refs\/tags\/)?(.+)$/.exec(token)
  if (tagMatch) return { kind: 'tag', name: tagMatch[1] ?? '' }
  if (token.startsWith('refs/heads/')) {
    return { kind: 'branch', name: token.slice('refs/heads/'.length) }
  }
  if (token.startsWith('refs/remotes/')) {
    return { kind: 'remote-branch', name: token.slice('refs/remotes/'.length) }
  }
  if (token.startsWith('refs/tags/')) {
    return { kind: 'tag', name: token.slice('refs/tags/'.length) }
  }
  if (token === 'refs/stash' || token.startsWith('refs/stash')) {
    return { kind: 'stash', name: 'stash' }
  }
  // Unknown namespace — skip rather than guess.
  return null
}

function parseDecoration(raw: string): GitRef[] {
  if (!raw) return []
  return raw
    .split(', ')
    .map(parseDecorationToken)
    .filter((r): r is GitRef => r !== null)
}

export function parseLogFormat(stdout: string): GitCommit[] {
  if (!stdout) return []
  const trimmed = stdout.endsWith(LOG_RECORD_SEP) ? stdout.slice(0, -1) : stdout
  if (!trimmed) return []
  return trimmed.split(LOG_RECORD_SEP).reduce<GitCommit[]>((acc, record) => {
    // git log -z separates records with NUL when using -z; we use a custom RS
    // to also support multi-record output without -z collisions in body text.
    const rec = record.replace(/^[\r\n]+/, '')
    if (!rec) return acc
    const parts = rec.split('\0')
    if (parts.length < 11) return acc
    const sha = parts[0] ?? ''
    const sha7 = parts[1] ?? ''
    const authorName = parts[2] ?? ''
    const authorEmail = parts[3] ?? ''
    const authorAt = parts[4] ?? ''
    const committerName = parts[5] ?? ''
    const committerAt = parts[6] ?? ''
    const parents = (parts[7] ?? '').split(' ').filter(Boolean)
    const refs = parseDecoration(parts[8] ?? '')
    const subject = parts[9] ?? ''
    const body = parts[10] ?? ''
    const message = body ? `${subject}\n\n${body}` : subject
    const commit: GitCommit = {
      sha,
      sha7,
      authorName,
      authorEmail,
      authorAt,
      committerName,
      committerAt,
      parents,
      subject,
      message,
      refs,
    }
    const phaseMatch = PHASE_TAG_RE.exec(subject)
    if (phaseMatch) commit.linkedPhaseId = phaseMatch[1]
    acc.push(commit)
    return acc
  }, [])
}

// ─── for-each-ref ──────────────────────────────────────────────────────────

const REF_RECORD_SEP = '\x1e'

export function parseForEachRef(stdout: string): GitBranch[] {
  if (!stdout) return []
  const trimmed = stdout.endsWith(REF_RECORD_SEP) ? stdout.slice(0, -1) : stdout
  return trimmed.split(REF_RECORD_SEP).reduce<GitBranch[]>((acc, rec) => {
    const r = rec.replace(/^[\r\n]+/, '')
    if (!r) return acc
    const parts = r.split('\0')
    if (parts.length < 7) return acc
    const refname = parts[0] ?? ''
    const shortName = parts[1] ?? ''
    const upstream = parts[2] ?? ''
    const track = parts[3] ?? ''
    const objectName = parts[4] ?? ''
    const subject = parts[5] ?? ''
    const committerDate = parts[6] ?? ''

    const isRemote = refname.startsWith('refs/remotes/')
    const isLocal = refname.startsWith('refs/heads/')
    if (!isRemote && !isLocal) return acc

    // Parse "[ahead 1, behind 2]" or "[gone]"; empty when in-sync / no upstream.
    let ahead = 0
    let behind = 0
    const aheadMatch = /ahead (\d+)/.exec(track)
    const behindMatch = /behind (\d+)/.exec(track)
    if (aheadMatch) ahead = Number.parseInt(aheadMatch[1] ?? '0', 10)
    if (behindMatch) behind = Number.parseInt(behindMatch[1] ?? '0', 10)

    acc.push({
      name: shortName,
      kind: isRemote ? 'remote' : 'local',
      isCurrent: false,
      upstream: upstream || null,
      ahead,
      behind,
      lastCommitSha: objectName,
      lastCommitSubject: subject,
      lastCommitAt: committerDate,
    })
    return acc
  }, [])
}

// ─── stash list ────────────────────────────────────────────────────────────

const STASH_RECORD_SEP = '\x1e'
// "WIP on <branch>: <sha7> <subject>" or "On <branch>: <userMsg>"
const STASH_MSG_RE = /^(?:WIP on|On)\s+([^:]+):/

export function parseStashList(stdout: string): GitStashEntry[] {
  if (!stdout) return []
  const trimmed = stdout.endsWith(STASH_RECORD_SEP) ? stdout.slice(0, -1) : stdout
  return trimmed.split(STASH_RECORD_SEP).reduce<GitStashEntry[]>((acc, rec) => {
    const r = rec.replace(/^[\r\n]+/, '')
    if (!r) return acc
    const parts = r.split('\0')
    if (parts.length < 4) return acc
    const sel = parts[0] ?? ''
    const sha = parts[1] ?? ''
    const createdAt = parts[2] ?? ''
    const subject = parts[3] ?? ''
    const idxMatch = /stash@\{(\d+)\}/.exec(sel)
    const index = idxMatch ? Number.parseInt(idxMatch[1] ?? '0', 10) : acc.length
    const branchMatch = STASH_MSG_RE.exec(subject)
    acc.push({
      index,
      message: subject,
      createdAt,
      baseSha: sha,
      baseBranch: branchMatch?.[1] ?? '',
    })
    return acc
  }, [])
}

// ─── remote -v ─────────────────────────────────────────────────────────────

export function parseRemoteV(stdout: string): GitRemote[] {
  if (!stdout) return []
  const lines = stdout.split('\n').filter((l) => l.trim().length > 0)
  const byName = new Map<string, GitRemote>()
  for (const line of lines) {
    // "<name>\t<url> (fetch|push)"
    const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)/.exec(line)
    if (!m) continue
    const name = m[1] ?? ''
    const url = m[2] ?? ''
    const kind = m[3] as 'fetch' | 'push'
    const existing = byName.get(name) ?? { name, fetchUrl: '', pushUrl: '' }
    if (kind === 'fetch') existing.fetchUrl = url
    else existing.pushUrl = url
    byName.set(name, existing)
  }
  return Array.from(byName.values())
}

// ─── unified diff ──────────────────────────────────────────────────────────

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

interface PendingFile {
  path: string
  oldPath?: string
  isBinary: boolean
  isRename: boolean
  hunks: GitDiffHunk[]
  oldFileMode?: string
  newFileMode?: string
}

function pushPending(out: GitFileDiff[], cur: PendingFile | null): void {
  if (!cur) return
  const file: GitFileDiff = {
    path: cur.path,
    isBinary: cur.isBinary,
    isRename: cur.isRename,
    hunks: cur.hunks,
  }
  if (cur.oldPath !== undefined) file.oldPath = cur.oldPath
  if (cur.oldFileMode !== undefined) file.oldFileMode = cur.oldFileMode
  if (cur.newFileMode !== undefined) file.newFileMode = cur.newFileMode
  out.push(file)
}

// Parse `git diff` / `git show --format=` unified output. Handles rename
// headers ("rename from / rename to"), binary marker, mode change, plain
// modify. Does not attempt to be a full libgit2 — covers the v1 visualizer
// (no line numbering correctness for split context lost in `\ No newline`).
export function parseUnifiedDiff(stdout: string): GitFileDiff[] {
  if (!stdout) return []
  const out: GitFileDiff[] = []
  let cur: PendingFile | null = null
  let curHunk: GitDiffHunk | null = null
  let oldLn = 0
  let newLn = 0
  const lines = stdout.split('\n')

  for (const raw of lines) {
    const line = raw
    if (line.startsWith('diff --git ')) {
      pushPending(out, cur)
      curHunk = null
      // path from "diff --git a/<path> b/<path>"; rename overrides later.
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line)
      const path = m?.[2] ?? ''
      cur = {
        path,
        isBinary: false,
        isRename: false,
        hunks: [],
      }
      continue
    }
    if (!cur) continue

    if (line.startsWith('rename from ')) {
      cur.oldPath = line.slice('rename from '.length)
      cur.isRename = true
      continue
    }
    if (line.startsWith('rename to ')) {
      cur.path = line.slice('rename to '.length)
      continue
    }
    if (line.startsWith('old mode ')) {
      cur.oldFileMode = line.slice('old mode '.length).trim()
      continue
    }
    if (line.startsWith('new mode ')) {
      cur.newFileMode = line.slice('new mode '.length).trim()
      continue
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      cur.isBinary = true
      curHunk = null
      continue
    }
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      // header lines — already captured via diff --git; skip.
      continue
    }

    const hm = HUNK_HEADER_RE.exec(line)
    if (hm) {
      const oldStart = Number.parseInt(hm[1] ?? '0', 10)
      const oldLines = hm[2] ? Number.parseInt(hm[2], 10) : 1
      const newStart = Number.parseInt(hm[3] ?? '0', 10)
      const newLines = hm[4] ? Number.parseInt(hm[4], 10) : 1
      curHunk = {
        oldStart,
        oldLines,
        newStart,
        newLines,
        header: line,
        lines: [],
      }
      cur.hunks.push(curHunk)
      oldLn = oldStart
      newLn = newStart
      continue
    }

    if (!curHunk) continue

    if (line.startsWith('\\')) {
      // "\ No newline at end of file"
      curHunk.lines.push({ kind: 'noeol', content: line })
      continue
    }
    const first = line[0]
    let kind: GitDiffLineKind
    if (first === '+') kind = 'add'
    else if (first === '-') kind = 'del'
    else if (first === ' ') kind = 'context'
    // A unified-diff body line always starts with ' ', '+' or '-'. Anything else
    // — notably the empty string left by `stdout.split('\n')` after git's final
    // newline — is NOT a content line. Treating it as context appended a phantom
    // empty context line to the last hunk, which made `git.stageHunk` rebuild a
    // patch that `git apply` rejected ("patch does not apply") for the last hunk.
    else continue
    const content = line.slice(1)
    const diffLine: GitDiffLine = { kind, content }
    if (kind === 'del' || kind === 'context') {
      diffLine.oldLineNum = oldLn
      oldLn += 1
    }
    if (kind === 'add' || kind === 'context') {
      diffLine.newLineNum = newLn
      newLn += 1
    }
    curHunk.lines.push(diffLine)
  }
  pushPending(out, cur)
  return out
}
