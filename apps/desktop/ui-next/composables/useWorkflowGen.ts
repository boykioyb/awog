import { computed, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import { useSettingsStore } from '~/stores/settings'
import {
  useWorkflowsStore,
  type GenNode,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowSource,
} from '~/stores/workflows'

// Workflow agent/skill data + draft generator. Owns its own minimal agent/skill
// slices fetched directly over IPC (agents.list / skills.list) — does NOT import
// the agents/skills stores (those are owned by sibling features). Mirrors the old
// UI useWorkflowGenerator: try the real LLM via the sidecar; fall back to a local
// name/description-only draft (empty DAG) when no sidecar / no active account.
//
// node.skillId scope: skills are listed PER project tier (the page passes the
// project roster it loaded), not the union of every project — preserve that.

// Minimal agent slice the palette + node picker need (id/name/role/source/
// projectId). NOT the full Agent type — the agents store owns that.
export type WorkflowAgent = {
  id: string
  name: string
  role: string
  source: WorkflowSource
  projectId?: string
}

// Minimal skill slice for the node skill picker.
export type WorkflowSkill = {
  id: string
  name: string
  description: string
  source: WorkflowSource
  projectId?: string
}

export type WorkflowDraft = {
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

type AgentsListResponse = {
  agents: { id: string; name: string; role: string; source: WorkflowSource; projectId?: string }[]
}
type SkillsListResponse = {
  skills: {
    id: string
    name: string
    description: string
    source: WorkflowSource
    projectId?: string
  }[]
}

// Title from the first prompt line (Title Case, ≤ 6 words). KISS — no stop-word
// list (the ui-next surface has none); the LLM path supplies a real name anyway.
const titleize = (prompt: string): string => {
  const words = (prompt.split('\n')[0] ?? '')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
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
    pos[id] = { x: 60 + r * 280, y: 60 + row * 140 }
  })
  return pos
}

export function useWorkflowGen() {
  const sc = useSidecar()
  const settings = useSettingsStore()
  const store = useWorkflowsStore()

  const agents = ref<WorkflowAgent[]>([])
  const skills = ref<WorkflowSkill[]>([])

  // Provider-agnostic creator account (mirrors Sessions' default resolution); null
  // → generate() falls back to a local mock draft.
  const accountId = computed(() => settings.resolveCreatorAccount().accountId)

  // Load the agent + skill rosters for the palette / node picker, scoped to the
  // passed project ids (global tier always included). node.skillId scope is
  // preserved: only these projects' skills are offered.
  async function loadRosters(projectIds: string[]): Promise<void> {
    if (!sc.available) return
    try {
      const params = projectIds.length > 0 ? { projectIds } : {}
      const [a, s] = await Promise.all([
        sc.request<AgentsListResponse>('agents.list', params),
        sc.request<SkillsListResponse>('skills.list', params),
      ])
      agents.value = Array.isArray(a.agents)
        ? a.agents.map((x) => ({
            id: x.id,
            name: x.name,
            role: x.role ?? '',
            source: x.source,
            ...(x.projectId ? { projectId: x.projectId } : {}),
          }))
        : []
      skills.value = Array.isArray(s.skills)
        ? s.skills.map((x) => ({
            id: x.id,
            name: x.name,
            description: x.description ?? '',
            source: x.source,
            ...(x.projectId ? { projectId: x.projectId } : {}),
          }))
        : []
    } catch (err) {
      console.warn('[workflows] loadRosters failed', err)
    }
  }

  // Map the LLM's node refs into real WorkflowNodes: resolve each agent's
  // source/projectId from the scoped list, validate the skill exists, drop nodes
  // referencing unknown agents, then lay out x/y.
  const toDraft = (gen: {
    name: string
    description: string
    nodes: GenNode[]
    edges: WorkflowEdge[]
  }): WorkflowDraft => {
    const byId = new Map(agents.value.map((a) => [a.id, a]))
    const kept = gen.nodes
      .map((g) => ({ g, agent: byId.get(g.agentId) }))
      .filter((x): x is { g: GenNode; agent: WorkflowAgent } => !!x.agent)
    const keptIds = new Set(kept.map((k) => k.g.id))
    const edges = gen.edges.filter((e) => keptIds.has(e.from) && keptIds.has(e.to))
    const pos = layout(
      kept.map((k) => k.g.id),
      edges,
    )
    const nodes: WorkflowNode[] = kept.map(({ g, agent }) => {
      const skillId = skills.value.some((s) => s.id === g.skillId) ? g.skillId : ''
      const node: WorkflowNode = {
        id: g.id,
        agentId: agent.id,
        agentSource: agent.source,
        skillId,
        x: pos[g.id]?.x ?? 60,
        y: pos[g.id]?.y ?? 60,
        outputs: g.outputs.length ? g.outputs : ['output.md'],
        approval: g.approval,
      }
      if (agent.projectId !== undefined) node.agentProjectId = agent.projectId
      return node
    })
    return { name: gen.name, description: gen.description, nodes, edges }
  }

  // Generate a draft. `scopedAgents` / `scopedSkills` are already filtered to the
  // chosen "Save to" tier so a global workflow never references a project-only
  // agent or skill.
  async function generate(
    prompt: string,
    scopedAgents: WorkflowAgent[],
    scopedSkills: WorkflowSkill[],
  ): Promise<WorkflowDraft> {
    const trimmed = prompt.trim()
    if (!trimmed) return mockDraft('')
    const id = accountId.value
    if (!sc.available || !id) {
      await new Promise<void>((r) => setTimeout(r, 250))
      return mockDraft(trimmed)
    }
    try {
      const res = await store.generateWorkflow({
        prompt: trimmed,
        accountId: id,
        availableAgents: scopedAgents.map((a) => ({
          id: a.id,
          name: a.name,
          role: a.role,
          scope: a.source === 'project' ? 'project' : 'global',
        })),
        availableSkills: scopedSkills.map((s) => ({
          id: s.id,
          name: s.name,
          scope: s.source === 'project' ? 'project' : 'global',
        })),
      })
      return toDraft({
        name: res.name,
        description: res.description,
        nodes: res.nodes,
        edges: res.edges,
      })
    } catch (err) {
      console.warn('[workflows] LLM generate failed, falling back to mock', err)
      return mockDraft(trimmed)
    }
  }

  return { agents, skills, accountId, loadRosters, generate }
}
