import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { SidecarError, useSidecar, type UnlistenFn } from '~/composables/useSidecar'

// Connections store — dual-path live over the `source.*` RPC surface (ADR 0060,
// "Craft Sources" model). A Source is an external data connection stored per
// folder at ~/.awog/sources/<slug>/. In P1 only the `mcp` kind carries a runtime;
// `api`/`local` land in later phases but round-trip through the store already.
//
// There is NO live process behind a source: status is the PERSISTED result of the
// last `source.test`/auth run (`connectionStatus`), not a running child. So the
// store subscribes only to `sources.fs-changed` (re-hydrate on out-of-band edits)
// — the old `mcp.status`/`mcp.stderr-line` live channels are gone.
//
// External consumers (useAgentsPage MCP picker + useProjectLlmDefaults whitelist)
// bind `servers` (id/name/status) + `mcpServers` + `loadServers()`; those names
// are kept as thin aliases over the source-centric internals so this rewire stays
// scoped to the Connections surface. Browser-dev seeds a small mock.

export type SourceType = 'mcp' | 'api' | 'local'
export type SourceTransport = 'http' | 'sse' | 'stdio'
export type SourceTrust = 'allow' | 'prompt' | 'deny'
export type SourceConnectionStatus =
  | 'connected'
  | 'needs_auth'
  | 'failed'
  | 'untested'
  | 'local_disabled'

// Optional auth probe (mirror of sidecar SourceHealthCheck): a read-only tool the
// Test runs after the handshake to verify the token actually authenticates.
export type SourceHealthCheck = {
  tool: string
  args?: Record<string, unknown>
}

// A tool / resource surfaced by a `source.test` outcome. Runtime-only — never
// persisted on the config.
export type SourceTool = { name: string; description: string }
export type SourceResource = { uri: string; mime: string }

// ── Per-kind config blocks (mirror of sidecar types/shared.ts) ────────────────

export type McpSourceBlock = {
  transport?: SourceTransport
  // http/sse
  url?: string
  authType?: 'oauth' | 'bearer' | 'none'
  clientId?: string
  headers?: Record<string, string>
  headerNames?: string[]
  // stdio
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

export type ApiSourceBlock = {
  baseUrl: string
  authType: 'bearer' | 'header' | 'query' | 'basic' | 'oauth' | 'none'
  headerName?: string
  headerNames?: string[]
  queryParam?: string
  authScheme?: string
  defaultHeaders?: Record<string, string>
  testEndpoint?: {
    method: 'GET' | 'POST'
    path: string
    body?: Record<string, unknown>
    headers?: Record<string, string>
  }
  renewEndpoint?: {
    path: string
    method?: 'GET' | 'POST'
    body?: Record<string, unknown>
    headers?: Record<string, string>
    tokenField?: string
    expiresInField?: string
    fallbackTtlSecs?: number
  }
  oauth?: {
    authorizationUrl: string
    tokenUrl: string
    clientId: string
    clientSecret?: string
    scopes?: string[]
    audience?: string
    extraParams?: Record<string, string>
  }
  googleService?: 'gmail' | 'calendar' | 'drive' | 'docs' | 'sheets' | 'youtube' | 'searchconsole'
  googleScopes?: string[]
  googleOAuthClientId?: string
  googleOAuthClientSecret?: string
  slackService?: 'messaging' | 'channels' | 'users' | 'files' | 'full'
  slackUserScopes?: string[]
  microsoftService?: 'outlook' | 'microsoft-calendar' | 'onedrive' | 'teams' | 'sharepoint'
  microsoftScopes?: string[]
}

export type LocalSourceBlock = {
  path: string
  format?: string
}

// Fields shared by every source kind. Config fields round-trip to disk; the
// status fields (isAuthenticated..lastTestedAt) are written by `source.test`.
// NO `autoStart` — lifecycle is a lazy pool (ADR 0060 D-3).
export type SourceBase = {
  id: string
  slug: string
  name: string
  provider: string
  enabled: boolean
  icon?: string
  tagline?: string
  description?: string
  isAuthenticated?: boolean
  connectionStatus?: SourceConnectionStatus
  connectionError?: string
  lastTestedAt?: number
  createdAt?: number
  updatedAt?: number
  timeoutMs: number
  deniedTools?: string[]
  trust: SourceTrust
  healthCheck?: SourceHealthCheck
}

export type McpSource = SourceBase & { type: 'mcp'; mcp: McpSourceBlock }
export type ApiSource = SourceBase & { type: 'api'; api: ApiSourceBlock }
export type LocalSource = SourceBase & { type: 'local'; local: LocalSourceBlock }

// Discriminated union on `type` — mirror of the sidecar SourceConfig.
export type Source = McpSource | ApiSource | LocalSource

// The shape a save accepts (the editor builds a full SourceConfig).
export type SourceInput = Source

// Dashboard/agent-picker compat slice — the only shape those surfaces consume.
export type Connection = {
  id: string
  name: string
  status: SourceConnectionStatus
}

// Outcome of the optional post-handshake auth probe.
export type SourceProbeResult = {
  ok: boolean
  tool: string
  error?: string
}

// Result of `source.test` (mirror of sidecar SourceTestOutcome). `supported`
// distinguishes "tested and failed" from "kind not testable yet" (api/local in P1).
export type SourceTestOutcome = {
  ok: boolean
  supported: boolean
  status: SourceConnectionStatus
  isAuthenticated?: boolean
  tools?: SourceTool[]
  resources?: SourceResource[]
  error?: string
  stderr?: string[]
  probe?: SourceProbeResult
}

// Outcome of a `source.startOAuth` flow (ADR 0060 P2). The token itself NEVER
// crosses the boundary — only the resolved status. `canceled` is the graceful
// user-abort path (the sidecar throws RpcError(-32023, 'CANCELED')), distinct
// from a real OAuth `failed`.
export type SourceOAuthResult =
  | { kind: 'connected'; alreadyAuthenticated: boolean }
  | { kind: 'failed'; error: string }
  | { kind: 'canceled' }

// The transport a source speaks (mcp only carries one; api/local report their kind).
export function sourceTransport(s: Source): string {
  if (s.type === 'mcp') return s.mcp.transport ?? 'http'
  return s.type
}

function mockSources(): Source[] {
  return [
    {
      id: 'github_00000000',
      slug: 'github',
      name: 'github',
      provider: 'github',
      description: 'GitHub MCP — repos, issues, PRs.',
      type: 'mcp',
      enabled: true,
      timeoutMs: 30000,
      trust: 'prompt',
      connectionStatus: 'connected',
      isAuthenticated: true,
      mcp: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'secret:GITHUB_PERSONAL_ACCESS_TOKEN' },
      },
    },
    {
      id: 'linear_00000000',
      slug: 'linear',
      name: 'linear',
      provider: 'linear',
      description: 'Linear MCP over HTTP.',
      type: 'mcp',
      enabled: true,
      timeoutMs: 30000,
      trust: 'prompt',
      connectionStatus: 'needs_auth',
      isAuthenticated: false,
      mcp: { transport: 'http', url: 'https://mcp.linear.app/sse', authType: 'oauth' },
    },
    {
      id: 'notion_00000000',
      slug: 'notion',
      name: 'notion',
      provider: 'notion',
      description: 'Notion MCP over HTTP.',
      type: 'mcp',
      enabled: false,
      timeoutMs: 30000,
      trust: 'prompt',
      connectionStatus: 'untested',
      mcp: { transport: 'http', url: 'https://mcp.notion.com' },
    },
  ]
}

export const useConnectionsStore = defineStore('connections', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const sources = ref<Source[]>(sc.available ? [] : mockSources())
  const loaded = ref(false)

  let unlisten: UnlistenFn | null = null

  // Dashboard/agent-picker compat slice (id/name/status).
  const servers = computed<Connection[]>(() =>
    sources.value.map((s) => ({
      id: s.id,
      name: s.name || s.slug,
      status: s.connectionStatus ?? 'untested',
    })),
  )

  // Alias kept for useProjectLlmDefaults' MCP whitelist (reads id/name/enabled).
  const mcpServers = computed<Source[]>(() => sources.value)

  const sourceBySlug = (slug: string): Source | undefined =>
    sources.value.find((s) => s.slug === slug)

  // Upsert a source in place (keyed by slug), used by every mutating RPC.
  function applySource(source: Source): void {
    const idx = sources.value.findIndex((s) => s.slug === source.slug)
    if (idx >= 0) sources.value[idx] = source
    else sources.value.push(source)
  }

  async function loadSources(): Promise<void> {
    if (!available.value) {
      loaded.value = true
      return
    }
    try {
      const res = await sc.request<{ sources: Source[] }>('source.list')
      sources.value = Array.isArray(res.sources) ? res.sources : []
    } catch (err) {
      console.warn('[connections] loadSources failed', err)
    } finally {
      loaded.value = true
      void subscribe()
    }
  }

  // Create-or-update, keyed by slug. Browser-dev mutates the local list only
  // (id/slug auto-filled when blank).
  async function saveSource(data: SourceInput): Promise<Source> {
    const isUpdate = sources.value.some((s) => s.slug === data.slug)
    if (available.value) {
      const res = await sc.request<{ source: Source }>('source.upsert', {
        source: data,
        mode: isUpdate ? 'update' : 'create',
      })
      applySource(res.source)
      return res.source
    }
    // Browser-dev fallback.
    const slug = data.slug || `src${Date.now()}`
    const next: Source = { ...data, slug, id: data.id || `${slug}_00000000` }
    applySource(next)
    return next
  }

  async function deleteSource(slug: string): Promise<void> {
    if (available.value) {
      try {
        await sc.request('source.delete', { slug })
      } catch (err) {
        console.warn('[connections] deleteSource failed', err)
      }
    }
    sources.value = sources.value.filter((s) => s.slug !== slug)
  }

  async function toggleSource(slug: string): Promise<void> {
    const target = sourceBySlug(slug)
    if (!target) return
    const nextEnabled = !target.enabled
    if (available.value) {
      const res = await sc.request<{ source: Source }>('source.toggle', {
        slug,
        enabled: nextEnabled,
      })
      applySource(res.source)
      return
    }
    target.enabled = nextEnabled
  }

  async function toggleToolDeny(slug: string, toolName: string): Promise<void> {
    const target = sourceBySlug(slug)
    if (!target) return
    const isDenied = target.deniedTools?.includes(toolName) ?? false
    if (available.value) {
      const res = await sc.request<{ source: Source }>('source.toggleTool', {
        slug,
        toolName,
        denied: !isDenied,
      })
      applySource(res.source)
      return
    }
    // Browser-dev fallback — mutate the denied set in place.
    const next = new Set(target.deniedTools ?? [])
    if (isDenied) next.delete(toolName)
    else next.add(toolName)
    target.deniedTools = next.size > 0 ? [...next].sort() : undefined
  }

  // Test a PERSISTED source by slug (the source must be saved first — the sidecar
  // persists the outcome back onto the config + auto-enables a clean run). Applies
  // the refreshed source so status/enabled reflect immediately. Browser-dev
  // returns an offline outcome.
  async function testSource(
    slug: string,
  ): Promise<{ source: Source | null; outcome: SourceTestOutcome }> {
    if (!available.value) {
      return {
        source: sourceBySlug(slug) ?? null,
        outcome: { ok: false, supported: false, status: 'untested', error: 'Engine offline' },
      }
    }
    const res = await sc.request<{ source: Source | null; outcome: SourceTestOutcome }>(
      'source.test',
      { slug },
    )
    if (res.source) applySource(res.source)
    return res
  }

  // Re-fetch a single source and patch it in place (used after an OAuth flow so
  // the freshly-persisted status/error shows immediately — the fs watcher fires
  // too, but this is deterministic and scoped).
  async function refreshSource(slug: string): Promise<void> {
    if (!available.value) return
    try {
      const res = await sc.request<{ source: Source | null }>('source.get', { slug })
      if (res.source) applySource(res.source)
    } catch (err) {
      console.warn('[connections] refreshSource failed', err)
    }
  }

  // Start an OAuth authorization for a remote (http/sse) MCP source (ADR 0060 P2).
  // LONG-LIVED: the RPC resolves only after the user authorizes in their browser
  // (or the flow is cancelled). The sidecar emits `source.oauth-url` mid-flow —
  // subscribe() opens it in the external browser. A user cancel surfaces as
  // RpcError(-32023, 'CANCELED') and is mapped to `{ kind: 'canceled' }` (silent,
  // prior state preserved) — NOT an error. The token never reaches the UI.
  async function startOAuth(slug: string): Promise<SourceOAuthResult> {
    if (!available.value) {
      // Browser-dev stub: flip the source connected so the UI can be exercised.
      const target = sourceBySlug(slug)
      if (target && target.type === 'mcp') {
        target.connectionStatus = 'connected'
        target.isAuthenticated = true
        target.connectionError = undefined
      }
      return { kind: 'connected', alreadyAuthenticated: false }
    }
    try {
      const res = await sc.request<
        | { ok: true; alreadyAuthenticated: boolean; status: SourceConnectionStatus }
        | { ok: false; status: SourceConnectionStatus; error: string }
      >('source.startOAuth', { slug })
      await refreshSource(slug)
      if (res.ok) return { kind: 'connected', alreadyAuthenticated: res.alreadyAuthenticated }
      return { kind: 'failed', error: res.error }
    } catch (err) {
      // Graceful user-abort: the sidecar throws RpcError(-32023, 'CANCELED') when
      // source.cancelOAuth aborts the flow. Prior state is untouched (the sidecar
      // does not persist on cancel), so just report `canceled`.
      if (
        err instanceof SidecarError &&
        (err.code === -32023 || err.message.includes('CANCELED'))
      ) {
        return { kind: 'canceled' }
      }
      throw err
    }
  }

  // Cancel an in-flight OAuth flow (idempotent — the sidecar returns `found`
  // whether or not a flow was live). Best-effort: a stale cancel is a no-op.
  async function cancelOAuth(slug: string): Promise<{ ok: boolean; found: boolean }> {
    if (!available.value) return { ok: true, found: false }
    try {
      return await sc.request<{ ok: boolean; found: boolean }>('source.cancelOAuth', { slug })
    } catch (err) {
      console.warn('[connections] cancelOAuth failed', err)
      return { ok: false, found: false }
    }
  }

  async function subscribe(): Promise<void> {
    if (!available.value || unlisten) return
    try {
      unlisten = await sc.onEvent((evt) => {
        if (!evt) return
        // OAuth flow (ADR 0060 P2): the sidecar builds the authorize URL and emits
        // it here — the UI is responsible for opening it in the external browser
        // (the sidecar never opens one). Same external-open path as the account
        // OAuth flow (SettingsCodexDialog).
        if (evt.type === 'source.oauth-url') {
          const payload = evt.payload as { slug?: string; url?: string }
          if (payload?.url) {
            void sc.openExternal(payload.url).catch((err) => {
              console.warn('[connections] openExternal failed', err)
            })
          }
          return
        }
        // A source has no live process — the only channel is the fs watcher, which
        // fires when a config/guide/permissions file changes out-of-band.
        if (evt.type === 'sources.fs-changed') {
          void loadSources()
        }
      })
    } catch {
      // Browser-dev: bridge absent → ignore (mock path).
      unlisten = null
    }
  }

  return {
    // state
    sources,
    loaded,
    available,
    // external-compat getters
    servers,
    mcpServers,
    // getters
    sourceBySlug,
    // actions
    loadSources,
    loadServers: loadSources,
    saveSource,
    deleteSource,
    toggleSource,
    toggleToolDeny,
    testSource,
    startOAuth,
    cancelOAuth,
  }
})
