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
// scoped to the Connections surface. Without the bridge the list stays empty.

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

// One row of the detail Tools section (mirror of the sidecar `source.tools`
// outcome). `name` is the AWOG-canonical `mcp__<id>__<tool>`; the UI strips the
// `mcp__<id>__` prefix for display. `allowed` is whether the tool passes this
// source's own permissions.json auto-scope (read-only view — never a credential).
export type SourceToolInfo = { name: string; description: string; allowed: boolean }

// One line of the connection-test activity log (mirror of the sidecar
// SourceLogLine). `info` = an AWOG step, `stderr` = a raw line the MCP server
// printed, `error` = the failure that ended the run. Streamed live over the
// `source.tools-log` event while `source.tools` runs, and also returned in full
// on the result (`log`) so a late subscriber still gets the transcript.
export type SourceLogLevel = 'info' | 'stderr' | 'error'
export type SourceLogLine = { level: SourceLogLevel; message: string }
export type SourceToolsResult = { tools: SourceToolInfo[]; error?: string; log?: SourceLogLine[] }

// A credential the source declares (`secret:<KEY>` ref) but the keychain has no
// value for yet (mirror of the sidecar source.pendingSecrets PendingSecret).
// `field` is the env var / header it fills (display); `key` is the keychain key
// to write via source.setSecret. Drives the chat-creator secret step.
export type SourcePendingSecret = { key: string; field: string }

// Parsed permissions.json for the detail Permissions section (mirror of the
// sidecar SourcePermissions). Read-only scoping rules, never credentials.
export type SourcePermissions = {
  allowedMcpPatterns?: string[]
  allowedApiEndpoints?: { method: string; path: string }[]
  allowedBashPatterns?: string[]
  allowedWritePaths?: string[]
}

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

// One entry of the "add a source" preset catalog (mirror of the sidecar
// PresetMeta — UI-parity area 3). Display + routing metadata surfaced by
// `source.listPresets` and rendered in the picker (SourceAvatar + name +
// tagline). `setupHint` is one line of provider guidance shown in the editor once
// a preset seeds it. No secret is ever involved.
export type SourcePresetMeta = {
  id: string
  slug: string
  name: string
  provider: string
  type: SourceType
  tagline?: string
  icon?: string
  setupHint?: string
}

// Dashboard/agent-picker compat slice — the only shape those surfaces consume.
export type Connection = {
  id: string
  name: string
  status: SourceConnectionStatus
}

// Resolved icon for a source (mirror of sidecar sources/icon.ts ResolvedSourceIcon).
// `dataUri` is a base64 `data:` string — CSP-safe, never a remote src; `emoji` a
// single glyph; `none` tells SourceAvatar to draw the lucide type fallback.
export type ResolvedSourceIcon =
  | { kind: 'emoji'; value: string }
  | { kind: 'dataUri'; value: string }
  | { kind: 'none' }

// Outcome of the optional post-handshake auth probe.
export type SourceProbeResult = {
  ok: boolean
  tool: string
  error?: string
  // The probe tool's returned text (truncated) on success — shown as a preview so
  // the user can confirm the token returns real data.
  preview?: string
}

// Write-only credential entry for an `api` source (ADR 0060 P3). Maps 1:1 onto
// the `source.setApiCredential` RPC modes: bearer/header/query collapse to a lone
// secret string, basic to username+password, multi-header to a header→value map.
// The secret NEVER round-trips — it is only ever written, never read back.
export type ApiCredentialInput =
  | { mode: 'bearer' | 'header' | 'query'; value: string }
  | { mode: 'basic'; username: string; password: string }
  | { mode: 'multi-header'; headers: Record<string, string> }

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

// Colored-dot palette for a connection status, keyed to the prototype theme
// tokens (CSS custom properties — the ui-next theming surface; NOT hardcoded hex).
// Single source of truth for the list dot, the detail pill, and SourceStatusDot.
export const SOURCE_STATUS_COLORS: Record<SourceConnectionStatus, string> = {
  connected: 'var(--green)',
  needs_auth: 'var(--amber)',
  failed: 'var(--danger)',
  untested: 'var(--textDim)',
  local_disabled: 'var(--textFaint)',
}

// Effective connection status for a source (mirror of Craft's
// deriveConnectionStatus). An explicit persisted `connectionStatus` wins;
// otherwise infer from auth — `authType` none/undefined ⇒ connected, else
// `isAuthenticated ? connected : needs_auth`. AWOG does not model the
// local-mcp-disabled toggle yet, so the `local_disabled` branch is omitted here
// (a persisted `connectionStatus` still surfaces it).
export function deriveStatus(s: Source): SourceConnectionStatus {
  if (s.connectionStatus) return s.connectionStatus
  const authType = s.type === 'mcp' ? s.mcp.authType : s.type === 'api' ? s.api.authType : undefined
  if (authType === undefined || authType === 'none') return 'connected'
  return s.isAuthenticated ? 'connected' : 'needs_auth'
}

export const useConnectionsStore = defineStore('connections', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const sources = ref<Source[]>([])
  const loaded = ref(false)

  let unlisten: UnlistenFn | null = null

  // Icon resolution cache (UI-parity area 1). `source.resolveIcon` is a network-
  // touching read (favicon download), so results are memoized per slug and
  // concurrent rows for the same source dedupe on the in-flight promise. Plain
  // Maps — SourceAvatar holds the resolved value in its own ref, so these need no
  // reactivity. Invalidated in applySource/deleteSource when a source changes.
  const iconResults = new Map<string, ResolvedSourceIcon>()
  const iconInflight = new Map<string, Promise<ResolvedSourceIcon>>()

  function invalidateIcon(slug: string): void {
    iconResults.delete(slug)
    iconInflight.delete(slug)
  }

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

  // Upsert a source in place (keyed by slug), used by every mutating RPC. Drops
  // the cached icon so SourceAvatar re-resolves it (config.icon may have changed).
  function applySource(source: Source): void {
    const idx = sources.value.findIndex((s) => s.slug === source.slug)
    if (idx >= 0) sources.value[idx] = source
    else sources.value.push(source)
    invalidateIcon(source.slug)
  }

  // Resolve + memoize a source's icon via the sidecar. Concurrent callers for the
  // same slug share the in-flight promise; a resolved value is cached until the
  // source is mutated (applySource) or deleted. Browser-dev / offline resolves to
  // `none` (SourceAvatar still renders an emoji config.icon via its own fast path).
  async function fetchIcon(slug: string): Promise<ResolvedSourceIcon> {
    const cached = iconResults.get(slug)
    if (cached) return cached
    const inflight = iconInflight.get(slug)
    if (inflight) return inflight
    if (!available.value) return { kind: 'none' }
    const p = (async (): Promise<ResolvedSourceIcon> => {
      try {
        const res = await sc.request<{ icon: ResolvedSourceIcon }>('source.resolveIcon', { slug })
        const icon = res.icon ?? { kind: 'none' }
        iconResults.set(slug, icon)
        return icon
      } catch (err) {
        console.warn('[connections] fetchIcon failed', err)
        return { kind: 'none' }
      } finally {
        iconInflight.delete(slug)
      }
    })()
    iconInflight.set(slug, p)
    return p
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

  // Preset catalog for the "add a source" picker (UI-parity area 3). `listPresets`
  // returns the display metadata; `discoverPreset` returns a ready-to-edit draft
  // for a chosen provider (correct block pre-filled) + its meta (for setupHint).
  // No secret ever crosses the boundary — env keys are seeded empty. The sidecar's
  // preset-catalog.ts is the ONE catalog; without the bridge there is no list to
  // offer rather than a stand-in copy that could drift from it.
  async function listPresets(): Promise<SourcePresetMeta[]> {
    if (!available.value) return []
    const res = await sc.request<{ presets: SourcePresetMeta[] }>('source.listPresets')
    return Array.isArray(res.presets) ? res.presets : []
  }

  async function discoverPreset(
    presetId: string,
  ): Promise<{ preset: Source; meta: SourcePresetMeta } | null> {
    if (!available.value) return null
    return sc.request<{ preset: Source; meta: SourcePresetMeta }>('source.discoverPreset', {
      presetId,
    })
  }

  // Create-or-update, keyed by slug. `renameFrom` (the source's previous slug) is
  // passed when the user edited the ID/slug of an existing source: the sidecar
  // renames the on-disk folder and keeps the id, so the old list entry + icon
  // cache must be dropped here. Browser-dev mutates the local list only.
  async function saveSource(data: SourceInput, renameFrom?: string): Promise<Source> {
    const renaming = !!renameFrom && renameFrom !== data.slug
    const isUpdate = renaming || sources.value.some((s) => s.slug === data.slug)
    if (available.value) {
      const res = await sc.request<{ source: Source }>('source.upsert', {
        source: data,
        mode: isUpdate ? 'update' : 'create',
        ...(renaming ? { renameFrom } : {}),
      })
      if (renaming && renameFrom) {
        sources.value = sources.value.filter((s) => s.slug !== renameFrom)
        invalidateIcon(renameFrom)
      }
      applySource(res.source)
      return res.source
    }
    // Browser-dev fallback.
    const slug = data.slug || `src${Date.now()}`
    const next: Source = { ...data, slug, id: data.id || `${slug}_00000000` }
    if (renaming && renameFrom) sources.value = sources.value.filter((s) => s.slug !== renameFrom)
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
    invalidateIcon(slug)
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

  // Persist an `api` source's credential to the OS keychain (ADR 0060 P3). The
  // secret NEVER touches config.json and is NEVER echoed back — the RPC returns
  // only { ok }, so there is no way to read a stored credential; a re-save simply
  // overwrites. Keyed by the source's STABLE id (not slug). Without the bridge it
  // only flips the in-memory row to authenticated.
  async function setApiCredential(
    args: { sourceId: string } & ApiCredentialInput,
  ): Promise<{ ok: boolean }> {
    if (!available.value) {
      const target = sources.value.find((s) => s.id === args.sourceId)
      if (target && target.type === 'api') {
        target.isAuthenticated = true
        target.connectionStatus = 'connected'
        target.connectionError = undefined
      }
      return { ok: true }
    }
    return sc.request<{ ok: boolean }>('source.setApiCredential', args)
  }

  // Which `secret:<KEY>` refs a source still needs a value for (chat-creator
  // secret step). Browser-dev has no keychain → nothing pending.
  async function fetchPendingSecrets(slug: string): Promise<SourcePendingSecret[]> {
    if (!available.value) return []
    const res = await sc.request<{ secrets: SourcePendingSecret[] }>('source.pendingSecrets', {
      slug,
    })
    return Array.isArray(res.secrets) ? res.secrets : []
  }

  // Persist a single mcp secret to the OS keychain (source.setSecret). Keyed by
  // the source's STABLE id; the value NEVER round-trips (write-only). The config
  // already holds the matching `secret:<KEY>` ref, so no config write is needed.
  // Browser-dev is a no-op (no keychain).
  async function setSecret(sourceId: string, key: string, value: string): Promise<void> {
    if (!available.value) return
    await sc.request('source.setSecret', { sourceId, key, value })
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

  // ── Detail read-only sections (ADR 0060 P5) ──────────────────────────────
  // Thin reads for the Craft-style detail sections. All three are pure reads —
  // no config mutation, no secret crosses the boundary (only tool names/desc,
  // permission scoping rules, guide markdown). Browser-dev returns small stubs so
  // the sections can be exercised offline.

  // Tools section: the source's tools + per-source allowed/blocked (source.tools).
  // `onLog` (optional) receives the connection-test activity lines LIVE while the
  // sidecar handshake runs — the sidecar emits `source.tools-log` events keyed by
  // slug for the duration of the RPC. We register a scoped listener around the
  // request and tear it down in `finally`, so only the active detail pane observes
  // the stream. The full transcript also rides back on the result (`log`).
  async function fetchTools(
    slug: string,
    onLog?: (line: SourceLogLine) => void,
  ): Promise<SourceToolsResult> {
    // A tool list can only come from a real handshake with the server — a
    // synthesized one would name tools the agent cannot actually call.
    if (!available.value) return { tools: [], error: 'Engine unavailable' }
    let unlistenLog: UnlistenFn | null = null
    if (onLog) {
      try {
        unlistenLog = await sc.onEvent((evt) => {
          if (evt?.type !== 'source.tools-log') return
          const payload = evt.payload as { slug?: string; line?: SourceLogLine }
          if (payload?.slug === slug && payload.line) onLog(payload.line)
        })
      } catch {
        unlistenLog = null
      }
    }
    try {
      return await sc.request<SourceToolsResult>('source.tools', { slug })
    } finally {
      unlistenLog?.()
    }
  }

  // Permissions section: the parsed permissions.json, or null when none exists.
  async function fetchPermissions(slug: string): Promise<SourcePermissions | null> {
    if (!available.value) return null
    const res = await sc.request<{ permissions: SourcePermissions | null }>('source.permissions', {
      slug,
    })
    return res.permissions
  }

  // Documentation section: the raw guide.md markdown, or null when none exists.
  async function fetchGuide(slug: string): Promise<string | null> {
    if (!available.value) return null
    const res = await sc.request<{ guide: string | null }>('source.guide', { slug })
    return res.guide
  }

  // Write guide.md (ADR 0060 P5 edit). Empty/whitespace content clears the file
  // (the sidecar deletes it). No secret crosses the boundary — guide is authored
  // markdown. The sidecar owns persistence (~/.awog/sources/<slug>/), so without
  // the bridge there is nowhere to write and this is a no-op.
  async function saveGuide(slug: string, content: string): Promise<void> {
    if (!available.value) return
    await sc.request('source.saveGuide', { slug, content })
  }

  // Write permissions.json (ADR 0060 P5 edit). The sidecar validates the shape and
  // throws a validation RpcError the caller surfaces inline. No secret — patterns
  // are scoping rules. No-op without the bridge (the sidecar owns persistence).
  async function savePermissions(slug: string, permissions: SourcePermissions): Promise<void> {
    if (!available.value) return
    await sc.request('source.savePermissions', { slug, permissions })
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
      // No bridge: nothing to subscribe to → ignore.
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
    listPresets,
    discoverPreset,
    saveSource,
    deleteSource,
    toggleSource,
    toggleToolDeny,
    testSource,
    setApiCredential,
    fetchPendingSecrets,
    setSecret,
    fetchTools,
    fetchPermissions,
    fetchGuide,
    saveGuide,
    savePermissions,
    fetchIcon,
    startOAuth,
    cancelOAuth,
  }
})
