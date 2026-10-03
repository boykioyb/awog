import { computed, ref, watch } from 'vue'
import type { ProtoAttachment } from '~/composables/useProtoPreview'

// Mock data for the /proto/sessions preview — same shapes the real sessions
// store serves, but static so the page renders without the engine/sidecar.

export interface ProtoProject {
  id: string
  name: string
  color: string
}

export interface ProtoSession {
  id: string
  projectId: string
  title: string
  agent: string
  model: string
  status: 'running' | 'waiting' | 'done' | 'error'
  time: string
  tokens: string
  pinned?: boolean
  unread?: number
}

// One tool call inside a turn's activity group (SessionStepItem parity:
// icon + name + target (dir ellipsized, filename kept) + result chip + Ns).
export interface ProtoStep {
  tool: string
  target?: string
  result?: string
  status: 'ok' | 'running' | 'fail'
  elapsed?: number
  // Raw terminal/search output (Input/Output branch).
  output?: string
  // File steps: the real payload — 'diff' = unified diff (Edit/MultiEdit),
  // 'file' = file content (Write/Read). SessionStepBody detailKind parity.
  detail?: string
  detailKind?: 'diff' | 'file'
}

export type ProtoActivity =
  | { kind: 'step'; step: ProtoStep }
  | { kind: 'think'; text: string }
  | { kind: 'note'; text: string }

export interface ProtoMessage {
  id: string
  role: 'user' | 'agent' | 'tool' | 'system'
  author: string
  time: string
  text?: string
  // Rendered-markdown body (goes through the real useMarkdown pipeline — same
  // sanitization + Shiki as production), vs `text` which renders plainly.
  md?: string
  // Attachment chips inside the bubble — click opens the shared preview modal.
  attachments?: ProtoAttachment[]
  tool?: {
    name: string
    cmd?: string
    status: 'ok' | 'running' | 'fail'
    output?: string
    elapsed?: number
  }
  // Turn activity stream — collapsible "N steps · M failed" group like
  // SessionTurnActivities: tool steps + thinking + commentary in one unit.
  activities?: ProtoActivity[]
  code?: { lang: string; body: string }
  mermaid?: string
  todo?: { done: boolean; text: string }[]
  bookmarked?: boolean
  // Per-turn telemetry — mirrors `startedAt→completedAt` elapsed + the char/3
  // token estimate the real SessionMessageItem renders in the byline footer.
  elapsedSec?: number
}

export interface ProtoTask {
  id: string
  title: string
  status: 'done' | 'running' | 'queued' | 'failed'
  duration: string
}

export interface ProtoFile {
  name: string
  path: string
  children?: ProtoFile[]
}

// Small inline SVGs as attachment payloads — real <img>/<video poster> sources
// without depending on files on disk.
const MOCK_IMG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#18181b"/><stop offset="1" stop-color="#3f3f46"/>
      </linearGradient></defs>
      <rect width="640" height="360" fill="url(#g)"/>
      <rect x="24" y="24" width="180" height="312" rx="10" fill="#27272a"/>
      <rect x="222" y="24" width="394" height="312" rx="10" fill="#27272a"/>
      <rect x="40" y="44" width="120" height="12" rx="6" fill="#52525b"/>
      <rect x="40" y="68" width="96" height="12" rx="6" fill="#3f3f46"/>
      <rect x="40" y="92" width="136" height="12" rx="6" fill="#3f3f46"/>
      <rect x="244" y="44" width="220" height="14" rx="7" fill="#e4e4e7"/>
      <rect x="244" y="80" width="340" height="80" rx="8" fill="#3f3f46"/>
      <rect x="244" y="180" width="280" height="80" rx="8" fill="#3f3f46"/>
      <circle cx="580" cy="300" r="18" fill="#e4e4e7"/>
    </svg>`,
  )

const MOCK_VIDEO_POSTER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
      <rect width="640" height="360" fill="#09090b"/>
      <rect x="24" y="300" width="592" height="6" rx="3" fill="#27272a"/>
      <rect x="24" y="300" width="220" height="6" rx="3" fill="#e4e4e7"/>
      <circle cx="320" cy="170" r="44" fill="#e4e4e7" fill-opacity="0.9"/>
      <path d="M306 148l44 22-44 22z" fill="#09090b"/>
      <text x="24" y="340" fill="#71717a" font-family="monospace" font-size="16">00:42 / 02:18</text>
    </svg>`,
  )

const projects: ProtoProject[] = [
  { id: 'awog', name: 'awog', color: 'oklch(0.696 0.17 162.48)' },
  { id: 'kyroweb', name: 'kyroweb', color: 'oklch(0.623 0.214 259.815)' },
  { id: 'infra', name: 'infra-lab', color: 'oklch(0.769 0.188 70.08)' },
  { id: 'petstore', name: 'petstore-api', color: 'oklch(0.645 0.246 16.439)' },
  { id: 'docs', name: 'docs-site', color: 'oklch(0.6 0.118 184.704)' },
  { id: 'mobile', name: 'awog-mobile', color: 'oklch(0.627 0.265 303.9)' },
]

const sessions: ProtoSession[] = [
  {
    id: 's1',
    projectId: 'awog',
    title: 'Refactor sang shadcn-vue primitives',
    agent: 'claude',
    model: 'Sonnet 4.5',
    status: 'running',
    time: '2m',
    tokens: '41.2k',
    pinned: true,
  },
  {
    id: 's2',
    projectId: 'awog',
    title: 'Fix session popout z-index',
    agent: 'codex',
    model: 'GPT-5',
    status: 'done',
    time: '1h',
    tokens: '18.7k',
    unread: 3,
  },
  {
    id: 's3',
    projectId: 'awog',
    title: 'Token guard rule R6 — spacing scale',
    agent: 'claude',
    model: 'Opus 4.1',
    status: 'waiting',
    time: '3h',
    tokens: '8.1k',
  },
  {
    id: 's7',
    projectId: 'awog',
    title: 'Sessions list context menu → ContextMenu',
    agent: 'claude',
    model: 'Haiku 4.5',
    status: 'done',
    time: '5h',
    tokens: '6.4k',
  },
  {
    id: 's4',
    projectId: 'kyroweb',
    title: 'Landing hero + OG image',
    agent: 'claude',
    model: 'Sonnet 4.5',
    status: 'done',
    time: '1d',
    tokens: '22.4k',
  },
  {
    id: 's5',
    projectId: 'kyroweb',
    title: 'Migrate Vue 3.5 Suspense',
    agent: 'gemini',
    model: 'Gemini 3 Pro',
    status: 'error',
    time: '2d',
    tokens: '5.9k',
  },
  {
    id: 's8',
    projectId: 'kyroweb',
    title: 'i18n pass — vi copy review',
    agent: 'claude',
    model: 'Sonnet 4.5',
    status: 'waiting',
    time: '2d',
    tokens: '9.8k',
  },
  {
    id: 's6',
    projectId: 'infra',
    title: 'EKS node group drain script',
    agent: 'claude',
    model: 'Haiku 4.5',
    status: 'done',
    time: '4d',
    tokens: '3.2k',
  },
  {
    id: 's9',
    projectId: 'infra',
    title: 'Terraform plan reviewer agent',
    agent: 'codex',
    model: 'GPT-5',
    status: 'running',
    time: '6d',
    tokens: '54.1k',
  },
  {
    id: 's10',
    projectId: 'petstore',
    title: 'OpenAPI schema → typed client',
    agent: 'claude',
    model: 'Opus 4.1',
    status: 'done',
    time: '1w',
    tokens: '12.0k',
  },
]

const messages: Record<string, ProtoMessage[]> = {
  s1: [
    {
      id: 'm1',
      role: 'user',
      author: 'kyro',
      time: '14:02',
      text: 'Tạo prototype cho refactor sang shadcn-vue. Màn Sessions trước — cần đúng look ui.shadcn.com (neutral palette, primary đen/trắng) + toggle Light/Dark/System.',
    },
    {
      id: 'm2',
      role: 'agent',
      author: 'claude · Sonnet 4.5',
      time: '14:02',
      text: 'Rõ. Tôi sẽ dựng lớp primitive shadcn-vue thật trên reka-ui, đọc đúng tên var chuẩn (`--background`, `--primary`, `--sidebar-accent`…) — giá trị do theme layer cấp: proto nạp palette neutral oklch thật của shadcn, production có thể alias ngược lại token AWOG.',
      elapsedSec: 8,
    },
    {
      id: 'm3',
      role: 'tool',
      author: 'tool',
      time: '14:03',
      tool: {
        name: 'Bash',
        cmd: 'grep -rn "text-sm\\|rounded-md" components pages | wc -l',
        status: 'ok',
        output:
          '0 — codebase không dùng named scale → remap trong tailwind.config an toàn tuyệt đối, chỉ ảnh hưởng components/ui mới.',
        elapsed: 3,
      },
    },
    {
      id: 'm4',
      role: 'agent',
      author: 'claude · Sonnet 4.5',
      time: '14:04',
      text: 'Xác nhận tách biệt sạch: theme sống trong `proto-shadcn.css` scoped `body.proto-shadcn` — component chỉ đọc var chuẩn. ModeToggle ghi `body.light`, cùng switch với theme thật.',
      code: {
        lang: 'css',
        body: `body.proto-shadcn {\n  --background: oklch(0.145 0 0);\n  --primary: oklch(0.922 0 0);   /* dark: nút primary TRẮNG */\n  --sidebar-accent: oklch(0.269 0 0);\n}`,
      },
      mermaid: `flowchart LR\n  A["components/ui"] -->|đọc var chuẩn| B["--background / --primary"]\n  B --> C["proto-shadcn.css<br/>neutral oklch"]\n  B -.->|production| D["AWOG token alias<br/>--bg / --accent"]`,
      bookmarked: true,
      elapsedSec: 23,
    },
    {
      id: 'm5',
      role: 'tool',
      author: 'tool',
      time: '14:05',
      tool: {
        name: 'Edit',
        cmd: 'proto-shadcn.css — standard var names → real neutral oklch',
        status: 'ok',
        elapsed: 1,
      },
    },
    {
      id: 'm5b',
      role: 'tool',
      author: 'tool',
      time: '14:05',
      tool: {
        name: 'Bash',
        cmd: 'pnpm typecheck',
        status: 'fail',
        output:
          'components/ui/input/Input.vue:9 — TS2304: Cannot find name "useVModel"\n→ @vueuse/core chưa cài. Viết lại v-model thủ công bằng computed get/set.',
        elapsed: 42,
      },
    },
    {
      id: 'm6',
      role: 'agent',
      author: 'claude · Sonnet 4.5',
      time: '14:06',
      text: 'Session screen đang render đúng look shadcn: sidebar `--sidebar-*`, selection `bg-accent`, primary monochrome, ModeToggle Light/Dark/System trên header.',
      todo: [
        { done: true, text: 'Theme layer: shadcn neutral oklch, light + dark + system' },
        { done: true, text: 'Primitive stock-look (Button/Tabs/Resizable/Sidebar…)' },
        { done: false, text: 'Chốt: giữ look stock hay alias var → token AWOG' },
        { done: false, text: 'Sweep 1.314 <button> theo từng domain' },
      ],
      elapsedSec: 76,
    },
    {
      id: 'm7',
      role: 'user',
      author: 'kyro',
      time: '14:21',
      text: 'Nhìn ổn rồi. Demo đầy đủ thêm mermaid, preview file, browser, message actions, bubble mode và context menu trên session list đi.',
      // Attachment chips inside the user bubble (screenshot + md + video) —
      // click opens the shared preview modal, same as SessionAttachmentChip.
      attachments: [
        { name: 'sidebar-mock.png', kind: 'image', src: MOCK_IMG, size: '182 KB' },
        {
          name: 'design-notes.md',
          kind: 'markdown',
          size: '2.1 KB',
          text: '# Design notes\n\n- `--sidebar-*` sống riêng khỏi `--background`\n- Icon rail **52px**, expanded **248px**\n- Selection = `bg-accent`, KHÔNG accent-wash emerald\n\n> Giữ đúng metric của shadcn — không nhét `--fs-*` của AWOG vào proto.',
        },
        { name: 'session-demo.mp4', kind: 'video', src: MOCK_VIDEO_POSTER, size: '4.8 MB' },
      ],
    },
    {
      id: 'm8',
      role: 'agent',
      author: 'claude · Sonnet 4.5',
      time: '14:21',
      // The turn's work BEFORE the answer — collapsible activity group like the
      // screenshot: interleaved Thinking + Run/Search/Write/subagent rows.
      activities: [
        {
          kind: 'think',
          text: 'Kiểm tra git top-level trước — repo root quyết định đường dẫn tương đối của docs/.',
        },
        {
          kind: 'step',
          step: {
            tool: 'Run',
            target: 'git log --oneline -3 && ls -1',
            status: 'ok',
            elapsed: 2,
            output:
              'a1b2c3d proto: media surfaces\nf4e5d6c proto: mermaid controls\n…\n=== top level ===\nawog/',
          },
        },
        {
          kind: 'step',
          step: {
            tool: 'Run',
            target: 'find docs -maxdepth 2 -name "*.md" | head -40',
            status: 'ok',
            elapsed: 1,
            output: 'docs/features/workspace-panel.md\ndocs/features/auto-update.md\n…',
          },
        },
        {
          kind: 'think',
          text: 'Changelog gần nhất nói về tab Đĩa — step kế phải grep "变更通知" trong docs.',
        },
        {
          kind: 'step',
          step: {
            tool: 'Run',
            target: 'git log --since=2026-09-25 --oneline | head -12 --name-only',
            status: 'fail',
            elapsed: 1,
            output: 'error: unrecognized argument: --name-only',
          },
        },
        {
          kind: 'step',
          step: {
            tool: 'Run',
            target: 'grep -rn "SelectionTranslate" components/ | head -8',
            status: 'ok',
            elapsed: 3,
            output:
              'components/common/SelectionTranslatePopover.vue:41:  languages\ncomponents/session/SessionMessageItem.vue:812: selection popover mount',
          },
        },
        {
          kind: 'step',
          step: {
            tool: 'ToolSearch',
            target: 'select:wiki_edit_page, wiki_update_page, wiki_list_revisions',
            result: '3 tools',
            status: 'ok',
          },
        },
        {
          kind: 'step',
          step: {
            tool: 'Write',
            target: 'scratch/wiki-check/update-brief.md',
            status: 'ok',
            result: '412 B',
            detailKind: 'file',
            detail:
              '# Update brief\n\n- §4.3: sync preview modal docs\n- §4.6: selection translate\n- §4.2.4.1: quote draft flow\n',
          },
        },
        {
          kind: 'step',
          step: {
            tool: 'Edit',
            target: 'components/proto/ProtoStepGroup.vue',
            status: 'ok',
            result: '+3 −0',
            detailKind: 'diff',
            detail: [
              '@@ -80,6 +80,9 @@ export function useProtoSession() {',
              '   const failed = computed(',
              "     () => entries.filter((e) => e.kind === 'step' && e.step.status === 'fail').length,",
              '   )',
              '+  const running = computed(',
              "+    () => entries.filter((e) => e.kind === 'step' && e.step.status === 'running').length,",
              '+  )',
              '   const preview = computed(() => {',
            ].join('\n'),
          },
        },
        {
          kind: 'step',
          step: {
            tool: 'Background agent: general-purpose',
            target: 'Update wiki W1: §4.3, §4.6, §4.2.4.1',
            status: 'ok',
            elapsed: 41,
            output: 'Wiki pages synced — 4 sections updated.',
          },
        },
        {
          kind: 'step',
          step: {
            tool: 'Background agent: general-purpose',
            target: 'Update wiki W2: SRS §5, §7, §7.E-J',
            status: 'running',
            elapsed: 18,
          },
        },
      ],
      // Markdown showcase — rendered through the real useMarkdown pipeline
      // (marked + sanitize + Shiki): headings/bold/code/table/quote/list.
      md: [
        '### Đã thêm đủ surface',
        '',
        '- **ContextMenu** (reka) cho item + project tab',
        '- **Dialog** cho Open project',
        '- **Message actions** kiểu `SessionMsgActions` — copy · quote · bookmark + `⋯` overflow',
        '- **Bubble mode** toggle + **mermaid** render thật',
        '',
        '| Surface | Primitive | Ghi chú |',
        '| --- | --- | --- |',
        '| Right-click | `ContextMenu` | alias `UiContextMenu` — trùng tên legacy |',
        '| Open project | `Dialog` | pin tab + re-scope session |',
        '| Workspace | `Tabs` | 8 tab, file → Code |',
        '',
        '> Component chỉ đọc tên var chuẩn — theme layer quyết giá trị.',
        '',
        'Đang verify lại `dark` + `light`.',
      ].join('\n'),
      elapsedSec: 11,
    },
  ],
}

const tasks: ProtoTask[] = [
  {
    id: 't1',
    title: 'Theme layer: shadcn neutral oklch + ModeToggle',
    status: 'done',
    duration: '1m 20s',
  },
  {
    id: 't2',
    title: 'Primitive stock-look (Button/Tabs/Resizable/Sidebar…)',
    status: 'done',
    duration: '4m 03s',
  },
  { id: 't3', title: 'Dialog + ContextMenu primitives', status: 'done', duration: '0m 58s' },
  {
    id: 't4',
    title: 'Session surface: actions, bubble, ctx menu, mermaid',
    status: 'running',
    duration: '2m 41s',
  },
  {
    id: 't5',
    title: 'Workspace: Code/Preview/Browser tabs',
    status: 'running',
    duration: '1m 12s',
  },
  {
    id: 't6',
    title: 'Verify dark/light/system + collapse + dialogs',
    status: 'queued',
    duration: '—',
  },
]

const fileTree: ProtoFile[] = [
  {
    name: 'ui',
    path: 'components/ui',
    children: [
      { name: 'button/', path: 'components/ui/button' },
      { name: 'sidebar/', path: 'components/ui/sidebar' },
      { name: 'resizable/', path: 'components/ui/resizable' },
      { name: 'tabs/', path: 'components/ui/tabs' },
      { name: 'dialog/', path: 'components/ui/dialog' },
      { name: 'context-menu/', path: 'components/ui/context-menu' },
      { name: 'scroll-area/', path: 'components/ui/scroll-area' },
      { name: 'tooltip/', path: 'components/ui/tooltip' },
      { name: 'dropdown-menu/', path: 'components/ui/dropdown-menu' },
      { name: 'input/', path: 'components/ui/input' },
      { name: 'badge/', path: 'components/ui/badge' },
    ],
  },
  {
    name: 'proto/',
    path: 'components/proto',
    children: [
      { name: 'ProtoSessionList.vue', path: 'components/proto/ProtoSessionList.vue' },
      { name: 'ProtoTranscript.vue', path: 'components/proto/ProtoTranscript.vue' },
      { name: 'ProtoComposer.vue', path: 'components/proto/ProtoComposer.vue' },
      { name: 'ProtoWorkspace.vue', path: 'components/proto/ProtoWorkspace.vue' },
      { name: 'ProtoMermaid.vue', path: 'components/proto/ProtoMermaid.vue' },
    ],
  },
  { name: 'proto-shadcn.css', path: 'assets/css/proto-shadcn.css' },
  { name: 'tailwind.config.ts', path: 'tailwind.config.ts' },
  { name: 'proto.vue', path: 'layouts/proto.vue' },
  { name: 'sessions.vue', path: 'pages/proto/sessions.vue' },
]

// Mock file contents for the Code tab — a slice of the real tailwind bridge.
const fileContents: Record<string, string> = {
  'tailwind.config.ts': `import type { Config } from 'tailwindcss'\nimport animate from 'tailwindcss-animate'\n\nconst c = (v: string) => \`rgb(from var(\${v}) r g b / <alpha-value>)\`\nconst raw = (v: string) => \`var(\${v})\`\n\nexport default <Partial<Config>>{\n  theme: {\n    extend: {\n      colors: {\n        background: c('--background'),\n        foreground: c('--foreground'),\n        primary: { DEFAULT: c('--primary'), foreground: c('--primary-foreground') },\n        sidebar: { accent: c('--sidebar-accent') /* … */ },\n      },\n    },\n  },\n  plugins: [animate],\n}`,
  'proto-shadcn.css': `body.proto-shadcn {\n  --background: oklch(0.145 0 0);\n  --foreground: oklch(0.985 0 0);\n  --primary: oklch(0.922 0 0);\n  --sidebar-accent: oklch(0.269 0 0);\n  --border: oklch(1 0 0 / 10%);\n}`,
  'proto.vue': `<template>\n  <TooltipProvider :delay-duration="300">\n    <SidebarProvider class="h-svh">\n      <Sidebar>…</Sidebar>\n      <SidebarInset>…</SidebarInset>\n    </SidebarProvider>\n  </TooltipProvider>\n</template>`,
  'sessions.vue': `<template>\n  <ResizablePanelGroup direction="horizontal">\n    <ResizablePanel>…list…</ResizablePanel>\n    <ResizableHandle />\n    <ResizablePanel>…detail…</ResizablePanel>\n  </ResizablePanelGroup>\n</template>`,
}

const planItems = [
  { done: true, text: 'Theme layer: shadcn neutral oklch, light + dark + system' },
  { done: true, text: 'Primitive stock-look (Button/Tabs/Resizable/Sidebar…)' },
  { done: true, text: 'Shell: SidebarProvider + icon-collapse rail' },
  { done: true, text: 'ContextMenu + Dialog + message actions + bubble mode' },
  { done: false, text: 'Chốt: giữ look stock hay alias var → token AWOG' },
  { done: false, text: 'Sweep 1.314 <button> theo từng domain' },
]

// Files this session touched — WorkspaceDiff parity: status letter + path +
// colored +/- counts, click → PreviewModal. Counts look like a real turn's work.
export const changedFiles: {
  path: string
  status: 'A' | 'M' | 'D'
  additions: number
  deletions: number
  body: string
}[] = [
  {
    path: 'components/proto/ProtoStepGroup.vue',
    status: 'M',
    additions: 118,
    deletions: 22,
    body: '// expanded: diff | file | input/output step bodies\n',
  },
  {
    path: 'components/proto/ProtoPreviewModal.vue',
    status: 'A',
    additions: 96,
    deletions: 0,
    body: '// new: shared preview modal (image/video/markdown/text)\n',
  },
  {
    path: 'composables/useProtoSession.ts',
    status: 'M',
    additions: 74,
    deletions: 12,
    body: '// activities + changedFiles + composerAtts + quoteDraft\n',
  },
  {
    path: 'assets/css/proto-shadcn.css',
    status: 'M',
    additions: 9,
    deletions: 4,
    body: '/* --success / --warning / code font */\n',
  },
  {
    path: 'components/proto/ProtoComposer.vue',
    status: 'M',
    additions: 61,
    deletions: 8,
    body: '// attachment chips + quote draft row\n',
  },
  {
    path: 'docs/features/shadcn-migration.md',
    status: 'D',
    additions: 0,
    deletions: 142,
    body: '',
  },
]

function createStore() {
  const activeTab = ref('awog')
  const openTabs = ref<string[]>(['awog', 'kyroweb', 'infra'])
  const activeId = ref('s1')
  const search = ref('')
  const workspaceOpen = ref(true)
  // Workspace dock side (SessionWorkspacePanel parity: right-click the tab
  // strip picks left/right/bottom; bottom is the narrow-width escape).
  const wsDock = ref<'left' | 'right' | 'bottom'>('right')
  // Workspace tab strip state — lifted so switching dock side doesn't remount
  // the panel and lose the active view / closed-view set.
  const wsTab = ref('plan')
  const wsViews = ref<string[]>([
    'plan',
    'tasks',
    'files',
    'code',
    'diff',
    'term',
    'preview',
    'browser',
  ])
  const listCollapsed = ref(false)
  const bubbleMode = ref(true)
  const previewFile = ref<ProtoFile | null>(null)
  // Composer pending attachments + quoted excerpts (selection → Quote).
  const composerAtts = ref<ProtoAttachment[]>([])
  const quoteDraft = ref<string[]>([])
  const previewContent = computed(() =>
    previewFile.value
      ? (fileContents[previewFile.value.name] ?? `// ${previewFile.value.path}\n// (mock content)`)
      : '',
  )

  const tabProjects = computed(() => projects.filter((p) => openTabs.value.includes(p.id)))

  function openProject(id: string) {
    if (!openTabs.value.includes(id)) openTabs.value = [...openTabs.value, id]
    activeTab.value = id
  }
  function closeProject(id: string) {
    const i = openTabs.value.indexOf(id)
    if (i === -1) return
    openTabs.value = openTabs.value.filter((t) => t !== id)
    if (activeTab.value === id) activeTab.value = openTabs.value[Math.max(0, i - 1)] ?? ''
  }

  const tabSessions = computed(() =>
    sessions.filter(
      (s) =>
        s.projectId === activeTab.value &&
        (!search.value || s.title.toLowerCase().includes(search.value.toLowerCase())),
    ),
  )
  const active = computed(() => sessions.find((s) => s.id === activeId.value) ?? null)
  const activeProject = computed(() => projects.find((p) => p.id === activeTab.value) ?? null)

  // Switching project tabs follows that project's session list — mirror the
  // real store, which re-scopes the active session to the selected project.
  watch(activeTab, (id) => {
    const inProject = sessions.find((s) => s.id === activeId.value)?.projectId === id
    if (!inProject) activeId.value = sessions.find((s) => s.projectId === id)?.id ?? ''
  })
  const activeMessages = computed(() => (active.value ? (messages[active.value.id] ?? []) : []))

  return {
    projects,
    sessions,
    activeTab,
    openTabs,
    tabProjects,
    openProject,
    closeProject,
    activeId,
    search,
    active,
    activeProject,
    tabSessions,
    activeMessages,
    workspaceOpen,
    wsDock,
    wsTab,
    wsViews,
    listCollapsed,
    bubbleMode,
    previewFile,
    previewContent,
    composerAtts,
    quoteDraft,
    tasks,
    fileTree,
    planItems,
    changedFiles,
  }
}

// Singleton — transcript/composer/page share one store (quoteDraft and
// composerAtts are cross-component; before they were passed via props, so the
// per-call refs happened to work).
let store: ReturnType<typeof createStore> | null = null
export function useProtoSession() {
  return (store ??= createStore())
}
