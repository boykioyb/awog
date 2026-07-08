import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'

// Connections store — dual-path live (MCP servers, ADR 0025 — flat global
// "Sources" list, NO service enum/tier). When the Electron bridge is available
// `loadServers()` pulls the snapshot list over IPC; an `mcp.status` subscription
// keeps each server's status/tools/resources/lastError fresh, an
// `mcp.stderr-line` subscription fills a 100-line stderr ring buffer per server,
// and an `mcp-servers.fs-changed` subscription re-hydrates when configs are
// edited outside the app. Browser-dev seeds a small mock. Mirrors stores/skills.ts
// + stores/agents.ts dual-path pattern.
//
// Dashboard compatibility: the Home dashboard (composables/useHomeDashboard.ts)
// binds `servers` (id/name/status) + calls `loadServers()`. Those stay exactly
// as before — the richer `McpServer` slice lives alongside, and `servers` is
// derived from it so a single load feeds both surfaces.

export type ConnectionStatus = 'running' | 'starting' | 'idle' | 'error' | 'disabled'
export type ConnectionTransport = 'stdio' | 'http' | 'sse'
export type ConnectionTrust = 'allow' | 'prompt' | 'deny'

export type ConnectionTool = {
  name: string
  description: string
}

export type ConnectionResource = {
  uri: string
  mime: string
}

// Optional auth probe (mirror of sidecar McpHealthCheck): a read-only tool the
// Test runs after the handshake to verify the token actually authenticates.
export type McpHealthCheck = {
  tool: string
  args?: Record<string, unknown>
}

// Full MCP server entity (mirror of sidecar McpServerSnapshot —
// apps/desktop/sidecar/src/types/shared.ts). NOT imported from the sidecar
// package; the store owns its own slice. Config fields (id..deniedTools) round-
// trip to disk; runtime fields (status/tools/resources/lastError/lastStartedAt)
// are rebuilt by the McpManager and stripped before `mcp.upsert`.
export type McpServer = {
  id: string
  name: string
  description: string
  transport: ConnectionTransport
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  enabled: boolean
  autoStart: boolean
  timeoutMs: number
  trust: ConnectionTrust
  deniedTools?: string[]
  healthCheck?: McpHealthCheck
  // runtime (sidecar-owned)
  status: ConnectionStatus
  tools: ConnectionTool[]
  resources: ConnectionResource[]
  lastError?: string
  lastStartedAt?: string
}

// Dashboard-compat slice — the only shape the Home tiles consume.
export type Connection = {
  id: string
  name: string
  status: ConnectionStatus
}

// Config-only draft a save accepts. The editor builds this; the store strips
// runtime fields before sending to `mcp.upsert`.
export type McpServerInput = McpServer

// Outcome of the optional post-handshake auth probe.
export type McpProbeResult = {
  ok: boolean
  tool: string
  error?: string
}

// Result of an ephemeral connection probe (`mcp.test`). `ok` reflects the
// handshake; `probe` (when a healthCheck is configured) reports whether the
// token actually authenticated.
export type McpTestResult = {
  ok: boolean
  tools?: ConnectionTool[]
  resources?: ConnectionResource[]
  error?: string
  stderr?: string[]
  probe?: McpProbeResult
}

// Runtime fields rebuilt by the McpManager — never sent to `mcp.upsert` (the
// sidecar zod schema rejects them).
const RUNTIME_KEYS = ['status', 'tools', 'resources', 'lastError', 'lastStartedAt'] as const

// Drop runtime fields, returning the config-only shape `mcp.upsert`/`mcp.test`
// accept. Mirrors stripRuntimeFields from the old UI workspace store.
function stripRuntimeFields(s: McpServer): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(s) as Array<keyof McpServer>) {
    if ((RUNTIME_KEYS as readonly string[]).includes(k)) continue
    out[k] = s[k]
  }
  return out
}

const STATUS_VALUES: ReadonlyArray<ConnectionStatus> = [
  'running',
  'starting',
  'idle',
  'error',
  'disabled',
]

const isStatus = (v: unknown): v is ConnectionStatus =>
  typeof v === 'string' && (STATUS_VALUES as readonly string[]).includes(v)

type McpStatusEvent = {
  id: string
  status?: ConnectionStatus
  lastError?: string
  tools?: ConnectionTool[]
  resources?: ConnectionResource[]
  lastStartedAt?: string
}

const isStatusEvent = (raw: unknown): raw is McpStatusEvent => {
  if (!raw || typeof raw !== 'object') return false
  const p = raw as Record<string, unknown>
  return typeof p.id === 'string'
}

type McpStderrEvent = { id: string; line: string }

const isStderrEvent = (raw: unknown): raw is McpStderrEvent => {
  if (!raw || typeof raw !== 'object') return false
  const p = raw as Record<string, unknown>
  return typeof p.id === 'string' && typeof p.line === 'string'
}

function mockServers(): McpServer[] {
  return [
    {
      id: 'github',
      name: 'github',
      description: 'GitHub MCP — repos, issues, PRs.',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'secret:GITHUB_PERSONAL_ACCESS_TOKEN' },
      enabled: true,
      autoStart: true,
      timeoutMs: 30000,
      trust: 'prompt',
      status: 'running',
      tools: [
        { name: 'create_issue', description: 'Open a new issue in a repository.' },
        { name: 'search_repositories', description: 'Search repositories by query.' },
      ],
      resources: [],
    },
    {
      id: 'filesystem',
      name: 'filesystem',
      description: 'Local filesystem MCP — read/write within a root.',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/Users/me/notes'],
      enabled: true,
      autoStart: true,
      timeoutMs: 30000,
      trust: 'allow',
      status: 'running',
      tools: [
        { name: 'read_file', description: 'Read a file from the allowed root.' },
        { name: 'write_file', description: 'Write a file inside the allowed root.' },
      ],
      resources: [],
    },
    {
      id: 'linear',
      name: 'linear',
      description: 'Linear MCP over HTTP.',
      transport: 'http',
      url: 'https://mcp.linear.app/sse',
      headers: { Authorization: 'secret:LINEAR_KEY' },
      enabled: true,
      autoStart: false,
      timeoutMs: 30000,
      trust: 'prompt',
      status: 'idle',
      tools: [],
      resources: [],
    },
    {
      id: 'notion',
      name: 'notion',
      description: 'Notion MCP over HTTP.',
      transport: 'http',
      url: 'https://mcp.notion.com',
      enabled: false,
      autoStart: false,
      timeoutMs: 30000,
      trust: 'prompt',
      status: 'disabled',
      tools: [],
      resources: [],
    },
  ]
}

export const useConnectionsStore = defineStore('connections', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const mcpServers = ref<McpServer[]>(sc.available ? [] : mockServers())
  // 100-line stderr ring buffer per server id, surfaced in the detail Logs view.
  const mcpStderr = ref<Record<string, string[]>>({})
  const loaded = ref(false)

  let unlisten: UnlistenFn | null = null

  // Dashboard-compat derived slice — the only shape the Home tiles bind to.
  const servers = computed<Connection[]>(() =>
    mcpServers.value.map((s) => ({ id: s.id, name: s.name || s.id, status: s.status })),
  )

  const serverById = (id: string): McpServer | undefined =>
    mcpServers.value.find((s) => s.id === id)

  // Upsert a snapshot in place (used by the status event + every mutating RPC).
  function applySnapshot(server: McpServer): void {
    const idx = mcpServers.value.findIndex((s) => s.id === server.id)
    if (idx >= 0) mcpServers.value[idx] = server
    else mcpServers.value.push(server)
  }

  async function loadServers(): Promise<void> {
    if (!available.value) {
      loaded.value = true
      return
    }
    try {
      const res = await sc.request<{ servers: McpServer[] }>('mcp.list')
      mcpServers.value = Array.isArray(res.servers) ? res.servers : []
    } catch (err) {
      console.warn('[connections] loadServers failed', err)
    } finally {
      loaded.value = true
      void subscribe()
    }
  }

  // Create-or-update. Strips runtime fields before sending. Browser-dev mutates
  // the local list only (id auto-filled when blank).
  async function saveServer(data: McpServerInput): Promise<McpServer> {
    const isUpdate = mcpServers.value.some((s) => s.id === data.id)
    if (available.value) {
      const res = await sc.request<{ server: McpServer }>('mcp.upsert', {
        server: stripRuntimeFields(data),
        mode: isUpdate ? 'update' : 'create',
      })
      applySnapshot(res.server)
      return res.server
    }
    // Browser-dev fallback.
    const next: McpServer = { ...data, id: data.id || `mcp${Date.now()}` }
    applySnapshot(next)
    return next
  }

  async function deleteServer(id: string): Promise<void> {
    if (available.value) {
      try {
        await sc.request('mcp.delete', { id })
      } catch (err) {
        console.warn('[connections] deleteServer failed', err)
      }
    }
    mcpServers.value = mcpServers.value.filter((s) => s.id !== id)
    delete mcpStderr.value[id]
  }

  async function toggleServer(id: string): Promise<void> {
    const target = serverById(id)
    if (!target) return
    const nextEnabled = !target.enabled
    if (available.value) {
      const res = await sc.request<{ server: McpServer }>('mcp.toggle', {
        id,
        enabled: nextEnabled,
      })
      applySnapshot(res.server)
      return
    }
    // Browser-dev fallback — derive a plausible status.
    target.enabled = nextEnabled
    if (!nextEnabled) target.status = 'disabled'
    else target.status = target.autoStart ? 'running' : 'idle'
    if (nextEnabled) target.lastError = undefined
  }

  async function toggleToolDeny(id: string, toolName: string): Promise<void> {
    const target = serverById(id)
    if (!target) return
    const isDenied = target.deniedTools?.includes(toolName) ?? false
    if (available.value) {
      const res = await sc.request<{ server: McpServer }>('mcp.toggle-tool', {
        id,
        toolName,
        denied: !isDenied,
      })
      applySnapshot(res.server)
      return
    }
    // Browser-dev fallback — mutate the denied set in place.
    const next = new Set(target.deniedTools ?? [])
    if (isDenied) next.delete(toolName)
    else next.add(toolName)
    target.deniedTools = next.size > 0 ? [...next].sort() : undefined
  }

  async function restartServer(id: string): Promise<void> {
    if (available.value) {
      const res = await sc.request<{ server: McpServer }>('mcp.restart', { id })
      applySnapshot(res.server)
      return
    }
    const s = serverById(id)
    if (s) s.status = 'starting'
  }

  // Ephemeral connection probe — spawns a one-shot MCP handshake and returns the
  // detected tools/resources without persisting. Browser-dev returns an offline
  // result so the caller can surface a friendly message.
  async function testServer(data: McpServerInput): Promise<McpTestResult> {
    if (!available.value) {
      return { ok: false, error: 'Engine offline — cannot test' }
    }
    return sc.request<McpTestResult>('mcp.test', { server: stripRuntimeFields(data) })
  }

  async function subscribe(): Promise<void> {
    if (!available.value || unlisten) return
    try {
      unlisten = await sc.onEvent((evt) => {
        if (!evt) return
        if (evt.type === 'mcp.status' && isStatusEvent(evt.payload)) {
          const p = evt.payload
          const target = serverById(p.id)
          if (!target) {
            // Unseen server (e.g. created out-of-band) → re-hydrate the list.
            void loadServers()
            return
          }
          if (isStatus(p.status)) target.status = p.status
          target.lastError = p.lastError
          if (Array.isArray(p.tools)) target.tools = p.tools
          if (Array.isArray(p.resources)) target.resources = p.resources
          if (typeof p.lastStartedAt === 'string') target.lastStartedAt = p.lastStartedAt
          return
        }
        if (evt.type === 'mcp.stderr-line' && isStderrEvent(evt.payload)) {
          const { id, line } = evt.payload
          const ring = mcpStderr.value[id] ?? []
          ring.push(line)
          if (ring.length > 100) ring.splice(0, ring.length - 100)
          mcpStderr.value[id] = ring
          return
        }
        if (evt.type === 'mcp-servers.fs-changed') {
          void loadServers()
        }
      })
    } catch {
      // Browser-dev: bridge absent → ignore (mock path).
      unlisten = null
    }
  }

  return {
    // state
    mcpServers,
    mcpStderr,
    servers,
    loaded,
    available,
    // getters
    serverById,
    // actions
    loadServers,
    saveServer,
    deleteServer,
    toggleServer,
    toggleToolDeny,
    restartServer,
    testServer,
  }
})
