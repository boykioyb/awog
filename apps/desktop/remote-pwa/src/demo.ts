import { gateway } from './gateway'
import type {
  FullSession,
  GatewayEvent,
  RemoteBootstrap,
  RemoteTaskDetail,
  RemoteTaskSummary,
  SessionSearchResult,
  SessionSummary,
} from './types'

// ─── Demo mode (dev only, ?demo trong URL) ──────────────────────────────────
// Thay socket thật bằng data + scripted events để xem toàn bộ luồng mobile (list,
// swipe, transcript, gate, task, diff, cost) mà không cần desktop gateway chạy.
// Không có đường nào tới đây trong production build — main.ts chỉ dynamic-import
// module này khi import.meta.env.DEV && ?demo.

type Listener = (e: GatewayEvent) => void

const listeners = new Set<Listener>()

function emit(type: string, payload: unknown): void {
  for (const l of listeners) l({ type, payload })
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const iso = (minAgo: number): string => new Date(Date.now() - minAgo * 60_000).toISOString()

// Demo PTYs + SSH hosts — mutable state the handlers below read/write.
const demoTerms: { id: string; sessionId: string }[] = []
let sshConnSeq = 0
let fwdSeq = 0
const sshConnsDemo: { connId: string; hostId: string }[] = [
  { connId: 'conn-1', hostId: 'prod-web' },
]
const fwdsDemo: {
  forwardId: string
  connId: string
  forward: { id: string; type: 'local' | 'remote' | 'dynamic'; label?: string; bindPort: number; destHost: string; destPort: number }
  status: 'active' | 'error'
}[] = [
  {
    forwardId: 'fwd-1',
    connId: 'conn-1',
    forward: { id: 'web', type: 'local', label: 'Web staging', bindPort: 8080, destHost: '127.0.0.1', destPort: 3000 },
    status: 'active',
  },
]
const sshHostsDemo: import('./types').SshHost[] = [
  {
    id: 'prod-web',
    name: 'prod-web',
    host: 'web-01.kyrotech.internal',
    port: 22,
    user: 'deploy',
    authMethod: 'key',
    identityId: 'id-main',
    folder: 'prod',
    portForwards: [
      { id: 'web', type: 'local', label: 'Web staging', bindPort: 8080, destHost: '127.0.0.1', destPort: 3000 },
      { id: 'db', type: 'local', label: 'Postgres', bindPort: 15432, destHost: '127.0.0.1', destPort: 5432 },
    ],
  },
  {
    id: 'staging',
    name: 'staging',
    host: '10.0.8.21',
    port: 2222,
    user: 'ubuntu',
    authMethod: 'agent',
    folder: 'staging',
  },
  {
    id: 'db-1',
    name: 'db-1',
    host: 'db.internal',
    port: 22,
    user: 'postgres',
    authMethod: 'password',
    folder: 'prod',
  },
]

// ─── DB giả ─────────────────────────────────────────────────────────────────

const sessions: SessionSummary[] = [
  {
    id: 's1',
    title: 'Refactor giao diện mobile PWA',
    projectId: 'awog',
    updatedAt: iso(2),
    status: 'idle',
    messageCount: 14,
    lastPreview: 'Đã xong NavBar + TabBar, đang làm gesture…',
  },
  {
    id: 's2',
    title: 'Viết spec Wiki backlinks',
    projectId: 'awog',
    updatedAt: iso(41),
    status: 'awaiting',
    messageCount: 6,
    lastPreview: 'Plan chờ duyệt — 4 bước',
  },
  {
    id: 's3',
    title: 'Fix webhook retry storm',
    projectId: 'kyrotech',
    updatedAt: iso(190),
    status: 'error',
    messageCount: 31,
    lastPreview: 'EPIPE: write after end',
  },
  {
    id: 's4',
    title: 'Draft bài viết local-first AI',
    projectId: 'blog',
    updatedAt: iso(1500),
    status: 'done',
    messageCount: 9,
    lastPreview: 'Outline xong, mời đọc draft',
  },
  {
    id: 's5',
    title: 'Hỏi nhanh về git rebase',
    projectId: null,
    updatedAt: iso(4300),
    status: 'done',
    messageCount: 4,
    lastPreview: 'rebase -i HEAD~3 rồi squash',
  },
]

// s1 đang có turn chạy trên "desktop" → hiện "Đang chạy" + composer steer mode.
// Flag tắt sau khi scripted turn kết thúc (user duyệt permission gate).
let s1Running = true

const transcripts = new Map<string, FullSession>([
  [
    's1',
    {
      id: 's1',
      title: 'Refactor giao diện mobile PWA',
      projectId: 'awog',
      updatedAt: iso(2),
      settings: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-5',
        level: 'high',
        mode: 'ask',
        responseStyle: 'Default',
      },
      todos: [
        { content: 'NavBar + large title collapse', status: 'completed' },
        { content: 'Edge swipe-back + slide transition', status: 'completed' },
        { content: 'Pull-to-refresh + skeleton', status: 'in_progress' },
        { content: 'Verify trên iPhone thật', status: 'pending' },
      ],
      messages: [
        {
          id: 'u1',
          role: 'user',
          text: 'Refactor giao diện mobile remote-pwa thành kiểu iOS — tab bar dưới, swipe back, pull to refresh',
        },
        {
          id: 'm1',
          role: 'agent',
          text: '',
          parts: [
            {
              kind: 'text',
              text: 'Đã đọc `store.ts` và các view. Kế hoạch: nav stack + history, TabBar dưới, NavBar iOS, gesture viết tay không lib.',
            },
            {
              id: 'st1',
              kind: 'tool',
              tool: 'read',
              label: 'Read',
              target: 'src/store.ts',
              status: 'done',
              detail: {
                kind: 'file',
                path: 'src/store.ts',
                content:
                  "export const route = ref<Route>('list')\nexport const sessionList = ref<SessionSummary[]>([])\nexport const current = ref<CurrentSession | null>(null)\n// …",
              },
            },
            {
              id: 'st2',
              kind: 'tool',
              tool: 'edit',
              label: 'Edit',
              target: 'src/App.vue',
              additions: 132,
              deletions: 40,
              status: 'done',
              detail: {
                kind: 'diff',
                path: 'src/App.vue',
                diff: [
                  'diff --git a/src/App.vue b/src/App.vue',
                  '@@ -145,10 +145,16 @@',
                  ' <div class="stage">',
                  '-  <SessionView v-if="route === \'session\'" />',
                  '-  <TasksView v-else-if="route === \'tasks\'" />',
                  '+  <div ref="underEl" class="under" :class="{ covered: inSession }">',
                  '+    <SessionListView v-if="rootRoute === \'list\'" />',
                  '+    <TasksView v-else />',
                  '+    <TabBar />',
                  '+  </div>',
                  '+  <Transition name="slide">',
                  '+    <div v-if="inSession" ref="overEl" class="over">',
                  '+      <SessionView />',
                  '+    </div>',
                  '+  </Transition>',
                  ' </div>',
                ].join('\n'),
              },
            },
            {
              id: 'st3',
              kind: 'tool',
              tool: 'terminal',
              label: 'Bash',
              target: 'pnpm typecheck',
              status: 'done',
              detail: { kind: 'terminal', command: 'pnpm typecheck', output: 'src/demo.ts — no errors\n\nExit code: 0', exitCode: 0 },
            },
            { kind: 'text', text: 'NavBar + TabBar xong, typecheck sạch. Đang viết edge-swipe gesture.' },
          ],
        },
        {
          id: 'm-run',
          role: 'agent',
          text: 'Còn phần build cuối — cần chạy `pnpm build` trên máy, đang xin quyền.',
          streaming: false,
        } as never,
      ],
    },
  ],
  [
    's2',
    {
      id: 's2',
      title: 'Viết spec Wiki backlinks',
      projectId: 'awog',
      updatedAt: iso(41),
      settings: {
        provider: 'anthropic',
        modelId: 'claude-opus-5',
        level: 'max',
        mode: 'plan',
        responseStyle: 'Default',
      },
      messages: [
        { id: 'u1', role: 'user', text: 'Viết spec tính năng backlink cho wiki' },
        {
          id: 'm1',
          role: 'agent',
          text: '',
          parts: [
            { kind: 'text', text: 'Đã khảo sát wiki store 2-tier. Đề xuất plan:' },
            {
              id: 'p1',
              kind: 'plan',
              label: 'Plan',
              planStatus: 'pending',
              planMarkdown:
                '1. Index backlink trong `wiki/index.ts` khi write\n2. Panel "Linked from" trong reader\n3. Grep fallback khi index rỗng\n4. Test: vòng đời rename → cập nhật link',
              planRationale: 'Backlink là lý do wiki tồn tại — làm đúng ở index thay vì query lúc đọc.',
            },
          ],
        },
      ],
    },
  ],
  [
    's3',
    {
      id: 's3',
      title: 'Fix webhook retry storm',
      projectId: 'kyrotech',
      updatedAt: iso(190),
      settings: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-5',
        level: 'medium',
        mode: 'ask',
        responseStyle: 'Default',
      },
      messages: [
        { id: 'u1', role: 'user', text: 'Webhook retry storm — queue đầy' },
        {
          id: 'm1',
          role: 'agent',
          text: 'Tìm thấy vòng retry không backoff. Đang vá…',
          error: { message: 'EPIPE: write after end' },
        },
      ],
    },
  ],
  [
    's4',
    {
      id: 's4',
      title: 'Draft bài viết local-first AI',
      projectId: 'blog',
      updatedAt: iso(1500),
      settings: {
        provider: 'openai',
        modelId: 'gpt-5.2',
        level: 'high',
        mode: 'ask',
        responseStyle: 'feynman',
      },
      messages: [
        { id: 'u1', role: 'user', text: 'Viết draft về local-first AI cho blog' },
        {
          id: 'm1',
          role: 'agent',
          text: '',
          parts: [
            { kind: 'text', text: 'Draft xong ở `drafts/local-first-ai.md`. Một câu hỏi trước khi chốt:' },
            {
              id: 'q1',
              kind: 'question',
              label: 'Hỏi',
              questions: [
                {
                  header: 'Giọng văn',
                  question: 'Bài viết nên theo giọng nào?',
                  multiSelect: false,
                  options: [
                    { label: 'Kỹ thuật sâu', description: 'Code sample + benchmark, cho reader engineer' },
                    { label: 'Kể chuyện', description: 'Narrative, ít code, dễ share' },
                    { label: 'Cân bằng', description: 'Mở narrative, thân bài kỹ thuật' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
  [
    's5',
    {
      id: 's5',
      title: 'Hỏi nhanh về git rebase',
      projectId: null,
      updatedAt: iso(4300),
      settings: {
        provider: 'anthropic',
        modelId: 'claude-sonnet-5',
        level: 'low',
        mode: 'ask',
        responseStyle: 'Default',
      },
      messages: [
        { id: 'u1', role: 'user', text: 'Squash 3 commit cuối kiểu gì?' },
        {
          id: 'm1',
          role: 'agent',
          text: '`git rebase -i HEAD~3` → đổi 2 dòng cuối `pick` thành `squash` → save. An toàn vì chưa push.',
        },
      ],
    },
  ],
])

let taskSeq = 3
const tasks: RemoteTaskSummary[] = [
  {
    id: 't1',
    title: 'Ship remote PWA P2',
    projectId: 'awog',
    status: 'running',
    createdAt: iso(95),
    workflowId: 'wf-ship',
    waitingApproval: 'n3',
    phaseCount: 4,
    donePhaseCount: 2,
  },
  {
    id: 't2',
    title: 'Đồng bộ wiki index',
    projectId: 'awog',
    status: 'completed',
    createdAt: iso(1400),
    workflowId: 'wf-sync',
    waitingApproval: null,
    phaseCount: 3,
    donePhaseCount: 3,
  },
  {
    id: 't3',
    title: 'Migrate DB schema v9',
    projectId: 'kyrotech',
    status: 'failed',
    createdAt: iso(2900),
    workflowId: 'wf-migrate',
    waitingApproval: null,
    phaseCount: 5,
    donePhaseCount: 1,
  },
]

const taskDetails = new Map<string, RemoteTaskDetail>([
  [
    't1',
    {
      ...tasks[0],
      description: 'Chạy workflow ship-feature cho remote PWA phase 2: steer, cancel, checklist, session-create.',
      currentNodeId: 'n3',
      phases: [
        { nodeId: 'n1', status: 'completed', skillName: 'Lên plan', runCount: 1, lastOutput: 'plan.md → 4 phases' },
        { nodeId: 'n2', status: 'completed', skillName: 'Implement gateway calls', runCount: 2, lastOutput: 'typecheck sạch' },
        { nodeId: 'n3', status: 'running', skillName: 'Verify UI', runCount: 1, lastOutput: 'đang chạy playwright…' },
        { nodeId: 'n4', status: 'queued', skillName: 'Mở PR', runCount: 0 },
      ],
    },
  ],
  [
    't2',
    {
      ...tasks[1],
      description: 'Re-index toàn bộ wiki sau khi đổi slug scheme.',
      currentNodeId: null,
      phases: [
        { nodeId: 'a1', status: 'completed', skillName: 'Scan', runCount: 1, lastOutput: '142 trang' },
        { nodeId: 'a2', status: 'completed', skillName: 'Re-index', runCount: 1, lastOutput: 'xong 8.2s' },
        { nodeId: 'a3', status: 'completed', skillName: 'Verify', runCount: 1, lastOutput: '0 orphan' },
      ],
    },
  ],
  [
    't3',
    {
      ...tasks[2],
      description: 'Migrate schema lên v9, rollback nếu migration 4 fail.',
      currentNodeId: 'b2',
      phases: [
        { nodeId: 'b1', status: 'completed', skillName: 'Backup', runCount: 1, lastOutput: 'snapshot ok' },
        { nodeId: 'b2', status: 'failed', skillName: 'Migrate 1-4', runCount: 1, lastOutput: 'lock timeout ở migration 3' },
        { nodeId: 'b3', status: 'queued', skillName: 'Migrate 5-9', runCount: 0 },
      ],
    },
  ],
])

const BOOTSTRAP: RemoteBootstrap = {
  projects: [
    { id: 'awog', name: 'AWOG', color: '#10b981' },
    { id: 'kyrotech', name: 'KyroTech API', color: '#f59e0b' },
    { id: 'blog', name: 'Blog cá nhân', color: '#8b5cf6' },
  ],
  providers: [
    {
      provider: 'anthropic',
      models: [
        { id: 'claude-opus-5', name: 'Claude Opus 5' },
        { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
      ],
      accounts: [
        { id: 'acc-main', label: 'kyro@work', status: 'active' },
        { id: 'acc-alt', label: 'kyro@personal', status: 'active' },
      ],
      activeAccountId: 'acc-main',
    },
    {
      provider: 'openai',
      models: [{ id: 'gpt-5.2', name: 'GPT-5.2' }],
      accounts: [],
      activeAccountId: null,
    },
  ],
  defaults: { provider: 'anthropic', modelId: 'claude-sonnet-5', level: 'high' },
  workflows: [
    { id: 'wf-ship', name: 'Ship feature', projectId: 'awog', nodeCount: 4 },
    { id: 'wf-sync', name: 'Đồng bộ wiki', projectId: 'awog', nodeCount: 3 },
    { id: 'wf-migrate', name: 'Migrate DB', projectId: 'kyrotech', nodeCount: 5 },
  ],
  capabilities: { unattended: true },
}

// ─── Scripted events ─────────────────────────────────────────────────────────

// Stream một câu trả lời giả vào bubble agent đã có sẵn (sendMessage) — chunk
// theo cụm từ để nhìn thấy caret/streaming, rồi message.done như engine thật.
async function streamReply(sessionId: string, messageId: string, text: string): Promise<void> {
  const words = text.split(' ')
  let acc = ''
  for (const w of words) {
    acc += (acc ? ' ' : '') + w
    emit('session.chunk', { sessionId, messageId, delta: acc.endsWith(' ') ? w + ' ' : w + ' ' })
    await sleep(90)
  }
  emit('session.message.done', { sessionId, messageId, text })
}

// Khi user mở s1: một việc nền chạy xong (BackgroundChips) + permission gate bật
// lên (PermissionCard) — đúng hai thứ chỉ đến qua event, không nằm trong get.
function scheduleSessionIntro(sessionId: string): void {
  void (async () => {
    await sleep(700)
    emit('session.background-started', {
      sessionId,
      shellId: 'sh1',
      command: 'pnpm build (watch)',
    })
    await sleep(1200)
    if (!s1Running) return
    emit('session.permission-request', {
      sessionId,
      messageId: 'm-run',
      requestId: 'req-demo-1',
      toolName: 'Bash',
      displayName: 'Chạy lệnh shell',
      promptSentence: 'Agent muốn chạy lệnh sau trên máy desktop:',
      input: { command: 'pnpm build', description: 'Build remote-pwa' },
    })
  })()
}

// ─── RPC dispatch ────────────────────────────────────────────────────────────

type Params = Record<string, unknown>

const handlers: Record<string, (p: Params) => unknown | Promise<unknown>> = {
  'remote.bootstrap': () => BOOTSTRAP,

  'sessions.list': () => ({ sessions: [...sessions] }),

  'sessions.activeTurns': () => ({ sessions: s1Running ? [{ engineId: 's1' }] : [] }),

  'sessions.get': (p) => ({ session: transcripts.get(String(p.sessionId)) ?? null }),

  'sessions.search': (p) => {
    const q = String(p.query ?? '')
    const results: SessionSearchResult[] = [
      {
        sessionId: 's1',
        sessionTitle: 'Refactor giao diện mobile PWA',
        projectId: 'awog',
        messageId: 'm1',
        role: 'agent',
        at: iso(2),
        snippet: `…nav stack + history, TabBar dưới — khớp "${q}"…`,
      },
      {
        sessionId: 's5',
        sessionTitle: 'Hỏi nhanh về git rebase',
        projectId: null,
        messageId: 'm1',
        role: 'agent',
        at: iso(4300),
        snippet: `git rebase -i HEAD~3 — kết quả cho "${q}"`,
      },
    ]
    return { results }
  },

  'sessions.sendMessage': async (p) => {
    const sessionId = String(p.sessionId)
    const messageId = String(p.messageId)
    void streamReply(
      sessionId,
      messageId,
      'Đã nhận — đây là reply demo stream từng chunk như engine thật. Thử vuốt mép trái để back.',
    ).then(() => loadSessionsPreview(sessionId))
    await sleep(150)
    return { messageId }
  },

  'sessions.steer': async (p) => {
    const sessionId = String(p.sessionId)
    const messageId = String(p.messageId)
    emit('session.chunk', { sessionId, messageId, delta: `\n> steer: ${p.text}\n` })
    await sleep(120)
    emit('session.message.done', { sessionId, messageId, text: '' })
    s1Running = false
    return { ok: true }
  },

  'sessions.cancel': (p) => {
    const sessionId = String(p.sessionId)
    emit('session.message.done', { sessionId, messageId: 'm-run', text: '' })
    s1Running = false
    return {}
  },

  'sessions.permission': (p) => {
    // Duyệt gate → "engine" chạy nốt một đoạn rồi xong lượt (drainPending của
    // store sẽ tự bắn tin nhắn đang xếp hàng — đúng luồng thật).
    if (p.decision === 'allow') {
      void streamReply('s1', 'm-run', 'Đã được duyệt — chạy `pnpm build`: ✓ built in 1.67s. Xong.').then(
        () => {
          s1Running = false
        },
      )
    } else {
      emit('session.message.done', {
        sessionId: 's1',
        messageId: 'm-run',
        errorMessage: 'Đã từ chối quyền',
      })
      s1Running = false
    }
    emit('session.background-done', {
      sessionId: 's1',
      shellId: 'sh1',
      command: 'pnpm build (watch)',
      status: 'exited',
      exitCode: 0,
    })
    return {}
  },

  'sessions.answerQuestion': () => ({}),

  'sessions.updateTodos': (p) => {
    const t = transcripts.get(String(p.sessionId))
    if (t) t.todos = p.todos as FullSession['todos']
    return {}
  },

  'sessions.generateTitle': (p) => ({
    ok: true,
    title: String(p.userText ?? 'Session mới').slice(0, 42),
  }),

  'sessions.upsert': (p) => {
    if (p.mode === 'create') {
      const id = `s${Math.floor(Math.random() * 1e6)}`
      const full: FullSession = {
        id,
        title: String(p.title ?? '') || 'Session mới',
        projectId: (p.projectId as string | null) ?? null,
        updatedAt: iso(0),
        settings: p.settings as FullSession['settings'],
        messages: [],
      }
      transcripts.set(id, full)
      sessions.unshift({
        id,
        title: full.title,
        projectId: full.projectId,
        updatedAt: full.updatedAt,
        status: 'idle',
        messageCount: 0,
        lastPreview: '',
      })
      return { session: full }
    }
    const t = transcripts.get(String(p.sessionId))
    if (t) {
      if (typeof p.title === 'string') t.title = p.title
      if (p.settings) t.settings = { ...t.settings, ...(p.settings as object) } as FullSession['settings']
      const row = sessions.find((s) => s.id === t.id)
      if (row) row.title = t.title
    }
    return { session: t ?? null }
  },

  'sessions.delete': (p) => {
    const id = String(p.id)
    const i = sessions.findIndex((s) => s.id === id)
    if (i >= 0) sessions.splice(i, 1)
    transcripts.delete(id)
    return {}
  },

  'sessions.turnActive': () => ({ active: s1Running }),

  'sessions.costBreakdown': (p) => ({
    sessionId: p.sessionId,
    byDay: [
      { date: '2026-09-25', costUsd: 1.24, totalTokens: 412_000, turns: 9 },
      { date: '2026-09-26', costUsd: 0.98, totalTokens: 318_000, turns: 7 },
      { date: '2026-09-27', costUsd: 1.19, totalTokens: 510_000, turns: 10 },
    ],
    total: { costUsd: 3.41, totalTokens: 1_240_000, turns: 26 },
    firstAt: iso(2900),
    lastAt: iso(2),
    hasUnpriced: false,
  }),

  'git.status': () => ({
    branch: 'feat/mobile-ui',
    detached: false,
    ahead: 2,
    behind: 0,
    files: [
      { path: 'src/App.vue', changeType: 'modified', stageState: 'unstaged', isBinary: false, additions: 132, deletions: 40 },
      { path: 'src/components/NavBar.vue', changeType: 'added', stageState: 'unstaged', isBinary: false, additions: 96, deletions: 0 },
      { path: 'src/components/TabBar.vue', changeType: 'added', stageState: 'unstaged', isBinary: false, additions: 74, deletions: 0 },
      { path: 'src/style.css', changeType: 'modified', stageState: 'unstaged', isBinary: false, additions: 61, deletions: 12 },
    ],
    isMerging: false,
    isRebasing: false,
    conflictedCount: 0,
  }),

  'git.diff': () => ({
    files: [
      {
        path: 'src/App.vue',
        isBinary: false,
        isRename: false,
        hunks: [
          {
            header: '@@ -34,6 +34,9 @@',
            lines: [
              { kind: 'context', oldLineNum: 34, newLineNum: 34, content: "import { route } from './store'" },
              { kind: 'add', newLineNum: 35, content: "import TabBar from './components/TabBar.vue'" },
              { kind: 'add', newLineNum: 36, content: "import { navPop } from './store'" },
              { kind: 'context', oldLineNum: 35, newLineNum: 37, content: '' },
              { kind: 'del', oldLineNum: 36, content: 'const inSession = computed(() => route.value === \'session\')' },
              { kind: 'add', newLineNum: 38, content: '// Edge swipe-back: drag từ mép trái ≤26px' },
            ],
          },
        ],
      },
      {
        path: 'src/style.css',
        isBinary: false,
        isRename: false,
        hunks: [
          {
            header: '@@ -148,4 +148,7 @@',
            lines: [
              { kind: 'context', oldLineNum: 148, newLineNum: 148, content: '#app {' },
              { kind: 'add', newLineNum: 149, content: '  padding-top: env(safe-area-inset-top);' },
              { kind: 'context', oldLineNum: 149, newLineNum: 150, content: '}' },
            ],
          },
        ],
      },
    ],
  }),

  // A small tree for the Files tab — enough depth to exercise expand/collapse
  // and the preview sheet. '' is the workspace root, per fs.listDir's contract.
  'fs.listDir': (p) => {
    const tree: Record<string, { name: string; path: string; kind: 'file' | 'dir'; size?: number }[]> = {
      '': [
        { name: 'docs', path: 'docs', kind: 'dir' },
        { name: 'src', path: 'src', kind: 'dir' },
        { name: '.gitignore', path: '.gitignore', kind: 'file', size: 186 },
        { name: 'CLAUDE.md', path: 'CLAUDE.md', kind: 'file', size: 3120 },
        { name: 'package.json', path: 'package.json', kind: 'file', size: 640 },
        { name: 'README.md', path: 'README.md', kind: 'file', size: 1440 },
      ],
      src: [
        { name: 'components', path: 'src/components', kind: 'dir' },
        { name: 'views', path: 'src/views', kind: 'dir' },
        { name: 'App.vue', path: 'src/App.vue', kind: 'file', size: 8102 },
        { name: 'demo.ts', path: 'src/demo.ts', kind: 'file', size: 19880 },
        { name: 'gateway.ts', path: 'src/gateway.ts', kind: 'file', size: 7420 },
        { name: 'main.ts', path: 'src/main.ts', kind: 'file', size: 1104 },
        { name: 'store.ts', path: 'src/store.ts', kind: 'file', size: 22410 },
        { name: 'style.css', path: 'src/style.css', kind: 'file', size: 12630 },
        { name: 'types.ts', path: 'src/types.ts', kind: 'file', size: 9210 },
      ],
      'src/components': [
        { name: 'Composer.vue', path: 'src/components/Composer.vue', kind: 'file', size: 14820 },
        { name: 'NavBar.vue', path: 'src/components/NavBar.vue', kind: 'file', size: 4200 },
        { name: 'SwipeRow.vue', path: 'src/components/SwipeRow.vue', kind: 'file', size: 5100 },
        { name: 'TabBar.vue', path: 'src/components/TabBar.vue', kind: 'file', size: 3010 },
      ],
      'src/views': [
        { name: 'SessionListView.vue', path: 'src/views/SessionListView.vue', kind: 'file', size: 9840 },
        { name: 'SessionView.vue', path: 'src/views/SessionView.vue', kind: 'file', size: 7620 },
        { name: 'TasksView.vue', path: 'src/views/TasksView.vue', kind: 'file', size: 6880 },
      ],
      docs: [
        { name: 'features', path: 'docs/features', kind: 'dir' },
        { name: 'decisions', path: 'docs/decisions', kind: 'dir' },
      ],
      'docs/features': [
        { name: 'mobile-remote-ui.md', path: 'docs/features/mobile-remote-ui.md', kind: 'file', size: 5400 },
      ],
      'docs/decisions': [
        { name: '0067-mobile-remote-control.md', path: 'docs/decisions/0067-mobile-remote-control.md', kind: 'file', size: 8900 },
      ],
    }
    return { entries: tree[String(p.path ?? '')] ?? [] }
  },

  'fs.readFile': (p) => {
    const files: Record<string, { content: string; language?: string }> = {
      'package.json': {
        language: 'json',
        content: JSON.stringify(
          {
            name: '@awog/remote-pwa',
            version: '0.26.0',
            private: true,
            type: 'module',
            scripts: { dev: 'vite', build: 'vite build', typecheck: 'vue-tsc --noEmit' },
          },
          null,
          2,
        ),
      },
      'CLAUDE.md': {
        language: 'markdown',
        content: '# AWOG\n\nArtifact Workflow Orchestrate Guild — AI Team OS local-first, đóng gói desktop qua Electron.\n\n## Quy ước\n\n- Tài liệu tiếng Việt, code tiếng Anh.\n- Một file = một chủ đề.',
      },
      'src/main.ts': {
        language: 'typescript',
        content:
          "import { createApp } from 'vue'\nimport App from './App.vue'\nimport './style.css'\n\ncreateApp(App).mount('#app')",
      },
      'src/App.vue': {
        language: 'vue',
        content:
          '<template>\n  <div class="stage">\n    <div class="under">…</div>\n    <div class="over"><SessionView /></div>\n  </div>\n</template>',
      },
      'README.md': { language: 'markdown', content: '# remote-pwa\n\nMobile remote-control PWA for AWOG.' },
    }
    const f = files[String(p.path)]
    return {
      path: p.path,
      content: f?.content ?? `// ${p.path}\n// Nội dung demo — file này không có preview trong mock.`,
      language: f?.language,
      truncated: false,
      isBinary: false,
    }
  },

  // ── Terminal (session-scoped PTY) ─────────────────────────────────────────
  'terminal.list': (p) => ({
    terminals: demoTerms
      .filter((t) => !p.sessionId || t.sessionId === p.sessionId)
      .map((t) => ({ terminalId: t.id, sessionId: t.sessionId, createdAt: iso(30) })),
  }),

  'terminal.create': (p) => {
    const id = `term-${demoTerms.length + 1}`
    const sessionId = String(p.sessionId)
    demoTerms.push({ id, sessionId })
    void (async () => {
      await sleep(300)
      emit('terminal.data', {
        terminalId: id,
        sessionId,
        chunk: 'AWOG remote shell — ~/Projects/awog\n$ ',
      })
    })()
    return { terminalId: id }
  },

  'terminal.write': (p) => {
    const id = String(p.terminalId)
    const t = demoTerms.find((x) => x.id === id)
    if (!t) return {}
    const data = String(p.data ?? '')
    if (data === '\x03') {
      emit('terminal.data', { terminalId: id, sessionId: t.sessionId, chunk: '^C\n$ ' })
      return {}
    }
    const cmd = data.trim()
    if (!cmd) return {}
    void (async () => {
      await sleep(180)
      const fake =
        cmd === 'ls'
          ? 'apps  docs  package.json  README.md\n'
          : cmd.startsWith('echo')
            ? cmd.slice(4).trim() + '\n'
            : cmd === 'git status'
              ? 'On branch feat/mobile-ui\nnothing to commit, working tree clean\n'
              : `${cmd}: command not found — đây là demo, thử ls / echo / git status\n`
      emit('terminal.data', {
        terminalId: id,
        sessionId: t.sessionId,
        chunk: `${cmd}\n${fake}$ `,
      })
    })()
    return {}
  },

  'terminal.resize': () => ({}),

  'terminal.kill': (p) => {
    const id = String(p.terminalId)
    const i = demoTerms.findIndex((x) => x.id === id)
    if (i >= 0) {
      const [t] = demoTerms.splice(i, 1)
      emit('terminal.exit', { terminalId: id, sessionId: t.sessionId, exitCode: 0 })
    }
    return {}
  },

  // ── SSH (ADR 0063) ─────────────────────────────────────────────────────────
  'ssh.list': () => ({
    hosts: sshHostsDemo.map((h) => ({
      ...h,
      connectionStatus: sshConnsDemo.some((c) => c.hostId === h.id)
        ? 'connected'
        : h.id === 'db-1'
          ? 'error'
          : 'disconnected',
      connectionError: h.id === 'db-1' ? 'Connection timed out' : undefined,
    })),
    identities: [{ id: 'id-main', name: 'Khoá chính', keyType: 'ed25519', keyPath: '~/.ssh/id_ed25519', inlineStored: false, hasPassphrase: true }],
  }),

  'ssh.connections': () => ({ connections: [...sshConnsDemo] }),

  'ssh.test': async (p) => {
    await sleep(600)
    return String(p.hostId) === 'db-1'
      ? { status: 'error', error: 'Connection timed out' }
      : { status: 'connected' }
  },

  'ssh.connect': async (p) => {
    await sleep(700)
    const connId = `conn-${++sshConnSeq}`
    sshConnsDemo.push({ connId, hostId: String(p.hostId) })
    return { connId }
  },

  'ssh.disconnect': (p) => {
    const i = sshConnsDemo.findIndex((c) => c.connId === p.connId)
    if (i >= 0) sshConnsDemo.splice(i, 1)
    return { ok: true }
  },

  'ssh.exec': async (p) => {
    await sleep(500)
    const c = String(p.command ?? '')
    if (c.includes('uptime')) return { stdout: ' 14:02  up 36 days,  2:41, 1 user, load average: 0.42, 0.38, 0.31\n', stderr: '', code: 0 }
    if (c.includes('df')) return { stdout: 'Filesystem  Size  Used Avail Use% Mounted on\n/dev/sda1   50G   31G   17G  65% /\n', stderr: '', code: 0 }
    if (c.includes('docker')) return { stdout: 'CONTAINER ID  IMAGE        STATUS\n8f3a21bc9d01  awog:latest  Up 36 days\n', stderr: '', code: 0 }
    return { stdout: `$ ${c}\n(demo) lệnh đã chạy trên host.\n`, stderr: '', code: 0 }
  },

  'ssh.forward.list': (p) => ({
    forwards: fwdsDemo.filter((f) => !p.connId || f.connId === p.connId),
  }),

  'ssh.forward.start': (p) => {
    const forwardId = `fwd-${++fwdSeq}`
    fwdsDemo.push({
      forwardId,
      connId: String(p.connId),
      forward: p.forward as (typeof fwdsDemo)[number]['forward'],
      status: 'active',
    })
    return { forwardId }
  },

  'ssh.forward.stop': (p) => {
    const i = fwdsDemo.findIndex((f) => f.forwardId === p.forwardId)
    if (i >= 0) fwdsDemo.splice(i, 1)
    return { ok: true }
  },

  'ssh.sftp.list': (p) => {
    const tree: Record<string, import('./types').SftpEntry[]> = {
      '.': [
        { name: 'apps', type: 'dir', size: 4096, mtime: 0, atime: 0, mode: 0o755, uid: 0, gid: 0 },
        { name: 'logs', type: 'dir', size: 4096, mtime: 0, atime: 0, mode: 0o755, uid: 0, gid: 0 },
        { name: '.bashrc', type: 'file', size: 2206, mtime: 0, atime: 0, mode: 0o644, uid: 0, gid: 0 },
        { name: 'deploy.sh', type: 'file', size: 842, mtime: 0, atime: 0, mode: 0o755, uid: 0, gid: 0 },
      ],
      '/apps': [
        { name: 'awog', type: 'dir', size: 4096, mtime: 0, atime: 0, mode: 0o755, uid: 0, gid: 0 },
        { name: 'kyrotech-api', type: 'dir', size: 4096, mtime: 0, atime: 0, mode: 0o755, uid: 0, gid: 0 },
      ],
      '/apps/awog': [
        { name: 'docker-compose.yml', type: 'file', size: 1180, mtime: 0, atime: 0, mode: 0o644, uid: 0, gid: 0 },
        { name: '.env', type: 'file', size: 210, mtime: 0, atime: 0, mode: 0o600, uid: 0, gid: 0 },
      ],
      '/apps/kyrotech-api': [
        { name: 'README.md', type: 'file', size: 640, mtime: 0, atime: 0, mode: 0o644, uid: 0, gid: 0 },
      ],
      '/logs': [
        { name: 'nginx-access.log', type: 'file', size: 8_242_010, mtime: 0, atime: 0, mode: 0o644, uid: 0, gid: 0 },
        { name: 'app.log', type: 'file', size: 96_400, mtime: 0, atime: 0, mode: 0o644, uid: 0, gid: 0 },
      ],
    }
    return { entries: tree[String(p.path ?? '.')] ?? [] }
  },

  'ssh.sftp.read': (p) => ({
    base64: btoa(
      `# ${String(p.path)}\n# Nội dung demo của file trên host remote.\nexport PATH="$HOME/bin:$PATH"\nalias ll='ls -la'`,
    ),
    truncated: false,
  }),

  'ssh.upsert': (p) => {
    const h = p.host as (typeof sshHostsDemo)[number]
    const i = sshHostsDemo.findIndex((x) => x.id === h.id)
    if (i >= 0) sshHostsDemo[i] = { ...sshHostsDemo[i], ...h }
    else sshHostsDemo.push(h)
    return { ok: true }
  },

  'ssh.delete': (p) => {
    const i = sshHostsDemo.findIndex((h) => h.id === p.id)
    if (i >= 0) sshHostsDemo.splice(i, 1)
    return { ok: true }
  },

  'ssh.setCredential': () => ({ ok: true }),
  'ssh.getCredential': () => ({}),
  'ssh.identityUpsert': () => ({ ok: true }),
  'ssh.identityDelete': () => ({ ok: true }),
  'ssh.detectKeyType': () => ({ keyType: 'ed25519' }),
  'ssh.importConfig': () => ({ candidates: [] }),
  'ssh.importConfigApply': () => ({ imported: 0 }),
  'ssh.confirmHostKey': () => ({ ok: true }),
  'ssh.runInShell': () => ({ output: '(demo)', exitCode: 0 }),
  'ssh.write': () => ({ ok: true }),
  'ssh.resize': () => ({ ok: true }),
  'ssh.sftp.mkdir': () => ({ ok: true }),
  'ssh.sftp.createFile': () => ({ ok: true }),
  'ssh.sftp.rename': () => ({ ok: true }),
  'ssh.sftp.delete': () => ({ ok: true }),
  'ssh.sftp.compress': () => ({ ok: true }),
  'ssh.sftp.extract': () => ({ ok: true }),
  'ssh.sftp.copy': () => ({ ok: true }),
  'ssh.sftp.chmod': () => ({ ok: true }),
  'ssh.sftp.chown': () => ({ ok: true }),
  'ssh.sftp.statx': () => ({ entries: [] }),
  'ssh.sftp.toolcheck': () => ({ tools: { tar: true, zip: false } }),

  'remote.tasks': () => ({ tasks: [...tasks] }),

  'remote.task': (p) => ({ task: taskDetails.get(String(p.id)) ?? null }),

  'tasks.approvePhase': (p) => {
    const d = taskDetails.get(String(p.taskId))
    if (d) {
      const ph = d.phases.find((x) => x.nodeId === p.nodeId)
      if (ph) ph.status = 'completed'
      d.waitingApproval = null
      d.donePhaseCount++
      const next = d.phases.find((x) => x.status === 'queued')
      if (next) {
        next.status = 'running'
        d.currentNodeId = next.nodeId
      } else {
        d.status = 'completed'
        d.currentNodeId = null
      }
      const s = tasks.find((t) => t.id === d.id)
      if (s) Object.assign(s, { status: d.status, waitingApproval: null, donePhaseCount: d.donePhaseCount })
    }
    return {}
  },

  'tasks.pause': (p) => setTaskStatus(String(p.id), 'paused'),
  'tasks.resume': (p) => setTaskStatus(String(p.id), 'running'),
  'tasks.cancel': (p) => setTaskStatus(String(p.id), 'canceled'),

  'tasks.create': (p) => {
    const id = `t${++taskSeq}`
    const wf = BOOTSTRAP.workflows.find((w) => w.id === p.workflowId)
    const t: RemoteTaskSummary = {
      id,
      title: String(p.title ?? '') || wf?.name || 'Task',
      projectId: String(p.projectId),
      status: 'queued',
      createdAt: iso(0),
      workflowId: String(p.workflowId),
      waitingApproval: null,
      phaseCount: wf?.nodeCount ?? 3,
      donePhaseCount: 0,
    }
    tasks.unshift(t)
    taskDetails.set(id, {
      ...t,
      description: String(p.description ?? ''),
      currentNodeId: 'n1',
      phases: Array.from({ length: t.phaseCount }, (_, i) => ({
        nodeId: `n${i + 1}`,
        status: i === 0 ? 'running' : 'queued',
        skillName: `Phase ${i + 1}`,
        runCount: 0,
      })),
    })
    return { task: t }
  },
}

function setTaskStatus(id: string, status: string): Record<string, never> {
  const s = tasks.find((t) => t.id === id)
  if (s) s.status = status
  const d = taskDetails.get(id)
  if (d) d.status = status
  return {}
}

// Cập nhật preview dưới list sau khi gửi — giữ list đồng bộ với transcript demo.
function loadSessionsPreview(sessionId: string): void {
  const s = sessions.find((x) => x.id === sessionId)
  if (s) {
    s.lastPreview = 'Reply demo vừa stream xong'
    s.updatedAt = iso(0)
  }
}

// ─── Install ────────────────────────────────────────────────────────────────

export function installDemoGateway(): void {
  // Chặn listener của store vào set riêng để emit event giả (listeners của
  // Gateway là private — bọc onEvent thay vì đụng gateway.ts).
  const origOnEvent = gateway.onEvent.bind(gateway)
  gateway.onEvent = (l: Listener) => {
    listeners.add(l)
    const off = origOnEvent(l)
    return () => {
      listeners.delete(l)
      off()
    }
  }

  gateway.request = (async (method: string, params: unknown) => {
    await sleep(140) // latency giả cho cảm giác mạng thật
    const h = handlers[method]
    if (!h) throw new Error(`demo: chưa mock ${method}`)
    return h((params ?? {}) as Params)
  }) as typeof gateway.request

  gateway.canSend = () => true
  gateway.subscribe = (sessionId: string) => {
    if (sessionId === 's1') scheduleSessionIntro(sessionId)
  }
  gateway.unsubscribe = () => {}
  gateway.forget = () => {}

  // initStore() (đăng ký watch trên readySignal) chạy ngay sau install — flip
  // sang 'ready' ở tick sau để watch kịp bắt, giống socket thật.
  setTimeout(() => {
    gateway.phase.value = 'ready'
    gateway.readySignal.value++
  }, 0)
}
