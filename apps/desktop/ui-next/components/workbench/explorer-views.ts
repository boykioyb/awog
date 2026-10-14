// Danh sách view của Explorer Workbench (ADR 0098) — MỘT nguồn cho cả dải chọn view
// ở đầu panel (WorkbenchExplorer) lẫn rail mini khi panel thu gọn (WorkbenchView).
// Trước đây rail mini chép tay một bản riêng 3 icon nên khi thêm view "Phiên" thì
// thu gọn panel là mất đường vào view đó.
export type ExplorerViewId = 'sessions' | 'files' | 'scm' | 'gh'

export type ExplorerView = {
  id: ExplorerViewId
  title: string
  // SVG hằng số (không phải input) — render bằng v-html ở hai nơi dùng.
  icon: string
}

export const EXPLORER_VIEWS: readonly ExplorerView[] = [
  {
    id: 'sessions',
    title: 'Phiên — danh sách phiên của project',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  },
  {
    id: 'files',
    title: 'Explorer ⌘B',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  },
  {
    id: 'scm',
    title: 'Source Control ⇧⌘G',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9"/></svg>',
  },
  {
    id: 'gh',
    title: 'GitHub — PR · Issues',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>',
  },
]
