import { defineStore } from 'pinia'
import type {
  Agent,
  AgentSource,
  Command,
  CommandScanReport,
  Hook,
  HookRunRecord,
  HookScanReport,
  HookSource,
  MCPServer,
  Project,
  Rule,
  RuleScanReport,
  Skill,
  SkillSource,
} from '~/types'
import { INITIAL_PROJECTS } from '~/utils/initial-data'
import { INITIAL_HOOKS } from '~/utils/initial-extensions'
import { nowIso } from '~/utils/time'

// Tasks + Workflows moved to their own live stores (stores/tasks.ts,
// stores/workflows.ts) — see ADR 0024. This store keeps projects/agents/skills/
// mcp/hooks/commands.

export interface LinkProjectInput {
  name: string
  path: string
  description: string
  language: string
  gitRemote: string
  gitBranch: string
}

export interface CloneProjectInput {
  name: string
  destPath: string
  gitRemote: string
  description: string
  language: string
}

interface ProjectsListResponse {
  projects: Project[]
}
interface ProjectUpsertResponse {
  project: Project
}
interface ProjectCloneResponse {
  project: Project
}

export interface SkillScanReport {
  dir: string
  source: SkillSource
  found: number
}
interface SkillsListResponse {
  skills: Skill[]
  reports?: SkillScanReport[]
}
interface SkillUpsertResponse {
  skill: Skill
}

export interface AgentScanReport {
  dir: string
  source: AgentSource
  found: number
}

let projectIdCounter = 0
const newProjectId = (): string =>
  `prj-${Date.now().toString(36)}-${(projectIdCounter++).toString(36)}`

// Strip the runtime fields (status / tools / resources / lastError) when sending
// a MCPServer to `mcp.upsert` — the sidecar only persists the config shape and
// rebuilds those fields from the McpManager snapshot on its way back.
const RUNTIME_KEYS: ReadonlyArray<keyof MCPServer> = ['status', 'tools', 'resources', 'lastError']

function stripRuntimeFields(
  s: MCPServer,
): Omit<MCPServer, 'status' | 'tools' | 'resources' | 'lastError'> {
  // Sidecar zod schema accepts the config shape only; rebuild without the
  // runtime fields the manager owns.
  const entries = (Object.keys(s) as Array<keyof MCPServer>)
    .filter((k) => !RUNTIME_KEYS.includes(k))
    .map((k) => [k, s[k]] as const)
  return Object.fromEntries(entries) as Omit<
    MCPServer,
    'status' | 'tools' | 'resources' | 'lastError'
  >
}

export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({
    // Projects hydrate from sidecar (~/.awog/projects/<id>.json). Browser dev
    // (no sidecar) falls back to INITIAL_PROJECTS inside hydrateProjectsFromSidecar.
    projects: [] as Project[],
    // Agents hydrate from sidecar across 5 tiers (mirror Skills). Each file is
    // an AGENT.md (YAML frontmatter + body) compatible with Claude Code SDK
    // subagent format. No mock seed — user creates agents explicitly.
    agents: [] as Agent[],
    // Per-tier scan report (matches Skills). Surfaces resolved paths +
    // scan counts so misconfigured HOME / missing dirs are diagnosable.
    agentScanReports: [] as AgentScanReport[],
    // Skills hydrate from sidecar (~/.awog/skills/<id>/SKILL.md). No mock seed —
    // user creates skills explicitly.
    skills: [] as Skill[],
    // Latest scan report (1 entry per scanned dir + count). Surfaces resolved
    // paths to the UI so misconfigured HOME / missing dirs are diagnosable.
    skillScanReports: [] as SkillScanReport[],
    // MCP servers hydrate from sidecar (`~/.awog/mcp-servers/<id>.json`). No
    // mock seed — empty until `hydrateMcpFromSidecar` populates it.
    mcpServers: [] as MCPServer[],
    // 100-line stderr ring buffer per server id, surfaced in the McpDetail Logs
    // tab. Populated via the `mcp.stderr-line` sidecar event subscription.
    mcpStderr: {} as Record<string, string[]>,
    // Hooks hydrate from sidecar (2-tier per-file JSON, ADR 0032). Browser dev
    // (no sidecar) falls back to INITIAL_HOOKS inside hydrateHooksFromSidecar.
    hooks: [] as Hook[],
    // Per-tier scan report (mirrors skillScanReports) — surfaces resolved dirs +
    // counts in the Hooks refresh toast.
    hookScanReports: [] as HookScanReport[],
    // Rules hydrate from sidecar (2-tier per-file Markdown, ADR 0033). No mock
    // seed — empty until hydrateRulesFromSidecar populates it.
    rules: [] as Rule[],
    ruleScanReports: [] as RuleScanReport[],
    // Slash commands hydrate from sidecar (2-tier per-file Markdown + imported
    // Claude Code commands). No mock seed — empty until hydrateCommandsFromSidecar.
    commands: [] as Command[],
    commandScanReports: [] as CommandScanReport[],
  }),

  getters: {
    projectById:
      (state) =>
      (id: string): Project | undefined =>
        state.projects.find((p: Project) => p.id === id),
    agentById:
      (state) =>
      (id: string): Agent | undefined =>
        state.agents.find((a: Agent) => a.id === id),
    skillById:
      (state) =>
      (id: string): Skill | undefined =>
        state.skills.find((s: Skill) => s.id === id),
  },

  actions: {
    // Project CRUD — persisted via sidecar (~/.awog/projects/<id>.json).
    // Browser dev (no sidecar): keep mock data + local-only mutations.

    async hydrateProjectsFromSidecar(): Promise<void> {
      const sidecar = useSidecar()
      if (!sidecar.available) {
        // Browser dev: seed mock so the UI is browsable without a Tauri shell.
        if (this.projects.length === 0) this.projects = [...INITIAL_PROJECTS]
        return
      }
      try {
        const res = await sidecar.request<ProjectsListResponse>('projects.list')
        this.projects = Array.isArray(res.projects) ? res.projects : []
      } catch (err) {
        console.warn('[workspace] hydrateProjectsFromSidecar failed', err)
      }
    },

    // Register an existing local folder as a project. Sidecar validates the
    // path exists and is a directory; throws an Error the caller surfaces.
    async linkProject(input: LinkProjectInput): Promise<Project> {
      const sidecar = useSidecar()
      const draft: Project = {
        id: newProjectId(),
        name: input.name,
        path: input.path,
        description: input.description,
        gitRemote: input.gitRemote,
        gitBranch: input.gitBranch,
        language: input.language,
        createdAt: nowIso(),
      }
      if (sidecar.available) {
        const res = await sidecar.request<ProjectUpsertResponse>('projects.upsert', {
          project: draft,
          mode: 'create',
        })
        this.projects.unshift(res.project)
        return res.project
      }
      this.projects.unshift(draft)
      return draft
    },

    // Clone a git remote into destPath and register the result. Sidecar runs
    // git clone with arg-array (no shell), enforces remote scheme allowlist,
    // and rejects if destPath already exists.
    async cloneProject(input: CloneProjectInput): Promise<Project> {
      const sidecar = useSidecar()
      const id = newProjectId()
      const createdAt = nowIso()
      if (sidecar.available) {
        const res = await sidecar.request<ProjectCloneResponse>('projects.clone', {
          id,
          name: input.name,
          gitRemote: input.gitRemote,
          destPath: input.destPath,
          description: input.description,
          language: input.language,
          createdAt,
        })
        this.projects.unshift(res.project)
        return res.project
      }
      // Browser dev fallback: pretend the clone succeeded.
      const local: Project = {
        id,
        name: input.name,
        path: input.destPath,
        description: input.description,
        gitRemote: input.gitRemote,
        gitBranch: 'main',
        language: input.language,
        createdAt,
      }
      this.projects.unshift(local)
      return local
    },

    async updateProject(project: Project): Promise<Project> {
      // Replace the array element wholesale (not Object.assign) so a removed
      // optional field — e.g. clearing `llmDefaults` on "reset to app default" —
      // actually disappears from the store, not just from disk.
      const apply = (saved: Project) => {
        const idx = this.projects.findIndex((p: Project) => p.id === saved.id)
        if (idx >= 0) this.projects[idx] = saved
      }
      const sidecar = useSidecar()
      if (sidecar.available) {
        const res = await sidecar.request<ProjectUpsertResponse>('projects.upsert', {
          project,
          mode: 'update',
        })
        apply(res.project)
        return res.project
      }
      apply(project)
      return project
    },

    async deleteProject(id: string): Promise<void> {
      this.projects = this.projects.filter((p: Project) => p.id !== id)
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        await sidecar.request('projects.delete', { id })
      } catch (err) {
        console.warn('[workspace] projects.delete failed', err)
      }
    },

    // Agent CRUD — persisted via sidecar across 2 tiers (mirror Skills, ADR
    // 0035): global / project. Each agent is uniquely identified by (id, source,
    // projectId). Browser dev (no sidecar): local-only mutations so the page
    // stays browsable.

    async hydrateAgentsFromSidecar(projectIds?: string[]): Promise<void> {
      const sidecar = useSidecar()
      // eslint-disable-next-line no-console
      console.log('%c[agents] hydrate begin', 'color: #10b981; font-weight: bold', {
        sidecarAvailable: sidecar.available,
        projectsInStore: this.projects.length,
        projectPaths: this.projects.map((p: Project) => ({ id: p.id, path: p.path })),
      })
      if (!sidecar.available) return
      const ids = projectIds ?? this.projects.map((p: Project) => p.id)
      try {
        const params = ids.length > 0 ? { projectIds: ids } : undefined
        const res = await sidecar.request<{
          agents: Agent[]
          reports?: AgentScanReport[]
        }>('agents.list', params)
        // eslint-disable-next-line no-console
        console.log('%c[agents] hydrate response', 'color: #10b981; font-weight: bold', {
          agentsCount: Array.isArray(res.agents) ? res.agents.length : 'not-an-array',
          reports: res.reports,
          firstAgent: res.agents?.[0] ?? null,
        })
        this.agents = Array.isArray(res.agents) ? res.agents : []
        this.agentScanReports = Array.isArray(res.reports) ? res.reports : []
      } catch (err) {
        console.warn('[agents] hydrate failed', err)
      }
    },

    applyAgentSnapshot(agent: Agent) {
      const matchKey = (a: Agent, b: Pick<Agent, 'id' | 'source' | 'projectId'>) =>
        a.source === b.source &&
        (a.projectId ?? undefined) === (b.projectId ?? undefined) &&
        a.id === b.id
      const idx = this.agents.findIndex((a: Agent) => matchKey(a, agent))
      if (idx >= 0) {
        this.agents[idx] = agent
      } else {
        this.agents.push(agent)
      }
    },

    async saveAgent(data: Agent, previousId?: string): Promise<Agent> {
      const sidecar = useSidecar()
      const matchKey = (a: Agent, b: Pick<Agent, 'id' | 'source' | 'projectId'>) =>
        a.source === b.source &&
        (a.projectId ?? undefined) === (b.projectId ?? undefined) &&
        a.id === b.id
      const slugChanged = previousId !== undefined && previousId !== data.id
      const isUpdate = slugChanged || this.agents.some((a: Agent) => matchKey(a, data))
      if (sidecar.available) {
        const params: Record<string, unknown> = {
          agent: data,
          mode: isUpdate ? 'update' : 'create',
        }
        if (slugChanged) params.previousId = previousId
        const res = await sidecar.request<{ agent: Agent }>('agents.upsert', params)
        if (slugChanged) {
          this.agents = this.agents.filter(
            (a: Agent) =>
              !matchKey(a, {
                source: data.source,
                projectId: data.projectId,
                id: previousId as string,
              }),
          )
        }
        this.applyAgentSnapshot(res.agent)
        return res.agent
      }
      this.applyAgentSnapshot(data)
      return data
    },

    async deleteAgent(id: string, source: Agent['source'], projectId?: string): Promise<void> {
      const sidecar = useSidecar()
      if (sidecar.available) {
        const params: Record<string, unknown> = { id, source }
        if (projectId) params.projectId = projectId
        await sidecar.request('agents.delete', params)
      }
      this.agents = this.agents.filter(
        (a: Agent) =>
          !(a.id === id && a.source === source && (a.projectId ?? undefined) === projectId),
      )
    },

    async duplicateAgent(agent: Agent): Promise<Agent> {
      // Slug uniqueness is per-tier — only check agents in the SAME source+projectId.
      const base = `${agent.id}-copy`
      const taken = new Set(
        this.agents
          .filter(
            (a: Agent) =>
              a.source === agent.source && (a.projectId ?? undefined) === agent.projectId,
          )
          .map((a: Agent) => a.id),
      )
      const candidate = taken.has(base)
        ? (Array.from({ length: 99 }, (_, i: number) => `${base}-${i + 2}`).find(
            (c: string) => !taken.has(c),
          ) ?? `${base}-${Date.now().toString(36)}`)
        : base
      const newAgent: Agent = { ...agent, id: candidate, name: `${agent.name} (Copy)` }
      return this.saveAgent(newAgent)
    },

    // Skill CRUD — persisted via sidecar. Each skill is identified by the
    // tuple (source, projectId, id), so the same slug can live independently
    // in the global and project tiers (ADR 0035). Browser dev (no sidecar):
    // keep local-only mutations so the page is browsable.

    async hydrateSkillsFromSidecar(projectIds?: string[]): Promise<void> {
      const sidecar = useSidecar()
      // eslint-disable-next-line no-console
      console.log('%c[skills] hydrate begin', 'color: #10b981; font-weight: bold', {
        sidecarAvailable: sidecar.available,
        projectsInStore: this.projects.length,
      })
      if (!sidecar.available) return
      // Default: include all registered projects so a fresh /skills page reload
      // sees both user-level dirs and every project's .claude/.agents skills.
      const ids = projectIds ?? this.projects.map((p: Project) => p.id)
      try {
        const params = ids.length > 0 ? { projectIds: ids } : undefined
        const res = await sidecar.request<SkillsListResponse>('skills.list', params)
        // eslint-disable-next-line no-console
        console.log('%c[skills] hydrate response', 'color: #10b981; font-weight: bold', {
          rawKeys: Object.keys(res ?? {}),
          skillsCount: Array.isArray(res.skills) ? res.skills.length : 'not-an-array',
          reportsCount: Array.isArray(res.reports) ? res.reports.length : 'missing',
          reports: res.reports,
          firstSkill: res.skills?.[0] ?? null,
        })
        this.skills = Array.isArray(res.skills) ? res.skills : []
        this.skillScanReports = Array.isArray(res.reports) ? res.reports : []
      } catch (err) {
        console.error('[skills] hydrate failed', err)
      }
    },

    async saveSkill(data: Skill, previousId?: string): Promise<Skill> {
      const sidecar = useSidecar()
      const matchKey = (a: Skill, b: { source: SkillSource; projectId?: string; id: string }) =>
        a.source === b.source &&
        (a.projectId ?? undefined) === (b.projectId ?? undefined) &&
        a.id === b.id
      const slugChanged = previousId !== undefined && previousId !== data.id
      const targetKey = { source: data.source, projectId: data.projectId, id: data.id }
      const isUpdate = slugChanged || this.skills.some((s: Skill) => matchKey(s, targetKey))
      if (sidecar.available) {
        const params: Record<string, unknown> = {
          skill: data,
          mode: isUpdate ? 'update' : 'create',
        }
        if (slugChanged) params.previousId = previousId
        const res = await sidecar.request<SkillUpsertResponse>('skills.upsert', params)
        if (slugChanged) {
          this.skills = this.skills.filter(
            (s: Skill) =>
              !matchKey(s, {
                source: data.source,
                projectId: data.projectId,
                id: previousId as string,
              }),
          )
        }
        const existing = this.skills.find((s: Skill) => matchKey(s, res.skill))
        if (existing) {
          Object.assign(existing, res.skill)
        } else {
          this.skills.push(res.skill)
        }
        return res.skill
      }
      if (slugChanged) {
        this.skills = this.skills.filter(
          (s: Skill) =>
            !matchKey(s, {
              source: data.source,
              projectId: data.projectId,
              id: previousId as string,
            }),
        )
      }
      const existing = this.skills.find((s: Skill) => matchKey(s, targetKey))
      if (existing) {
        Object.assign(existing, data)
      } else {
        this.skills.push({ ...data })
      }
      return data
    },

    async deleteSkill(id: string, source: SkillSource, projectId?: string): Promise<void> {
      this.skills = this.skills.filter(
        (s: Skill) =>
          !(
            s.id === id &&
            s.source === source &&
            (s.projectId ?? undefined) === (projectId ?? undefined)
          ),
      )
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        const params: Record<string, unknown> = { id, source }
        if (projectId) params.projectId = projectId
        await sidecar.request('skills.delete', params)
      } catch (err) {
        console.warn('[workspace] skills.delete failed', err)
      }
    },

    // MCP Server — persisted via sidecar (~/.awog/mcp-servers/<id>.json).
    // Browser dev (no sidecar): keep mock seed so the page is browsable.

    async hydrateMcpFromSidecar(): Promise<void> {
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        const res = await sidecar.request<{ servers: MCPServer[] }>('mcp.list')
        this.mcpServers = Array.isArray(res.servers) ? res.servers : []
      } catch (err) {
        console.warn('[mcp] hydrate failed', err)
      }
    },

    // Filesystem watcher subscribe (Sprint 3 C1). Sidecar emits
    // `agents.fs-changed`, `skills.fs-changed`, `mcp-servers.fs-changed`
    // (debounced 500ms) when files are touched outside the app. We re-hydrate
    // the matching store section so the UI reflects disk truth without the
    // user clicking 🔄. Each store handles its own throttling (re-hydrate
    // returns same data fast if disk hasn't changed). Returns unsubscribe fn.
    async subscribeFsEvents(): Promise<() => void> {
      const sidecar = useSidecar()
      if (!sidecar.available) return () => {}
      try {
        const unlisten = await sidecar.onEvent((evt) => {
          // Fire-and-forget hydrate. Each store action logs its own errors
          // (already wired) so a swallow handler is fine here.
          const swallow = () => {
            // intentional no-op
          }
          if (evt.type === 'agents.fs-changed') {
            this.hydrateAgentsFromSidecar().catch(swallow)
            return
          }
          if (evt.type === 'skills.fs-changed') {
            this.hydrateSkillsFromSidecar().catch(swallow)
            return
          }
          if (evt.type === 'mcp-servers.fs-changed') {
            this.hydrateMcpFromSidecar().catch(swallow)
            return
          }
          if (evt.type === 'hooks.fs-changed') {
            this.hydrateHooksFromSidecar().catch(swallow)
            return
          }
          if (evt.type === 'rules.fs-changed') {
            this.hydrateRulesFromSidecar().catch(swallow)
            return
          }
          if (evt.type === 'commands.fs-changed') {
            this.hydrateCommandsFromSidecar().catch(swallow)
            return
          }
          // Live hook-run audit (ADR 0032): prepend the record to the matching
          // hook's recentRuns so the detail view updates without a refetch.
          if (evt.type === 'hook.run') {
            const p = evt.payload as {
              hookId?: string
              source?: HookSource
              projectId?: string
              record?: HookRunRecord
            }
            if (typeof p.hookId !== 'string' || !p.record) return
            // Match the full (id, source, projectId) — project-tier ids can
            // collide across projects (imported CC hooks), so id-only would
            // attach the record to the wrong hook instance.
            const src = p.source ?? 'global'
            const hook = this.hooks.find(
              (h: Hook) =>
                h.id === p.hookId &&
                (h.source ?? 'global') === src &&
                (h.projectId ?? undefined) === (p.projectId ?? undefined),
            )
            if (!hook) return
            hook.recentRuns.unshift(p.record)
            hook.recentRuns = hook.recentRuns.slice(0, 20)
          }
        })
        return unlisten
      } catch {
        return () => {}
      }
    },

    async subscribeMcpEvents(): Promise<() => void> {
      const sidecar = useSidecar()
      if (!sidecar.available) return () => {}
      try {
        const unlisten = await sidecar.onEvent((evt) => {
          if (evt.type === 'mcp.status') {
            const p = evt.payload as {
              id?: string
              status?: MCPServer['status']
              lastError?: string
              tools?: MCPServer['tools']
              resources?: MCPServer['resources']
              lastStartedAt?: string
            }
            if (typeof p.id !== 'string') return
            const target = this.mcpServers.find((s: MCPServer) => s.id === p.id)
            if (!target) return
            if (p.status) target.status = p.status
            target.lastError = p.lastError
            if (Array.isArray(p.tools)) target.tools = p.tools
            if (Array.isArray(p.resources)) target.resources = p.resources
            return
          }
          if (evt.type === 'mcp.stderr-line') {
            const p = evt.payload as { id?: string; line?: string }
            if (typeof p.id !== 'string' || typeof p.line !== 'string') return
            const ring = this.mcpStderr[p.id] ?? []
            ring.push(p.line)
            if (ring.length > 100) ring.splice(0, ring.length - 100)
            this.mcpStderr[p.id] = ring
          }
        })
        return unlisten
      } catch {
        return () => {}
      }
    },

    applyMcpServerSnapshot(server: MCPServer) {
      const idx = this.mcpServers.findIndex((s: MCPServer) => s.id === server.id)
      if (idx >= 0) {
        this.mcpServers[idx] = server
      } else {
        this.mcpServers.push(server)
      }
    },

    async saveMCPServer(data: MCPServer): Promise<MCPServer> {
      const sidecar = useSidecar()
      const isUpdate = this.mcpServers.some((s: MCPServer) => s.id === data.id)
      if (sidecar.available) {
        const res = await sidecar.request<{ server: MCPServer }>('mcp.upsert', {
          server: stripRuntimeFields(data),
          mode: isUpdate ? 'update' : 'create',
        })
        this.applyMcpServerSnapshot(res.server)
        return res.server
      }
      // Local-only fallback (browser dev).
      const next = { ...data, id: data.id || `mcp${Date.now()}` }
      this.applyMcpServerSnapshot(next)
      return next
    },

    async deleteMCPServer(id: string): Promise<void> {
      const sidecar = useSidecar()
      if (sidecar.available) {
        await sidecar.request('mcp.delete', { id })
      }
      this.mcpServers = this.mcpServers.filter((s: MCPServer) => s.id !== id)
    },

    async toggleMCPServer(id: string): Promise<void> {
      const target = this.mcpServers.find((s: MCPServer) => s.id === id)
      if (!target) return
      const sidecar = useSidecar()
      const nextEnabled = !target.enabled
      if (sidecar.available) {
        const res = await sidecar.request<{ server: MCPServer }>('mcp.toggle', {
          id,
          enabled: nextEnabled,
        })
        this.applyMcpServerSnapshot(res.server)
        return
      }
      target.enabled = nextEnabled
      let nextStatus: MCPServer['status']
      if (!nextEnabled) nextStatus = 'disabled'
      else if (target.autoStart) nextStatus = 'running'
      else nextStatus = 'idle'
      target.status = nextStatus
      if (nextEnabled) target.lastError = undefined
    },

    async toggleMCPToolDeny(id: string, toolName: string): Promise<void> {
      const target = this.mcpServers.find((s: MCPServer) => s.id === id)
      if (!target) return
      const isDenied = target.deniedTools?.includes(toolName) ?? false
      const sidecar = useSidecar()
      if (sidecar.available) {
        const res = await sidecar.request<{ server: MCPServer }>('mcp.toggle-tool', {
          id,
          toolName,
          denied: !isDenied,
        })
        this.applyMcpServerSnapshot(res.server)
        return
      }
      // Browser dev fallback: mutate in place.
      const next = new Set(target.deniedTools ?? [])
      if (isDenied) next.delete(toolName)
      else next.add(toolName)
      target.deniedTools = next.size > 0 ? [...next].sort() : undefined
    },

    async restartMCPServer(id: string): Promise<void> {
      const sidecar = useSidecar()
      if (sidecar.available) {
        const res = await sidecar.request<{ server: MCPServer }>('mcp.restart', { id })
        this.applyMcpServerSnapshot(res.server)
        return
      }
      const s = this.mcpServers.find((x: MCPServer) => x.id === id)
      if (s) s.status = 'starting'
    },

    // Hook CRUD — persisted via sidecar (2-tier per-file JSON, ADR 0032).
    // Browser dev (no sidecar) keeps the optimistic local mutation so the page
    // stays browsable with INITIAL_HOOKS.

    async hydrateHooksFromSidecar(projectIds?: string[]): Promise<void> {
      const sidecar = useSidecar()
      if (!sidecar.available) {
        if (this.hooks.length === 0) this.hooks = [...INITIAL_HOOKS]
        return
      }
      const ids = projectIds ?? this.projects.map((p: Project) => p.id)
      try {
        const params = ids.length > 0 ? { projectIds: ids } : undefined
        const res = await sidecar.request<{ hooks: Hook[]; reports?: HookScanReport[] }>(
          'hooks.list',
          params,
        )
        this.hooks = Array.isArray(res.hooks) ? res.hooks : []
        this.hookScanReports = Array.isArray(res.reports) ? res.reports : []
      } catch (err) {
        console.warn('[hooks] hydrate failed', err)
      }
    },

    async saveHook(data: Hook): Promise<void> {
      const source = data.source ?? 'global'
      const match = (h: Hook) =>
        h.id === data.id &&
        (h.source ?? 'global') === source &&
        (h.projectId ?? undefined) === (data.projectId ?? undefined)
      const existing = this.hooks.find(match)
      const isUpdate = !!existing
      // Optimistic local update (also the browser-dev path).
      if (existing) {
        Object.assign(existing, data)
      } else {
        this.hooks.push({ ...data, source, recentRuns: data.recentRuns ?? [] })
      }
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        await sidecar.request('hooks.upsert', {
          hook: { ...data, source },
          mode: isUpdate ? 'update' : 'create',
        })
      } catch (err) {
        console.warn('[hooks] upsert failed', err)
      }
    },

    async deleteHook(id: string, source?: Hook['source'], projectId?: string): Promise<void> {
      const target = this.hooks.find((h: Hook) => h.id === id)
      const src = source ?? target?.source ?? 'global'
      const pid = projectId ?? target?.projectId
      this.hooks = this.hooks.filter(
        (h: Hook) =>
          !(
            h.id === id &&
            (h.source ?? 'global') === src &&
            (h.projectId ?? undefined) === (pid ?? undefined)
          ),
      )
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        const params: Record<string, unknown> = { id, source: src }
        if (pid) params.projectId = pid
        await sidecar.request('hooks.delete', params)
      } catch (err) {
        console.warn('[hooks] delete failed', err)
      }
    },

    // Match by the full (id, source, projectId) — project-tier ids collide
    // across projects (imported CC hooks), so id-only finds the wrong instance.
    findHook(hook: Hook): Hook | undefined {
      return this.hooks.find(
        (x: Hook) =>
          x.id === hook.id &&
          (x.source ?? 'global') === (hook.source ?? 'global') &&
          (x.projectId ?? undefined) === (hook.projectId ?? undefined),
      )
    },

    async toggleHook(hook: Hook): Promise<void> {
      const h = this.findHook(hook)
      if (!h) return
      h.enabled = !h.enabled
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        const params: Record<string, unknown> = {
          id: h.id,
          source: h.source ?? 'global',
          enabled: h.enabled,
        }
        if (h.projectId) params.projectId = h.projectId
        await sidecar.request('hooks.toggle', params)
      } catch (err) {
        console.warn('[hooks] toggle failed', err)
      }
    },

    async runHookOnce(hook: Hook): Promise<void> {
      const h = this.findHook(hook)
      if (!h) return
      const sidecar = useSidecar()
      if (!sidecar.available) {
        // Browser dev: simulate a successful run.
        h.recentRuns.unshift({ at: 'Just now', durationMs: 300, exitCode: 0 })
        h.recentRuns = h.recentRuns.slice(0, 20)
        return
      }
      try {
        const params: Record<string, unknown> = { id: h.id, source: h.source ?? 'global' }
        if (h.projectId) params.projectId = h.projectId
        const res = await sidecar.request<{ record: HookRunRecord }>('hooks.run-once', params)
        if (res.record) {
          h.recentRuns.unshift(res.record)
          h.recentRuns = h.recentRuns.slice(0, 20)
        }
      } catch (err) {
        console.warn('[hooks] run-once failed', err)
      }
    },

    // Read the script file a hook command runs (e.g. format-after-edit.sh), so
    // the editor can edit its content. Returns null when the command references
    // no editable script (or it's outside the allowed hook dirs).
    async readHookScript(
      hook: Pick<Hook, 'command' | 'source' | 'projectId'>,
    ): Promise<{ path: string; content: string; exists: boolean } | null> {
      const sidecar = useSidecar()
      if (!sidecar.available) return null
      try {
        const params: Record<string, unknown> = {
          command: hook.command,
          source: hook.source ?? 'global',
        }
        if (hook.projectId) params.projectId = hook.projectId
        const res = await sidecar.request<{
          script: { path: string; content: string; exists: boolean } | null
        }>('hooks.read-script', params)
        return res.script ?? null
      } catch (err) {
        console.warn('[hooks] read-script failed', err)
        return null
      }
    },

    async writeHookScript(
      hook: Pick<Hook, 'command' | 'source' | 'projectId'>,
      content: string,
    ): Promise<void> {
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        const params: Record<string, unknown> = {
          command: hook.command,
          source: hook.source ?? 'global',
          content,
        }
        if (hook.projectId) params.projectId = hook.projectId
        await sidecar.request('hooks.write-script', params)
      } catch (err) {
        console.warn('[hooks] write-script failed', err)
      }
    },

    // Grant trust to project-tier hooks (ADR 0032 D-8) so they may spawn.
    async trustHooks(projectId: string, hookIds: string[]): Promise<void> {
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        await sidecar.request('hooks.trust', { projectId, hookIds })
        this.hooks.forEach((h: Hook) => {
          if (h.projectId === projectId && hookIds.includes(h.id)) h.trusted = true
        })
      } catch (err) {
        console.warn('[hooks] trust failed', err)
      }
    },

    // Rule CRUD — persisted via sidecar (2-tier per-file Markdown, ADR 0033).

    async hydrateRulesFromSidecar(projectIds?: string[]): Promise<void> {
      const sidecar = useSidecar()
      if (!sidecar.available) return
      const ids = projectIds ?? this.projects.map((p: Project) => p.id)
      try {
        const params = ids.length > 0 ? { projectIds: ids } : undefined
        const res = await sidecar.request<{ rules: Rule[]; reports?: RuleScanReport[] }>(
          'rules.list',
          params,
        )
        this.rules = Array.isArray(res.rules) ? res.rules : []
        this.ruleScanReports = Array.isArray(res.reports) ? res.reports : []
      } catch (err) {
        console.warn('[rules] hydrate failed', err)
      }
    },

    async saveRule(data: Rule): Promise<void> {
      const source = data.source ?? 'global'
      const match = (r: Rule) =>
        r.id === data.id &&
        (r.source ?? 'global') === source &&
        (r.projectId ?? undefined) === (data.projectId ?? undefined)
      const existing = this.rules.find(match)
      const isUpdate = !!existing
      if (existing) {
        Object.assign(existing, data)
      } else {
        this.rules.push({ ...data, source })
      }
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        await sidecar.request('rules.upsert', {
          rule: { ...data, source },
          mode: isUpdate ? 'update' : 'create',
        })
      } catch (err) {
        console.warn('[rules] upsert failed', err)
      }
    },

    async deleteRule(id: string, source?: Rule['source'], projectId?: string): Promise<void> {
      const target = this.rules.find((r: Rule) => r.id === id)
      const src = source ?? target?.source ?? 'global'
      const pid = projectId ?? target?.projectId
      this.rules = this.rules.filter(
        (r: Rule) =>
          !(
            r.id === id &&
            (r.source ?? 'global') === src &&
            (r.projectId ?? undefined) === (pid ?? undefined)
          ),
      )
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        const params: Record<string, unknown> = { id, source: src }
        if (pid) params.projectId = pid
        await sidecar.request('rules.delete', params)
      } catch (err) {
        console.warn('[rules] delete failed', err)
      }
    },

    async toggleRule(id: string): Promise<void> {
      const r = this.rules.find((x: Rule) => x.id === id)
      if (!r) return
      r.enabled = !r.enabled
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        const params: Record<string, unknown> = {
          id,
          source: r.source ?? 'global',
          enabled: r.enabled,
        }
        if (r.projectId) params.projectId = r.projectId
        await sidecar.request('rules.toggle', params)
      } catch (err) {
        console.warn('[rules] toggle failed', err)
      }
    },

    // Slash Command CRUD — persisted via sidecar (2-tier per-file Markdown +
    // imported Claude Code commands). Mirrors the Rule actions.

    async hydrateCommandsFromSidecar(projectIds?: string[]): Promise<void> {
      const sidecar = useSidecar()
      if (!sidecar.available) return
      const ids = projectIds ?? this.projects.map((p: Project) => p.id)
      try {
        const params = ids.length > 0 ? { projectIds: ids } : undefined
        const res = await sidecar.request<{ commands: Command[]; reports?: CommandScanReport[] }>(
          'commands.list',
          params,
        )
        this.commands = Array.isArray(res.commands) ? res.commands : []
        this.commandScanReports = Array.isArray(res.reports) ? res.reports : []
      } catch (err) {
        console.warn('[commands] hydrate failed', err)
      }
    },

    async saveCommand(data: Command): Promise<void> {
      const source = data.source ?? 'global'
      const match = (c: Command) =>
        c.id === data.id &&
        (c.source ?? 'global') === source &&
        (c.projectId ?? undefined) === (data.projectId ?? undefined)
      const existing = this.commands.find(match)
      const isUpdate = !!existing
      if (existing) {
        Object.assign(existing, data)
      } else {
        this.commands.push({ ...data, source })
      }
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        await sidecar.request('commands.upsert', {
          command: { ...data, source },
          mode: isUpdate ? 'update' : 'create',
        })
      } catch (err) {
        console.warn('[commands] upsert failed', err)
      }
    },

    async deleteCommand(id: string, source?: Command['source'], projectId?: string): Promise<void> {
      const target = this.commands.find((c: Command) => c.id === id)
      const src = source ?? target?.source ?? 'global'
      const pid = projectId ?? target?.projectId
      this.commands = this.commands.filter(
        (c: Command) =>
          !(
            c.id === id &&
            (c.source ?? 'global') === src &&
            (c.projectId ?? undefined) === (pid ?? undefined)
          ),
      )
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        const params: Record<string, unknown> = { id, source: src }
        if (pid) params.projectId = pid
        await sidecar.request('commands.delete', params)
      } catch (err) {
        console.warn('[commands] delete failed', err)
      }
    },

    async toggleCommand(id: string): Promise<void> {
      const c = this.commands.find((x: Command) => x.id === id)
      if (!c) return
      c.enabled = !c.enabled
      const sidecar = useSidecar()
      if (!sidecar.available) return
      try {
        const params: Record<string, unknown> = {
          id,
          source: c.source ?? 'global',
          enabled: c.enabled,
        }
        if (c.projectId) params.projectId = c.projectId
        await sidecar.request('commands.toggle', params)
      } catch (err) {
        console.warn('[commands] toggle failed', err)
      }
    },
  },
})
