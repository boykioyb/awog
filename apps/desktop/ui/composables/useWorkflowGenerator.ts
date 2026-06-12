// Workflow draft generator. Tries the real LLM via the sidecar
// (`workflows.generate` → claude-agent-sdk one-shot) given the agents the
// workflow may use; falls back to a local name/description-only draft (empty
// DAG) when no sidecar / no active account (browser dev, or before the user
// connected an Anthropic account).

import type { Agent, WorkflowEdge, WorkflowNode } from '~/types'
import { STOP_WORDS } from '~/utils/stop-words'

export interface WorkflowDraft {
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

interface GenNode {
  id: string
  agentId: string
  skillId: string
  outputs: string[]
  approval: boolean
}

interface GenerateResponse {
  workflow: {
    name: string
    description: string
    nodes: GenNode[]
    edges: { from: string; to: string }[]
  }
}

const titleize = (prompt: string): string => {
  const firstLine = prompt.split('\n')[0] ?? ''
  const words = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .slice(0, 5)
  return words.length
    ? words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ')
    : 'New Workflow'
}

const firstSentence = (prompt: string): string => {
  const m = prompt.match(/^[^.!?\n]+[.!?]?/)
  return m ? m[0].trim() : prompt.slice(0, 140)
}

const mockDraft = (prompt: string): WorkflowDraft => ({
  name: titleize(prompt),
  description: firstSentence(prompt),
  nodes: [],
  edges: [],
})

// Layered DAG layout: x by rank (longest path from a root), y by order within a
// rank. Keeps generated graphs readable on the canvas.
const layout = (
  nodeIds: string[],
  edges: WorkflowEdge[],
): Record<string, { x: number; y: number }> => {
  const inDeg = new Map<string, number>()
  const adj = new Map<string, string[]>()
  nodeIds.forEach((id) => {
    inDeg.set(id, 0)
    adj.set(id, [])
  })
  edges.forEach((e) => {
    if (!inDeg.has(e.from) || !inDeg.has(e.to)) return
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1)
    adj.get(e.from)?.push(e.to)
  })
  const rank = new Map<string, number>()
  const queue: string[] = []
  inDeg.forEach((deg, id) => {
    if (deg === 0) {
      rank.set(id, 0)
      queue.push(id)
    }
  })
  while (queue.length) {
    const id = queue.shift() as string
    const r = rank.get(id) ?? 0
    ;(adj.get(id) ?? []).forEach((next) => {
      rank.set(next, Math.max(rank.get(next) ?? 0, r + 1))
      const d = (inDeg.get(next) ?? 1) - 1
      inDeg.set(next, d)
      if (d === 0) queue.push(next)
    })
  }
  const rowByRank = new Map<number, number>()
  const pos: Record<string, { x: number; y: number }> = {}
  nodeIds.forEach((id) => {
    const r = rank.get(id) ?? 0
    const row = rowByRank.get(r) ?? 0
    rowByRank.set(r, row + 1)
    pos[id] = { x: 60 + r * 260, y: 60 + row * 130 }
  })
  return pos
}

export const useWorkflowGenerator = (getAgents: () => Agent[]) => {
  const isGenerating = ref(false)
  const error = ref<string | null>(null)
  const sidecar = useSidecar()
  const settings = useSettingsStore()
  const workspace = useWorkspaceStore()

  // Map the LLM's node refs into real WorkflowNodes: resolve each agent's
  // source/projectId from the available list, validate the skill belongs to the
  // agent, drop nodes referencing unknown agents, then lay out x/y.
  const toDraft = (res: GenerateResponse['workflow']): WorkflowDraft => {
    const byId = new Map(getAgents().map((a) => [a.id, a]))
    const kept = res.nodes
      .map((gen) => ({ gen, agent: byId.get(gen.agentId) }))
      .filter((x): x is { gen: GenNode; agent: Agent } => !!x.agent)
    const keptIds = new Set(kept.map((k) => k.gen.id))
    const edges: WorkflowEdge[] = res.edges.filter((e) => keptIds.has(e.from) && keptIds.has(e.to))
    const pos = layout(
      kept.map((k) => k.gen.id),
      edges,
    )
    const nodes: WorkflowNode[] = kept.map(({ gen, agent }) => {
      // Skills are independent of agents — accept any generated skill id that
      // exists in the workspace, else leave the node skill empty.
      const skillId = workspace.skills.some((s) => s.id === gen.skillId) ? gen.skillId : ''
      const node: WorkflowNode = {
        id: gen.id,
        agentId: agent.id,
        skillId,
        x: pos[gen.id]?.x ?? 60,
        y: pos[gen.id]?.y ?? 60,
        outputs: gen.outputs.length ? gen.outputs : ['output.md'],
        approval: gen.approval,
      }
      if (agent.source) node.agentSource = agent.source
      if (agent.projectId) node.agentProjectId = agent.projectId
      return node
    })
    return { name: res.name, description: res.description, nodes, edges }
  }

  const generate = async (prompt: string): Promise<WorkflowDraft | null> => {
    const trimmed = prompt.trim()
    if (!trimmed) {
      error.value = 'Prompt cannot be empty'
      return null
    }
    isGenerating.value = true
    error.value = null
    try {
      const account = settings.activeAccount('anthropic')
      if (!sidecar.available || !account) {
        await new Promise<void>((r) => {
          setTimeout(r, 350)
        })
        return mockDraft(trimmed)
      }
      const availableAgents = getAgents().map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        // Tag tier so the model prefers project agents over global ones.
        scope: a.source === 'project' ? 'project' : 'global',
      }))
      // Skills are independent of agents now — the generator picks a node skill
      // from the full workspace skill list.
      const availableSkills = workspace.skills.map((s) => ({ id: s.id, name: s.name }))
      try {
        const res = await sidecar.request<GenerateResponse>('workflows.generate', {
          prompt: trimmed,
          accountId: account.id,
          availableAgents,
          availableSkills,
        })
        return toDraft(res.workflow)
      } catch (err) {
        console.warn('[workflows] LLM generate failed, falling back to mock', err)
        error.value = err instanceof Error ? err.message : String(err)
        return mockDraft(trimmed)
      }
    } finally {
      isGenerating.value = false
    }
  }

  return { generate, isGenerating, error }
}
