// Changelog — static, bundled release notes powering the "What's New" panel.
// Local-first: AWOG ships its changelog with the build, never fetches it (no
// SSRF surface, works fully offline). Each item is bilingual (en/vi) so the
// content matches the active UI locale like the rest of the i18n'd interface.
//
// Maintaining this file:
//   • Add the newest release at the TOP of `CHANGELOG` (the array is ordered
//     newest → oldest). `CURRENT_VERSION` derives from the first entry and
//     drives the NavRail "unseen" dot (see `useWhatsNew`).
//   • Keep `version` in sync with `package.json` when you cut a real release.
//   • `kind` groups the change for the colored badge in the modal.

export type ChangeKind = 'added' | 'improved' | 'changed' | 'fixed'

export type LocalizedText = {
  en: string
  vi: string
}

export type ChangeItem = LocalizedText & {
  kind: ChangeKind
}

export type Release = {
  version: string // semver without the leading "v"
  date: string // ISO date `YYYY-MM-DD`
  highlight?: LocalizedText // optional one-line summary shown under the version
  items: ChangeItem[]
}

export const CHANGELOG: Release[] = [
  {
    version: '0.3.2',
    date: '2026-06-04',
    highlight: {
      en: 'Task artifact editor fixes and tidier session replies.',
      vi: 'Sửa trình soạn artifact của Task và gọn lại phần trả lời trong Session.',
    },
    items: [
      {
        kind: 'fixed',
        en: 'Opening a task artifact in the editor now shows the real generated output instead of placeholder text.',
        vi: 'Mở artifact của task trong editor giờ hiển thị nội dung thật thay vì văn bản mẫu.',
      },
      {
        kind: 'fixed',
        en: '"Back to task" from the editor no longer 404s, and the task detail keeps its expanded step, active tab, and scroll position.',
        vi: 'Nút "Back to task" trong editor không còn lỗi 404, và phần chi tiết task giữ nguyên bước đang mở, tab và vị trí cuộn.',
      },
      {
        kind: 'fixed',
        en: 'Session replies no longer duplicate their tail when streaming finishes, and long tool lists, URLs, and paths wrap instead of overflowing the chat column.',
        vi: 'Câu trả lời trong Session không còn lặp đuôi khi stream xong, và danh sách tool, URL, đường dẫn dài tự xuống dòng thay vì tràn cột chat.',
      },
    ],
  },
  {
    version: '0.3.1',
    date: '2026-06-04',
    highlight: {
      en: 'First stable cross-platform builds — native installers for Windows, macOS, and Linux.',
      vi: 'Bản stable đa nền tảng đầu tiên — installer cho Windows, macOS và Linux.',
    },
    items: [
      {
        kind: 'added',
        en: 'Native installers built by CI: Windows (.msi/.exe), macOS (.dmg, Apple Silicon + Intel), Linux (.deb/.AppImage).',
        vi: 'Installer dựng bởi CI: Windows (.msi/.exe), macOS (.dmg, Apple Silicon + Intel), Linux (.deb/.AppImage).',
      },
    ],
  },
  {
    version: '0.3.0',
    date: '2026-06-04',
    highlight: {
      en: 'The Task & Workflow engine, a Monaco code workspace, Connections, and multi-provider agents.',
      vi: 'Engine Task & Workflow, code workspace Monaco, Connections, và agent đa provider.',
    },
    items: [
      {
        kind: 'added',
        en: 'Task & Workflow execution engine: design agent pipelines as a DAG and run them with approval gates.',
        vi: 'Engine chạy Task & Workflow: thiết kế pipeline agent dạng DAG và chạy với cổng phê duyệt.',
      },
      {
        kind: 'added',
        en: 'Project code workspace with a multi-tab Monaco editor.',
        vi: 'Code workspace cho project với Monaco editor đa tab.',
      },
      {
        kind: 'added',
        en: 'Connections (formerly MCP Servers) for stdio/HTTP tools, with secrets in the OS keychain.',
        vi: 'Connections (trước là MCP Servers) cho tool stdio/HTTP, secret lưu trong keychain hệ điều hành.',
      },
      {
        kind: 'added',
        en: 'Per-agent LLM provider and account picker — Anthropic today, OpenAI and Google coming next.',
        vi: 'Chọn LLM provider và account cho từng agent — hiện Anthropic, OpenAI và Google sắp tới.',
      },
      {
        kind: 'added',
        en: 'Session resume and compaction for long-running conversations.',
        vi: 'Resume session và nén ngữ cảnh cho hội thoại dài.',
      },
      {
        kind: 'changed',
        en: 'Agents are now defined purely by their system prompt; skills are applied per step in Workflows.',
        vi: 'Agent giờ chỉ định nghĩa bằng system prompt; skills áp dụng theo từng bước trong Workflows.',
      },
      {
        kind: 'improved',
        en: 'Git Manager discovers multiple repositories inside a single project.',
        vi: 'Git Manager tự phát hiện nhiều repo trong cùng một project.',
      },
      {
        kind: 'added',
        en: 'Background-base theme presets: GitHub Dark and Subtle Purple.',
        vi: 'Theme preset theo nền: GitHub Dark và Subtle Purple.',
      },
      {
        kind: 'added',
        en: 'Claude Opus 4.8 model with 1M-token context.',
        vi: 'Model Claude Opus 4.8 với context 1M token.',
      },
      {
        kind: 'improved',
        en: 'Icon-only "New" button across list pages and borderless session chips.',
        vi: 'Nút "New" chỉ icon trên các trang danh sách và chip session bỏ viền.',
      },
      {
        kind: 'improved',
        en: 'Copy and expand actions on code blocks inside replies.',
        vi: 'Thêm nút sao chép và phóng to cho code block trong câu trả lời.',
      },
    ],
  },
  {
    version: '0.2.0',
    date: '2026-05-12',
    highlight: {
      en: 'Full Git Manager and the Session Workspace Panel land.',
      vi: 'Ra mắt Git Manager đầy đủ và Workspace Panel cho Session.',
    },
    items: [
      {
        kind: 'added',
        en: 'Git Manager (Sublime Merge-style): stage, commit, branch, stash, remotes, and tags.',
        vi: 'Git Manager (kiểu Sublime Merge): stage, commit, branch, stash, remote và tag.',
      },
      {
        kind: 'added',
        en: 'Session Workspace Panel with Diff, Files, Plan, Terminal, Tasks, and Preview tabs.',
        vi: 'Workspace Panel cho Session với tab Diff, Files, Plan, Terminal, Tasks và Preview.',
      },
      {
        kind: 'added',
        en: 'Integrated PTY terminal running in the sidecar.',
        vi: 'Terminal PTY tích hợp chạy trong sidecar.',
      },
      {
        kind: 'improved',
        en: 'Filesystem watcher auto-refreshes the UI when workspace files change outside the app.',
        vi: 'Filesystem watcher tự động làm mới UI khi file workspace đổi bên ngoài app.',
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-04-08',
    highlight: {
      en: 'The first foundation: Agents, Skills, MCP Servers, and sign-in.',
      vi: 'Nền tảng đầu tiên: Agents, Skills, MCP Servers và đăng nhập.',
    },
    items: [
      {
        kind: 'added',
        en: 'Agents (AGENT.md) with runtime system prompt, tools, skills, and MCP injection.',
        vi: 'Agents (AGENT.md) với system prompt, tools, skills và MCP inject lúc chạy.',
      },
      {
        kind: 'added',
        en: 'Skills (SKILL.md) with chat-driven creation.',
        vi: 'Skills (SKILL.md) với khả năng tạo qua hội thoại.',
      },
      {
        kind: 'added',
        en: 'MCP Servers over stdio and HTTP, with secrets stored in the OS keychain.',
        vi: 'MCP Servers qua stdio và HTTP, lưu secret trong keychain hệ điều hành.',
      },
      {
        kind: 'added',
        en: 'OAuth sign-in and persistent Sessions.',
        vi: 'Đăng nhập OAuth và Sessions lưu bền.',
      },
    ],
  },
]

export const CURRENT_VERSION: string = CHANGELOG[0]?.version ?? '0.0.0'
