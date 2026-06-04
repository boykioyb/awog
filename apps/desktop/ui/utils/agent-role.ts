import type { Agent } from '~/types'

// Short role label for an agent's badge. Falls back to initials derived from the
// name (or id) when the agent has no explicit `role`, so the badge is never an
// empty box: "ba" → "BA", "dev" → "DEV", "api-design" → "AD", "code-reviewer" → "CR".
export const agentRoleLabel = (agent: Pick<Agent, 'role' | 'name' | 'id'>): string => {
  const role = (agent.role ?? '').trim()
  if (role) return role
  const base = (agent.name || agent.id || '').trim()
  const parts = base.split(/[-_\s]+/).filter(Boolean)
  if (parts.length >= 2) {
    return parts
      .map((p) => p.charAt(0))
      .join('')
      .slice(0, 3)
      .toUpperCase()
  }
  return (parts[0] ?? base).slice(0, 3).toUpperCase()
}
