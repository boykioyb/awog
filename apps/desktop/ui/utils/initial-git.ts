import type {
  GitBranch,
  GitCommit,
  GitFileDiff,
  GitFileStatus,
  GitMergeConflictBlock,
  GitRemote,
  GitStashEntry,
} from '~/types'

// Mock data cho Git Manager prototype — mỗi Project = 1 repo độc lập.
// File mock được phân bổ qua 2 project chính (prj1 loyalty, prj2 payment) +
// vài entry cho prj3 admin để demo filter dropdown.

export const INITIAL_BINARY_PATH = 'public/icons/logo.png'
export const INITIAL_CONFLICT_PATH = 'src/stores/workspace.ts'

export const INITIAL_STATUS_FILES: GitFileStatus[] = [
  // ─── prj1 loyalty-service ──────────────────────────────────────────────
  {
    projectId: 'prj1',
    path: 'src/auth/login.py',
    index: 'modified',
    workTree: 'clean',
    isBinary: false,
    isStaged: true,
    hasConflict: false,
  },
  {
    projectId: 'prj1',
    path: 'src/auth/oauth.py',
    index: 'added',
    workTree: 'clean',
    isBinary: false,
    isStaged: true,
    hasConflict: false,
  },
  {
    projectId: 'prj1',
    path: 'docs/features/loyalty-expiration.md',
    index: 'modified',
    workTree: 'clean',
    isBinary: false,
    isStaged: true,
    hasConflict: false,
  },
  {
    projectId: 'prj1',
    path: 'src/rewards/calculator.py',
    index: 'clean',
    workTree: 'modified',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
  {
    projectId: 'prj1',
    path: 'tests/test_rewards.py',
    index: 'clean',
    workTree: 'modified',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
  {
    projectId: 'prj1',
    path: 'README.md',
    index: 'clean',
    workTree: 'modified',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
  {
    projectId: 'prj1',
    path: 'src/notes — “bản nháp” 🌱.md',
    index: 'clean',
    workTree: 'modified',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
  {
    projectId: 'prj1',
    path: 'src/loyalty/membership.py',
    workTree: 'untracked',
    index: 'clean',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
  {
    projectId: 'prj1',
    path: 'src/loyalty/tier.py',
    workTree: 'untracked',
    index: 'clean',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
  {
    projectId: 'prj1',
    path: INITIAL_BINARY_PATH,
    workTree: 'modified',
    index: 'clean',
    isBinary: true,
    isStaged: false,
    hasConflict: false,
  },
  {
    projectId: 'prj1',
    path: 'src/legacy/old_handler.py',
    workTree: 'deleted',
    index: 'clean',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
  {
    projectId: 'prj1',
    path: INITIAL_CONFLICT_PATH,
    workTree: 'conflicted',
    index: 'conflicted',
    isBinary: false,
    isStaged: false,
    hasConflict: true,
  },
  // ─── prj2 payment-service ──────────────────────────────────────────────
  {
    projectId: 'prj2',
    path: 'internal/retry/race.go',
    index: 'modified',
    workTree: 'clean',
    isBinary: false,
    isStaged: true,
    hasConflict: false,
  },
  {
    projectId: 'prj2',
    path: 'internal/billing/invoice.go',
    index: 'clean',
    workTree: 'modified',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
  {
    projectId: 'prj2',
    path: 'cmd/payment/main.go',
    index: 'clean',
    workTree: 'modified',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
  {
    projectId: 'prj2',
    path: 'README.md',
    workTree: 'untracked',
    index: 'clean',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
  // ─── prj3 admin-dashboard ──────────────────────────────────────────────
  {
    projectId: 'prj3',
    path: 'src/components/UserTable.vue',
    index: 'modified',
    workTree: 'clean',
    isBinary: false,
    isStaged: true,
    hasConflict: false,
  },
  {
    projectId: 'prj3',
    path: 'src/composables/useFilter.ts',
    index: 'clean',
    workTree: 'modified',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
]

const AGENTS = ['Architect', 'Backend', 'Frontend', 'Reviewer', 'QA']
const SUBJECTS = [
  'wire VueFlow inspector pane',
  'rebuild status list virtual scroll',
  'introduce Pinia composition store for git',
  'fix toast leak on rapid commits',
  'add diff highlighting for theme tokens',
  'remove dead legacy components',
  'tighten typecheck — replace any with unknown',
  'split GitCommitPanel into commit/amend',
  'mock auto-commit per phase for demo',
  'document Git Manager spec',
  'normalize file path unicode handling',
  'add empty-state CTA for no-repo workspace',
  'guard against busy state during push',
  'introduce conflict resolver 2-way picker',
  'refresh README port status',
  'wire NavRail dirty badge dot',
  'theme: add gitAdded/gitModified/gitDeleted tokens',
  'commit message validation inline error',
  'progress bar streaming mock',
  'load-more pagination for history',
  'support stash apply vs pop semantics',
  'rename branch flow',
  'fast-forward only pull default',
  'discard file confirm modal copy',
  'detached HEAD warning banner',
]

const PAYMENT_SUBJECTS = [
  'fix(retry): cap exponential backoff at 30s',
  'feat(billing): support refund partial amount',
  'chore: bump go-redis to v9.4',
  'fix(invoice): correct VAT calculation for EU',
  'feat: add idempotency key middleware',
  'docs: payment flow sequence diagram',
  'test: race condition reproduction',
  'refactor(handler): extract validation layer',
  'perf: connection pool tuning',
  'fix: nil deref on missing customer',
]

const ADMIN_SUBJECTS = [
  'feat(users): bulk edit role',
  'fix(table): virtual scroll memory leak',
  'chore: tailwind v3 migration',
  'feat: dark mode toggle persistence',
  'docs: README quickstart',
]

const makeHash = (i: number, seed = 0) => {
  const s = (i + 1) * 9301 + 49297 + seed * 100003
  const out = ((s * s) % 9999999).toString(16).padStart(7, '0')
  return `${out}${out.slice(0, 33)}`.slice(0, 40)
}

const phasePrefix = (i: number) => {
  if (i % 5 !== 0) return ''
  const phaseNum = String(Math.floor(i / 5) + 1).padStart(3, '0')
  const phase = ['N_arch', 'N_back', 'N_front', 'N_qa', 'N_review'][i % 5]
  return `[${phase}-${phaseNum}] ${AGENTS[i % AGENTS.length]}: `
}

const buildCommits = (
  projectId: string,
  subjects: string[],
  seed: number,
  branchRefs: Record<number, string[]> = {},
): GitCommit[] =>
  subjects.map((subj, i) => {
    const hash = makeHash(i, seed)
    const prefix = projectId === 'prj1' ? phasePrefix(i) : ''
    const subject = prefix ? `${prefix}${subj}` : subj
    const phaseIdMatch = subject.match(/^\[([^\]]+)\]/)
    const created = Date.now() - i * 1000 * 60 * 47 - seed * 1000 * 60 * 60 * 24
    return {
      projectId,
      hash,
      shortHash: hash.slice(0, 7),
      authorName: i % 3 === 0 ? 'AWOG Engine' : 'Local Developer',
      authorEmail: i % 3 === 0 ? 'engine@awog.local' : 'dev@awog.local',
      date: new Date(created).toISOString(),
      subject,
      body: i % 7 === 0 ? 'Generated by mock data for demo purposes.' : undefined,
      parents: i + 1 < subjects.length ? [makeHash(i + 1, seed)] : [],
      refs: branchRefs[i] ?? [],
      phaseId: phaseIdMatch?.[1],
      agentId: phaseIdMatch ? (AGENTS[i % AGENTS.length] ?? 'unknown').toLowerCase() : undefined,
    }
  })

export const INITIAL_COMMITS: GitCommit[] = [
  ...buildCommits('prj1', SUBJECTS, 0, {
    0: ['feat/loyalty-expiration'],
    5: ['main', 'origin/main'],
  }),
  ...buildCommits('prj2', PAYMENT_SUBJECTS, 1, {
    0: ['fix/retry-race'],
    3: ['main', 'origin/main'],
  }),
  ...buildCommits('prj3', ADMIN_SUBJECTS, 2, {
    0: ['develop'],
    2: ['main', 'origin/main'],
  }),
]

const commitHashAt = (projectId: string, i: number): string => {
  const list = INITIAL_COMMITS.filter((c) => c.projectId === projectId)
  return list[i]?.hash ?? makeHash(i)
}

export const INITIAL_BRANCHES: GitBranch[] = [
  // ─── prj1 ───
  {
    projectId: 'prj1',
    name: 'feat/loyalty-expiration',
    isCurrent: true,
    isRemote: false,
    upstream: 'origin/feat/loyalty-expiration',
    ahead: 2,
    behind: 0,
    lastCommit: commitHashAt('prj1', 0),
  },
  {
    projectId: 'prj1',
    name: 'main',
    isCurrent: false,
    isRemote: false,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    lastCommit: commitHashAt('prj1', 5),
  },
  {
    projectId: 'prj1',
    name: 'feat/membership-tiers',
    isCurrent: false,
    isRemote: false,
    upstream: 'origin/feat/membership-tiers',
    ahead: 5,
    behind: 3,
    lastCommit: commitHashAt('prj1', 10),
  },
  {
    projectId: 'prj1',
    name: 'fix/expiration-tz',
    isCurrent: false,
    isRemote: false,
    ahead: 0,
    behind: 0,
    lastCommit: commitHashAt('prj1', 15),
  },
  {
    projectId: 'prj1',
    name: 'origin/main',
    isCurrent: false,
    isRemote: true,
    ahead: 0,
    behind: 0,
    lastCommit: commitHashAt('prj1', 5),
  },
  {
    projectId: 'prj1',
    name: 'origin/feat/loyalty-expiration',
    isCurrent: false,
    isRemote: true,
    ahead: 0,
    behind: 0,
    lastCommit: commitHashAt('prj1', 2),
  },
  // ─── prj2 ───
  {
    projectId: 'prj2',
    name: 'fix/retry-race',
    isCurrent: true,
    isRemote: false,
    upstream: 'origin/fix/retry-race',
    ahead: 1,
    behind: 0,
    lastCommit: commitHashAt('prj2', 0),
  },
  {
    projectId: 'prj2',
    name: 'main',
    isCurrent: false,
    isRemote: false,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    lastCommit: commitHashAt('prj2', 3),
  },
  {
    projectId: 'prj2',
    name: 'feat/refund-partial',
    isCurrent: false,
    isRemote: false,
    ahead: 4,
    behind: 1,
    lastCommit: commitHashAt('prj2', 1),
  },
  {
    projectId: 'prj2',
    name: 'origin/main',
    isCurrent: false,
    isRemote: true,
    ahead: 0,
    behind: 0,
    lastCommit: commitHashAt('prj2', 3),
  },
  // ─── prj3 ───
  {
    projectId: 'prj3',
    name: 'develop',
    isCurrent: true,
    isRemote: false,
    upstream: 'origin/develop',
    ahead: 1,
    behind: 0,
    lastCommit: commitHashAt('prj3', 0),
  },
  {
    projectId: 'prj3',
    name: 'main',
    isCurrent: false,
    isRemote: false,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    lastCommit: commitHashAt('prj3', 2),
  },
  // ─── prj4 — không có dirty file để demo "clean" state ───
  {
    projectId: 'prj4',
    name: 'main',
    isCurrent: true,
    isRemote: false,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    lastCommit: 'abc1234',
  },
]

export const INITIAL_STASHES: GitStashEntry[] = [
  {
    projectId: 'prj1',
    index: 0,
    ref: 'stash@{0}',
    message: 'WIP: refactor loyalty calculator',
    date: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    branch: 'feat/loyalty-expiration',
  },
  {
    projectId: 'prj1',
    index: 1,
    ref: 'stash@{1}',
    message: 'WIP: debug auth flow',
    date: new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString(),
    branch: 'fix/expiration-tz',
  },
  {
    projectId: 'prj2',
    index: 0,
    ref: 'stash@{0}',
    message: 'WIP: idempotency middleware',
    date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
    branch: 'fix/retry-race',
  },
]

export const INITIAL_REMOTES: GitRemote[] = [
  {
    projectId: 'prj1',
    name: 'origin',
    fetchUrl: 'git@github.com:acme/loyalty-service.git',
    pushUrl: 'git@github.com:acme/loyalty-service.git',
  },
  {
    projectId: 'prj2',
    name: 'origin',
    fetchUrl: 'git@github.com:acme/payment-service.git',
    pushUrl: 'git@github.com:acme/payment-service.git',
  },
  {
    projectId: 'prj3',
    name: 'origin',
    fetchUrl: 'git@github.com:acme/admin-dashboard.git',
    pushUrl: 'git@github.com:acme/admin-dashboard.git',
  },
  {
    projectId: 'prj4',
    name: 'origin',
    fetchUrl: 'git@github.com:acme/auth-service.git',
    pushUrl: 'git@github.com:acme/auth-service.git',
  },
]

const makeDiff = (p: string, hunks: GitFileDiff['hunks']): GitFileDiff => ({
  path: p,
  isBinary: false,
  hunks,
})

export const INITIAL_FILE_DIFFS: Record<string, GitFileDiff> = {
  'src/auth/login.py': makeDiff('src/auth/login.py', [
    {
      oldStart: 10,
      oldLines: 5,
      newStart: 10,
      newLines: 7,
      header: '@@ -10,5 +10,7 @@',
      lines: [
        { kind: 'context', text: 'def login(user, password):' },
        { kind: 'del', text: '    return check_legacy(user, password)' },
        { kind: 'add', text: '    if not user or not password:' },
        { kind: 'add', text: '        raise InvalidCredentialError()' },
        { kind: 'add', text: '    return verify(user, password)' },
        { kind: 'context', text: '' },
      ],
    },
  ]),
  'src/auth/oauth.py': makeDiff('src/auth/oauth.py', [
    {
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 8,
      header: '@@ -0,0 +1,8 @@',
      lines: [
        { kind: 'add', text: 'from typing import Optional' },
        { kind: 'add', text: '' },
        { kind: 'add', text: 'class OAuthProvider:' },
        { kind: 'add', text: '    def __init__(self, client_id: str):' },
        { kind: 'add', text: '        self.client_id = client_id' },
        { kind: 'add', text: '' },
        { kind: 'add', text: '    def authorize(self) -> Optional[str]:' },
        { kind: 'add', text: '        return None' },
      ],
    },
  ]),
  'docs/features/loyalty-expiration.md': makeDiff('docs/features/loyalty-expiration.md', [
    {
      oldStart: 12,
      oldLines: 5,
      newStart: 12,
      newLines: 7,
      header: '@@ -12,5 +12,7 @@',
      lines: [
        { kind: 'context', text: '## Acceptance Criteria' },
        { kind: 'context', text: '' },
        { kind: 'del', text: '- AC-01: expire reward sau 90 ngày' },
        { kind: 'add', text: '- AC-01: expire reward sau 90 ngày kể từ ngày issue' },
        { kind: 'add', text: '- AC-02: send notification 7 ngày trước khi expire' },
        { kind: 'context', text: '- AC-03: cron job chạy daily 02:00 UTC' },
        { kind: 'context', text: '' },
      ],
    },
  ]),
  'src/rewards/calculator.py': makeDiff('src/rewards/calculator.py', [
    {
      oldStart: 25,
      oldLines: 3,
      newStart: 25,
      newLines: 4,
      header: '@@ -25,3 +25,4 @@',
      lines: [
        { kind: 'context', text: 'def calculate_points(amount):' },
        { kind: 'add', text: '    if amount < 0: return 0' },
        { kind: 'context', text: '    return int(amount * 0.05)' },
        { kind: 'context', text: '' },
      ],
    },
  ]),
  'tests/test_rewards.py': makeDiff('tests/test_rewards.py', [
    {
      oldStart: 5,
      oldLines: 3,
      newStart: 5,
      newLines: 5,
      header: '@@ -5,3 +5,5 @@',
      lines: [
        { kind: 'context', text: 'def test_basic():' },
        { kind: 'context', text: '    assert calculate_points(100) == 5' },
        { kind: 'add', text: '' },
        { kind: 'add', text: 'def test_negative():' },
        { kind: 'add', text: '    assert calculate_points(-10) == 0' },
      ],
    },
  ]),
  'README.md': makeDiff('README.md', [
    {
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 4,
      header: '@@ -1,3 +1,4 @@',
      lines: [
        { kind: 'context', text: '# Loyalty Service' },
        { kind: 'context', text: '' },
        { kind: 'del', text: 'Customer loyalty backend' },
        { kind: 'add', text: 'Customer loyalty and rewards backend.' },
      ],
    },
  ]),
  'src/notes — “bản nháp” 🌱.md': makeDiff('src/notes — “bản nháp” 🌱.md', [
    {
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 4,
      header: '@@ -1,3 +1,4 @@',
      lines: [
        { kind: 'context', text: '# Ghi chú — bản nháp 🌱' },
        { kind: 'context', text: '' },
        { kind: 'del', text: '- Idea: tier loyalty' },
        { kind: 'add', text: '- ✅ Đã spec — review membership.py' },
        { kind: 'add', text: '- TODO: cron job notification' },
      ],
    },
  ]),
  'src/loyalty/membership.py': makeDiff('src/loyalty/membership.py', [
    {
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 5,
      header: '@@ -0,0 +1,5 @@',
      lines: [
        { kind: 'add', text: 'class Membership:' },
        { kind: 'add', text: '    def __init__(self, user_id: str):' },
        { kind: 'add', text: '        self.user_id = user_id' },
        { kind: 'add', text: '        self.tier = "bronze"' },
        { kind: 'add', text: '' },
      ],
    },
  ]),
  'src/loyalty/tier.py': makeDiff('src/loyalty/tier.py', [
    {
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 4,
      header: '@@ -0,0 +1,4 @@',
      lines: [
        { kind: 'add', text: 'TIERS = ["bronze", "silver", "gold", "platinum"]' },
        { kind: 'add', text: '' },
        { kind: 'add', text: 'def next_tier(current):' },
        { kind: 'add', text: '    return TIERS[min(TIERS.index(current) + 1, len(TIERS) - 1)]' },
      ],
    },
  ]),
  'src/legacy/old_handler.py': makeDiff('src/legacy/old_handler.py', [
    {
      oldStart: 1,
      oldLines: 5,
      newStart: 0,
      newLines: 0,
      header: '@@ -1,5 +0,0 @@',
      lines: [
        { kind: 'del', text: 'def handle_legacy(req):' },
        { kind: 'del', text: '    # Legacy code path' },
        { kind: 'del', text: '    return None' },
        { kind: 'del', text: '' },
        { kind: 'del', text: '# end' },
      ],
    },
  ]),
  [INITIAL_CONFLICT_PATH]: makeDiff(INITIAL_CONFLICT_PATH, [
    {
      oldStart: 32,
      oldLines: 8,
      newStart: 32,
      newLines: 12,
      header: '@@ -32,8 +32,12 @@',
      lines: [
        { kind: 'context', text: 'class WorkspaceStore:' },
        { kind: 'context', text: '    def __init__(self):' },
        { kind: 'add', text: '<<<<<<< HEAD' },
        { kind: 'add', text: '        self.projects = list(INITIAL_PROJECTS)' },
        { kind: 'add', text: '=======' },
        { kind: 'add', text: '        self.projects = INITIAL_PROJECTS.copy()' },
        { kind: 'add', text: '>>>>>>> origin/main' },
        { kind: 'context', text: '        self.agents = list(INITIAL_AGENTS)' },
        { kind: 'context', text: '' },
      ],
    },
  ]),
  // ─── prj2 diffs ───
  'internal/retry/race.go': makeDiff('internal/retry/race.go', [
    {
      oldStart: 40,
      oldLines: 5,
      newStart: 40,
      newLines: 7,
      header: '@@ -40,5 +40,7 @@',
      lines: [
        { kind: 'context', text: 'func (r *Retrier) Do(ctx context.Context) error {' },
        { kind: 'del', text: '    backoff := time.Second' },
        { kind: 'add', text: '    backoff := time.Second' },
        { kind: 'add', text: '    if backoff > 30*time.Second {' },
        { kind: 'add', text: '        backoff = 30 * time.Second' },
        { kind: 'add', text: '    }' },
        { kind: 'context', text: '    for {' },
      ],
    },
  ]),
  'internal/billing/invoice.go': makeDiff('internal/billing/invoice.go', [
    {
      oldStart: 88,
      oldLines: 3,
      newStart: 88,
      newLines: 4,
      header: '@@ -88,3 +88,4 @@',
      lines: [
        { kind: 'context', text: 'func calcVAT(amount Money, region string) Money {' },
        { kind: 'add', text: '    if region == "EU" { return amount.Mul(0.21) }' },
        { kind: 'context', text: '    return amount.Mul(0.0)' },
        { kind: 'context', text: '}' },
      ],
    },
  ]),
  'cmd/payment/main.go': makeDiff('cmd/payment/main.go', [
    {
      oldStart: 12,
      oldLines: 3,
      newStart: 12,
      newLines: 4,
      header: '@@ -12,3 +12,4 @@',
      lines: [
        { kind: 'context', text: 'func main() {' },
        { kind: 'add', text: '    log.SetFlags(log.LstdFlags | log.Lmicroseconds)' },
        { kind: 'context', text: '    srv := server.New()' },
        { kind: 'context', text: '    srv.Run()' },
      ],
    },
  ]),
  // ─── prj3 diffs ───
  'src/components/UserTable.vue': makeDiff('src/components/UserTable.vue', [
    {
      oldStart: 22,
      oldLines: 4,
      newStart: 22,
      newLines: 6,
      header: '@@ -22,4 +22,6 @@',
      lines: [
        { kind: 'context', text: '<template>' },
        { kind: 'add', text: '  <BulkActions :selected="selectedIds" @apply="applyRole" />' },
        { kind: 'add', text: '  <UserRow v-for="u in users" :key="u.id" :user="u" />' },
        { kind: 'del', text: '  <UserRow v-for="u in users" :key="u.id" :user="u" />' },
        { kind: 'context', text: '</template>' },
      ],
    },
  ]),
  'src/composables/useFilter.ts': makeDiff('src/composables/useFilter.ts', [
    {
      oldStart: 5,
      oldLines: 3,
      newStart: 5,
      newLines: 4,
      header: '@@ -5,3 +5,4 @@',
      lines: [
        { kind: 'context', text: 'export const useFilter = () => {' },
        { kind: 'add', text: '  const query = ref("")' },
        { kind: 'context', text: '  return { /* ... */ }' },
        { kind: 'context', text: '}' },
      ],
    },
  ]),
}

export const INITIAL_CONFLICT_BLOCKS: GitMergeConflictBlock[] = [
  {
    startLine: 34,
    endLine: 38,
    ours: '        self.projects = list(INITIAL_PROJECTS)',
    theirs: '        self.projects = INITIAL_PROJECTS.copy()',
    resolution: 'unresolved',
  },
  {
    startLine: 52,
    endLine: 57,
    ours: '        self.selected_task = self.tasks[0].id if self.tasks else None',
    theirs: '        self.selected_task = next(iter(self.tasks), None)',
    resolution: 'unresolved',
  },
]

export const buildAutoCommit = (projectId: string, parentHash?: string): GitCommit => {
  const hash = `auto${Date.now().toString(16)}`.padEnd(40, '0').slice(0, 40)
  return {
    projectId,
    hash,
    shortHash: hash.slice(0, 7),
    authorName: 'AWOG Engine',
    authorEmail: 'engine@awog.local',
    date: new Date().toISOString(),
    subject: '[N_arch-007] Architect: draft partitioned scheduler design',
    body: 'Auto-commit triggered after phase completion.',
    parents: parentHash ? [parentHash] : [],
    refs: [],
    phaseId: 'N_arch-007',
    agentId: 'architect',
  }
}
