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
export type BranchInfo = {
  name: string
  current?: boolean
  remote?: boolean
  ahead?: number
  behind?: number
  upstream?: string | null
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

// Generic context-menu item — one row of GitContextMenu (file / branch / stash /
// tag / remote menus are all built as MenuItem lists).
export type MenuItem = {
  id?: string
  label?: string
  icon?: string
  danger?: boolean
  disabled?: boolean
  hint?: string
  separator?: boolean
  children?: MenuItem[]
}

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
  commits: Commit[]
}

export function createGitState(): GitState {
  return {
    projects: [
      { id: 'awog', name: 'AWOG', path: '/Users/hoatq/dev/awog', color: '#10b981', dirty: 7 },
      {
        id: 'sora',
        name: 'sora-hoa',
        path: '/Users/hoatq/dev/sora-hoa',
        color: '#3b82f6',
        dirty: 0,
      },
    ],
    currentProjectId: 'awog',
    repos: ['awog', 'sidecar'],
    repo: 'awog',
    section: { kind: 'local-changes' },
    collapsed: false,
    secOpen: { branches: true, remotes: true, tags: false, stashes: true, submodules: false },
    search: '',
    sideW: 240,
    bcol: {},
    branch: 'fix/session-mcp-pool',
    ahead: 2,
    behind: 0,
    branches: [
      { name: 'main', ahead: 0, behind: 0 },
      { name: 'develop', ahead: 0, behind: 1 },
      {
        name: 'fix/session-mcp-pool',
        current: true,
        ahead: 2,
        behind: 0,
        upstream: 'origin/fix/…',
      },
      { name: 'fix/session/byte-persist' },
      { name: 'feature/ui-renew' },
      { name: 'feature/git-redesign' },
      { name: 'origin/main', remote: true },
      { name: 'origin/develop', remote: true },
      { name: 'origin/fix/session-mcp-pool', remote: true },
    ],
    remotes: [
      {
        name: 'origin',
        fetchUrl: 'git@github.com:spacelinks/awog.git',
        pushUrl: 'git@github.com:spacelinks/awog.git',
      },
    ],
    tags: ['v0.18.0', 'v0.17.2', 'v0.17.1'],
    stashes: [
      {
        index: 0,
        ref: 'stash@{0}',
        m: 'WIP: composer resize handle',
        branch: 'feature/ui-renew',
        w: '1h',
      },
      {
        index: 1,
        ref: 'stash@{1}',
        m: 'debug logs trong runner',
        branch: 'fix/session-mcp-pool',
        w: '4h',
      },
    ],
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
    unstaged: [
      { f: 'apps/desktop/ui/components/session/SessionComposer.vue', st: 'M' },
      { f: 'apps/desktop/ui/components/session/SessionMessageItem.vue', st: 'M' },
      { f: 'apps/desktop/ui/stores/sessions.ts', st: 'M' },
      { f: 'apps/desktop/ui/i18n/en.json', st: 'M' },
      { f: 'apps/desktop/ui/i18n/vi.json', st: 'M' },
    ],
    staged: [
      { f: 'apps/desktop/sidecar/src/methods/sessions.enhance-prompt.ts', st: 'A' },
      { f: 'apps/desktop/sidecar/src/mcp/pool.ts', st: 'M' },
    ],
    commits: [
      {
        h: 'd1b488f',
        sha: 'd1b488f3e2a0c91b4d7f8a25e6c0b1d2f3a49e8c',
        lane: 0,
        refs: [
          { t: 'head', n: 'fix/session-mcp-pool' },
          { t: 'remote', n: 'origin/fix/…' },
        ],
        m: 'feat(runtime): progressive MCP tool disclosure',
        a: 'boykioyb',
        email: 'hoatq@spacelinks.vn',
        w: 'Hôm qua 21:26',
        body: 'Lộ dần MCP tool theo nhu cầu thay vì nạp toàn bộ vào context mỗi turn — giảm token cho session nhiều connection. Proxy meta-tool đặt tên mcpDescribe/mcpCall (tránh prefix mcp_ Anthropic reserve).',
        files: [
          { f: 'sidecar/src/runtime/tools/mcp-tools.ts', st: 'M' },
          { f: 'sidecar/src/runtime/trace.ts', st: 'M' },
        ],
      },
      {
        h: '92a01b0',
        sha: '92a01b07c4d9e1f2a3b5c6d7e8f90a1b2c3d4e5f',
        lane: 0,
        merge: true,
        refs: [],
        m: 'Merge branch feature/git-redesign',
        a: 'boykioyb',
        email: 'hoatq@spacelinks.vn',
        w: 'Hôm qua 21:10',
        body: 'Gộp redesign Git Manager (DAG graph + commit detail tabs).',
        files: [{ f: 'ui/components/git/GitHistoryGraph.vue', st: 'A' }],
      },
      {
        h: 'b7c12a0',
        sha: 'b7c12a09f8e7d6c5b4a39281706f5e4d3c2b1a09',
        lane: 1,
        refs: [],
        m: 'feat(git): DAG history graph',
        a: 'developer',
        email: 'dev@awog.local',
        w: 'Hôm qua 18:40',
        body: 'Vẽ lane + dot + edge cho lịch sử commit, mẫu Sublime Merge.',
        files: [{ f: 'ui/components/git/GitHistoryTable.vue', st: 'A' }],
      },
      {
        h: '58bb474',
        sha: '58bb474a1c2e3f405162738495a6b7c8d9e0f1a2',
        lane: 0,
        refs: [
          { t: 'branch', n: 'main' },
          { t: 'tag', n: 'v0.18.0' },
        ],
        m: 'fix(session): stream JSONL loader + index',
        a: 'boykioyb',
        email: 'hoatq@spacelinks.vn',
        w: 'CN 22:56',
        body: 'Loader stream từng dòng + index offset → mở session lớn không đứng UI.',
        files: [{ f: 'sidecar/src/sessions/persist.ts', st: 'M' }],
      },
      {
        h: '9d8b6de',
        sha: '9d8b6de0a9b8c7d6e5f4031211f0e9d8c7b6a504',
        lane: 0,
        refs: [{ t: 'tag', n: 'v0.17.2' }],
        m: 'fix(mcp): reuse one server child per session',
        a: 'boykioyb',
        email: 'hoatq@spacelinks.vn',
        w: 'T6 15:02',
        body: 'Một child cho mỗi (session, server) + idle-stop 5 phút.',
        files: [
          { f: 'sidecar/src/mcp/pool.ts', st: 'A' },
          { f: 'sidecar/src/sessions/runner.ts', st: 'M' },
        ],
      },
    ],
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

export function statusColor(st: string): string {
  return st === 'A' ? 'var(--add)' : st === 'D' ? 'var(--del)' : 'var(--mod)'
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

const HLKW = new Set(
  (
    'const let var function return import export from await async if else for while do new class ' +
    'extends implements interface type enum of in try catch finally throw typeof instanceof this ' +
    'super null undefined true false void as public private readonly default'
  ).split(' '),
)

// Token for syntax highlighting; cls maps to the prototype's t-c/t-s/t-n/t-k/t-t spans.
export type CodeToken = { text: string; cls: '' | 't-c' | 't-s' | 't-n' | 't-k' | 't-t' }

// hl: tiny syntax tokenizer — comment / string / number / keyword / type.
// Returns tokens so templates render <span> per token (no v-html); Vue escapes text.
export function tokenizeCode(src: string): CodeToken[] {
  const re = /(\/\/[^\n]*)|(`[^`]*`|'[^']*'|"[^"]*")|(\b\d[\w.]*\b)|([A-Za-z_$][\w$]*)/g
  const tokens: CodeToken[] = []
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(src))) {
    if (match.index > last) tokens.push({ text: src.slice(last, match.index), cls: '' })
    const [, c, s, n, id] = match
    if (c) tokens.push({ text: c, cls: 't-c' })
    else if (s) tokens.push({ text: s, cls: 't-s' })
    else if (n) tokens.push({ text: n, cls: 't-n' })
    else if (id) {
      if (HLKW.has(id)) tokens.push({ text: id, cls: 't-k' })
      else if (/^[A-Z]/.test(id)) tokens.push({ text: id, cls: 't-t' })
      else tokens.push({ text: id, cls: '' })
    }
    last = re.lastIndex
  }
  if (last < src.length) tokens.push({ text: src.slice(last), cls: '' })
  return tokens
}
