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
import { useGitApi } from '~/composables/useGitApi'
import type {
  SidecarGitBranch,
  SidecarGitCommit,
  SidecarGitDiff,
  SidecarGitFileChangeType,
  SidecarGitFileStatus,
  SidecarGitRemote,
  SidecarGitStashEntry,
} from '~/composables/useGitApi'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'
import { DEFAULT_COMMIT_MESSAGE_RULE, useSettingsStore } from '~/stores/settings'
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
// lib: < 1h → "Nm", < 24h → "Nh", < 7d → "Nd", else locale date string. Invalid
// input passes through unchanged.
function formatWhen(iso: string): string {
  const then = new Date(iso)
  const ms = then.getTime()
  if (Number.isNaN(ms)) return iso
  const diff = Date.now() - ms
  if (diff < 0) return then.toLocaleString()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return then.toLocaleString()
}

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
  const commits = ref<Commit[]>(seed.commits)
  const isMerging = ref<boolean>(seed.isMerging)
  const isRebasing = ref<boolean>(seed.isRebasing)
  const hasConflict = ref<boolean>(seed.hasConflict)
  const isDetached = ref<boolean>(seed.isDetached)
  const detachedAt = ref<string | null>(seed.detachedAt)
  const commitMessage = ref<string>('')
  const historyHasMore = ref<boolean>(false)

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
      for (const f of status.files) {
        if (f.stageState === 'staged') nextStaged.push(adaptFile(f))
        else nextUnstaged.push(adaptFile(f))
      }
      staged.value = nextStaged
      unstaged.value = nextUnstaged
      isMerging.value = status.isMerging
      isRebasing.value = status.isRebasing
      isDetached.value = status.detached
      detachedAt.value = status.detachedAt ?? null
      hasConflict.value =
        status.conflictedCount > 0 || status.files.some((f) => f.stageState === 'conflicted')
      ahead.value = status.ahead
      behind.value = status.behind
    } catch (err) {
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
    await Promise.all([loadStatus(), loadHistory(), loadBranches(), loadStashes(), loadRemotes()])
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
    if (!available.value || !root) return
    try {
      await useGitApi().fetch(root)
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
      console.warn('[git] stageFile failed', err)
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
      console.warn('[git] unstageFile failed', err)
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
      console.warn('[git] discardFile failed', err)
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
      console.warn('[git] stageAll failed', err)
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
      console.warn('[git] unstageAll failed', err)
    }
  }

  // ─── Commit ─────────────────────────────────────────────────────────────────

  const commit = async (msg: string) => {
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
    try {
      await useGitApi().commit(workspaceRoot(), { message: msg })
      commitMessage.value = ''
      await Promise.all([loadStatus(), loadHistory()])
    } catch (err) {
      console.warn('[git] commit failed', err)
    }
  }

  const amend = async (msg: string) => {
    if (!available.value) {
      const head = commits.value[0]
      if (head) head.m = msg.split('\n')[0] ?? msg
      commitMessage.value = ''
      return
    }
    try {
      await useGitApi().commit(workspaceRoot(), { message: msg, amend: true })
      commitMessage.value = ''
      await Promise.all([loadStatus(), loadHistory()])
    } catch (err) {
      console.warn('[git] amend failed', err)
    }
  }

  const generateCommitMessage = async () => {
    if (!available.value) {
      commitMessage.value = `feat(git): update ${staged.value.length} staged file(s)`
      return
    }
    try {
      // Feed the user-configured commit-message rule (settings.git.commitMessageRule)
      // as the model's system prompt. The sidecar rejects an empty rule (Params
      // requires min(1)), so fall back to the store default when somehow blank.
      const rule = useSettingsStore().git.commitMessageRule || DEFAULT_COMMIT_MESSAGE_RULE
      const result = await useGitApi().generateCommitMessage(workspaceRoot(), { rule })
      commitMessage.value = result.message
    } catch (err) {
      console.warn('[git] generateCommitMessage failed', err)
    }
  }

  // ─── Remote sync ──────────────────────────────────────────────────────────

  const fetchRemote = async () => {
    if (!available.value) return
    try {
      await useGitApi().fetch(workspaceRoot())
      await Promise.all([loadStatus(), loadBranches()])
    } catch (err) {
      console.warn('[git] fetch failed', err)
    }
  }

  const pull = async (strategy: 'ff-only' | 'merge' | 'rebase' = 'ff-only') => {
    if (!available.value) {
      behind.value = 0
      return
    }
    try {
      await useGitApi().pull(workspaceRoot(), { strategy })
      await Promise.all([loadStatus(), loadBranches()])
    } catch (err) {
      console.warn('[git] pull failed', err)
    }
  }

  const push = async () => {
    if (!available.value) {
      ahead.value = 0
      return
    }
    try {
      await useGitApi().push(workspaceRoot())
      await Promise.all([loadStatus(), loadBranches()])
    } catch (err) {
      console.warn('[git] push failed', err)
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

  const checkoutBranch = async (name: string) => {
    if (!available.value) {
      branch.value = name
      branches.value = branches.value.map((b) => ({ ...b, current: !b.remote && b.name === name }))
      return
    }
    try {
      await useGitApi().branchCheckout(workspaceRoot(), { name })
      await loadAll()
    } catch (err) {
      console.warn('[git] checkoutBranch failed', err)
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
      console.warn('[git] createBranch failed', err)
    }
  }

  const deleteBranch = async (name: string) => {
    if (!available.value) {
      branches.value = branches.value.filter((b) => b.name !== name)
      return
    }
    try {
      await useGitApi().branchDelete(workspaceRoot(), { name })
      await loadBranches()
    } catch (err) {
      console.warn('[git] deleteBranch failed', err)
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
      console.warn('[git] renameBranch failed', err)
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
      console.warn('[git] merge failed', err)
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
      console.warn('[git] rebase failed', err)
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
      await useGitApi().completeMerge(workspaceRoot())
      await loadAll()
    } catch (err) {
      console.warn('[git] completeMerge failed', err)
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
      console.warn('[git] abortMerge failed', err)
    }
  }

  // ─── Stashes ──────────────────────────────────────────────────────────────

  const stashSave = async (msg?: string) => {
    if (!available.value) {
      stashes.value = [
        {
          index: 0,
          ref: 'stash@{0}',
          m: msg ?? `WIP on ${branch.value}`,
          branch: branch.value,
          w: 'now',
        },
        ...stashes.value.map((s) => ({ ...s, index: s.index + 1, ref: `stash@{${s.index + 1}}` })),
      ]
      staged.value = []
      unstaged.value = []
      return
    }
    try {
      await useGitApi().stashSave(workspaceRoot(), { message: msg ?? '' })
      await Promise.all([loadStatus(), loadStashes()])
    } catch (err) {
      console.warn('[git] stashSave failed', err)
    }
  }

  const stashApply = async (i: number) => {
    if (!available.value) return
    try {
      await useGitApi().stashApply(workspaceRoot(), i)
      await Promise.all([loadStatus(), loadStashes()])
    } catch (err) {
      console.warn('[git] stashApply failed', err)
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
      console.warn('[git] stashPop failed', err)
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
      console.warn('[git] stashDrop failed', err)
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
      console.warn('[git] tagCreate failed', err)
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
      console.warn('[git] deleteTag failed', err)
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
      console.warn('[git] checkoutTag failed', err)
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
      console.warn('[git] checkoutCommit failed', err)
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
      console.warn('[git] cherryPick failed', err)
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
      console.warn('[git] revertCommit failed', err)
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
      console.warn('[git] resetTo failed', err)
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
      console.warn('[git] ignore failed', err)
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
      console.warn('[git] savePatch failed', err)
    }
  }

  // ─── Diff loaders ─────────────────────────────────────────────────────────

  const loadDiff = async (path: string): Promise<DiffLine[]> => {
    if (!available.value) return DEMO_DIFF
    const root = workspaceRoot()
    if (!root) return []
    try {
      const api = useGitApi()
      const isUntracked = unstaged.value.some((f) => f.f === path && f.st === '?')
      const isStaged = staged.value.some((f) => f.f === path)
      let result: SidecarGitDiff
      if (isUntracked) result = await api.diff({ kind: 'untracked', workspaceRoot: root, path })
      else if (isStaged) result = await api.diff({ kind: 'staged', workspaceRoot: root, path })
      else result = await api.diff({ kind: 'workingTree', workspaceRoot: root, path })
      return adaptDiff(result)
    } catch (err) {
      console.warn('[git] loadDiff failed', err)
      return []
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
      console.warn('[git] stageHunk failed', err)
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
    commits,
    isMerging,
    isRebasing,
    hasConflict,
    isDetached,
    detachedAt,
    commitMessage,
    historyHasMore,
    available,
    // actions
    init,
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
    stageFile,
    unstageFile,
    discardFile,
    stageAll,
    unstageAll,
    commit,
    amend,
    generateCommitMessage,
    fetchRemote,
    pull,
    push,
    cancel,
    checkoutBranch,
    createBranch,
    deleteBranch,
    renameBranch,
    merge,
    rebase,
    completeMerge,
    abortMerge,
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
    loadCommitDiff,
    stageHunk,
    openFile,
    revealFile,
    openInVscode,
    vscodeAvailable,
    openPrFor,
  }
})
