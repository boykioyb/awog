// Static mock data ported verbatim from awog-prototype.html (PROJ / PDATA / AGCOL,
// lines ~2205–2225). Visual port only — no Pinia/IPC. Shapes kept narrow to the
// fields the Projects page renders.

export type ProjectStatus = 'active' | 'idle'

export type ProjectRepo = {
  n: string
  br: string
  dirty?: number
  ahead?: number
  gh?: string
}

export type ProjectSession = { t: string; w: string }
export type ProjectTask = { t: string; s: string }
export type GhLabel = { n: string; c: string }
export type GhComment = { a: string; w: string; b: string; bVi?: string }

export type GhItem = {
  n: number
  repo?: string
  title: string
  titleVi?: string
  state: 'open' | 'closed' | 'merged'
  draft?: boolean
  base?: string
  head?: string
  labels?: GhLabel[]
  author: string
  up: string
  assignees?: string[]
  body: string
  bodyVi?: string
  comments: GhComment[]
}

export type Project = {
  name: string
  path: string
  status: ProjectStatus
  gh: string | null
  repos: ProjectRepo[]
  agents: string[]
  ses: ProjectSession[]
  tasks: ProjectTask[]
  issues: GhItem[]
  prs: GhItem[]
}

export const GHACCS = ['hoatq', 'team-bot'] as const

// Agent badge colors + 2-letter avatar (AGCOL ~2224). Exact hex from the prototype.
export const AGCOL: Record<string, [string, string]> = {
  'tech-lead': ['#a78bfa', 'TL'],
  developer: ['#6ee7b7', 'DV'],
  infosec: ['#fca5a5', 'IS'],
  'qa-tester': ['#fcd34d', 'QA'],
  'product-owner': ['#93c5fd', 'PO'],
  'code-reviewer': ['#f0abfc', 'CR'],
  'business-analyst': ['#7dd3fc', 'BA'],
  'project-manager': ['#fdba74', 'PM'],
}

export function agBadge(a: string): [string, string] {
  return AGCOL[a] ?? ['var(--textMuted)', a.slice(0, 2).toUpperCase()]
}

export const PDATA: Project[] = [
  {
    name: 'awog',
    path: '~/KyroTech/Projects/awog',
    status: 'active',
    gh: 'awog/awog',
    repos: [
      { n: 'awog', br: 'fix/session-mcp-pool', dirty: 7, ahead: 2, gh: 'awog/awog' },
      { n: 'sidecar', br: 'main', dirty: 0, gh: 'awog/sidecar' },
    ],
    agents: [
      'tech-lead',
      'developer',
      'infosec',
      'qa-tester',
      'product-owner',
      'code-reviewer',
      'business-analyst',
      'project-manager',
    ],
    ses: [
      { t: 'Migrate session store → MCP pool', w: '3m' },
      { t: 'Byte-minimal JSONL persist', w: '12m' },
    ],
    tasks: [
      { t: 'Lazy-load transcripts', s: 'running' },
      { t: 'Audit fs.* sanitize', s: 'running' },
    ],
    issues: [
      {
        n: 45,
        repo: 'awog',
        title: 'Server spawn mỗi turn gây chậm',
        state: 'open',
        labels: [
          { n: 'perf', c: '#a78bfa' },
          { n: 'mcp', c: '#60a5fa' },
        ],
        author: 'hoatq',
        up: '3h',
        assignees: ['developer'],
        body: 'Mỗi tool call lại spawn một MCP server child mới → latency cao.\n\nĐề xuất: pool theo `(sessionId, serverId)` + idle-stop 5 phút.',
        comments: [
          { a: 'tech-lead', w: '2h', b: 'Đồng ý. Pool key nên gồm cả serverId để tránh nhầm.' },
          { a: 'developer', w: '1h', b: 'Đang làm ở nhánh `fix/session-mcp-pool`.' },
        ],
      },
      {
        n: 7,
        repo: 'sidecar',
        title: 'node-pty zombie khi đóng terminal tab',
        state: 'open',
        labels: [
          { n: 'bug', c: '#ef4444' },
          { n: 'terminal', c: '#60a5fa' },
        ],
        author: 'developer',
        up: '6h',
        assignees: ['developer'],
        body: 'PTY process không được kill khi tab terminal đóng → tiến trình zombie tích tụ.',
        comments: [],
      },
      {
        n: 42,
        repo: 'awog',
        title: 'JSONL persist O(n²) makes 1.2GB files',
        titleVi: 'JSONL persist O(n²) làm file phình 1.2GB',
        state: 'closed',
        labels: [{ n: 'bug', c: '#ef4444' }],
        author: 'boykioyb',
        up: '1d',
        assignees: [],
        body: 'Mid-stream re-persists the full `steps[]` on every delta. The file balloons to 1.2GB and the UI freezes.',
        bodyVi: 'Mid-stream ghi lại toàn bộ `steps[]` mỗi delta → file phình tới 1.2GB và UI đứng.',
        comments: [
          {
            a: 'hoatq',
            w: '1d',
            b: 'Fixed via incremental progress delta + stream loader.',
            bVi: 'Đã fix bằng progress delta tăng dần + loader stream.',
          },
        ],
      },
    ],
    prs: [
      {
        n: 128,
        repo: 'awog',
        title: 'Reuse MCP server child per session',
        titleVi: 'Tái dùng MCP server child mỗi session',
        state: 'open',
        draft: false,
        base: 'main',
        head: 'fix/session-mcp-pool',
        labels: [{ n: 'perf', c: '#a78bfa' }],
        author: 'developer',
        up: '1h',
        assignees: ['developer'],
        body: 'Implements the pool from #45. Keeps one child per `(session, server)`, idle-stop 5m.',
        bodyVi: 'Hiện thực pool từ #45. Giữ một child cho mỗi (session, server), idle-stop 5 phút.',
        comments: [
          {
            a: 'code-reviewer',
            w: '30m',
            b: 'LGTM, please add a test for idle-stop.',
            bVi: 'Ổn rồi, thêm test cho idle-stop nhé.',
          },
        ],
      },
      {
        n: 120,
        repo: 'sidecar',
        title: 'WIP: progressive MCP tool disclosure',
        state: 'open',
        draft: true,
        base: 'main',
        head: 'feat/tool-disclosure',
        labels: [],
        author: 'tech-lead',
        up: '5h',
        assignees: [],
        body: 'Draft — expose MCP tools progressively to reduce token cost.',
        bodyVi: 'Bản nháp — lộ dần MCP tool để giảm token.',
        comments: [],
      },
      {
        n: 64,
        repo: 'sidecar',
        title: 'Bump node-pty + keychain deps',
        state: 'merged',
        draft: false,
        base: 'main',
        head: 'chore/deps',
        labels: [],
        author: 'boykioyb',
        up: '2d',
        assignees: [],
        body: 'Routine dependency bump for node-pty and @napi-rs/keyring.',
        bodyVi: 'Cập nhật dependency node-pty và @napi-rs/keyring.',
        comments: [],
      },
      {
        n: 118,
        repo: 'awog',
        title: 'Lazy-load transcripts on open',
        state: 'merged',
        draft: false,
        base: 'main',
        head: 'feat/lazy-transcripts',
        labels: [{ n: 'session', c: '#10b981' }],
        author: 'developer',
        up: '1d',
        assignees: [],
        body: 'ADR 0048 — load transcript JSONL only when a session is opened.',
        bodyVi: 'ADR 0048 — chỉ nạp transcript JSONL khi mở session.',
        comments: [],
      },
    ],
  },
  {
    name: 'vbsec',
    path: '~/KyroTech/Projects/vbsec',
    status: 'idle',
    gh: 'tanviet12/vbsec',
    repos: [{ n: 'vbsec', br: 'audit/ssrf', dirty: 2, gh: 'tanviet12/vbsec' }],
    agents: ['infosec', 'code-reviewer', 'tech-lead'],
    ses: [{ t: 'Scan SSRF HttpMcpClient', w: '5h' }],
    tasks: [],
    issues: [
      {
        n: 12,
        repo: 'vbsec',
        title: 'SSRF redirect chưa re-check IP đích',
        state: 'open',
        labels: [{ n: 'security', c: '#ef4444' }],
        author: 'team-bot',
        up: '5h',
        assignees: ['infosec'],
        body: 'Redirect không kiểm tra lại private IP ở mỗi hop.',
        comments: [],
      },
    ],
    prs: [],
  },
  {
    name: 'spacelinks-web',
    path: '~/work/spacelinks-web',
    status: 'idle',
    gh: null,
    repos: [
      { n: 'web', br: 'main', dirty: 0 },
      { n: 'api', br: 'main', dirty: 1 },
      { n: 'infra', br: 'main', dirty: 0 },
    ],
    agents: ['developer', 'qa-tester', 'tech-lead', 'product-owner'],
    ses: [{ t: 'Landing hero responsive', w: '2d' }],
    tasks: [],
    issues: [],
    prs: [],
  },
]
