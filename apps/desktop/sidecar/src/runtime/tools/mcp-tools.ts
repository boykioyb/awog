// MCP → Pi AgentTool bridge for the AWOG runtime (ADR 0029 §4, amends ADR 0014
// Q4). When a Session/Task runs under the Pi runtime, the MCP/Connection servers
// the user attached are exposed to the model as tools and executed IN-PROCESS by
// AWOG — NOT by pi's own MCP support.
//
// Key contract: `mcpServers` arrives ALREADY RESOLVED. Upstream
// (sessions.send-message.ts / tasks/agent-context.ts) has already:
//   (a) intersected the session∩agent whitelist, and
//   (b) expanded `secret:KEY` → real keychain values (mcp/secrets.ts).
// So this bridge does NOT re-do whitelist or secret expansion — it consumes the
// map as-is. It DOES honour the http SSRF guard and never logs secrets/headers.
//
// Reuse decision: short-lived clients built from `mcpServers`, reusing AWOG's
// existing client classes — `StdioMcpClient` (mcp/manager.ts) for stdio and
// `HttpMcpClient` + `ssrfCheck` (mcp/http-client.ts) for http. McpManager keeps
// no warm client references after its handshake (it retains the child process,
// not the JSON-RPC client), so there is nothing to reuse from it.
//
// Connection lifetime depends on `poolKey`:
//   - No poolKey (tasks / one-shot / subagents): a fresh stdio child per tool
//     call, killed when the call returns. Correct for STATELESS servers.
//   - poolKey set (Sessions pass their sessionId): ONE long-lived child per
//     server, reused across every turn of the session via the session pool
//     below — so STATEFUL servers (Playwright keeps its browser inside the
//     server process) survive `browser_navigate` → snapshot → click instead of
//     the browser closing the instant the first call returns. Torn down on
//     session delete, idle timeout, child death, or sidecar shutdown.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Type } from '@earendil-works/pi-ai'
import type { TextContent, ImageContent } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import type { McpServersConfig } from '../permission-types.js'
import { StdioMcpClient } from '../../mcp/manager.js'
import { HttpMcpClient, ssrfCheck } from '../../mcp/http-client.js'
import { log } from '../../util/logger.js'

// The already-resolved map handed to the runtime: Record<serverId, stdio | http
// config> (McpServersConfig). We only bridge stdio + http; other kinds are
// skipped.
type ResolvedMcpServer = McpServersConfig[string]

// Env passed through to a stdio MCP child. The resolved config's `env` already
// holds the expanded secrets; we add the minimal process env a child needs to
// find executables. AWOG credential env (ANTHROPIC_API_KEY, OAuth tokens) is
// never forwarded.
const ENV_WHITELIST = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR'] as const

// Wall-clock limit for the initialize + tools/list handshake when the server
// config doesn't specify one. Bumped well above the old 10s: `npx -y <pkg>`
// cold starts (first-run download) routinely exceed 10s and were silently
// timing out → zero tools registered. A configured `timeoutMs` overrides this,
// clamped to MCP_LIST_TIMEOUT_MAX_MS.
const MCP_LIST_TIMEOUT_DEFAULT_MS = 20_000
const MCP_LIST_TIMEOUT_MAX_MS = 60_000
const MCP_CALL_TIMEOUT_MS = 120_000

// Resolve the handshake timeout for a server: its configured budget (clamped)
// or the default. Keeps a hung server from stalling the loop while giving cold
// `npx` starts room to finish.
function listTimeoutFor(server: ResolvedMcpServer): number {
  const configured = (server as { timeoutMs?: unknown }).timeoutMs
  if (typeof configured !== 'number' || !Number.isFinite(configured)) {
    return MCP_LIST_TIMEOUT_DEFAULT_MS
  }
  return Math.min(Math.max(configured, MCP_LIST_TIMEOUT_DEFAULT_MS), MCP_LIST_TIMEOUT_MAX_MS)
}
// Cap the text we hand back to the model from a single MCP tool result.
const MCP_RESULT_MAX_CHARS = 64 * 1024

// Minimal transport contract both StdioMcpClient and HttpMcpClient satisfy —
// lets handshake/list/call work without branching on transport.
interface McpTransport {
  request: (method: string, params: unknown, timeoutMs: number) => Promise<unknown>
  notify: (method: string, params: unknown) => void | Promise<void>
}

// A connected client: its transport, a disposer (stdio child kill / http no-op),
// and a liveness probe. `alive()` lets the session pool detect a dead child
// (browser crashed / window closed) and respawn instead of reusing a broken one.
interface ConnectedClient {
  transport: McpTransport
  dispose: () => void
  alive: () => boolean
}

// Raw MCP tool descriptor from tools/list. `inputSchema` is a JSON Schema object
// (or absent). We keep it `unknown` and narrow defensively.
interface RawMcpTool {
  name: string
  description?: unknown
  inputSchema?: unknown
}

interface ToolsListResult {
  tools?: unknown[]
}

interface ToolCallResult {
  content?: unknown
  isError?: unknown
}

function isStdioServer(s: ResolvedMcpServer): s is { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> } {
  // stdio when `type` is 'stdio' (or absent for forward-compat) and a `command`
  // is present.
  const t = (s as { type?: unknown }).type
  return (t === undefined || t === 'stdio') && typeof (s as { command?: unknown }).command === 'string'
}

function isHttpServer(s: ResolvedMcpServer): s is { type: 'http'; url: string; headers?: Record<string, string> } {
  return (s as { type?: unknown }).type === 'http' && typeof (s as { url?: unknown }).url === 'string'
}

function stdioEnv(extra: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ENV_WHITELIST) {
    const val = process.env[key]
    if (typeof val === 'string') env[key] = val
  }
  // Already-expanded secrets from upstream. Pass through verbatim (never logged).
  if (extra) {
    for (const [k, v] of Object.entries(extra)) env[k] = v
  }
  return env
}

// Connect a per-turn client. stdio: spawn the resolved command and wrap the
// child in StdioMcpClient; http: SSRF-guard the URL then build HttpMcpClient.
// Returns null when the server kind is unsupported or the SSRF guard rejects —
// the caller skips that server (no thrown error fails the whole turn).
function connect(serverId: string, server: ResolvedMcpServer): ConnectedClient | null {
  if (isHttpServer(server)) {
    const guard = ssrfCheck(server.url)
    if (!guard.ok) {
      log.warn('mcp bridge: SSRF guard rejected http server, skipping', {
        serverId,
        reason: guard.reason,
      })
      return null
    }
    const client = new HttpMcpClient(server.url, server.headers ?? {})
    return { transport: client, dispose: () => {}, alive: () => true }
  }
  if (isStdioServer(server)) {
    let child: ChildProcessWithoutNullStreams
    try {
      // execFile-style argv array; no shell, no interpolation.
      child = spawn(server.command, server.args ?? [], {
        env: stdioEnv(server.env),
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
        windowsHide: true,
      })
    } catch (err) {
      log.warn('mcp bridge: failed to spawn stdio server, skipping', {
        serverId,
        err: err instanceof Error ? err.message : String(err),
      })
      return null
    }
    // Drain stderr so the child never blocks on a full pipe; we don't surface it.
    child.stderr.resume()
    // Swallow async spawn errors (e.g. ENOENT for a bad command) so they don't
    // become an unhandled 'error' event (which would crash the sidecar). The
    // logical failure surfaces as an initialize/tools-call timeout → skip/throw.
    child.on('error', (err) => {
      log.warn('mcp bridge: stdio child error', {
        serverId,
        err: err instanceof Error ? err.message : String(err),
      })
    })
    // Liveness flag for the session pool: flip on exit/close so a pooled
    // connection whose child died (browser closed/crashed) is detected on the
    // next acquire and respawned instead of reused.
    let alive = true
    child.once('exit', () => {
      alive = false
    })
    child.once('close', () => {
      alive = false
    })
    const client = new StdioMcpClient(child)
    const dispose = (): void => {
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore — best effort cleanup
      }
    }
    return { transport: client, dispose, alive: () => alive }
  }
  log.warn('mcp bridge: unsupported server kind, skipping', { serverId })
  return null
}

// MCP initialize handshake. Mirrors mcp/manager.ts so a bridged client behaves
// the same as a McpManager-started one.
async function initialize(transport: McpTransport, timeoutMs: number): Promise<void> {
  await transport.request(
    'initialize',
    {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'awog-sidecar', version: '0.1.0' },
    },
    timeoutMs,
  )
  await transport.notify('notifications/initialized', {})
}

// ─── Session MCP connection pool (per-session reuse for stateful servers) ──────
//
// Keyed by poolKey (a session's sessionId) → serverId → one long-lived,
// already-initialized client that survives across turns. Lets a Session keep a
// Playwright browser open between `browser_navigate` → snapshot → click instead
// of the per-call kill closing it. Tasks / one-shot / subagents pass no poolKey
// and never touch this pool.

interface PoolEntry {
  client: ConnectedClient
  // initialize() runs exactly once per connection; every caller awaits this.
  ready: Promise<void>
  // Redacted config fingerprint (no secret VALUES) — respawn when it drifts.
  configKey: string
  lastActivityAt: number
}

// poolKey (sessionId) → serverId → entry.
const POOL = new Map<string, Map<string, PoolEntry>>()

// Idle backstop: a session's MCP child is stopped after this long with no tool
// activity, freeing a lingering browser. Longer than McpManager's 5 min because a
// user may pause between turns mid-task and still expect the browser to be there.
const SESSION_MCP_IDLE_MS = 15 * 60_000
const SESSION_MCP_SWEEP_MS = 60_000
let sweepTimer: ReturnType<typeof setInterval> | undefined

// A redacted fingerprint of the resolved config — command/url + arg list + the
// NAMES (not values) of env/header secrets. Secret values never enter this string
// (invariant 1). A drift (different command / swapped server) evicts the pooled
// child so the next acquire respawns with the new config.
function configKeyOf(server: ResolvedMcpServer): string {
  if (isHttpServer(server)) {
    return `http:${server.url}:${Object.keys(server.headers ?? {}).sort().join(',')}`
  }
  if (isStdioServer(server)) {
    const args = (server.args ?? []).join(' ')
    const envKeys = Object.keys(server.env ?? {}).sort().join(',')
    return `stdio:${server.command}:${args}:${envKeys}`
  }
  return 'unknown'
}

function evict(servers: Map<string, PoolEntry>, serverId: string, entry: PoolEntry): void {
  if (servers.get(serverId) === entry) servers.delete(serverId)
  try {
    entry.client.dispose()
  } catch {
    // best effort — the child may already be gone
  }
}

// Get-or-create a pooled, initialized client for (poolKey, serverId). Recreates
// when the prior child died or the config drifted. Returns null only when
// connect() itself fails (unsupported transport / spawn error). Callers MUST
// await the returned entry's `ready` before issuing requests.
function acquireSessionMcp(
  poolKey: string,
  serverId: string,
  server: ResolvedMcpServer,
): PoolEntry | null {
  const servers = POOL.get(poolKey) ?? new Map<string, PoolEntry>()
  POOL.set(poolKey, servers)
  const configKey = configKeyOf(server)
  const existing = servers.get(serverId)
  if (existing) {
    if (existing.configKey === configKey && existing.client.alive()) {
      existing.lastActivityAt = Date.now()
      return existing
    }
    // Stale (config changed or child dead) → drop and respawn below.
    evict(servers, serverId, existing)
  }
  const conn = connect(serverId, server)
  if (!conn) return null
  const entry: PoolEntry = {
    client: conn,
    configKey,
    lastActivityAt: Date.now(),
    ready: Promise.resolve(),
  }
  // Initialize once; on failure evict so the next turn retries with a fresh child.
  entry.ready = initialize(conn.transport, listTimeoutFor(server)).catch((err: unknown) => {
    evict(servers, serverId, entry)
    throw err
  })
  servers.set(serverId, entry)
  startSessionMcpSweep()
  return entry
}

// Dispose every pooled MCP child for a session. Called from sessions.delete so a
// closed session leaves no orphan browser running for the sidecar lifetime.
export function releaseSessionMcp(poolKey: string): void {
  const servers = POOL.get(poolKey)
  if (!servers) return
  POOL.delete(poolKey)
  for (const [serverId, entry] of servers) {
    log.info('mcp pool: releasing session server', { poolKey, serverId })
    try {
      entry.client.dispose()
    } catch {
      // best effort
    }
  }
}

function startSessionMcpSweep(): void {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [poolKey, servers] of POOL) {
      for (const [serverId, entry] of servers) {
        if (entry.client.alive() && now - entry.lastActivityAt < SESSION_MCP_IDLE_MS) continue
        log.info('mcp pool: idle-stopping session server', {
          poolKey,
          serverId,
          idleMs: now - entry.lastActivityAt,
        })
        evict(servers, serverId, entry)
      }
      if (servers.size === 0) POOL.delete(poolKey)
    }
  }, SESSION_MCP_SWEEP_MS)
  // Don't keep the event loop alive just for the sweep.
  sweepTimer.unref()
}

function shutdownSessionMcpPool(): void {
  for (const servers of POOL.values()) {
    for (const entry of servers.values()) {
      try {
        entry.client.dispose()
      } catch {
        // best effort
      }
    }
  }
  POOL.clear()
}

process.once('SIGTERM', shutdownSessionMcpPool)
process.once('SIGINT', shutdownSessionMcpPool)

// A leased transport for one tools/list or tools/call round-trip. Pooled leases
// reuse the session's long-lived client (release = no-op, child survives); plain
// leases own a fresh per-call child (release = dispose/kill).
type Lease =
  | { ok: true; transport: McpTransport; needsInit: boolean; release: () => void }
  | { ok: false; reason: string }

// Obtain a transport for (poolKey?, serverId, server). With a poolKey it returns
// the session-pooled, already-initialized client (needsInit:false). Without one
// it connects a fresh per-call client (needsInit:true) the caller disposes.
async function leaseTransport(
  poolKey: string | undefined,
  serverId: string,
  server: ResolvedMcpServer,
): Promise<Lease> {
  const notReachable = 'could not start (command not found or unsupported transport)'
  if (poolKey) {
    const entry = acquireSessionMcp(poolKey, serverId, server)
    if (!entry) return { ok: false, reason: notReachable }
    try {
      await entry.ready
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
    return { ok: true, transport: entry.client.transport, needsInit: false, release: () => {} }
  }
  const conn = connect(serverId, server)
  if (!conn) return { ok: false, reason: notReachable }
  return { ok: true, transport: conn.transport, needsInit: true, release: () => conn.dispose() }
}

// Issue a JSON-RPC request that rejects promptly if either signal aborts, while
// leaving the underlying connection INTACT — critical for pooled clients: a turn
// cancel must abandon this call without closing the session's browser. The
// orphaned request settles later via the transport's own timeout (no-op then).
function requestWithAbort(
  transport: McpTransport,
  method: string,
  params: unknown,
  timeoutMs: number,
  signals: (AbortSignal | undefined)[],
): Promise<unknown> {
  for (const s of signals) {
    if (s?.aborted) return Promise.reject(new Error('aborted'))
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      for (const s of signals) s?.removeEventListener('abort', onAbort)
    }
    const onAbort = (): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('aborted'))
    }
    for (const s of signals) s?.addEventListener('abort', onAbort, { once: true })
    transport.request(method, params, timeoutMs).then(
      (v) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(v)
      },
      (e: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        reject(e instanceof Error ? e : new Error(String(e)))
      },
    )
  })
}

function parseToolsList(raw: unknown): RawMcpTool[] {
  const list = (raw as ToolsListResult)?.tools
  if (!Array.isArray(list)) return []
  const out: RawMcpTool[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const t = item as Record<string, unknown>
    if (typeof t.name !== 'string' || t.name.length === 0) continue
    out.push({
      name: t.name,
      ...(t.description !== undefined ? { description: t.description } : {}),
      ...(t.inputSchema !== undefined ? { inputSchema: t.inputSchema } : {}),
    })
  }
  return out
}

// Map an MCP tools/call result `content` array → Pi AgentToolResult content.
// MCP content blocks are { type:'text', text } | { type:'image', data, mimeType }
// | other. We keep text + image; anything else is JSON-stringified into a text
// block so the model still sees it. Text is capped.
function mapResultContent(raw: unknown): (TextContent | ImageContent)[] {
  if (!Array.isArray(raw)) {
    // Some servers return a bare string or object — coerce to a single text block.
    const text = typeof raw === 'string' ? raw : raw === undefined ? '' : JSON.stringify(raw)
    return [{ type: 'text', text: clip(text) }]
  }
  const out: (TextContent | ImageContent)[] = []
  for (const block of raw) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (b.type === 'text' && typeof b.text === 'string') {
      out.push({ type: 'text', text: clip(b.text) })
    } else if (b.type === 'image' && typeof b.data === 'string' && typeof b.mimeType === 'string') {
      out.push({ type: 'image', data: b.data, mimeType: b.mimeType })
    } else {
      // resource / unknown block → stringify so the model still gets the payload.
      out.push({ type: 'text', text: clip(JSON.stringify(b)) })
    }
  }
  if (out.length === 0) out.push({ type: 'text', text: '(empty result)' })
  return out
}

function clip(text: string): string {
  if (text.length <= MCP_RESULT_MAX_CHARS) return text
  return `${text.slice(0, MCP_RESULT_MAX_CHARS)}\n…(truncated)`
}

// A server that was attached but couldn't expose its tools this turn. Surfaced
// to the model (buildMcpUnavailableNote) so it doesn't call absent
// mcp__<serverId>__* tools or fabricate their results when the server is down.
export interface McpLoadFailure {
  serverId: string
  reason: string
}

export interface McpToolset {
  tools: AgentTool[]
  failures: McpLoadFailure[]
}

// Build the AgentTool list for every reachable MCP server in `mcpServers`.
// Defensive per-server: a connect/list failure is captured as an McpLoadFailure
// (no secrets) and that server's tools are skipped — it never fails the whole
// turn. The returned tools own their own short-lived client; the client is
// disposed after the tool's tools/call completes (stdio child is killed).
// signal aborts in-flight work.
export async function createMcpToolDefinitions(
  mcpServers: McpServersConfig | undefined,
  signal?: AbortSignal,
  // Session pool key (sessionId). When set, every server's child is reused across
  // turns and survives until session delete / idle / shutdown (stateful servers
  // like Playwright keep their browser open). Absent → per-call spawn (default).
  poolKey?: string,
): Promise<McpToolset> {
  if (!mcpServers) return { tools: [], failures: [] }
  const entries = Object.entries(mcpServers)
  if (entries.length === 0) return { tools: [], failures: [] }

  const perServer = await Promise.all(
    entries.map((entry) => listServerTools(entry[0], entry[1], signal, poolKey)),
  )
  return {
    tools: perServer.flatMap((r) => r.tools),
    failures: perServer.flatMap((r) => (r.failure ? [r.failure] : [])),
  }
}

// Connect to one server, list its tools, synthesize an AgentTool per MCP tool.
// On any failure → { tools: [], failure } (skip + warn + report). Each
// synthesized tool reconnects per call for stdio (the listing client is
// disposed immediately) so a tool that's never invoked leaves no lingering
// child; http clients are stateless.
async function listServerTools(
  serverId: string,
  server: ResolvedMcpServer,
  signal?: AbortSignal,
  poolKey?: string,
): Promise<{ tools: AgentTool[]; failure?: McpLoadFailure }> {
  const lease = await leaseTransport(poolKey, serverId, server)
  if (!lease.ok) {
    return { tools: [], failure: { serverId, reason: lease.reason } }
  }
  let rawTools: RawMcpTool[]
  try {
    const timeout = listTimeoutFor(server)
    // Pooled leases are already initialized once per connection; only a fresh
    // per-call client needs the handshake here.
    if (lease.needsInit) await initialize(lease.transport, timeout)
    const listed = await requestWithAbort(lease.transport, 'tools/list', {}, timeout, [signal])
    rawTools = parseToolsList(listed)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    log.warn('mcp bridge: tools/list failed, skipping server', { serverId, err: reason })
    return { tools: [], failure: { serverId, reason } }
  } finally {
    // Pooled: no-op (the session keeps the child). Per-call: disposes the
    // short-lived listing child; execute() opens its own.
    lease.release()
  }

  return { tools: rawTools.map((t) => synthTool(serverId, server, t, signal, poolKey)) }
}

// A system-prompt note listing servers that were attached but failed to load.
// Returns undefined when nothing failed. Injected by run-stream.ts / invoke.ts
// so the model is told — in-band — not to call these tools or invent their
// output. This is the direct guard against the observed failure mode: a server
// silently skipped, the model promised it via the mcp-preference nudge, then
// fabricating results when every mcp__<serverId>__* call returned "not found".
export function buildMcpUnavailableNote(failures: McpLoadFailure[]): string | undefined {
  if (failures.length === 0) return undefined
  const lines = failures.map((f) => `- mcp__${f.serverId}__* — ${f.reason}`).join('\n')
  return `<mcp-unavailable>
The following MCP servers were attached to this turn but FAILED to start, so their tools are NOT available:
${lines}

Do NOT call any \`mcp__<serverId>__*\` tool for these servers, and do NOT fabricate, guess, or infer their results. If you need data only these servers can provide, tell the user the server is unavailable (include the reason above) and stop — ask them to fix the connection or supply the data another way.
</mcp-unavailable>`
}

// Synthesize one Pi AgentTool from an MCP tool descriptor.
function synthTool(
  serverId: string,
  server: ResolvedMcpServer,
  tool: RawMcpTool,
  loopSignal?: AbortSignal,
  poolKey?: string,
): AgentTool {
  // EXACT name format `mcp__<serverId>__<toolName>` — trace-mapper.ts's scalar
  // fallback, step-mapper, and the system-prompt MCP nudge in
  // sessions.send-message.ts all key off this (matches Claude Code's naming).
  const name = `mcp__${serverId}__${tool.name}`
  const description = typeof tool.description === 'string' ? tool.description : `MCP tool ${tool.name}`
  // pi AgentTool.parameters expects a TypeBox TSchema. Wrap the raw JSON Schema
  // with Type.Unsafe so pi forwards it to the provider verbatim (no re-encoding).
  // Missing schema → empty object schema.
  const parameters =
    tool.inputSchema && typeof tool.inputSchema === 'object'
      ? Type.Unsafe(tool.inputSchema)
      : Type.Object({})

  return {
    name,
    label: tool.name,
    description,
    parameters,
    async execute(_toolCallId, params, sig): Promise<AgentToolResult<unknown>> {
      // Honour both the per-call signal and the loop-level signal: if either is
      // already aborted, fail fast before connecting anything.
      if (sig?.aborted || loopSignal?.aborted) {
        throw new Error(`MCP tool ${tool.name} aborted`)
      }
      // Pooled: reuse the session's long-lived client (browser stays open).
      // Per-call: connect a fresh stdio child. A connection failure here is a real
      // tool failure → throw. Error messages never include secrets/headers.
      const lease = await leaseTransport(poolKey, serverId, server)
      if (!lease.ok) {
        throw new Error(`MCP server "${serverId}" is not reachable`)
      }
      try {
        if (lease.needsInit) await initialize(lease.transport, listTimeoutFor(server))
        // requestWithAbort rejects promptly on cancel but never disposes the
        // connection — a pooled session's browser must survive a turn cancel.
        const result = (await requestWithAbort(
          lease.transport,
          'tools/call',
          { name: tool.name, arguments: params ?? {} },
          MCP_CALL_TIMEOUT_MS,
          [sig, loopSignal],
        )) as ToolCallResult
        const content = mapResultContent(result?.content)
        // An MCP tool that returns isError:true is a NORMAL result (the model
        // should see the error text and decide). Per pi's AgentTool.execute
        // contract we only THROW on a real call failure (transport/connection) —
        // which is the catch below. Surface isError via the result content +
        // details; pi-agent-core records it without aborting the loop.
        return {
          content,
          details: { serverId, toolName: tool.name, isError: result?.isError === true, raw: result },
        }
      } catch (err) {
        // Real call failure (transport down, timeout, JSON-RPC error). Throw a
        // sanitized message — pi maps a thrown execute() to an error tool result.
        // Do NOT leak secrets/headers/args (params may contain sensitive input).
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`MCP tool ${tool.name} failed: ${message}`)
      } finally {
        // Pooled: no-op (keep the child alive for the next turn). Per-call: kills
        // the stdio child.
        lease.release()
      }
    },
  }
}
