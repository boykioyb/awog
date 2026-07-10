// source.test logic (ADR 0060 D-6, P1 = mcp kind only). Maps an mcp source's
// `mcp` block onto the normalized McpConnectParams, runs mcpManager.test()
// (handshake + optional auth probe over the reused Stdio/Http client), classifies
// the outcome into a persisted `connectionStatus`, and — for the persisting
// variant — writes the status back onto the SourceConfig + auto-enables a clean
// run. `api`/`local` kinds return a "not supported yet" outcome (phases P3/P4).
//
// Mirrors Craft's session-tools-core/src/handlers/source-test.ts connection-test
// step, but scoped to what P1 needs (mcp handshake + auth classification).

import { mcpManager } from '../mcp/manager.js'
import type { McpConnectParams, McpProbeResult } from '../mcp/manager.js'
import { loadSource, saveSource } from './store.js'
import { getFreshToken } from './oauth-manager.js'
import type {
  McpResource,
  McpSource,
  McpTool,
  SourceConfig,
  SourceConnectionStatus,
} from '../types/shared.js'

// The per-source test result surfaced to the UI. `supported` distinguishes
// "tested and failed" from "we don't test this kind yet" (api/local in P1).
export interface SourceTestOutcome {
  ok: boolean
  supported: boolean
  status: SourceConnectionStatus
  isAuthenticated?: boolean
  tools?: McpTool[]
  resources?: McpResource[]
  error?: string
  stderr?: string[]
  probe?: McpProbeResult
}

// An auth-shaped failure (missing/rejected token) as opposed to an unreachable
// server. HTTP 401/403 (relayed by HttpMcpClient as `HTTP 401: …`) is the primary
// signal; a bare "unauthorized"/"forbidden" in the error covers stdio servers
// that report auth failures textually.
function isAuthFailure(error: string): boolean {
  return /\b(401|403)\b/.test(error) || /unauthor|forbidden/i.test(error)
}

// Map an mcp source's `mcp` block onto the transport-neutral test params.
// `transport` defaults to 'http' (Craft's default) when unset.
function mcpConnectParams(source: McpSource): McpConnectParams {
  const transport = source.mcp.transport ?? 'http'
  const params: McpConnectParams = {
    id: source.id,
    transport,
    timeoutMs: source.timeoutMs,
  }
  if (transport === 'stdio') {
    if (source.mcp.command !== undefined) params.command = source.mcp.command
    if (source.mcp.args !== undefined) params.args = source.mcp.args
    if (source.mcp.env !== undefined) params.env = source.mcp.env
    if (source.mcp.cwd !== undefined) params.cwd = source.mcp.cwd
  } else {
    if (source.mcp.url !== undefined) params.url = source.mcp.url
    if (source.mcp.headers !== undefined) params.headers = source.mcp.headers
  }
  if (source.healthCheck) params.healthCheck = source.healthCheck
  return params
}

// Run the connectivity test for a source. mcp kind only in P1; api/local return a
// clear "not supported yet" outcome. Never throws — a failure is an outcome.
export async function testSource(
  source: SourceConfig,
  opts: { timeoutMs?: number } = {},
): Promise<SourceTestOutcome> {
  if (source.type !== 'mcp') {
    return {
      ok: false,
      supported: false,
      status: 'untested',
      error: `Testing ${source.type} sources is not supported yet (phase ${source.type === 'api' ? 'P3' : 'P4'}).`,
    }
  }

  const params = mcpConnectParams(source)

  // OAuth remote sources (ADR 0060 D-4): inject a fresh Bearer token before the
  // handshake. No/expired token that can't refresh → needs_auth immediately (the
  // user must Connect first). bearer/none keep using their `secret:` header refs,
  // resolved by mcpManager.test via expandSecrets — unchanged.
  const transport = source.mcp.transport ?? 'http'
  if (transport !== 'stdio' && source.mcp.authType === 'oauth') {
    const token = await getFreshToken(source)
    if (!token) {
      return {
        ok: false,
        supported: true,
        status: 'needs_auth',
        isAuthenticated: false,
        error: 'Source is not authenticated — connect via OAuth first.',
      }
    }
    params.headers = { ...(params.headers ?? {}), Authorization: `Bearer ${token}` }
  }

  const outcome = await mcpManager.test(params, opts)

  // Clean handshake: connected unless a configured auth probe was rejected.
  if (outcome.ok) {
    const authFailed = outcome.probe ? !outcome.probe.ok : false
    const result: SourceTestOutcome = {
      ok: true,
      supported: true,
      status: authFailed ? 'needs_auth' : 'connected',
      isAuthenticated: !authFailed,
    }
    if (outcome.tools) result.tools = outcome.tools
    if (outcome.resources) result.resources = outcome.resources
    if (outcome.stderr && outcome.stderr.length > 0) result.stderr = outcome.stderr
    if (outcome.probe) result.probe = outcome.probe
    return result
  }

  // Handshake failed: an auth-shaped error → needs_auth (fixable by connecting),
  // anything else → failed (unreachable / bad config).
  const error = outcome.error ?? 'connection failed'
  const authFailure = isAuthFailure(error)
  const result: SourceTestOutcome = {
    ok: false,
    supported: true,
    status: authFailure ? 'needs_auth' : 'failed',
    isAuthenticated: false,
    error,
  }
  if (outcome.stderr && outcome.stderr.length > 0) result.stderr = outcome.stderr
  return result
}

// Load a persisted source, test it, and write the outcome back onto its config
// (connectionStatus / isAuthenticated / connectionError / lastTestedAt), auto-
// enabling on a clean run (ADR 0060 D-3/D-6). Returns the refreshed source. Used
// by both the `source.test` RPC and `source.author`'s verify step so the two
// stay in lockstep. Unsupported kinds are tested but NOT persisted.
export async function testAndPersistSource(
  slug: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ source: SourceConfig | null; outcome: SourceTestOutcome }> {
  const source = await loadSource(slug)
  if (!source) {
    return {
      source: null,
      outcome: { ok: false, supported: false, status: 'untested', error: `source not found: ${slug}` },
    }
  }

  const outcome = await testSource(source, opts)
  if (!outcome.supported) return { source, outcome }

  const now = Date.now()
  const next: SourceConfig = {
    ...source,
    connectionStatus: outcome.status,
    isAuthenticated: outcome.isAuthenticated ?? false,
    lastTestedAt: now,
    updatedAt: now,
    // Auto-enable when the server connected cleanly AND (no probe OR the probe
    // authenticated) — a needs_auth/failed run leaves `enabled` untouched.
    enabled: outcome.ok && (!outcome.probe || outcome.probe.ok) ? true : source.enabled,
  }
  if (outcome.error) next.connectionError = outcome.error
  else delete next.connectionError

  await saveSource(next)
  return { source: await loadSource(slug), outcome }
}
