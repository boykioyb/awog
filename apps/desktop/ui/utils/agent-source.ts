import type { Agent, AgentSource, Project } from '~/types'

// Tier root paths mirror the on-disk AGENT.md layout (ADR 0035). The global tier
// resolves to a `~`-prefixed path; the project tier resolves through the
// registered project's absolute path (see `agentSourcePath`).
const USER_TIER_PATH: Partial<Record<AgentSource, string>> = {
  global: '~/.awog/agents',
}

/**
 * Full file path of an agent's AGENT.md on disk — the unambiguous "where does
 * this come from" answer for agents that share a name across tiers. The global
 * tier uses the `~`-prefixed root; the project tier resolves through the
 * registered project's absolute path (falls back to a `<project>` placeholder
 * when the project is not in the store).
 */
export const agentSourcePath = (
  agent: Pick<Agent, 'source' | 'projectId' | 'id'>,
  projects: Project[],
): string => {
  const userPrefix = USER_TIER_PATH[agent.source]
  if (userPrefix) return `${userPrefix}/${agent.id}.md`
  const project = agent.projectId ? projects.find((p) => p.id === agent.projectId) : undefined
  const base = project?.path ?? '<project>'
  return `${base}/.awog/agents/${agent.id}.md`
}
