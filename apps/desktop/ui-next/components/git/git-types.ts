// Git page — shared types, mock data, and pure helpers. Layout mirrors the
// production Git Manager (apps/desktop/ui): full-section sidebar + page header
// (project/repo/branch picker + ops) + selection-driven main pane. Styling uses
// ui-next prototype.css classes. All static mock; no IPC. Used by pages/git.vue
// + components/git/*.

export type DiffMode = 'unified' | 'split'
export type CommitTab = 'commit' | 'changes' | 'tree'

export type DiffLine = { t: '@' | ' ' | '+' | '-'; n?: number; s: string }

// A rendered diff line: status class, gutter number, highlighted tokens, optional hunk index.
export type DiffRow = { cls: string; n: number | string; tokens: CodeToken[]; hunk?: number }

export type GitFile = { f: string; st: string }

// A selected working-tree row + which section it was clicked in. A partially
// staged file appears in BOTH the Staged and Changes sections, so the `staged`
// side disambiguates which diff to load and which actions apply.
export type GitSelection = { path: string; staged: boolean }

// Modifier state carried on a working-tree row click. `meta` (⌘ on macOS / Ctrl
// elsewhere) turns a click into a multi-select toggle; a plain click single-
// selects. Selection is a pure highlight for bulk ops — it never stages.
export type SelMods = { meta: boolean }

// Right-pane selection for the Git page. A normal file row renders a diff, a
// conflicted file row renders the conflict resolver. Discriminated union so the
// pane branches cleanly without carrying stray fields.
export type GitRightPaneSel =
  | { kind: 'file'; path: string; staged: boolean }
  | { kind: 'conflict'; path: string }
  | null

export type CommitRef = { t: 'head' | 'remote' | 'branch' | 'tag'; n: string }

export type Commit = {
  h: string
  sha?: string
  lane?: number
  merge?: boolean
  refs?: CommitRef[]
  m: string
  a: string
  email?: string
  w: string
  body?: string
  files: GitFile[]
}

// ── Sidebar selection (mirrors production git-section.ts) ──
// Drives which view the main pane renders + which sidebar row is highlighted.
export type GitSection =
  | { kind: 'local-changes' }
  | { kind: 'all-commits' }
  | { kind: 'branch'; name: string }
  | { kind: 'remote'; name: string }
  | { kind: 'tag'; name: string }
  | { kind: 'stash'; index: number }
  | { kind: 'submodule'; name: string }

export function sectionKey(s: GitSection): string {
  switch (s.kind) {
    case 'local-changes':
    case 'all-commits':
      return s.kind
    case 'branch':
    case 'remote':
    case 'tag':
    case 'submodule':
      return `${s.kind}:${s.name}`
    case 'stash':
      return `stash:${s.index}`
    default:
      return 'unknown'
  }
}

// A branch row (local or remote-tracking). `ahead/behind` drive the sidebar hint.
// `lastCommitAt` (committer date, ISO-strict) drives the recency sort — the most
// recently active branches float to the top of the Branches section.
export type BranchInfo = {
  name: string
  current?: boolean
  remote?: boolean
  ahead?: number
  behind?: number
  upstream?: string | null
  lastCommitAt?: string
}

export type RemoteInfo = { name: string; fetchUrl: string; pushUrl: string }

export type ProjectInfo = { id: string; name: string; path: string; color?: string; dirty?: number }

// Stash entry — richer than the prototype's {m,w} so the detail pane can render
// ref / branch / message / date like production.
export type Stash = { index: number; ref: string; m: string; branch: string; w: string }

// Which collapsible sidebar sections are open.
export type SectionOpen = {
  branches: boolean
  remotes: boolean
  tags: boolean
  stashes: boolean
  submodules: boolean
}

// Generic context-menu item — one row of ContextMenu (file / branch / stash /
// tag / remote menus are all built as MenuItem lists). Re-exported from the
// shared composable so git call sites keep importing it from here unchanged.
export type { MenuItem } from '~/composables/useContextMenu'

export const DEMO_DIFF: DiffLine[] = [
  { t: '@', s: '@@ -210,4 +210,5 @@ const send = () => {' },
  { t: ' ', n: 210, s: '  const text = draft.value.trim()' },
  { t: ' ', n: 211, s: '  if (!text) return' },
  { t: '-', n: 212, s: '  emit("send", text)' },
  { t: '+', n: 212, s: '  const enhanced = await enhancePrompt(text)' },
  { t: '+', n: 213, s: '  emit("send", enhanced)' },
  { t: ' ', n: 214, s: '}' },
]

export const DEMO_DIFF2: DiffLine[] = [
  { t: '@', s: '@@ -50,3 +50,4 @@ export class McpManager {' },
  { t: ' ', n: 50, s: '  private pool = new Map()' },
  { t: '-', n: 51, s: '  spawn(id) { return new Server(id) }' },
  { t: '+', n: 51, s: '  acquire(sessionId, serverId) {' },
  { t: '+', n: 52, s: '    return this.pool.get(key) ?? this.spawn(serverId)' },
  { t: '+', n: 53, s: '  }' },
]

export type GitState = {
  // Project + repo context (header pickers).
  projects: ProjectInfo[]
  currentProjectId: string
  repos: string[]
  repo: string
  // Sidebar.
  section: GitSection
  collapsed: boolean
  secOpen: SectionOpen
  search: string
  sideW: number
  bcol: Record<string, boolean>
  // Branch / sync state.
  branch: string
  ahead: number
  behind: number
  branches: BranchInfo[]
  remotes: RemoteInfo[]
  tags: string[]
  stashes: Stash[]
  isMerging: boolean
  isRebasing: boolean
  hasConflict: boolean
  isDetached: boolean
  detachedAt: string | null
  // Working tree + history.
  sel: string | null
  msg: string
  chTree: boolean
  diffMode: DiffMode
  ctab: CommitTab
  commitSel: string | null
  unstaged: GitFile[]
  staged: GitFile[]
  conflicted: GitFile[]
  commits: Commit[]
}

export function createGitState(): GitState {
  return {
    // Data fields start empty — the store fills them from the sidecar (git.* IPC).
    // No mock seed: an unwired/offline state shows real empty/NO_REPO UI, never
    // fabricated branches/commits/stashes.
    projects: [],
    currentProjectId: '',
    repos: [],
    repo: '',
    section: { kind: 'local-changes' },
    collapsed: false,
    secOpen: { branches: true, remotes: true, tags: false, stashes: true, submodules: false },
    search: '',
    sideW: 240,
    bcol: {},
    branch: '',
    ahead: 0,
    behind: 0,
    branches: [],
    remotes: [],
    tags: [],
    stashes: [],
    isMerging: false,
    isRebasing: false,
    hasConflict: false,
    isDetached: false,
    detachedAt: null,
    sel: null,
    msg: '',
    chTree: true,
    diffMode: 'unified',
    ctab: 'commit',
    commitSel: null,
    unstaged: [],
    staged: [],
    conflicted: [],
    commits: [],
  }
}

// ── pure helpers (ported: gshort, gcol, avatarOf, hl) ──

// gshort: split a path into [dir, name] for the two-line file display.
export function shortPath(p: string): [string, string] {
  const a = p.split('/')
  const name = a.pop() ?? ''
  const dir = a.length > 2 ? '…/' + a[a.length - 1] + '/' : a.length ? a.join('/') + '/' : ''
  return [dir, name]
}

export function baseNameOf(p: string): string {
  return shortPath(p)[1]
}

// Image extensions whose git diff is binary ("Binary files differ", no hunks) →
// the diff viewer renders an inline <img> preview instead of empty diff text.
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif'])

export function isImagePath(p: string): boolean {
  const dot = p.lastIndexOf('.')
  if (dot < 0) return false
  return IMAGE_EXTS.has(p.slice(dot + 1).toLowerCase())
}

export function statusColor(st: string): string {
  return st === 'A' ? 'var(--add)' : st === 'D' ? 'var(--del)' : 'var(--mod)'
}

// Visual for one working-tree status char: a scannable icon + theme color + i18n
// label key. Replaces the raw porcelain letter ("?", "M", "A"…) — a colored glyph
// reads faster and "?" no longer looks like an error. `key` maps to
// `git.fileStatus.<key>` for the tooltip so color is never the only channel.
export type StatusVisual = { icon: string; color: string; key: string }

export function statusVisual(st: string): StatusVisual {
  switch (st) {
    case 'A':
      return { icon: 'plus', color: 'var(--add)', key: 'added' }
    case '?':
      return { icon: 'plus', color: 'var(--add)', key: 'untracked' }
    case 'C':
      return { icon: 'copy', color: 'var(--add)', key: 'copied' }
    case 'D':
      return { icon: 'trash', color: 'var(--del)', key: 'deleted' }
    case 'R':
      return { icon: 'move', color: 'var(--mod)', key: 'renamed' }
    case 'T':
      return { icon: 'edit', color: 'var(--mod)', key: 'typeChanged' }
    case 'U':
      return { icon: 'alert', color: 'var(--danger)', key: 'conflicted' }
    case 'I':
      return { icon: 'file', color: 'var(--textDim)', key: 'ignored' }
    case 'M':
    default:
      return { icon: 'edit', color: 'var(--mod)', key: 'modified' }
  }
}

export function avatarOf(a: string): string {
  const parts = String(a)
    .split(/[ \-_.]/)
    .filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const second = parts[1] ? parts[1][0] : (parts[0]?.[1] ?? '')
  return (first + second).toUpperCase()
}

// ── File-path tree (Sublime-Merge style) ──
// Build a nested folder tree from a flat file list, collapsing single-child dir
// chains (apps/desktop/ui → one row) and flattening into depth-tagged rows.
// Mirrors production utils/file-path-tree.ts (specialised to GitFile.f).
export type PathTreeRow =
  | { kind: 'dir'; id: string; path: string; label: string; depth: number }
  | { kind: 'file'; id: string; path: string; label: string; depth: number; item: GitFile }

type RawNode = { name: string; fullPath: string; files: GitFile[]; children: Map<string, RawNode> }

const leafName = (p: string): string => p.split('/').at(-1) ?? p

export function buildPathTreeRows(
  items: readonly GitFile[],
  collapsed: ReadonlySet<string>,
): PathTreeRow[] {
  const root: RawNode = { name: '', fullPath: '', files: [], children: new Map() }
  for (const item of items) {
    const segs = item.f.split('/')
    let cur = root
    for (let i = 0; i < segs.length - 1; i += 1) {
      const seg = segs[i]!
      let next = cur.children.get(seg)
      if (!next) {
        const prefix = cur.fullPath ? `${cur.fullPath}/${seg}` : seg
        next = { name: seg, fullPath: prefix, files: [], children: new Map() }
        cur.children.set(seg, next)
      }
      cur = next
    }
    cur.files.push(item)
  }

  const rows: PathTreeRow[] = []
  const walk = (node: RawNode, depth: number): void => {
    const subDirs = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name))
    const files = [...node.files].sort((a, b) => leafName(a.f).localeCompare(leafName(b.f)))
    for (const dir of subDirs) {
      // Collapse single-child dir chains, but cap each row's label at MAX_SEGS
      // segments — `apps/desktop/sidecar/src` becomes `apps/desktop` then a
      // nested `sidecar/src` row instead of one long path.
      const MAX_SEGS = 2
      let cur = dir
      let label = cur.name
      let dirPath = cur.fullPath
      let segs = 1
      while (segs < MAX_SEGS && cur.children.size === 1 && cur.files.length === 0) {
        const [only] = [...cur.children.values()]
        if (!only) break
        cur = only
        label = `${label}/${cur.name}`
        dirPath = cur.fullPath
        segs += 1
      }
      rows.push({ kind: 'dir', id: `d:${dirPath}`, path: dirPath, label, depth })
      if (!collapsed.has(dirPath)) walk(cur, depth + 1)
    }
    for (const item of files) {
      rows.push({
        kind: 'file',
        id: `f:${item.f}`,
        path: item.f,
        label: leafName(item.f),
        depth,
        item,
      })
    }
  }
  walk(root, 0)
  return rows
}

// Token for a diff line cell. The diff viewers render lines as a single plain
// token (cls '') colored by line type — the `t-*` syntax classes exist for the
// shape but are no longer produced (per-token highlighting fought add/del color).
export type CodeToken = { text: string; cls: '' | 't-c' | 't-s' | 't-n' | 't-k' | 't-t' }
