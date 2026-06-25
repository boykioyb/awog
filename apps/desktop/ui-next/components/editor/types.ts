// Shared types for the editor area (Project Code Workspace + Task Artifact
// Editor). Mirrors the editor slice of apps/desktop/ui/types/index.ts; declared
// here so the editor feature owns its own contract (KISS — ui-next has no central
// editor types file).

// Artifact file kinds the Task Artifact Editor recognizes by extension.
export type EditorFileKind = 'md' | 'diff' | 'yaml'

// View modes for the Task Artifact Editor (code only / split / rendered preview).
export type EditorViewMode = 'code' | 'split' | 'preview'

// Unified-diff summary shown in the top bar for .diff/.patch artifacts.
export interface EditorDiffStats {
  files: number
  additions: number
  deletions: number
}

// One artifact file surfaced in the Task Artifact Editor's file list.
export interface EditorTaskFile {
  // Workspace-relative path (also the model key + display name source).
  path: string
  // Display name (basename of `path`).
  name: string
  kind: EditorFileKind
  // Sub-label: the phase/skill that produced it + run version (best-effort).
  phase?: string
  version?: number
}

// One tab in the Project Code Workspace.
export interface EditorTab {
  path: string
  name: string
  language?: string
  dirty: boolean
}

// Imperative handle the multi-tab MonacoEditor (and its EditorMonacoPane wrapper)
// expose via defineExpose — the page/controller drives tabs through this.
export interface MonacoEditorHandle {
  openFile: (path: string, content: string, language?: string) => void
  closeFile: (path: string) => void
  getValue: (path: string) => string
  setValue: (path: string, content: string) => void
  revealPosition: (path: string, line: number, column: number) => void
  focus: () => void
}
