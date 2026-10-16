// Shared contracts for the Session Workbench (ADR 0098). Slices B–F import these;
// do not extend without updating the task spec.

export type WorkbenchDocKind =
  | 'chat'
  | 'file'
  | 'md'
  | 'web'
  | 'img'
  | 'vid'
  | 'mmd'
  | 'diff'
  // Git Log kiểu JetBrains (graph + file đổi + chi tiết commit) — id `gitlog:<pid>`.
  | 'gitlog'
  // Diff một file TRONG một commit — id `cdiff:<pid>/<sha>/<rel>`.
  | 'cdiff'
  | 'settings'
  | 'monitor'
  | 'task'

export interface WorkbenchDoc {
  kind: WorkbenchDocKind
  /** stable id — file path for file docs, `web-<tabId>`, `chat`, `settings`, … */
  id: string
  title: string
  pin?: boolean
  dirty?: boolean
  /** doc 'web': id of the agent browser tab (useEmbeddedBrowser) */
  browId?: string
  /** doc 'settings': active nav section */
  nav?: string
  /** doc 'file': cursor/scroll restore */
  viewState?: { line?: number; col?: number }
  /** doc 'file' mở file TUYỆT ĐỐI ngoài mọi project (id `abs:<path>`): root =
      thư mục cha để fs.* qua được assertInsideWorkspace, rel = basename. */
  root?: string
  rel?: string
  /** doc 'gitlog': commit được chọn sẵn khi mở (SHA đầy đủ) — click commit ở SCM. */
  focusSha?: string
}

export type DockView = 'Terminal' | 'Tasks' | 'Cost' | 'Info' | 'Team'
export type SideView = 'files' | 'scm' | 'gh' | 'sessions' | 'issues'

export interface TermTab {
  id: string
  title: string
  cwd: string
  /** sidecar PTY id once spawned (lazy on first show) */
  ptyId?: string
}
