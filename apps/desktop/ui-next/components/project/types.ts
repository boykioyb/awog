import type { Project } from '~/types'

// Editor draft fields (link / clone / edit share the same form). Mirrors the old
// UI ProjectEditorDraft.
export interface ProjectEditorDraft {
  name: string
  path: string
  description: string
  gitRemote: string
  gitBranch: string
  language: string
}

// Save payload the editor emits — discriminated by the operation.
export type ProjectEditorSavePayload =
  | { kind: 'link'; data: ProjectEditorDraft }
  | { kind: 'clone'; data: ProjectEditorDraft }
  | { kind: 'update'; project: Project }
