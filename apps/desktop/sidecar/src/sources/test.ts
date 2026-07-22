// source.test logic (ADR 0060 D-6, P1 = mcp kind only). Maps an mcp source's
// `mcp` block onto the normalized McpConnectParams, runs mcpManager.test()
// (handshake + optional auth probe over the reused Stdio/Http client), classifies
// the outcome into a persisted `connectionStatus`, and — for the persisting
// variant — writes the status back onto the SourceConfig + auto-enables a clean
// run. `api`/`local` kinds return a "not supported yet" outcome (phases P3/P4).
//
// Mirrors Craft's session-tools-core/src/handlers/source-test.ts connection-test
// step, but scoped to what P1 needs (mcp handshake + auth classification).

import { stat } from 'node:fs/promises'
import { mcpManager } from '../mcp/manager.js'
import type { McpConnectParams, McpProbeResult } from '../mcp/manager.js'
import { loadSource, saveSource } from './store.js'
import { resolveLocalPath } from './gate.js'
import { getFreshToken } from './oauth-manager.js'
import { ssrfCheck } from '../mcp/http-client.js'
import { buildApiRequest, type ApiRequestSpec } from './api-tools.js'
import { loadApiCredential, type ApiCredential } from './api-credentials.js'
import type {
  ApiSource,
  LocalSource,
  McpResource,
  McpSource,
  McpTool,
  SourceConfig,
  SourceConnectionStatus,
  SourceLog,
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
    // Carries the 'bearer' hint so the manager prefixes a bare token with
    // `Bearer ` after secret expansion (applyBearerScheme).
    if (source.mcp.authType !== undefined) params.authType = source.mcp.authType
  }
  if (source.healthCheck) params.healthCheck = source.healthCheck
  return params
}

// Probe an api source (ADR 0060 D-6, P3). Validates config + SSRF-guards the
// baseUrl, then hits the configured `testEndpoint` (or a bare GET on baseUrl)
// with auth injected. Classifies: 2xx → connected; 401/403 → needs_auth (hard);
// any other reachable status → soft warning (still connected, note surfaced);
// a network failure → failed. A missing credential on an authenticated source
// short-circuits to needs_auth without a request. Never throws.
async function testApiSource(
  source: ApiSource,
  opts: { timeoutMs?: number; onLog?: SourceLog },
): Promise<SourceTestOutcome> {
  const api = source.api
  const onLog = opts.onLog

  if (!api.baseUrl) {
    onLog?.({ level: 'error', message: 'api source has no baseUrl' })
    return { ok: false, supported: true, status: 'failed', error: 'api source has no baseUrl' }
  }
  const baseGuard = ssrfCheck(api.baseUrl)
  if (!baseGuard.ok) {
    onLog?.({ level: 'error', message: `baseUrl blocked: ${baseGuard.reason}` })
    return { ok: false, supported: true, status: 'failed', error: `baseUrl blocked: ${baseGuard.reason}` }
  }

  // Auth resolution. OAuth (ADR 0060 P6): fetch a fresh Bearer token (auto-
  // refreshed) and probe with it; no token → needs_auth without a request.
  // Other authed kinds need a stored credential; public (none) needs neither.
  let cred: ApiCredential | null = null
  let oauthHeaders: Record<string, string> | undefined
  if (api.authType === 'oauth') {
    onLog?.({ level: 'info', message: 'Resolving OAuth token (auto-refresh if expired)' })
    const token = await getFreshToken(source)
    if (!token) {
      onLog?.({ level: 'error', message: 'No valid OAuth token — connect first' })
      return {
        ok: false,
        supported: true,
        status: 'needs_auth',
        isAuthenticated: false,
        error: 'Not authenticated — connect via OAuth first (source_oauth_trigger).',
      }
    }
    oauthHeaders = { Authorization: `Bearer ${token}` }
  } else if (api.authType !== 'none') {
    cred = await loadApiCredential(source.id)
    if (!cred) {
      onLog?.({ level: 'error', message: 'No credential stored — add one before testing' })
      return {
        ok: false,
        supported: true,
        status: 'needs_auth',
        isAuthenticated: false,
        error: 'No credential stored — add one before testing.',
      }
    }
  }

  // Probe target: the configured testEndpoint, else a bare GET on baseUrl. The
  // OAuth Bearer wins over any stale testEndpoint Authorization header.
  const method = api.testEndpoint?.method ?? 'GET'
  const extraHeaders: Record<string, string> = {
    ...(api.testEndpoint?.headers ?? {}),
    ...(oauthHeaders ?? {}),
  }
  const spec: ApiRequestSpec = {
    path: api.testEndpoint?.path ?? '',
    method,
    ...(method !== 'GET' && api.testEndpoint?.body ? { params: api.testEndpoint.body } : {}),
    ...(Object.keys(extraHeaders).length > 0 ? { extraHeaders } : {}),
  }
  const { url, init } = buildApiRequest(api, cred, spec)

  const guard = ssrfCheck(url)
  if (!guard.ok) {
    onLog?.({ level: 'error', message: `request blocked: ${guard.reason}` })
    return { ok: false, supported: true, status: 'failed', error: `request blocked: ${guard.reason}` }
  }

  const timeoutMs = opts.timeoutMs ?? source.timeoutMs
  // Invariant 1: `authType: 'query'` bakes the API key into the URL query string
  // (api-tools buildApiRequest) — strip the query before logging so no secret is
  // echoed. The path/origin is safe (baseUrl is already shown in the info table);
  // auth headers baked into `init` are never touched.
  const safeUrl = url.split('?')[0]
  onLog?.({ level: 'info', message: `Probe ${method} ${safeUrl} (timeout ${timeoutMs}ms)` })
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    // Free the socket — we classify by status only.
    await res.body?.cancel().catch(() => {})
    onLog?.({
      level: res.ok ? 'info' : 'stderr',
      message: `Response: HTTP ${res.status} ${res.statusText}`.trim(),
    })
    if (res.ok) {
      return { ok: true, supported: true, status: 'connected', isAuthenticated: true }
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        supported: true,
        status: 'needs_auth',
        isAuthenticated: false,
        error: `HTTP ${res.status} — credential rejected. Update the credential and retry.`,
      }
    }
    // Reachable but the probe path returned a non-2xx, non-auth status (e.g. a
    // 404 for a guessed test path). Soft warning: the API answered and the
    // credential wasn't rejected, so treat it as usable but surface the status.
    return {
      ok: true,
      supported: true,
      status: 'connected',
      isAuthenticated: true,
      error: `Reachable, but the test request returned HTTP ${res.status} (check testEndpoint).`,
    }
  } catch (err) {
    const msg = ctrl.signal.aborted
      ? `timed out after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : String(err)
    onLog?.({ level: 'error', message: `Request failed: ${msg}` })
    return { ok: false, supported: true, status: 'failed', isAuthenticated: false, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

// Probe a local (filesystem) source (ADR 0060 D-6, P4): the configured `path`
// must expand to an absolute path that exists AND is a readable directory →
// connected; otherwise → failed. Never throws.
async function testLocalSource(
  source: LocalSource,
  onLog?: SourceLog,
): Promise<SourceTestOutcome> {
  const abs = resolveLocalPath(source.local.path)
  if (!abs) {
    onLog?.({ level: 'error', message: `Invalid path (contains ".."): ${source.local.path}` })
    return {
      ok: false,
      supported: true,
      status: 'failed',
      error: `Invalid path (contains "..": ${source.local.path}). Use an absolute or ~-anchored folder.`,
    }
  }
  onLog?.({ level: 'info', message: `Checking folder — ${abs}` })
  try {
    const st = await stat(abs)
    if (!st.isDirectory()) {
      onLog?.({ level: 'error', message: `Not a directory: ${abs}` })
      return { ok: false, supported: true, status: 'failed', error: `Not a directory: ${abs}` }
    }
    onLog?.({ level: 'info', message: 'Folder exists and is readable' })
    return { ok: true, supported: true, status: 'connected' }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    const reason =
      code === 'ENOENT'
        ? `Folder does not exist: ${abs}`
        : code === 'EACCES'
          ? `Folder is not readable (permission denied): ${abs}`
          : err instanceof Error
            ? err.message
            : String(err)
    onLog?.({ level: 'error', message: reason })
    return { ok: false, supported: true, status: 'failed', error: reason }
  }
}

// Run the connectivity test for a source. mcp + api + local are supported. Never
// throws — a failure is an outcome. `opts.onLog` (optional) streams coarse-grained
// progress lines to the caller (source.tools' live console) — a pure observer.
export async function testSource(
  source: SourceConfig,
  opts: { timeoutMs?: number; onLog?: SourceLog } = {},
): Promise<SourceTestOutcome> {
  if (source.type === 'api') {
    return testApiSource(source, opts)
  }
  if (source.type === 'local') {
    return testLocalSource(source, opts.onLog)
  }

  // Only `mcp` remains (the union is exhausted above).
  const params = mcpConnectParams(source)

  // OAuth remote sources (ADR 0060 D-4): inject a fresh Bearer token before the
  // handshake. No/expired token that can't refresh → needs_auth immediately (the
  // user must Connect first). bearer/none keep using their `secret:` header refs,
  // resolved by mcpManager.test via expandSecrets — unchanged.
  const transport = source.mcp.transport ?? 'http'
  if (transport !== 'stdio' && source.mcp.authType === 'oauth') {
    opts.onLog?.({ level: 'info', message: 'Resolving OAuth token (auto-refresh if expired)' })
    const token = await getFreshToken(source)
    if (!token) {
      opts.onLog?.({ level: 'error', message: 'No valid OAuth token — connect first' })
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
