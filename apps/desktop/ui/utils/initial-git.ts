import type {
  GitBranch,
  GitCommit,
  GitFileDiff,
  GitFileStatus,
  GitMergeConflictBlock,
  GitRemote,
  GitStashEntry,
} from '~/types'

// Mock data cho Git Manager prototype — dùng cho /git khi sidecar chưa có.
// Cố ý mix file path unicode/emoji + binary để verify edge case hiển thị.

export const INITIAL_BINARY_PATH = 'apps/desktop/ui/public/icons/logo.png'
export const INITIAL_CONFLICT_PATH = 'apps/desktop/ui/stores/workspace.ts'

const path = (s: string): string => s

export const INITIAL_STATUS_FILES: GitFileStatus[] = [
  {
    path: path('apps/desktop/ui/pages/git/index.vue'),
    index: 'added',
    workTree: 'clean',
    isBinary: false,
    isStaged: true,
    hasConflict: false,
  },
  {
    path: path('apps/desktop/ui/stores/git.ts'),
    index: 'added',
    workTree: 'clean',
    isBinary: false,
    isStaged: true,
    hasConflict: false,
  },
  {
    path: path('docs/features/git-manager.md'),
    index: 'modified',
    workTree: 'clean',
    isBinary: false,
    isStaged: true,
    hasConflict: false,
  },
  {
    path: path('apps/desktop/ui/components/NavRail.vue'),
    index: 'clean',
    workTree: 'modified',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
  {
    path: path('apps/desktop/ui/utils/themes.ts'),
    index: 'clean',
    workTree: 'modified',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
  {
    path: path('apps/desktop/ui/types/index.ts'),
    index: 'clean',
    workTree: 'modified',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
  {
    path: path('apps/desktop/ui/README.md'),
    index: 'clean',
    workTree: 'modified',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
  {
    path: path('artifacts/notes — “bản nháp” 🌱.md'),
    index: 'clean',
    workTree: 'modified',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
  {
    path: path('apps/desktop/ui/components/git/GitStatusList.vue'),
    workTree: 'untracked',
    index: 'clean',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
  {
    path: path('apps/desktop/ui/components/git/GitDiffViewer.vue'),
    workTree: 'untracked',
    index: 'clean',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
  {
    path: path('apps/desktop/ui/components/git/GitCommitPanel.vue'),
    workTree: 'untracked',
    index: 'clean',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
  {
    path: path('apps/desktop/ui/components/git/GitHistoryList.vue'),
    workTree: 'untracked',
    index: 'clean',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
  {
    path: INITIAL_BINARY_PATH,
    workTree: 'modified',
    index: 'clean',
    isBinary: true,
    isStaged: false,
    hasConflict: false,
  },
  {
    path: path('apps/desktop/ui/legacy/old-component.vue'),
    workTree: 'deleted',
    index: 'clean',
    isBinary: false,
    isStaged: false,
    hasConflict: false,
  },
  {
    path: INITIAL_CONFLICT_PATH,
    workTree: 'conflicted',
    index: 'conflicted',
    isBinary: false,
    isStaged: false,
    hasConflict: true,
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
  'commit cross-link phase regex parse',
  'amend HEAD safety guard',
  'binary file diff placeholder',
  'stash include untracked files',
  'remote list readonly view',
  'fix Nuxt route alias unresolved',
  'unify diff palette dark/light',
  'sanitize stderr for auth modal',
  'broader status badge taxonomy',
  'persistent toast queue cap',
  'avoid v-html in conflict resolver',
  'remove hardcoded hex from chart',
  'parametrize mock latency',
  'eslint: prefer-const + no-plusplus',
  'storybook smoke for GitBranchList',
  'cancel push round-trip',
  'recover gracefully on ENOENT cwd',
  'add tests for parser regex',
  'docs: ADR draft for IPC contract',
  'reorder NavRail icons',
  'fix tray badge invariants',
  'lock orchestrator behind workspace mutex',
  'split useGitApi composable surface',
  'add upstream tracking metadata',
  'baseline performance numbers',
]

const makeHash = (i: number) => {
  const seed = (i + 1) * 9301 + 49297
  const out = ((seed * seed) % 9999999).toString(16).padStart(7, '0')
  return `${out}${out.slice(0, 33)}`.slice(0, 40)
}

const refsForIndex = (i: number): string[] => {
  if (i === 0) return ['feature/git-manager']
  if (i === 5) return ['main', 'origin/main']
  return []
}

const phasePrefix = (i: number) => {
  if (i % 5 !== 0) return ''
  const phaseNum = String(Math.floor(i / 5) + 1).padStart(3, '0')
  const phase = ['N_arch', 'N_back', 'N_front', 'N_qa', 'N_review'][i % 5]
  return `[${phase}-${phaseNum}] ${AGENTS[i % AGENTS.length]}: `
}

export const INITIAL_COMMITS: GitCommit[] = SUBJECTS.map((subj, i) => {
  const hash = makeHash(i)
  const prefix = phasePrefix(i)
  const subject = prefix ? `${prefix}${subj}` : subj
  const phaseIdMatch = subject.match(/^\[([^\]]+)\]/)
  const created = Date.now() - i * 1000 * 60 * 47
  return {
    hash,
    shortHash: hash.slice(0, 7),
    authorName: i % 3 === 0 ? 'AWOG Engine' : 'Local Developer',
    authorEmail: i % 3 === 0 ? 'engine@awog.local' : 'dev@awog.local',
    date: new Date(created).toISOString(),
    subject,
    body: i % 7 === 0 ? 'Generated by mock data for demo purposes.' : undefined,
    parents: i + 1 < SUBJECTS.length ? [makeHash(i + 1)] : [],
    refs: refsForIndex(i),
    phaseId: phaseIdMatch?.[1],
    agentId: phaseIdMatch ? (AGENTS[i % AGENTS.length] ?? 'unknown').toLowerCase() : undefined,
  }
})

const commitHashAt = (i: number): string => INITIAL_COMMITS[i]?.hash ?? makeHash(i)

export const INITIAL_BRANCHES: GitBranch[] = [
  {
    name: 'feature/git-manager',
    isCurrent: true,
    isRemote: false,
    upstream: 'origin/feature/git-manager',
    ahead: 2,
    behind: 0,
    lastCommit: commitHashAt(0),
  },
  {
    name: 'main',
    isCurrent: false,
    isRemote: false,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    lastCommit: commitHashAt(5),
  },
  {
    name: 'feature/sessions-revamp',
    isCurrent: false,
    isRemote: false,
    upstream: 'origin/feature/sessions-revamp',
    ahead: 5,
    behind: 3,
    lastCommit: commitHashAt(10),
  },
  {
    name: 'fix/auth-flow',
    isCurrent: false,
    isRemote: false,
    ahead: 0,
    behind: 0,
    lastCommit: commitHashAt(15),
  },
  {
    name: 'docs/spec-cleanup',
    isCurrent: false,
    isRemote: false,
    ahead: 1,
    behind: 0,
    lastCommit: commitHashAt(20),
  },
  {
    name: 'origin/main',
    isCurrent: false,
    isRemote: true,
    ahead: 0,
    behind: 0,
    lastCommit: commitHashAt(5),
  },
  {
    name: 'origin/feature/git-manager',
    isCurrent: false,
    isRemote: true,
    ahead: 0,
    behind: 0,
    lastCommit: commitHashAt(2),
  },
]

export const INITIAL_STASHES: GitStashEntry[] = [
  {
    index: 0,
    ref: 'stash@{0}',
    message: 'WIP: refactor GitCommitPanel',
    date: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    branch: 'feature/git-manager',
  },
  {
    index: 1,
    ref: 'stash@{1}',
    message: 'WIP: debug toast leak',
    date: new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString(),
    branch: 'fix/auth-flow',
  },
  {
    index: 2,
    ref: 'stash@{2}',
    message: 'tweak theme tokens',
    date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(),
    branch: 'main',
  },
]

export const INITIAL_REMOTES: GitRemote[] = [
  {
    name: 'origin',
    fetchUrl: 'git@github.com:boykioyb/awog.git',
    pushUrl: 'git@github.com:boykioyb/awog.git',
  },
]

const makeDiff = (p: string, hunks: GitFileDiff['hunks']): GitFileDiff => ({
  path: p,
  isBinary: false,
  hunks,
})

export const INITIAL_FILE_DIFFS: Record<string, GitFileDiff> = {
  'apps/desktop/ui/pages/git/index.vue': makeDiff('apps/desktop/ui/pages/git/index.vue', [
    {
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 12,
      header: '@@ -0,0 +1,12 @@',
      lines: [
        { kind: 'add', text: '<template>' },
        { kind: 'add', text: '  <div class="flex flex-1 overflow-hidden">' },
        { kind: 'add', text: '    <GitTabBar v-model="activeTab" />' },
        { kind: 'add', text: '    <GitChangesTab v-if="activeTab === \'changes\'" />' },
        { kind: 'add', text: '    <GitHistoryTab v-else-if="activeTab === \'history\'" />' },
        { kind: 'add', text: '  </div>' },
        { kind: 'add', text: '</template>' },
        { kind: 'add', text: '' },
        { kind: 'add', text: '<script setup lang="ts">' },
        { kind: 'add', text: "const activeTab = ref<'changes' | 'history'>('changes')" },
        { kind: 'add', text: '</script>' },
        { kind: 'add', text: '' },
      ],
    },
  ]),
  'apps/desktop/ui/stores/git.ts': makeDiff('apps/desktop/ui/stores/git.ts', [
    {
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 8,
      header: '@@ -0,0 +1,8 @@',
      lines: [
        { kind: 'add', text: "import { defineStore } from 'pinia'" },
        { kind: 'add', text: '' },
        { kind: 'add', text: "export const useGitStore = defineStore('git', () => {" },
        { kind: 'add', text: "  const currentBranch = ref<string>('main')" },
        { kind: 'add', text: '  // ...' },
        { kind: 'add', text: '  return { currentBranch }' },
        { kind: 'add', text: '})' },
        { kind: 'add', text: '' },
      ],
    },
  ]),
  'docs/features/git-manager.md': makeDiff('docs/features/git-manager.md', [
    {
      oldStart: 100,
      oldLines: 5,
      newStart: 100,
      newLines: 7,
      header: '@@ -100,5 +100,7 @@',
      lines: [
        { kind: 'context', text: '## Acceptance Criteria' },
        { kind: 'context', text: '' },
        { kind: 'del', text: '- AC-01: list status (basic)' },
        {
          kind: 'add',
          text: '- AC-01: list status với section staged/unstaged/untracked/conflicted',
        },
        { kind: 'add', text: '- AC-02: stage / unstage per-file' },
        { kind: 'context', text: '- AC-03: commit với message valid' },
        { kind: 'context', text: '' },
      ],
    },
  ]),
  'apps/desktop/ui/components/NavRail.vue': makeDiff('apps/desktop/ui/components/NavRail.vue', [
    {
      oldStart: 170,
      oldLines: 5,
      newStart: 170,
      newLines: 6,
      header: '@@ -170,5 +170,6 @@',
      lines: [
        {
          kind: 'context',
          text: "  { id: 'agents', label: 'Agents', icon: Users, to: '/agents' },",
        },
        {
          kind: 'context',
          text: "  { id: 'skills', label: 'Skills', icon: Wand2, to: '/skills' },",
        },
        { kind: 'add', text: "  { id: 'git', label: 'Git', icon: GitBranch, to: '/git' }," },
        {
          kind: 'context',
          text: "  { id: 'mcp-servers', label: 'MCP Servers', icon: Plug, to: '/mcp-servers' },",
        },
        { kind: 'context', text: "  { id: 'hooks', label: 'Hooks', icon: Zap, to: '/hooks' }," },
        { kind: 'context', text: '' },
      ],
    },
  ]),
  'apps/desktop/ui/utils/themes.ts': makeDiff('apps/desktop/ui/utils/themes.ts', [
    {
      oldStart: 56,
      oldLines: 3,
      newStart: 56,
      newLines: 10,
      header: '@@ -56,3 +56,10 @@',
      lines: [
        { kind: 'context', text: '  edgeActive: string' },
        { kind: 'context', text: '  connectingEdge: string' },
        { kind: 'add', text: '  // Git' },
        { kind: 'add', text: '  gitAdded: string' },
        { kind: 'add', text: '  gitModified: string' },
        { kind: 'add', text: '  gitDeleted: string' },
        { kind: 'add', text: '  gitUntracked: string' },
        { kind: 'add', text: '  gitConflict: string' },
        { kind: 'context', text: '  shadow: string' },
        { kind: 'context', text: '' },
      ],
    },
  ]),
  'apps/desktop/ui/types/index.ts': makeDiff('apps/desktop/ui/types/index.ts', [
    {
      oldStart: 350,
      oldLines: 4,
      newStart: 350,
      newLines: 12,
      header: '@@ -350,4 +350,12 @@',
      lines: [
        { kind: 'context', text: '  system?: boolean' },
        { kind: 'context', text: '}' },
        { kind: 'add', text: '' },
        { kind: 'add', text: 'export type GitFileStatusCode =' },
        { kind: 'add', text: "  | 'modified'" },
        { kind: 'add', text: "  | 'added'" },
        { kind: 'add', text: "  | 'deleted'" },
        { kind: 'add', text: "  | 'untracked'" },
        { kind: 'add', text: "  | 'conflicted'" },
        { kind: 'add', text: '' },
        { kind: 'context', text: '// end of file' },
        { kind: 'context', text: '' },
      ],
    },
  ]),
  'apps/desktop/ui/README.md': makeDiff('apps/desktop/ui/README.md', [
    {
      oldStart: 45,
      oldLines: 3,
      newStart: 45,
      newLines: 4,
      header: '@@ -45,3 +45,4 @@',
      lines: [
        { kind: 'context', text: '✅ Markdown editor fullscreen' },
        { kind: 'context', text: '✅ Theme system' },
        { kind: 'add', text: '✅ Git Manager prototype — /git với 5 tab + mock data' },
        { kind: 'context', text: '✅ System tray + native notification' },
        { kind: 'context', text: '' },
      ],
    },
  ]),
  'artifacts/notes — “bản nháp” 🌱.md': makeDiff('artifacts/notes — “bản nháp” 🌱.md', [
    {
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 4,
      header: '@@ -1,3 +1,4 @@',
      lines: [
        { kind: 'context', text: '# Ghi chú — bản nháp 🌱' },
        { kind: 'context', text: '' },
        { kind: 'del', text: '- Idea: thêm tab Git' },
        { kind: 'add', text: '- ✅ Đã có tab Git mock — review prototype' },
        { kind: 'add', text: '- TODO: wire sidecar IPC sau' },
      ],
    },
  ]),
  'apps/desktop/ui/legacy/old-component.vue': makeDiff('apps/desktop/ui/legacy/old-component.vue', [
    {
      oldStart: 1,
      oldLines: 5,
      newStart: 0,
      newLines: 0,
      header: '@@ -1,5 +0,0 @@',
      lines: [
        { kind: 'del', text: '<template>' },
        { kind: 'del', text: '  <div>Legacy</div>' },
        { kind: 'del', text: '</template>' },
        { kind: 'del', text: '' },
        { kind: 'del', text: '<script setup lang="ts"></script>' },
      ],
    },
  ]),
  'apps/desktop/ui/components/git/GitStatusList.vue': makeDiff(
    'apps/desktop/ui/components/git/GitStatusList.vue',
    [
      {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 4,
        header: '@@ -0,0 +1,4 @@',
        lines: [
          { kind: 'add', text: '<template>' },
          { kind: 'add', text: '  <div class="git-status-list">…</div>' },
          { kind: 'add', text: '</template>' },
          { kind: 'add', text: '' },
        ],
      },
    ],
  ),
  'apps/desktop/ui/components/git/GitDiffViewer.vue': makeDiff(
    'apps/desktop/ui/components/git/GitDiffViewer.vue',
    [
      {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 3,
        header: '@@ -0,0 +1,3 @@',
        lines: [
          { kind: 'add', text: '<template>' },
          { kind: 'add', text: '  <div class="git-diff-viewer">…</div>' },
          { kind: 'add', text: '</template>' },
        ],
      },
    ],
  ),
  'apps/desktop/ui/components/git/GitCommitPanel.vue': makeDiff(
    'apps/desktop/ui/components/git/GitCommitPanel.vue',
    [
      {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 3,
        header: '@@ -0,0 +1,3 @@',
        lines: [
          { kind: 'add', text: '<template>' },
          { kind: 'add', text: '  <div class="git-commit-panel">…</div>' },
          { kind: 'add', text: '</template>' },
        ],
      },
    ],
  ),
  'apps/desktop/ui/components/git/GitHistoryList.vue': makeDiff(
    'apps/desktop/ui/components/git/GitHistoryList.vue',
    [
      {
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: 3,
        header: '@@ -0,0 +1,3 @@',
        lines: [
          { kind: 'add', text: '<template>' },
          { kind: 'add', text: '  <div class="git-history-list">…</div>' },
          { kind: 'add', text: '</template>' },
        ],
      },
    ],
  ),
  [INITIAL_CONFLICT_PATH]: makeDiff(INITIAL_CONFLICT_PATH, [
    {
      oldStart: 32,
      oldLines: 8,
      newStart: 32,
      newLines: 12,
      header: '@@ -32,8 +32,12 @@',
      lines: [
        { kind: 'context', text: "export const useWorkspaceStore = defineStore('workspace', {" },
        { kind: 'context', text: '  state: () => ({' },
        { kind: 'add', text: '<<<<<<< HEAD' },
        { kind: 'add', text: '    projects: [...INITIAL_PROJECTS] as Project[],' },
        { kind: 'add', text: '=======' },
        { kind: 'add', text: '    projects: INITIAL_PROJECTS.slice() as Project[],' },
        { kind: 'add', text: '>>>>>>> origin/main' },
        { kind: 'context', text: '    agents: [...INITIAL_AGENTS] as Agent[],' },
        { kind: 'context', text: '  }),' },
        { kind: 'context', text: '' },
      ],
    },
  ]),
}

export const INITIAL_CONFLICT_BLOCKS: GitMergeConflictBlock[] = [
  {
    startLine: 34,
    endLine: 38,
    ours: '    projects: [...INITIAL_PROJECTS] as Project[],',
    theirs: '    projects: INITIAL_PROJECTS.slice() as Project[],',
    resolution: 'unresolved',
  },
  {
    startLine: 52,
    endLine: 57,
    ours: '      selectedTaskId: state.tasks[0]?.id ?? null,',
    theirs: '      selectedTaskId: state.tasks.at(0)?.id ?? null,',
    resolution: 'unresolved',
  },
]

export const buildAutoCommit = (parentHash?: string): GitCommit => {
  const hash = `auto${Date.now().toString(16)}`.padEnd(40, '0').slice(0, 40)
  return {
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
