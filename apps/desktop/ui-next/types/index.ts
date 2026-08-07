// Shared entity types for ui-next. Ported from apps/desktop/ui/types/index.ts —
// only the shapes the git store + useGitApi consume (kept minimal on purpose).

export type ProviderName = 'anthropic' | 'openai' | 'google'

export type ThinkingLevel = 'low' | 'medium' | 'high' | 'extra-high' | 'max'

// Status of one checklist row (mirrors the sidecar TodoItem union in
// sidecar/src/types/shared.ts). Declared HERE, not in a composable/store: both the
// sessions domain (`Todo`) and the tasks store (`TodoItem`) build on it, and those
// two dirs are auto-import roots — exporting the same name from both makes Nuxt
// pick one at random and warn about the duplicate.
export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface ProjectLlmDefaults {
  provider: ProviderName
  modelId: string
  // undefined = follow the global default (Settings → Defaults → thinkingLevel).
  // Pinned only when the project intentionally overrides the global level, so
  // changing the global default later still propagates to non-pinned projects.
  level?: ThinkingLevel
  accountId?: string
  // MCP server ids new sessions opt into. Mirrors `Session.mcpServerIds`:
  // undefined = all currently enabled servers (default); [] = none; [id…] =
  // whitelist.
  mcpServerIds?: string[]
  // Response style (ADR 0046) new sessions inherit. Mirrors SessionSettings:
  // undefined = "Normal" (no style). `responseStyleNoMarkdown` strips markdown.
  responseStyle?: string
  responseStyleNoMarkdown?: boolean
}

export interface Project {
  id: string
  name: string
  path: string
  description: string
  gitRemote: string
  gitBranch: string
  language: string
  createdAt: string
  color?: string
  // Session LLM defaults (provider/account/model/effort) for this project. New
  // sessions inherit these; undefined = use the global app defaults.
  llmDefaults?: ProjectLlmDefaults
  // GitHub (gh CLI) account this project authenticates as — for git
  // push/fetch/pull AND the GH Issues/PR tabs. '' = active gh account; undefined
  // = inherit the app-level default (settings.githubAccount); a login pins it.
  githubAccount?: string
}

// A git repo discovered inside a project folder. A project may be a container
// holding several repos in subfolders — surfaced via `git.discoverRepos` so the
// Git header can show a repo picker. Mirror of sidecar GitRepoEntry.
export type GitRepoEntry = {
  path: string
  name: string
  relativePath: string
  isRoot: boolean
}

export interface ProjectsListResponse {
  projects: Project[]
}
