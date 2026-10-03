import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'
import type { ProviderName } from '~/stores/settings'

// Agents store — dual-path live (AGENT.md 5-tier → 2-tier global/project, ADR
// 0015/0035). When the Electron bridge is available `loadAgents()` scans the
// global tier + every passed project tier over IPC, and an `agents.fs-changed`
// subscription re-hydrates when files are touched outside the app; without the
// bridge the list stays empty (no seed data). Mirrors stores/skills.ts (the
// reference library store): inline slice types, readonly-state + named async
// actions.
//
// COMPAT: the Home dashboard (composables/useHomeDashboard.ts) consumes the
// `agents` list as a roster of { id, name, model, role } via the `roster`
// getter, plus `agentById`, `loaded`, `available`, `loadAgents`. Those are kept
// stable here while the richer Agent slice + CRUD live alongside.

export type AgentSource = 'global' | 'project'
// ProviderName is owned by stores/settings.ts (single auto-import source). It is
// imported (not re-exported) so the Agent type can reference it; consumers that
// need it directly import from `~/stores/settings`.

// Full Agent entity (mirror of sidecar Agent — apps/desktop/sidecar/src/types/
// shared.ts). NOT imported from the sidecar package; the store owns its own
// minimal slice.
export type Agent = {
  id: string
  source: AgentSource
  projectId?: string
  name: string
  description: string
  // LLM provider this agent runs on (ADR 0026). Default 'anthropic'.
  provider: ProviderName
  // Optional per-agent account (id in credentials.json). Undefined = use the
  // provider's active account.
  accountId?: string
  model: string
  systemPrompt: string
  role: string
  // SDK tool whitelist (Read/Write/Edit/Bash/Grep/… + `mcp__<id>` entries).
  // Empty/undefined = full toolset.
  tools?: string[]
  // Per-agent MCP server whitelist (ADR 0016). Empty/undefined = inherit session.
  mcpServerIds?: string[]
  // Per-agent skill whitelist — the <available_skills> catalogue is filtered to
  // these ids; on the Claude SDK path the `skills` option is narrowed to match.
  // Empty/undefined = all in-scope skills.
  skillIds?: string[]
  // Repos the agent may touch (absolute paths — a project root or a repo inside
  // a multi-repo container). Empty/undefined = unrestricted (session workspace).
  repos?: string[]
}

// Roster row the Home dashboard binds to (id/name/model/role display strings).
export type AgentRoster = {
  id: string
  name: string
  model: string
  role: string
}

// Per-tier scan report (1 entry per scanned dir). Surfaces resolved paths +
// counts so a misconfigured HOME / missing dir is diagnosable.
export type AgentScanReport = {
  dir: string
  source: AgentSource
  found: number
}

// Draft a save accepts — the full Agent shape (storage metadata + content).
export type AgentInput = Agent

// Draft mà agents.generate trả về (không source/projectId — caller giữ tier).
export type AgentDraftResult = {
  id: string
  name: string
  description: string
  model: string
  systemPrompt: string
  role: string
  mcpServerIds?: string[]
  skillIds?: string[]
  repos?: string[]
  tools?: string[]
}

type AgentsListResponse = { agents: Agent[]; reports?: AgentScanReport[] }
type AgentUpsertResponse = { agent: Agent }

// Composite identity — an agent is keyed by (source, projectId, id) so a project
// agent and a global agent can share an id without colliding.
const matchKey = (a: Agent, b: { source: AgentSource; projectId?: string; id: string }): boolean =>
  a.source === b.source &&
  (a.projectId ?? undefined) === (b.projectId ?? undefined) &&
  a.id === b.id

export const useAgentsStore = defineStore('agents', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const agents = ref<Agent[]>([])
  const scanReports = ref<AgentScanReport[]>([])
  const loaded = ref(false)

  let unlisten: UnlistenFn | null = null

  // Stable composite key for list selection / dedupe.
  const agentKey = (a: Pick<Agent, 'id' | 'source' | 'projectId'>): string =>
    `${a.source}|${a.projectId ?? ''}|${a.id}`

  const agentByKey = (key: string): Agent | undefined =>
    agents.value.find((a) => agentKey(a) === key)

  // Dashboard roster — { id, name, model, role } display rows. Kept as a getter
  // so useHomeDashboard keeps consuming the same shape after this expansion.
  const roster = computed<AgentRoster[]>(() =>
    agents.value.map((a) => ({
      id: a.id,
      name: a.name || a.id,
      model: a.model ?? '',
      role: a.role ?? '',
    })),
  )

  // COMPAT getter for the dashboard (it reads agents.agentById(id) → AgentRoster).
  const agentById = (id: string): AgentRoster | undefined => roster.value.find((a) => a.id === id)

  // Scan the global tier + every passed project tier. Default scope is the global
  // tier only (the page passes projectIds when it has a project roster).
  async function loadAgents(projectIds?: string[]): Promise<void> {
    if (!available.value) {
      loaded.value = true
      return
    }
    try {
      // Pass an explicit object (never `undefined`) — the IPC boundary maps
      // undefined params → null and the sidecar zod schema rejects null.
      const ids = projectIds ?? []
      const params = ids.length > 0 ? { projectIds: ids } : {}
      const res = await sc.request<AgentsListResponse>('agents.list', params)
      agents.value = Array.isArray(res.agents) ? res.agents : []
      scanReports.value = Array.isArray(res.reports) ? res.reports : []
    } catch (err) {
      console.warn('[agents] loadAgents failed', err)
    } finally {
      loaded.value = true
      void subscribe()
    }
  }

  // Create-or-update. `previousId` (set when the slug changed) drives a rename on
  // disk. Returns the persisted agent. Browser-dev mutates the local list only.
  async function saveAgent(data: AgentInput, previousId?: string): Promise<Agent> {
    const slugChanged = previousId !== undefined && previousId !== data.id
    const targetKey = { source: data.source, projectId: data.projectId, id: data.id }
    const isUpdate = slugChanged || agents.value.some((a) => matchKey(a, targetKey))

    if (available.value) {
      const params: Record<string, unknown> = { agent: data, mode: isUpdate ? 'update' : 'create' }
      if (slugChanged) params.previousId = previousId
      const res = await sc.request<AgentUpsertResponse>('agents.upsert', params)
      if (slugChanged) {
        agents.value = agents.value.filter(
          (a) =>
            !matchKey(a, {
              source: data.source,
              projectId: data.projectId,
              id: previousId as string,
            }),
        )
      }
      // Wholesale replace — res.agent is authoritative. Object.assign would
      // leave cleared optional fields (skillIds/tools/repos/mcpServerIds —
      // the serializer drops empty keys) lingering on the store object.
      const idx = agents.value.findIndex((a) => matchKey(a, res.agent))
      if (idx >= 0) agents.value.splice(idx, 1, res.agent)
      else agents.value.push(res.agent)
      return res.agent
    }

    // No bridge: keep the change in memory only.
    if (slugChanged) {
      agents.value = agents.value.filter(
        (a) =>
          !matchKey(a, {
            source: data.source,
            projectId: data.projectId,
            id: previousId as string,
          }),
      )
    }
    const idx = agents.value.findIndex((a) => matchKey(a, targetKey))
    if (idx >= 0) agents.value.splice(idx, 1, { ...data })
    else agents.value.push({ ...data })
    return data
  }

  async function deleteAgent(id: string, source: AgentSource, projectId?: string): Promise<void> {
    // Optimistic local removal (re-hydrate corrects it on fs-changed).
    agents.value = agents.value.filter((a) => !matchKey(a, { id, source, projectId }))
    if (!available.value) return
    try {
      const params: Record<string, unknown> = { id, source }
      if (projectId) params.projectId = projectId
      await sc.request('agents.delete', params)
    } catch (err) {
      console.warn('[agents] deleteAgent failed', err)
    }
  }

  // Duplicate an agent into a new slug (`-copy` suffix, deduped). Same tier. The
  // copy is created via saveAgent in create mode.
  async function duplicateAgent(source: Agent): Promise<Agent> {
    const base = `${source.id}-copy`
    let candidate = base
    let n = 2
    while (
      agents.value.some((a) =>
        matchKey(a, { source: source.source, projectId: source.projectId, id: candidate }),
      )
    ) {
      candidate = `${base}-${n}`
      n += 1
    }
    const copy: AgentInput = { ...source, id: candidate, name: `${source.name} (Copy)` }
    return saveAgent(copy)
  }

  // One-shot LLM draft/revision from a natural-language prompt (agents.generate).
  // Returns a draft (no `source`/`projectId` — the caller preserves the tier).
  // `catalogs` feed the model the real pickable values (global skills + tool
  // names) so it can propose valid whitelists instead of guessing ids.
  // Throws on failure so the caller can surface the error.
  async function generateAgent(
    prompt: string,
    accountId: string,
    currentAgent?: Partial<Agent>,
    modelId?: string,
    catalogs?: { skills?: { id: string; name: string }[]; tools?: string[] },
  ): Promise<{ draft: AgentDraftResult; catalogDropped: boolean }> {
    const params: Record<string, unknown> = { prompt, accountId }
    if (currentAgent) params.currentAgent = currentAgent
    // Model theo cấu hình AI authoring — vắng mặt thì sidecar dùng mặc định.
    if (modelId) params.modelId = modelId
    if (catalogs) params.catalogs = catalogs
    const res = await sc.request<{ agent: AgentDraftResult; catalogDropped?: boolean }>(
      'agents.generate',
      params,
    )
    // catalogDropped=true: provider đã chặn request do catalog skills → sidecar
    // retry không kèm danh sách, nên draft không có gợi ý skillIds.
    return { draft: res.agent, catalogDropped: res.catalogDropped === true }
  }

  // agents.export — raw AGENT.md của các agent được chọn, trả {name, content}[]
  // để UI zip + lưu (utils/export). Throw khi không agent nào tồn tại.
  async function exportAgents(
    refs: { id: string; source?: AgentSource; projectId?: string }[],
  ): Promise<{ name: string; content: string }[]> {
    const res = await sc.request<{ files?: { name: string; content: string }[] }>('agents.export', {
      agents: refs,
    })
    return res?.files ?? []
  }

  // agents.run — DISPATCH một agent spec thành phiên thật trên project đích
  // (giao việc cho agent; session là instance do dispatch materialize — xem
  // sidecar agents.run). Trả về sessionId của phiên vừa tạo.
  // `origin: 'board'` đánh dấu phiên lone-agent do một board item dispatch —
  // danh sách session ẩn nó (việc ê-kíp sống trong board UI); "chat với agent"
  // ở trang Agents không gửi nên phiên đó vẫn hiện thường.
  async function runAgent(
    agent: Agent,
    projectId: string | null,
    settings: {
      provider: string
      modelId: string
      level?: string
      mode?: string
      accountId?: string
    },
    title?: string,
    origin?: 'board',
  ): Promise<{ sessionId: string } | null> {
    if (!available.value) return null
    try {
      return await sc.request<{ sessionId: string }>('agents.run', {
        agent: {
          id: agent.id,
          source: agent.source,
          ...(agent.projectId ? { projectId: agent.projectId } : {}),
        },
        projectId,
        settings,
        ...(title ? { title } : {}),
        ...(origin ? { origin } : {}),
      })
    } catch (err) {
      // KHÔNG nuốt — caller toast message thật qua sidecarErrorText.
      console.warn('[agents] agents.run failed', err)
      throw err
    }
  }

  async function subscribe(): Promise<void> {
    if (!available.value || unlisten) return
    try {
      unlisten = await sc.onEvent((evt) => {
        if (!evt || evt.type !== 'agents.fs-changed') return
        // Re-hydrate against the same project scope we last loaded. Project ids
        // are derived from the current list so the scan stays consistent.
        const ids = Array.from(
          new Set(agents.value.filter((a) => a.projectId).map((a) => a.projectId as string)),
        )
        void loadAgents(ids)
      })
    } catch {
      unlisten = null
    }
  }

  return {
    // state
    agents,
    scanReports,
    loaded,
    available,
    // getters
    roster,
    agentKey,
    agentByKey,
    agentById,
    // actions
    loadAgents,
    saveAgent,
    deleteAgent,
    exportAgents,
    duplicateAgent,
    generateAgent,
    runAgent,
  }
})
