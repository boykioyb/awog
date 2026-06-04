import type { Agent, AgentSource, Project } from '~/types'

// Tier root paths mirror the on-disk AGENT.md layout (ADR 0015). User tiers
// resolve to a `~`-prefixed path; project tiers resolve through the registered
// project's absolute path (see `agentSourcePath`).
const USER_TIER_PATH: Partial<Record<AgentSource, string>> = {
  global: '~/.awog/agents',
  'user-claude': '~/.claude/agents',
  'user-agents': '~/.agents/agents',
}

/**
 * Full file path of an agent's AGENT.md on disk — the unambiguous "where does
 * this come from" answer for agents that share a name across tiers. User tiers
 * use the `~`-prefixed root; project tiers resolve through the registered
 * project's absolute path (falls back to a `<project>` placeholder when the
 * project is not in the store).
 */
export const agentSourcePath = (
  agent: Pick<Agent, 'source' | 'projectId' | 'id'>,
  projects: Project[],
): string => {
  const userPrefix = USER_TIER_PATH[agent.source]
  if (userPrefix) return `${userPrefix}/${agent.id}.md`
  const sub = agent.source === 'project-claude' ? '.claude/agents' : '.agents/agents'
  const project = agent.projectId ? projects.find((p) => p.id === agent.projectId) : undefined
  const base = project?.path ?? '<project>'
  return `${base}/${sub}/${agent.id}.md`
}
