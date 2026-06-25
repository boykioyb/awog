// View shapes + small presentation helpers for the Projects page. The visual
// components (ProjectList / ProjectOverview) bind a derived `ProjectView` rather
// than the raw entity so the prototype markup stays unchanged; the page-controller
// (useProjectsPage) builds a ProjectView per selected project from the live stores
// (entity + git repos + agents/sessions/tasks). GitHub issues/PRs are NOT part of
// this shape — they're fetched live via useProjectGh.

export type ProjectViewStatus = 'active' | 'idle'

export type ProjectRepo = {
  n: string
  br: string
  dirty?: number
  ahead?: number
  gh?: string
}

export type ProjectViewSession = { t: string; w: string }
export type ProjectViewTask = { t: string; s: string }

// Compact view-model the master list + overview tab render. Derived from the real
// Project entity + live stores by the page-controller.
export type ProjectView = {
  id: string
  name: string
  path: string
  status: ProjectViewStatus
  gh: string | null
  repos: ProjectRepo[]
  agents: string[]
  ses: ProjectViewSession[]
  tasks: ProjectViewTask[]
}

// Agent badge colors + 2-letter avatar. Exact hex from the prototype (AGCOL).
export const AGCOL: Record<string, [string, string]> = {
  'tech-lead': ['#a78bfa', 'TL'],
  developer: ['#6ee7b7', 'DV'],
  infosec: ['#fca5a5', 'IS'],
  'qa-tester': ['#fcd34d', 'QA'],
  'product-owner': ['#93c5fd', 'PO'],
  'code-reviewer': ['#f0abfc', 'CR'],
  'business-analyst': ['#7dd3fc', 'BA'],
  'project-manager': ['#fdba74', 'PM'],
}

export function agBadge(a: string): [string, string] {
  return AGCOL[a] ?? ['var(--textMuted)', a.slice(0, 2).toUpperCase()]
}

// color-mix(in srgb, <c> 16%, transparent) for the agent avatar background.
export function avatarBg(color: string): string {
  return `color-mix(in srgb, ${color} 16%, transparent)`
}

// Parse `owner/repo` from a git remote URL (SSH or HTTPS, only github.com), or
// null when the remote is absent / non-GitHub. Drives the overview "remote" row
// + the GH tab visibility.
export function githubSlugFromRemote(remote: string): string | null {
  const url = (remote ?? '').trim()
  if (!url) return null
  const strip = (s: string): string => (s.endsWith('.git') ? s.slice(0, -4) : s)
  // git@github.com:owner/repo(.git)
  const ssh = /^git@github\.com:(.+?)\/([^/]+?)\/?$/.exec(url)
  if (ssh && ssh[1] && ssh[2]) return `${ssh[1]}/${strip(ssh[2])}`
  // https://github.com/owner/repo(.git)
  const https = /^https?:\/\/(?:www\.)?github\.com\/(.+?)\/([^/]+?)\/?$/.exec(url)
  if (https && https[1] && https[2]) return `${https[1]}/${strip(https[2])}`
  return null
}
