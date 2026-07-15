import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type {
  BranchInfo,
  Commit,
  CommitRef,
  DiffLine,
  GitFile,
  ProjectInfo,
  RemoteInfo,
  Stash,
} from '~/components/git/git-types'
import { DEMO_DIFF, DEMO_DIFF2, createGitState } from '~/components/git/git-types'
import { useFsApi } from '~/composables/useFsApi'
import { useGitApi } from '~/composables/useGitApi'
import type {
  GitIdentity,
  GitStreamingOp,
  PrSummaryResult,
  PushParams,
  ReadConflictFileResult,
  SetIdentityParams,
  SidecarGitBranch,
  SidecarGitCommit,
  SidecarGitDiff,
  SidecarGitFileChangeType,
  SidecarGitFileStatus,
  SidecarGitRemote,
  SidecarGitStashEntry,
} from '~/composables/useGitApi'
import { SidecarError, useSidecar, type UnlistenFn } from '~/composables/useSidecar'
import { DEFAULT_COMMIT_MESSAGE_RULE, useSettingsStore } from '~/stores/settings'
import { useProjectsStore } from '~/stores/projects'
import type { GitRepoEntry, ProjectsListResponse } from '~/types'

// ─── Adapters: sidecar shape → ui-next view shape ───────────────────────────
// The sidecar speaks the workspace-rooted shapes in useGitApi; the git.vue page
// + components/git/* bind to the compact prototype shapes in git-types. These
// pure functions bridge the two. Mirrors apps/desktop/ui/stores/git/adapters.ts
// (same field semantics, different output shape).

const ST_CHAR: Record<SidecarGitFileChangeType, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: '?',
  conflicted: 'U',
  type_changed: 'T',
  ignored: 'I',
}

const REF_KIND: Record<SidecarGitCommit['refs'][number]['kind'], CommitRef['t'] | null> = {
  HEAD: 'head',
  'remote-branch': 'remote',
  branch: 'branch',
  tag: 'tag',
  stash: null,
}

function adaptFile(f: SidecarGitFileStatus): GitFile {
  return { f: f.path, st: ST_CHAR[f.changeType] ?? 'M' }
}

function adaptCommit(c: SidecarGitCommit): Commit {
  const body =
    c.message.length > c.subject.length ? c.message.slice(c.subject.length).trimStart() : ''
  const refs: CommitRef[] = c.refs
    .map<CommitRef | null>((r) => {
      const t = REF_KIND[r.kind]
      return t ? { t, n: r.name } : null
    })
    .filter((x): x is CommitRef => x !== null)
  return {
    h: c.sha7,
    sha: c.sha,
    m: c.subject,
    a: c.authorName,
    email: c.authorEmail,
    w: formatWhen(c.authorAt),
    body,
    merge: c.parents.length > 1,
    refs,
    files: [],
  }
}

function adaptBranch(b: SidecarGitBranch): BranchInfo {
  return {
    name: b.name,
    current: b.isCurrent,
    remote: b.kind === 'remote',
    ahead: b.ahead,
    behind: b.behind,
    upstream: b.upstream ?? undefined,
    lastCommitAt: b.lastCommitAt || undefined,
  }
}

function adaptStash(s: SidecarGitStashEntry): Stash {
  return {
    index: s.index,
    ref: `stash@{${s.index}}`,
    m: s.message,
    branch: s.baseBranch,
    w: formatWhen(s.createdAt),
  }
}

function adaptRemote(r: SidecarGitRemote): RemoteInfo {
  return { name: r.name, fetchUrl: r.fetchUrl, pushUrl: r.pushUrl }
}

// Flatten every file's hunks into a single list of rendered diff rows (the
// prototype DiffViewer renders one flat list, not per-file sections). Hunk
// headers become `@` rows; context/add/del rows carry the relevant line number.
// Adapt a single file's hunks into rendered diff lines (hunk header + body).
function adaptFileDiff(file: SidecarGitDiff['files'][number]): DiffLine[] {
  const out: DiffLine[] = []
  for (const hunk of file.hunks) {
    out.push({ t: '@', s: hunk.header })
    for (const line of hunk.lines) {
      if (line.kind === 'context') out.push({ t: ' ', n: line.newLineNum, s: line.content })
      else if (line.kind === 'add') out.push({ t: '+', n: line.newLineNum, s: line.content })
      else if (line.kind === 'del') out.push({ t: '-', n: line.oldLineNum, s: line.content })
      // 'noeol' → skip (no rendered row).
    }
  }
  return out
}

function adaptDiff(d: SidecarGitDiff): DiffLine[] {
  return d.files.flatMap(adaptFileDiff)
}

// Parse a git remote URL into {host, owner, repo}, handling both SSH
// (`git@github.com:owner/repo.git`) and HTTPS
// (`https://github.com/owner/repo[.git]`) forms. A trailing `.git` is stripped.
// Returns null when the shape doesn't match (used to no-op "open PR").
function parseRemoteUrl(raw: string): { host: string; owner: string; repo: string } | null {
  const url = raw.trim()
  if (!url) return null
  const stripGit = (s: string): string => (s.endsWith('.git') ? s.slice(0, -4) : s)
  // SSH form: git@host:owner/repo(.git)
  const ssh = /^[^@]+@([^:]+):(.+?)\/([^/]+?)\/?$/.exec(url)
  if (ssh) {
    const host = ssh[1]
    const owner = ssh[2]
    const repo = ssh[3]
    if (host && owner && repo) return { host, owner, repo: stripGit(repo) }
    return null
  }
  // HTTPS / scp-less http form: https://host/owner/repo(.git)
  const https = /^https?:\/\/([^/]+)\/(.+?)\/([^/]+?)\/?$/.exec(url)
  if (https) {
    const host = https[1]
    const owner = https[2]
    const repo = https[3]
    if (host && owner && repo) return { host, owner, repo: stripGit(repo) }
    return null
  }
  return null
}

// Short, human-readable relative time for commit/stash timestamps. No external
// lib: < 1h → "Nm", < 24h → "Nh", < 7d → "Nd", else a compact date (no time) so
// history rows stay single-line. Invalid input passes through unchanged.
function formatWhen(iso: string): string {
  const then = new Date(iso)
  const ms = then.getTime()
  if (Number.isNaN(ms)) return iso
  const diff = Date.now() - ms
  if (diff < 0) return then.toLocaleDateString()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return then.toLocaleDateString()
}

// Result of a mutating git action. Actions never throw to their caller; they
// resolve `{ ok: false, code }` so the UI can branch on the gitCode (e.g. offer
// "stash & switch" on DIRTY_TREE) instead of failing silently in the console.
export type GitOpResult = { ok: true } | { ok: false; code: string | null; message: string }

// Branch delete also reports the optional remote-delete outcome (the local
// delete can succeed while the remote push --delete fails, e.g. auth).
export type DeleteBranchResult =
  | { ok: true; remoteDeleted: boolean; remoteError?: string }
  | { ok: false; code: string | null; message: string }

// ─── Store ──────────────────────────────────────────────────────────────────
// Dual-mode: in the Electron shell (`available`) every action hits the sidecar
// over IPC and re-syncs the view state; in browser-dev (`!available`) it mutates
// the mock seed locally so the prototype UX stays interactive. Mirrors the
// production git store (apps/desktop/ui/stores/git/*) but emits the compact
// git-types view shapes instead of the per-project entity shapes.
export const useGitStore = defineStore('git', () => {
  const seed = createGitState()

  // ── View state (git.vue binds these names verbatim) ──
  const projects = ref<ProjectInfo[]>(seed.projects)
  const currentProjectId = ref<string>(seed.currentProjectId)
  const repos = ref<string[]>(seed.repos)
  const repo = ref<string>(seed.repo)
  const branch = ref<string>(seed.branch)
  const ahead = ref<number>(seed.ahead)
  const behind = ref<number>(seed.behind)
  const branches = ref<BranchInfo[]>(seed.branches)
  const remotes = ref<RemoteInfo[]>(seed.remotes)
  const tags = ref<string[]>(seed.tags)
  const stashes = ref<Stash[]>(seed.stashes)
  const staged = ref<GitFile[]>(seed.staged)
  const unstaged = ref<GitFile[]>(seed.unstaged)
  const conflicted = ref<GitFile[]>(seed.conflicted)
  const commits = ref<Commit[]>(seed.commits)
  const isMerging = ref<boolean>(seed.isMerging)
  const isRebasing = ref<boolean>(seed.isRebasing)
  const hasConflict = ref<boolean>(seed.hasConflict)
  const isDetached = ref<boolean>(seed.isDetached)
  const detachedAt = ref<string | null>(seed.detachedAt)
  const commitMessage = ref<string>('')
  // In-flight guards for the commit panel — drive button spinners + disabled
  // state and block re-entry (Cmd+Enter / double-click) to avoid racing the
  // sidecar with overlapping commit/amend or generate calls.
  const isCommitting = ref<boolean>(false)
  const isGeneratingCommit = ref<boolean>(false)
  const historyHasMore = ref<boolean>(false)
  // True when the selected workspace exists but isn't a git repo (git.status →
  // NO_REPO). Drives the Git page's "initialize repository" empty state instead of
  // a silent console error.
  const notARepo = ref<boolean>(false)

  // ── Internal repo resolution ──
  // Discovered repo entries keyed by label; `selectedRepoLabel` drives `repo`.
  const repoEntries = ref<GitRepoEntry[]>([])
  const repoPathByLabel = ref<Map<string, string>>(new Map())
  const selectedRepoLabel = ref<string | null>(null)

  // Tag name → sha, populated by loadTags(); used by checkoutTag to detach HEAD.
  const tagShaByName = ref<Record<string, string>>({})

  // Live `git:status:changed` unlisten handle (set by subscribe()).
  let unlisten: UnlistenFn | null = null
  let statusRefreshTimer: ReturnType<typeof setTimeout> | null = null
  // Background auto-fetch (CLAUDE.md: silent fetch every N minutes while the git
  // page is open + on window focus). Interval ms comes from
  // settings.git.autoFetchIntervalMs; 0 disables it. Set/cleared by subscribe()/
  // unsubscribe() so the lifecycle matches the git page mount/unmount.
  let autoFetchTimer: ReturnType<typeof setInterval> | null = null
  let onWindowFocus: (() => void) | null = null

  const available = computed(() => useSidecar().available)

  // ── Error surfacing ──
  // Last failed mutating op. The git page watches this to toast a human message
  // (mapped from `code`) so failures aren't silent in the console. A fresh object
  // is assigned per failure so identical consecutive errors still trigger the watch.
  const lastError = ref<{ op: string; code: string | null; message: string } | null>(null)

  // Remote-sync in-flight state (fetch/pull/push). Drives the header buttons'
  // busy/spinner state + live progress fed by git:*:progress events. null = idle.
  const syncOp = ref<{ op: GitStreamingOp; phase: string; pct: number | null } | null>(null)

  // One-off success notice (mirrors lastError) → GitManager toasts it. Gives the
  // remote-sync ops a visible confirmation even when nothing changed (the common
  // "Already up to date" case that otherwise looks like the button did nothing).
  // A fresh object per call so identical consecutive notices still trigger the watch.
  const lastNotice = ref<{ key: string; params?: Record<string, string | number> } | null>(null)

  // Pull the sidecar gitCode (DIRTY_TREE / AUTH_FAILED / …) out of an error, when present.
  const gitCodeOf = (err: unknown): string | null => {
    if (err instanceof SidecarError && err.data && typeof err.data === 'object') {
      const c = (err.data as { gitCode?: unknown }).gitCode
      if (typeof c === 'string') return c
    }
    return null
  }

  // Log (kept for diagnostics) + publish to `lastError` so the UI can react.
  const reportError = (op: string, err: unknown): void => {
    console.warn(`[git] ${op} failed`, err)
    lastError.value = {
      op,
      code: gitCodeOf(err),
      message: err instanceof Error ? err.message : String(err),
    }
  }

  // Auth-failure flavour the sidecar tags onto AUTH_FAILED errors (mirrors
  // detectAuthHint) so the UI can give actionable copy: SSH key vs HTTPS token.
  type GitAuthHint = 'ssh-key' | 'https-token' | 'unknown'

  // A remote op that failed to authenticate → drives the rich GitAuthErrorModal
  // (not just a toast). null = no pending auth error.
  const pendingAuthError = ref<{ op: GitStreamingOp; hint: GitAuthHint; message: string } | null>(
    null,
  )

  // Pull the auth flavour + sanitized message out of an AUTH_FAILED error; null
  // when it isn't an auth failure (caller then falls back to a plain toast).
  const authPayloadOf = (err: unknown): { hint: GitAuthHint; message: string } | null => {
    if (gitCodeOf(err) !== 'AUTH_FAILED') return null
    const data =
      err instanceof SidecarError && err.data && typeof err.data === 'object'
        ? (err.data as { hint?: unknown; stderrSanitized?: unknown })
        : undefined
    const hint = data?.hint
    return {
      hint: hint === 'ssh-key' || hint === 'https-token' ? hint : 'unknown',
      message:
        (typeof data?.stderrSanitized === 'string' && data.stderrSanitized) ||
        (err instanceof Error ? err.message : ''),
    }
  }

  const clearAuthError = (): void => {
    pendingAuthError.value = null
  }

  // Route a remote-sync failure: auth → rich modal, everything else → toast.
  const reportSyncError = (op: GitStreamingOp, err: unknown): void => {
    // A user-initiated cancel throws CANCELLED from the sidecar — that's not a
    // failure, so surface a neutral notice instead of an error toast.
    if (gitCodeOf(err) === 'CANCELLED') {
      lastNotice.value = { key: 'git.notice.cancelled' }
      return
    }
    const auth = authPayloadOf(err)
    if (auth) pendingAuthError.value = { op, ...auth }
    else reportError(op, err)
  }

  const projectPath = (): string =>
    projects.value.find((p) => p.id === currentProjectId.value)?.path ?? ''

  // Effective git root: the selected repo's path, falling back to the project
  // folder (single-repo / not-yet-discovered). Empty → loaders/actions no-op.
  const workspaceRoot = (): string => {
    const label = selectedRepoLabel.value
    if (label) {
      const p = repoPathByLabel.value.get(label)
      if (p) return p
    }
    return projectPath()
  }

  // The gh account to authenticate github.com remotes as, for fetch/pull/push.
  // Source of truth = the project's GitHub-account setting (Project.githubAccount,
  // set in Project → Overview), inheriting the app-level default (Settings → Git)
  // when unset. Undefined → the sidecar leaves git's own credential helper (OS
  // keychain) untouched, i.e. no behavior change. Same resolution the Issues/PR
  // tabs use (see utils/project-gh-account). See git.push.ts for the sidecar side.
  const effectiveGhAccount = (): string | undefined => {
    const project = useProjectsStore().projectById(currentProjectId.value)
    return resolveGhAccount(project?.githubAccount, useSettingsStore().githubAccount)
  }

  // The effective gh account for the current project, for display in the Git
  // header ('' when none is pinned → the header shows a "Default" chip).
  const activeGhAccount = computed<string>(() => effectiveGhAccount() ?? '')

  const repoLabel = (r: GitRepoEntry): string => (r.isRoot ? r.name : r.relativePath)

  // ─── Read loaders ─────────────────────────────────────────────────────────

  const discoverRepos = async () => {
    const root = projectPath()
    if (!root) return
    try {
      const result = await useGitApi().discoverRepos(root)
      repoEntries.value = result.repos
      const map = new Map<string, string>()
      for (const r of result.repos) map.set(repoLabel(r), r.path)
      repoPathByLabel.value = map
      repos.value = result.repos.map(repoLabel)
      // Keep the current selection if it still exists; else prefer the root repo.
      const current = selectedRepoLabel.value
      if (!current || !map.has(current)) {
        const next = result.repos.find((r) => r.isRoot) ?? result.repos[0]
        selectedRepoLabel.value = next ? repoLabel(next) : null
        repo.value = selectedRepoLabel.value ?? ''
      }
    } catch (err) {
      console.warn('[git] discoverRepos failed', err)
    }
  }

  const loadStatus = async () => {
    const root = workspaceRoot()
    if (!root) return
    try {
      const status = await useGitApi().status(root)
      const nextStaged: GitFile[] = []
      const nextUnstaged: GitFile[] = []
      const nextConflicted: GitFile[] = []
      for (const f of status.files) {
        if (f.stageState === 'conflicted') nextConflicted.push(adaptFile(f))
        else if (f.stageState === 'staged') nextStaged.push(adaptFile(f))
        else nextUnstaged.push(adaptFile(f))
      }
      staged.value = nextStaged
      unstaged.value = nextUnstaged
      conflicted.value = nextConflicted
      isMerging.value = status.isMerging
      isRebasing.value = status.isRebasing
      isDetached.value = status.detached
      detachedAt.value = status.detachedAt ?? null
      hasConflict.value =
        status.conflictedCount > 0 || status.files.some((f) => f.stageState === 'conflicted')
      ahead.value = status.ahead
      behind.value = status.behind
      notARepo.value = false
    } catch (err) {
      if (gitCodeOf(err) === 'NO_REPO') {
        // Folder exists but has no .git — surface the init empty state and clear
        // any data carried over from a previously-selected (real) repo.
        notARepo.value = true
        staged.value = []
        unstaged.value = []
        conflicted.value = []
        commits.value = []
        branches.value = []
        remotes.value = []
        tags.value = []
        stashes.value = []
        ahead.value = 0
        behind.value = 0
        return
      }
      console.warn('[git] loadStatus failed', err)
    }
  }

  const loadHistory = async (opts: { append?: boolean; skip?: number } = {}) => {
    const root = workspaceRoot()
    if (!root) return
    try {
      const params: { workspaceRoot: string; limit: number; skip?: number } = {
        workspaceRoot: root,
        limit: 100,
      }
      if (opts.skip !== undefined) params.skip = opts.skip
      const result = await useGitApi().log(params)
      const adapted = result.commits.map(adaptCommit)
      commits.value = opts.append ? [...commits.value, ...adapted] : adapted
      historyHasMore.value = result.hasMore
    } catch (err) {
      console.warn('[git] loadHistory failed', err)
    }
  }

  const loadMoreHistory = () => loadHistory({ append: true, skip: commits.value.length })

  const loadBranches = async () => {
    const root = workspaceRoot()
    if (!root) return
    try {
      const result = await useGitApi().branchList(root)
      branches.value = result.branches.map(adaptBranch)
      const current = result.branches.find((b) => b.isCurrent && b.kind === 'local')
      if (current) branch.value = current.name
    } catch (err) {
      console.warn('[git] loadBranches failed', err)
    }
  }

  const loadStashes = async () => {
    const root = workspaceRoot()
    if (!root) return
    try {
      const result = await useGitApi().stashList(root)
      stashes.value = result.stashes.map(adaptStash)
    } catch (err) {
      console.warn('[git] loadStashes failed', err)
    }
  }

  const loadRemotes = async () => {
    const root = workspaceRoot()
    if (!root) return
    try {
      const result = await useGitApi().remoteList(root)
      remotes.value = result.remotes.map(adaptRemote)
    } catch (err) {
      console.warn('[git] loadRemotes failed', err)
    }
  }

  const loadTags = async () => {
    if (!available.value) return // mock keeps its seeded / derived tags
    const root = workspaceRoot()
    if (!root) return
    try {
      const { tags: list } = await useGitApi().tagList(root)
      tags.value = list.map((t) => t.name)
      tagShaByName.value = Object.fromEntries(list.map((t) => [t.name, t.sha]))
    } catch (err) {
      console.warn('[git] loadTags failed', err)
    }
  }

  const loadAll = async () => {
    // Probe status first: a NO_REPO workspace short-circuits the rest so the other
    // loaders (history / branches / stashes / remotes / tags) don't each spawn git
    // and fail with "not a git repository". loadStatus sets notARepo + clears data.
    await loadStatus()
    if (notARepo.value) {
      historyHasMore.value = false
      return
    }
    await Promise.all([loadHistory(), loadBranches(), loadStashes(), loadRemotes()])
    if (available.value) {
      await loadTags()
      return
    }
    // Mock mode: derive tags from the commit ref decorations (sidecar exposes
    // tags as refs on the history; the prototype keeps a flat name list).
    const seen = new Set<string>()
    const names: string[] = []
    for (const c of commits.value) {
      for (const r of c.refs ?? []) {
        if (r.t === 'tag' && !seen.has(r.n)) {
          seen.add(r.n)
          names.push(r.n)
        }
      }
    }
    tags.value = names
  }

  // ─── Projects ─────────────────────────────────────────────────────────────

  const loadProjects = async () => {
    try {
      const result = await useSidecar().request<ProjectsListResponse>('projects.list')
      projects.value = result.projects.map((p) => ({
        id: p.id,
        name: p.name,
        path: p.path,
        ...(p.color !== undefined ? { color: p.color } : {}),
      }))
      if (!projects.value.some((p) => p.id === currentProjectId.value)) {
        const first = projects.value[0]
        if (first) currentProjectId.value = first.id
      }
    } catch (err) {
      console.warn('[git] loadProjects failed', err)
    }
  }

  // ─── Background auto-fetch ──────────────────────────────────────────────────
  // Silent `git fetch` so ahead/behind stays fresh without a manual click. Never
  // throws (failures are swallowed) and never opens the progress strip — it just
  // refreshes status + branches when refs actually moved.
  const silentFetch = async () => {
    const root = workspaceRoot()
    if (!available.value || !root || notARepo.value) return
    try {
      await useGitApi().fetch(root, { ghAccount: effectiveGhAccount() })
      await Promise.all([loadStatus(), loadBranches()])
    } catch {
      // Background fetch is best-effort — offline/no-remote is non-fatal.
    }
  }

  const stopAutoFetch = () => {
    if (autoFetchTimer) {
      clearInterval(autoFetchTimer)
      autoFetchTimer = null
    }
    if (onWindowFocus && typeof window !== 'undefined') {
      window.removeEventListener('focus', onWindowFocus)
      onWindowFocus = null
    }
  }

  // (Re)arm the periodic fetch from the current settings interval. interval ≤ 0
  // disables it (Settings → Workspace "Auto-fetch" off). Called on subscribe and
  // whenever the configured interval changes.
  const startAutoFetch = () => {
    stopAutoFetch()
    if (!available.value) return
    const intervalMs = useSettingsStore().git.autoFetchIntervalMs
    if (!intervalMs || intervalMs <= 0) return
    autoFetchTimer = setInterval(() => {
      void silentFetch()
    }, intervalMs)
    if (typeof window !== 'undefined') {
      onWindowFocus = () => void silentFetch()
      window.addEventListener('focus', onWindowFocus)
    }
  }

  // ─── Live subscription ──────────────────────────────────────────────────────

  // Re-arm the scheduler when the user changes the interval (or toggles
  // auto-fetch) while the git page is open. The watch only acts while a live
  // subscription exists (unlisten set) — otherwise nothing is scheduled yet.
  watch(
    () => useSettingsStore().git.autoFetchIntervalMs,
    () => {
      if (unlisten) startAutoFetch()
    },
  )

  const subscribe = async () => {
    const sidecar = useSidecar()
    if (!sidecar.available) return
    startAutoFetch()
    try {
      unlisten = await sidecar.onEvent((evt) => {
        const typed = evt as unknown as { type?: string; method?: string }
        const evtType = typed.type ?? typed.method ?? null
        if (!evtType) return
        // Live progress for the in-flight remote-sync op → drives the header
        // button's spinner/percent. Only react while an op is actually running.
        // Payload (phase/pct) is nested under `evt.payload` per SidecarEvent.
        const m = /^git:(fetch|pull|push):progress$/.exec(evtType)
        if (m && syncOp.value && syncOp.value.op === m[1]) {
          const p = (evt as { payload?: { phase?: string; pct?: number | null } }).payload ?? {}
          syncOp.value = {
            op: syncOp.value.op,
            phase: typeof p.phase === 'string' ? p.phase : syncOp.value.phase,
            pct: typeof p.pct === 'number' ? p.pct : null,
          }
          return
        }
        if (evtType !== 'git:status:changed') return
        // Debounce burst (many .git files touched in one operation).
        if (statusRefreshTimer) clearTimeout(statusRefreshTimer)
        statusRefreshTimer = setTimeout(() => {
          statusRefreshTimer = null
          loadStatus().catch(() => undefined)
        }, 200)
      })
    } catch (err) {
      console.warn('[git] subscribe failed', err)
    }
  }

  const unsubscribe = () => {
    if (statusRefreshTimer) {
      clearTimeout(statusRefreshTimer)
      statusRefreshTimer = null
    }
    stopAutoFetch()
    if (unlisten) {
      unlisten()
      unlisten = null
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  const init = async () => {
    // Seed mock state so browser-dev + first paint show something immediately.
    const s = createGitState()
    projects.value = s.projects
    currentProjectId.value = s.currentProjectId
    repos.value = s.repos
    repo.value = s.repo
    branch.value = s.branch
    ahead.value = s.ahead
    behind.value = s.behind
    branches.value = s.branches
    remotes.value = s.remotes
    tags.value = s.tags
    stashes.value = s.stashes
    staged.value = s.staged
    unstaged.value = s.unstaged
    commits.value = s.commits
    isMerging.value = s.isMerging
    isRebasing.value = s.isRebasing
    hasConflict.value = s.hasConflict
    isDetached.value = s.isDetached
    detachedAt.value = s.detachedAt
    commitMessage.value = ''
    historyHasMore.value = false
    notARepo.value = false

    if (!available.value) return
    await loadProjects()
    await discoverRepos()
    await loadAll()
    await subscribe()
  }

  // ─── Project / repo selection ──────────────────────────────────────────────

  const setProject = async (id: string) => {
    currentProjectId.value = id
    if (!available.value) return
    selectedRepoLabel.value = null
    await discoverRepos()
    await loadAll()
  }

  const setRepo = async (label: string) => {
    selectedRepoLabel.value = label
    repo.value = label
    if (!available.value) return
    await loadAll()
  }

  // Make the store ready for a second consumer (the global PR summary host) that
  // opens outside the Git page/modal — without disturbing GitManager's own
  // subscribe lifecycle. Cold store → load projects + subscribe once; then scope
  // to the hinted project (matched by id or name, like GitManager). Idempotent: a
  // no-op when already scoped there with data loaded.
  const ensureScoped = async (projectHint: string | null): Promise<void> => {
    if (!available.value) return
    const cold = projects.value.length === 0
    if (cold) {
      await loadProjects()
      if (!unlisten) await subscribe()
    }
    let targetId = currentProjectId.value
    if (projectHint) {
      const match =
        projects.value.find((p) => p.id === projectHint) ??
        projects.value.find((p) => p.name === projectHint)
      if (match) targetId = match.id
    }
    if (!targetId && projects.value[0]) targetId = projects.value[0].id
    if (targetId && (targetId !== currentProjectId.value || cold || branches.value.length === 0)) {
      await setProject(targetId)
    }
  }

  // ─── Staging (working tree) ─────────────────────────────────────────────────

  const moveMock = (path: string, from: GitFile[], to: GitFile[]): void => {
    const idx = from.findIndex((x) => x.f === path)
    const item = from[idx]
    if (item) {
      to.push(item)
      from.splice(idx, 1)
    }
  }

  const stageFile = async (path: string) => {
    if (!available.value) {
      moveMock(path, unstaged.value, staged.value)
      return
    }
    try {
      await useGitApi().stageFile(workspaceRoot(), [path])
      await loadStatus()
    } catch (err) {
      reportError('stageFile', err)
    }
  }

  const unstageFile = async (path: string) => {
    if (!available.value) {
      moveMock(path, staged.value, unstaged.value)
      return
    }
    try {
      await useGitApi().unstageFile(workspaceRoot(), [path])
      await loadStatus()
    } catch (err) {
      reportError('unstageFile', err)
    }
  }

  const discardFile = async (path: string) => {
    if (!available.value) {
      staged.value = staged.value.filter((x) => x.f !== path)
      unstaged.value = unstaged.value.filter((x) => x.f !== path)
      return
    }
    try {
      await useGitApi().discardFile(workspaceRoot(), [path])
      await loadStatus()
    } catch (err) {
      reportError('discardFile', err)
    }
  }

  const stageAll = async () => {
    if (!available.value) {
      staged.value = [...staged.value, ...unstaged.value]
      unstaged.value = []
      return
    }
    const paths = unstaged.value.map((f) => f.f)
    if (paths.length === 0) return
    try {
      await useGitApi().stageFile(workspaceRoot(), paths)
      await loadStatus()
    } catch (err) {
      reportError('stageAll', err)
    }
  }

  const unstageAll = async () => {
    if (!available.value) {
      unstaged.value = [...unstaged.value, ...staged.value]
      staged.value = []
      return
    }
    const paths = staged.value.map((f) => f.f)
    if (paths.length === 0) return
    try {
      await useGitApi().unstageFile(workspaceRoot(), paths)
      await loadStatus()
    } catch (err) {
      reportError('unstageAll', err)
    }
  }

  // Bulk stage/unstage/discard a subset of paths (e.g. every file under a folder
  // in the changes tree) — one API call + one status reload instead of N.
  const stagePaths = async (paths: string[]) => {
    if (paths.length === 0) return
    if (!available.value) {
      for (const p of paths) moveMock(p, unstaged.value, staged.value)
      return
    }
    try {
      await useGitApi().stageFile(workspaceRoot(), paths)
      await loadStatus()
    } catch (err) {
      reportError('stagePaths', err)
    }
  }

  const unstagePaths = async (paths: string[]) => {
    if (paths.length === 0) return
    if (!available.value) {
      for (const p of paths) moveMock(p, staged.value, unstaged.value)
      return
    }
    try {
      await useGitApi().unstageFile(workspaceRoot(), paths)
      await loadStatus()
    } catch (err) {
      reportError('unstagePaths', err)
    }
  }

  const discardPaths = async (paths: string[]) => {
    if (paths.length === 0) return
    if (!available.value) {
      const drop = new Set(paths)
      staged.value = staged.value.filter((x) => !drop.has(x.f))
      unstaged.value = unstaged.value.filter((x) => !drop.has(x.f))
      return
    }
    try {
      await useGitApi().discardFile(workspaceRoot(), paths)
      await loadStatus()
    } catch (err) {
      reportError('discardPaths', err)
    }
  }

  // ─── Commit ─────────────────────────────────────────────────────────────────

  const commit = async (msg: string) => {
    // Block re-entry — the button is disabled while in flight, but Cmd+Enter on
    // the textarea can still fire a second commit before the first resolves.
    if (isCommitting.value) return
    if (!available.value) {
      const hash = `mock${Date.now().toString(16).slice(-7)}`
      commits.value = [
        {
          h: hash.slice(0, 7),
          sha: hash,
          m: msg.split('\n')[0] ?? msg,
          a: 'Local Developer',
          email: 'dev@awog.local',
          w: 'now',
          files: staged.value.map((f) => ({ ...f })),
        },
        ...commits.value,
      ]
      staged.value = []
      commitMessage.value = ''
      ahead.value += 1
      return
    }
    isCommitting.value = true
    try {
      await useGitApi().commit(workspaceRoot(), { message: msg })
      commitMessage.value = ''
      await Promise.all([loadStatus(), loadHistory()])
    } catch (err) {
      reportError('commit', err)
    } finally {
      isCommitting.value = false
    }
  }

  const amend = async (msg: string) => {
    if (isCommitting.value) return
    if (!available.value) {
      const head = commits.value[0]
      if (head) head.m = msg.split('\n')[0] ?? msg
      commitMessage.value = ''
      return
    }
    isCommitting.value = true
    try {
      await useGitApi().commit(workspaceRoot(), { message: msg, amend: true })
      commitMessage.value = ''
      await Promise.all([loadStatus(), loadHistory()])
    } catch (err) {
      reportError('amend', err)
    } finally {
      isCommitting.value = false
    }
  }

  const generateCommitMessage = async () => {
    if (isGeneratingCommit.value) return
    if (!available.value) {
      commitMessage.value = `feat(git): update ${staged.value.length} staged file(s)`
      return
    }
    isGeneratingCommit.value = true
    try {
      // Feed the user-configured commit-message rule (settings.git.commitMessageRule)
      // as the model's system prompt. The sidecar rejects an empty rule (Params
      // requires min(1)), so fall back to the store default when somehow blank.
      const rule = useSettingsStore().git.commitMessageRule || DEFAULT_COMMIT_MESSAGE_RULE
      const result = await useGitApi().generateCommitMessage(workspaceRoot(), { rule })
      commitMessage.value = result.message
    } catch (err) {
      reportError('generateCommitMessage', err)
    } finally {
      isGeneratingCommit.value = false
    }
  }

  // ─── Remote sync ──────────────────────────────────────────────────────────

  const fetchRemote = async () => {
    if (!available.value) return
    // Guard re-entry: a sync op already in flight. Header buttons disable on
    // syncOp, but the remote-detail pane can also trigger these — block here so
    // no caller can race two network git ops at once.
    if (syncOp.value) return
    syncOp.value = { op: 'fetch', phase: 'connecting', pct: null }
    try {
      const res = await useGitApi().fetch(workspaceRoot(), { ghAccount: effectiveGhAccount() })
      await Promise.all([loadStatus(), loadBranches()])
      lastNotice.value = res.updated.length
        ? { key: 'git.notice.fetched', params: { n: res.updated.length } }
        : { key: 'git.notice.fetchUpToDate' }
    } catch (err) {
      reportSyncError('fetch', err)
    } finally {
      syncOp.value = null
    }
  }

  const pull = async (strategy: 'ff-only' | 'merge' | 'rebase' = 'ff-only') => {
    if (!available.value) {
      behind.value = 0
      return
    }
    if (syncOp.value) return
    syncOp.value = { op: 'pull', phase: 'connecting', pct: null }
    try {
      const res = await useGitApi().pull(workspaceRoot(), {
        strategy,
        ghAccount: effectiveGhAccount(),
      })
      await Promise.all([loadStatus(), loadBranches()])
      lastNotice.value = res.commitsApplied
        ? { key: 'git.notice.pulled', params: { n: res.commitsApplied } }
        : { key: 'git.notice.pullUpToDate' }
    } catch (err) {
      reportSyncError('pull', err)
    } finally {
      syncOp.value = null
    }
  }

  // Options come from the Push dialog (target remote/branch, force, push tags,
  // set-upstream). No-arg push (e.g. remote-pane "Push") falls back to the
  // tracked upstream — same as bare `git push`.
  const push = async (params: PushParams = {}) => {
    if (!available.value) {
      ahead.value = 0
      return
    }
    if (syncOp.value) return
    syncOp.value = { op: 'push', phase: 'connecting', pct: null }
    try {
      const res = await useGitApi().push(workspaceRoot(), {
        ghAccount: effectiveGhAccount(),
        ...params,
      })
      await Promise.all([loadStatus(), loadBranches()])
      lastNotice.value = res.pushed
        ? { key: 'git.notice.pushed', params: { n: res.pushed } }
        : { key: 'git.notice.pushUpToDate' }
    } catch (err) {
      reportSyncError('push', err)
    } finally {
      syncOp.value = null
    }
  }

  const cancel = async (op: 'fetch' | 'pull' | 'push') => {
    if (!available.value) return
    try {
      await useGitApi().cancel(workspaceRoot(), op)
    } catch (err) {
      console.warn('[git] cancel failed', err)
    }
  }

  // ─── Branches ─────────────────────────────────────────────────────────────

  // Returns a result instead of swallowing: the caller decides how to surface a
  // failure (e.g. DIRTY_TREE → offer "stash & switch"). `force` maps to
  // `git checkout --force` (discards local changes).
  const checkoutBranch = async (
    name: string,
    opts: { force?: boolean } = {},
  ): Promise<GitOpResult> => {
    if (!available.value) {
      branch.value = name
      branches.value = branches.value.map((b) => ({ ...b, current: !b.remote && b.name === name }))
      return { ok: true }
    }
    try {
      await useGitApi().branchCheckout(workspaceRoot(), {
        name,
        ...(opts.force ? { force: true } : {}),
      })
      await loadAll()
      return { ok: true }
    } catch (err) {
      console.warn('[git] checkoutBranch failed', err)
      return {
        ok: false,
        code: gitCodeOf(err),
        message: err instanceof Error ? err.message : String(err),
      }
    }
  }

  const createBranch = async (name: string, from?: string) => {
    if (!available.value) {
      branches.value = [...branches.value, { name }]
      return
    }
    try {
      const params: { name: string; from?: string } = { name }
      if (from !== undefined) params.from = from
      await useGitApi().branchCreate(workspaceRoot(), params)
      await loadBranches()
    } catch (err) {
      reportError('createBranch', err)
    }
  }

  // Returns a result (instead of swallowing) so the caller can react to an
  // UNMERGED refusal by offering a force delete. `force` → `git branch -D`;
  // `deleteRemote` → also `git push <remote> --delete <name>` (remote failure
  // doesn't roll back the local delete — surfaced via `remoteError`).
  const deleteBranch = async (
    name: string,
    opts: { force?: boolean; deleteRemote?: boolean; remote?: string } = {},
  ): Promise<DeleteBranchResult> => {
    if (!available.value) {
      branches.value = branches.value.filter((b) => b.name !== name)
      return { ok: true, remoteDeleted: opts.deleteRemote === true }
    }
    try {
      const res = await useGitApi().branchDelete(workspaceRoot(), {
        name,
        ...(opts.force ? { force: true } : {}),
        ...(opts.deleteRemote ? { deleteRemote: true } : {}),
        ...(opts.remote ? { remote: opts.remote } : {}),
      })
      await loadBranches()
      return { ok: true, remoteDeleted: res.remoteDeleted, remoteError: res.remoteError }
    } catch (err) {
      console.warn('[git] deleteBranch failed', err)
      return {
        ok: false,
        code: gitCodeOf(err),
        message: err instanceof Error ? err.message : String(err),
      }
    }
  }

  const renameBranch = async (oldName: string, next: string) => {
    if (!available.value) {
      branches.value = branches.value.map((b) =>
        !b.remote && b.name === oldName ? { ...b, name: next } : b,
      )
      return
    }
    try {
      await useGitApi().branchCreate(workspaceRoot(), { name: next, from: oldName })
      await useGitApi().branchDelete(workspaceRoot(), { name: oldName })
      await loadBranches()
    } catch (err) {
      reportError('renameBranch', err)
    }
  }

  // ─── Merge / rebase ─────────────────────────────────────────────────────────

  const merge = async (name: string) => {
    if (!available.value) {
      const hash = `mock${Date.now().toString(16).slice(-7)}`
      commits.value = [
        {
          h: hash.slice(0, 7),
          sha: hash,
          merge: true,
          m: `Merge branch '${name}' into ${branch.value}`,
          a: 'Local Developer',
          w: 'now',
          files: [],
        },
        ...commits.value,
      ]
      return
    }
    try {
      await useGitApi().merge(workspaceRoot(), name)
      await loadAll()
    } catch (err) {
      reportError('merge', err)
    }
  }

  const rebase = async (name: string) => {
    if (!available.value) {
      isRebasing.value = true
      return
    }
    try {
      await useGitApi().rebase(workspaceRoot(), name)
      await loadStatus()
    } catch (err) {
      reportError('rebase', err)
    }
  }

  const completeMerge = async () => {
    if (!available.value) {
      isMerging.value = false
      isRebasing.value = false
      hasConflict.value = false
      return
    }
    try {
      // Rebase and merge share one header entry point; branch on `isRebasing`
      // so a rebase advances via `rebaseContinue` (which may stop at the next
      // conflicting commit) while a merge finalises via `completeMerge`.
      if (isRebasing.value) await useGitApi().rebaseContinue(workspaceRoot())
      else await useGitApi().completeMerge(workspaceRoot())
      // loadAll re-derives hasConflict; a rebase that hit the next commit's
      // conflict will re-open the resolver for the new batch.
      await loadAll()
    } catch (err) {
      reportError(isRebasing.value ? 'rebaseContinue' : 'completeMerge', err)
    }
  }

  const abortMerge = async () => {
    if (!available.value) {
      isMerging.value = false
      isRebasing.value = false
      hasConflict.value = false
      return
    }
    try {
      if (isRebasing.value) await useGitApi().rebaseAbort(workspaceRoot())
      else await useGitApi().mergeAbort(workspaceRoot())
      await loadAll()
    } catch (err) {
      reportError('abortMerge', err)
    }
  }

  // ─── Conflict resolution ────────────────────────────────────────────────────
  // These three actions intentionally break the "swallow into reportError" pattern
  // used by other git actions: loadConflictFile throws raw so the resolver can
  // branch on `gitCode` (ENCODING_UNSUPPORTED / ENOENT), and resolveConflict/
  // resolveConflictBinary re-throw after reporting so the component keeps the
  // resolver open on a desync/MERGE_CONFLICT instead of silently closing (CR-10,
  // CR-13).

  const loadConflictFile = (path: string): Promise<ReadConflictFileResult> =>
    useGitApi().readConflictFile(workspaceRoot(), path)

  const resolveConflict = async (
    path: string,
    resolutions: Array<{ blockIndex: number; choice: 'ours' | 'theirs' }>,
  ): Promise<void> => {
    if (!available.value) return
    try {
      await useGitApi().resolveFile(workspaceRoot(), { path, resolutions })
      await loadStatus()
    } catch (err) {
      reportError('resolveFile', err)
      throw err
    }
  }

  const resolveConflictBinary = async (path: string, choice: 'ours' | 'theirs'): Promise<void> => {
    if (!available.value) return
    try {
      await useGitApi().resolveFileBinary(workspaceRoot(), { path, choice })
      await loadStatus()
    } catch (err) {
      reportError('resolveFileBinary', err)
      throw err
    }
  }

  // ─── Stashes ──────────────────────────────────────────────────────────────

  // Returns whether the stash succeeded so callers (e.g. "stash & switch") can
  // avoid acting on a tree that's still dirty. The sidecar rejects an empty
  // message, so default to git's own `WIP on <branch>` label when none is given.
  // `includeUntracked` (`git stash -u`) is needed when the blocker is untracked
  // files — plain stash leaves them and reports "No local changes to save".
  const stashSave = async (
    msg?: string,
    opts: { includeUntracked?: boolean } = {},
  ): Promise<boolean> => {
    const message = msg?.trim() || `WIP on ${branch.value || 'HEAD'}`
    if (!available.value) {
      stashes.value = [
        { index: 0, ref: 'stash@{0}', m: message, branch: branch.value, w: 'now' },
        ...stashes.value.map((s) => ({ ...s, index: s.index + 1, ref: `stash@{${s.index + 1}}` })),
      ]
      staged.value = []
      unstaged.value = []
      return true
    }
    try {
      await useGitApi().stashSave(workspaceRoot(), {
        message,
        ...(opts.includeUntracked ? { includeUntracked: true } : {}),
      })
      await Promise.all([loadStatus(), loadStashes()])
      return true
    } catch (err) {
      reportError('stashSave', err)
      return false
    }
  }

  const stashApply = async (i: number) => {
    if (!available.value) return
    try {
      await useGitApi().stashApply(workspaceRoot(), i)
      await Promise.all([loadStatus(), loadStashes()])
    } catch (err) {
      reportError('stashApply', err)
    }
  }

  const stashPop = async (i: number) => {
    if (!available.value) {
      stashes.value = stashes.value.filter((s) => s.index !== i)
      return
    }
    try {
      await useGitApi().stashPop(workspaceRoot(), i)
      await Promise.all([loadStatus(), loadStashes()])
    } catch (err) {
      reportError('stashPop', err)
    }
  }

  const stashDrop = async (i: number) => {
    if (!available.value) {
      stashes.value = stashes.value.filter((s) => s.index !== i)
      return
    }
    try {
      await useGitApi().stashDrop(workspaceRoot(), i)
      await Promise.all([loadStatus(), loadStashes()])
    } catch (err) {
      reportError('stashDrop', err)
    }
  }

  // ─── Tags ─────────────────────────────────────────────────────────────────

  const tagCreate = async (name: string, sha?: string) => {
    if (!available.value) {
      tags.value = [name, ...tags.value]
      return
    }
    try {
      const params: { name: string; sha?: string } = { name }
      if (sha !== undefined) params.sha = sha
      await useGitApi().tagCreate(workspaceRoot(), params)
      await Promise.all([loadHistory(), loadTags()])
    } catch (err) {
      reportError('tagCreate', err)
    }
  }

  const deleteTag = async (name: string) => {
    if (!available.value) {
      tags.value = tags.value.filter((t) => t !== name)
      return
    }
    const root = workspaceRoot()
    if (!root) return
    try {
      await useGitApi().tagDelete(root, name)
      await loadTags()
    } catch (err) {
      reportError('deleteTag', err)
    }
  }

  // Checkout a tag → detached HEAD at the tag's commit. Reuses checkoutCommit
  // with the sha resolved from loadTags().
  const checkoutTag = async (name: string) => {
    const sha = tagShaByName.value[name]
    if (!available.value || !sha) return
    const root = workspaceRoot()
    if (!root) return
    try {
      await useGitApi().checkoutCommit(root, sha)
      await loadAll()
    } catch (err) {
      reportError('checkoutTag', err)
    }
  }

  // ─── Commit ops (history context menu) ───────────────────────────────────────

  // Checkout a specific commit → detached HEAD. Reuses the tag-checkout RPC.
  const checkoutCommit = async (sha: string) => {
    if (!available.value) return
    const root = workspaceRoot()
    if (!root) return
    try {
      await useGitApi().checkoutCommit(root, sha)
      await loadAll()
    } catch (err) {
      reportError('checkoutCommit', err)
    }
  }

  // Replay a commit onto the current branch. Conflicts surface via loadStatus
  // (isMerging/hasConflict drive the existing banner).
  const cherryPick = async (sha: string) => {
    if (!available.value) return
    const root = workspaceRoot()
    if (!root) return
    try {
      await useGitApi().cherryPick(root, sha)
      await loadAll()
    } catch (err) {
      reportError('cherryPick', err)
    }
  }

  // Create an inverse commit that undoes the given commit.
  const revertCommit = async (sha: string) => {
    if (!available.value) return
    const root = workspaceRoot()
    if (!root) return
    try {
      await useGitApi().revertCommit(root, sha)
      await loadAll()
    } catch (err) {
      reportError('revertCommit', err)
    }
  }

  // Move the current branch to <sha>. 'hard' discards the working tree.
  const resetTo = async (sha: string, mode: 'soft' | 'mixed' | 'hard') => {
    if (!available.value) return
    const root = workspaceRoot()
    if (!root) return
    try {
      await useGitApi().resetTo(root, sha, mode)
      await loadAll()
    } catch (err) {
      reportError('resetTo', err)
    }
  }

  // ─── Ignore / patch ──────────────────────────────────────────────────────────

  const ignore = async (patterns: string[]) => {
    if (!available.value) return
    const root = workspaceRoot()
    if (!root) return
    try {
      await useGitApi().ignore(root, patterns)
      await loadStatus()
    } catch (err) {
      reportError('ignore', err)
    }
  }

  // Export the working-tree diff to a .patch file. Best-effort reveal of the
  // written file afterwards (own try/catch so a reveal failure doesn't surface).
  const savePatch = async (path?: string) => {
    if (!available.value) return
    const root = workspaceRoot()
    if (!root) return
    try {
      const r = await useGitApi().savePatch(root, path)
      try {
        await useSidecar().revealPath(root, r.path)
      } catch (err) {
        console.warn('[git] savePatch reveal failed', err)
      }
    } catch (err) {
      reportError('savePatch', err)
    }
  }

  // ─── Diff loaders ─────────────────────────────────────────────────────────

  // `staged` selects the index-vs-HEAD diff (Staged section) vs the working-tree
  // diff (Changes section). A partially-staged file lives in BOTH sections, so
  // the caller must say which side it's showing — inferring from list membership
  // is ambiguous once a file is in both.
  const loadDiff = async (path: string, staged = false): Promise<DiffLine[]> => {
    if (!available.value) return DEMO_DIFF
    const root = workspaceRoot()
    if (!root) return []
    try {
      const api = useGitApi()
      const isUntracked = !staged && unstaged.value.some((f) => f.f === path && f.st === '?')
      let result: SidecarGitDiff
      if (isUntracked) result = await api.diff({ kind: 'untracked', workspaceRoot: root, path })
      else if (staged) result = await api.diff({ kind: 'staged', workspaceRoot: root, path })
      else result = await api.diff({ kind: 'workingTree', workspaceRoot: root, path })
      return adaptDiff(result)
    } catch (err) {
      console.warn('[git] loadDiff failed', err)
      return []
    }
  }

  // Image preview for a working-tree file: git renders binary diffs as
  // "Binary files differ" (no hunks), so an image row shows nothing in the diff
  // viewer. Instead read the on-disk copy as a base64 data URL and let the viewer
  // render an <img>. Returns null when unavailable (no root / over cap / deleted /
  // read error) → the viewer falls back to an "unavailable" placeholder.
  const loadImageDataUrl = async (path: string): Promise<string | null> => {
    if (!available.value) return null
    const root = workspaceRoot()
    if (!root) return null
    try {
      const res = await useFsApi().readFileBase64(root, path)
      if (res.truncated || !res.base64) return null
      return `data:${res.mimeType};base64,${res.base64}`
    } catch (err) {
      console.warn('[git] loadImageDataUrl failed', err)
      return null
    }
  }

  // Per-commit detail: the changed files plus each file's own diff lines (keyed
  // by path) so the CHANGES tab can show a 2-pane file-list ↔ selected-file diff.
  const loadCommitDiff = async (
    sha: string,
  ): Promise<{ files: GitFile[]; diffByPath: Record<string, DiffLine[]> }> => {
    if (!available.value) {
      const known = commits.value.find((c) => c.sha === sha || c.h === sha.slice(0, 7))
      const files = known?.files ?? []
      const diffByPath: Record<string, DiffLine[]> = {}
      files.forEach((f, i) => {
        diffByPath[f.f] = i % 2 === 0 ? DEMO_DIFF : DEMO_DIFF2
      })
      return { files, diffByPath }
    }
    const root = workspaceRoot()
    if (!root) return { files: [], diffByPath: {} }
    try {
      const result = await useGitApi().diff({ kind: 'commit', workspaceRoot: root, sha })
      const files: GitFile[] = result.files.map((fd) => ({
        f: fd.path,
        st: fd.isRename ? 'R' : 'M',
      }))
      const diffByPath: Record<string, DiffLine[]> = {}
      for (const fd of result.files) diffByPath[fd.path] = adaptFileDiff(fd)
      return { files, diffByPath }
    } catch (err) {
      console.warn('[git] loadCommitDiff failed', err)
      return { files: [], diffByPath: {} }
    }
  }

  // ─── Hunk staging ───────────────────────────────────────────────────────────

  const stageHunk = async (path: string, hunkIndex: number) => {
    if (!available.value) return // mock can't stage a single hunk
    const root = workspaceRoot()
    if (!root) return
    try {
      await useGitApi().stageHunk(root, path, hunkIndex)
      await loadStatus()
    } catch (err) {
      reportError('stageHunk', err)
    }
  }

  const unstageHunk = async (path: string, hunkIndex: number) => {
    if (!available.value) return // mock can't unstage a single hunk
    const root = workspaceRoot()
    if (!root) return
    try {
      await useGitApi().unstageHunk(root, path, hunkIndex)
      await loadStatus()
    } catch (err) {
      reportError('unstageHunk', err)
    }
  }

  // ─── OS integration (open / reveal / VS Code) ────────────────────────────────

  const openFile = async (path: string) => {
    if (!available.value) return
    const root = workspaceRoot()
    if (!root) return
    try {
      await useSidecar().openPath(root, path)
    } catch (err) {
      console.warn('[git] openFile failed', err)
    }
  }

  const revealFile = async (path: string) => {
    if (!available.value) return
    const root = workspaceRoot()
    if (!root) return
    try {
      await useSidecar().revealPath(root, path)
    } catch (err) {
      console.warn('[git] revealFile failed', err)
    }
  }

  const openInVscode = async (path: string) => {
    if (!available.value) return
    const root = workspaceRoot()
    if (!root) return
    try {
      await useSidecar().openInVscode(root, path)
    } catch (err) {
      console.warn('[git] openInVscode failed', err)
    }
  }

  const vscodeAvailable = (): Promise<boolean> => useSidecar().isVscodeAvailable()

  // ─── Open PR / compare for a branch ───────────────────────────────────────────
  // Resolve the create-PR (or compare) URL from the `origin` remote (falling back
  // to the first remote) and hand it to the OS browser. SSH + HTTPS remote URLs
  // both supported via parseRemoteUrl. No-op when there's no remote / parse fails.
  const openPrFor = async (branchName: string) => {
    const remote = remotes.value.find((r) => r.name === 'origin') ?? remotes.value[0]
    if (!remote) {
      console.warn('[git] openPrFor: no remote')
      return
    }
    const parsed = parseRemoteUrl(remote.pushUrl || remote.fetchUrl)
    if (!parsed) {
      console.warn('[git] openPrFor: cannot parse remote url')
      return
    }
    const { host, owner, repo } = parsed
    const branchEnc = encodeURIComponent(branchName)
    let url: string
    if (host.includes('github')) {
      url = `https://${host}/${owner}/${repo}/compare/${branchEnc}?expand=1`
    } else if (host.includes('gitlab')) {
      url = `https://${host}/${owner}/${repo}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${branchEnc}`
    } else {
      url = `https://${host}/${owner}/${repo}`
    }
    try {
      await useSidecar().openExternal(url)
    } catch (err) {
      // In mock mode openExternal throws SidecarUnavailableError → swallow.
      console.warn('[git] openPrFor failed', err)
    }
  }

  // ─── PR-summary commit-rule files ────────────────────────────────────────────
  // Directories a project may keep its commit convention in, most-preferred first.
  // The PR summary modal lists the `.md` files here so the user can pick which rule
  // governs the generated PR title (per-project, not just the global app setting).
  const PR_RULE_DIRS = ['.awog/rules', '.claude/rules'] as const

  // Workspace-relative paths of candidate rule files (git-commit.md floated first
  // within each dir). Empty when unavailable / none exist. Missing dirs are skipped.
  const listPrRuleFiles = async (): Promise<string[]> => {
    if (!available.value) return []
    const root = workspaceRoot()
    if (!root) return []
    const fs = useFsApi()
    const perDir = await Promise.all(
      PR_RULE_DIRS.map(async (dir) => {
        try {
          const { entries } = await fs.listDir(root, dir)
          return entries
            .filter((e) => e.kind === 'file' && e.name.toLowerCase().endsWith('.md'))
            .map((e) => e.path)
            .sort((a, b) => {
              const rank = (p: string) => (/(^|\/)git-commit\.md$/i.test(p) ? 0 : 1)
              return rank(a) - rank(b) || a.localeCompare(b)
            })
        } catch {
          // Directory absent in this project — skip it.
          return []
        }
      }),
    )
    return perDir.flat()
  }

  // The commit rule to bind the PR title to. A picked rule FILE wins; else the
  // global app setting (empty rulePath = the modal's "Default" choice). Capped to
  // the sidecar's title-rule limit.
  const TITLE_RULE_MAX = 16_000
  const resolvePrTitleRule = async (rulePath?: string): Promise<string> => {
    if (rulePath) {
      try {
        const res = await useFsApi().readFile(workspaceRoot(), rulePath, TITLE_RULE_MAX)
        const content = res.content.trim()
        if (content) return content.slice(0, TITLE_RULE_MAX)
      } catch (err) {
        // Fall back to the app setting rather than failing the whole generation.
        console.warn('[git] readFile PR rule failed', err)
      }
    }
    return useSettingsStore().git.commitMessageRule || DEFAULT_COMMIT_MESSAGE_RULE
  }

  // ─── Generate PR summary (title + markdown description) ──────────────────────
  // One-shot LLM summary of `head` against `base`: commits + diff + touched
  // requirement/plan docs → { title, description }. `opts.rulePath` picks the
  // commit-rule file that governs the title. Throws on failure so the modal can
  // surface the error (unlike the swallow-into-lastError mutations).
  const generatePrSummary = async (
    head: string,
    base: string,
    opts: { rulePath?: string } = {},
  ): Promise<PrSummaryResult> => {
    if (!available.value) {
      // Browser-dev mock: a plausible summary so the modal is exercisable offline.
      return {
        title: `feat: merge ${head} into ${base}`,
        description: [
          '## Summary',
          `Changes from \`${head}\` proposed for \`${base}\`.`,
          '',
          '## Changes',
          '- (mock) sidecar unavailable — no diff analysed',
          '',
          '## Test plan',
          '- [ ] Run the app and verify the branch behaves as expected',
        ].join('\n'),
        model: 'mock',
        truncated: false,
      }
    }
    const titleRule = await resolvePrTitleRule(opts.rulePath)
    return useGitApi().generatePrSummary(workspaceRoot(), { head, base, titleRule })
  }

  // ─── Identity (user.name / user.email) ──────────────────────────────────────
  // Commit identity at the global (~/.gitconfig) and repo-local scopes. Read on
  // demand by the Git Identity modal (not part of loadAll). Mock mode returns a
  // seeded global identity and pretends saves succeed (no real git in browser-dev).

  const loadIdentity = async (): Promise<GitIdentity | null> => {
    if (!available.value) {
      return {
        global: { name: 'Local Developer', email: 'dev@awog.local' },
        local: { name: null, email: null },
      }
    }
    const root = workspaceRoot()
    if (!root) return null
    try {
      return await useGitApi().getIdentity(root)
    } catch (err) {
      console.warn('[git] loadIdentity failed', err)
      return null
    }
  }

  const saveIdentity = async (params: SetIdentityParams): Promise<boolean> => {
    if (!available.value) return true // mock: pretend success
    const root = workspaceRoot()
    if (!root) return false
    try {
      await useGitApi().setIdentity(root, params)
      return true
    } catch (err) {
      console.warn('[git] saveIdentity failed', err)
      return false
    }
  }

  // ─── Init repo (NO_REPO empty state) ────────────────────────────────────────
  // `git init` the selected workspace, then re-discover + reload so the regular
  // Git UI replaces the empty state. Subscription is already live (store.init),
  // so no re-subscribe needed.
  const gitInit = async (): Promise<boolean> => {
    if (!available.value) {
      notARepo.value = false
      return true
    }
    const root = workspaceRoot()
    if (!root) return false
    try {
      await useGitApi().init(root)
      notARepo.value = false
      await discoverRepos()
      await loadAll()
      return true
    } catch (err) {
      reportError('init', err)
      return false
    }
  }

  // ─── Remotes ──────────────────────────────────────────────────────────────
  // Add a new remote (`git remote add`). A fresh `git init` repo has none, so this
  // is the path to wiring up origin before the first push.
  const addRemote = async (name: string, url: string): Promise<boolean> => {
    if (!available.value) {
      if (!remotes.value.some((r) => r.name === name)) {
        remotes.value = [...remotes.value, { name, fetchUrl: url, pushUrl: url }]
      }
      return true
    }
    try {
      await useGitApi().remoteAdd(workspaceRoot(), { name, url })
      await loadRemotes()
      return true
    } catch (err) {
      reportError('remoteAdd', err)
      return false
    }
  }

  // Edit a remote's fetch and/or push URL (`git remote set-url`). Errors surface
  // via lastError → toast like other mutations.
  const setRemoteUrl = async (
    name: string,
    urls: { fetchUrl?: string; pushUrl?: string },
  ): Promise<boolean> => {
    if (!available.value) {
      remotes.value = remotes.value.map((r) =>
        r.name === name
          ? {
              ...r,
              ...(urls.fetchUrl !== undefined ? { fetchUrl: urls.fetchUrl } : {}),
              ...(urls.pushUrl !== undefined ? { pushUrl: urls.pushUrl } : {}),
            }
          : r,
      )
      return true
    }
    try {
      await useGitApi().remoteSetUrl(workspaceRoot(), { name, ...urls })
      await loadRemotes()
      return true
    } catch (err) {
      reportError('remoteSetUrl', err)
      return false
    }
  }

  // Remove a remote (`git remote remove`). Local branches/commits are untouched —
  // only the remote's tracking config is dropped. Errors surface via lastError.
  const removeRemote = async (name: string): Promise<boolean> => {
    if (!available.value) {
      remotes.value = remotes.value.filter((r) => r.name !== name)
      return true
    }
    try {
      await useGitApi().remoteRemove(workspaceRoot(), { name })
      await loadRemotes()
      return true
    } catch (err) {
      reportError('remoteRemove', err)
      return false
    }
  }

  return {
    // state
    projects,
    currentProjectId,
    repos,
    repo,
    branch,
    ahead,
    behind,
    branches,
    remotes,
    tags,
    stashes,
    staged,
    unstaged,
    conflicted,
    commits,
    isMerging,
    isRebasing,
    hasConflict,
    isDetached,
    detachedAt,
    commitMessage,
    isCommitting,
    isGeneratingCommit,
    historyHasMore,
    notARepo,
    available,
    lastError,
    lastNotice,
    syncOp,
    pendingAuthError,
    // actions
    clearAuthError,
    init,
    gitInit,
    addRemote,
    setRemoteUrl,
    removeRemote,
    loadProjects,
    discoverRepos,
    loadStatus,
    loadHistory,
    loadMoreHistory,
    loadBranches,
    loadStashes,
    loadRemotes,
    loadTags,
    loadAll,
    subscribe,
    unsubscribe,
    setProject,
    setRepo,
    ensureScoped,
    stageFile,
    unstageFile,
    discardFile,
    stageAll,
    unstageAll,
    stagePaths,
    unstagePaths,
    discardPaths,
    commit,
    amend,
    generateCommitMessage,
    fetchRemote,
    pull,
    push,
    activeGhAccount,
    cancel,
    checkoutBranch,
    createBranch,
    deleteBranch,
    renameBranch,
    merge,
    rebase,
    completeMerge,
    abortMerge,
    loadConflictFile,
    resolveConflict,
    resolveConflictBinary,
    stashSave,
    stashApply,
    stashPop,
    stashDrop,
    tagCreate,
    deleteTag,
    checkoutTag,
    checkoutCommit,
    cherryPick,
    revertCommit,
    resetTo,
    ignore,
    savePatch,
    loadDiff,
    loadImageDataUrl,
    loadCommitDiff,
    stageHunk,
    unstageHunk,
    openFile,
    revealFile,
    openInVscode,
    vscodeAvailable,
    openPrFor,
    generatePrSummary,
    listPrRuleFiles,
    loadIdentity,
    saveIdentity,
  }
})
