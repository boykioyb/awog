import type { Project } from '~/types'

export interface ProjectEditorDraft {
  name: string
  path: string
  description: string
  gitRemote: string
  gitBranch: string
  language: string
}

export type ProjectEditorSavePayload =
  | { kind: 'link'; data: ProjectEditorDraft }
  | { kind: 'clone'; data: ProjectEditorDraft }
  | { kind: 'update'; project: Project }
