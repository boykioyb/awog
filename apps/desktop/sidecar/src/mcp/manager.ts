// MCP connection testing + the shared stdio client for the runtime bridge.
// See ADR 0014 (spawn / env whitelist rules) + ADR 0060 D-3.
//
// Since ADR 0060 the Connections page NO LONGER keeps persistent MCP child
// processes: a source's status is derived from the last `source.test`/auth and
// persisted on the SourceConfig (connectionStatus/isAuthenticated/...), not from
// a live process. So this module dropped the start/stop/restart/idle-sweep/
// auto-start lifecycle. What remains:
//   - StdioMcpClient — the JSON-RPC-over-stdio transport, reused by the Pi
//     runtime MCP bridge (runtime/tools/mcp-tools.ts). That bridge pools its OWN
//     children per session and owns their cleanup on shutdown.
//   - mcpManager.test() — a one-shot connectivity probe (spawn ephemeral child /
//     one-shot http POST, handshake, optional auth probe, tear down). Consumed by
//     source.test + source.author's verify step. It operates on a normalized
//     McpConnectParams (mapped from an mcp source's `mcp` block by sources/test),
//     so it no longer depends on the legacy flat McpServerConfig shape.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { resolve, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { log } from '../util/logger.js'
import { HttpMcpClient, ssrfCheck } from './http-client.js'
import { expandSecrets } from './secrets.js'
import { applyBearerScheme } from './auth-headers.js'
import type { McpHealthCheck, McpTool, McpResource, SourceLog } from '../types/shared.js'

// Environment vars we pass through to children. Everything else is dropped —
// notably ANTHROPIC_API_KEY, OAuth tokens, and any leaked credential.
const ENV_WHITELIST = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR'] as const

const STDERR_RING_SIZE = 100

// Normalized connection params for a one-shot test — source-agnostic. The caller
// (sources/test.ts) maps an mcp source's `mcp` block onto this. `id` is the
// keychain account prefix used to expand `secret:KEY` env/header refs (ADR 0018).
export interface McpConnectParams {
  id: string
  transport: 'stdio' | 'http' | 'sse'
  command?: string | undefined
  args?: string[] | undefined
  env?: Record<string, string> | undefined
  cwd?: string | undefined
  url?: string | undefined
  headers?: Record<string, string> | undefined
  // http/sse auth mode. 'bearer' → the Authorization header holds a bare token
  // that applyBearerScheme prefixes with `Bearer ` after secret expansion.
  authType?: 'oauth' | 'bearer' | 'none' | undefined
  timeoutMs: number
  healthCheck?: McpHealthCheck | undefined
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

interface ToolsListResult {
  tools?: { name?: unknown; description?: unknown }[]
}

interface ResourcesListResult {
  resources?: { uri?: unknown; mimeType?: unknown }[]
}

// MCP tools/call result: tool-execution errors come back as a normal result
// with `isError: true` (NOT a JSON-RPC error), so the probe must inspect this.
interface CallToolResult {
  content?: { type?: unknown; text?: unknown }[]
  isError?: boolean
}

// Result of the optional post-handshake auth probe (tools/call).
export interface McpProbeResult {
  ok: boolean
  tool: string
  error?: string
  // The tool's returned text on success (truncated by extractCallText) — surfaced
  // as a "preview" so the UI can show the real response, confirming the token
  // returns actual data rather than only that the call didn't error.
  preview?: string
}

// Full test outcome: handshake result (tools/resources) plus the optional auth
// probe. `ok` reflects the handshake only — a failed probe leaves ok=true (the
// server IS reachable) but sets `probe.ok=false` so the caller can distinguish
// "can't connect" from "connected but token rejected".
export interface McpTestOutcome {
  ok: boolean
  tools?: McpTool[]
  resources?: McpResource[]
  error?: string
  stderr?: string[]
  probe?: McpProbeResult
}

async function buildEnv(params: McpConnectParams): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ENV_WHITELIST) {
    const val = process.env[key]
    if (typeof val === 'string') env[key] = val
  }
  // Expand `secret:KEY` placeholders against the OS keychain (ADR 0018) before
  // passing to the child. Plaintext values pass through. Missing keychain
  // entries become empty strings — the MCP server itself surfaces a clear
  // auth failure rather than the sidecar crashing.
  const expanded = await expandSecrets(params.id, params.env)
  for (const [k, v] of Object.entries(expanded)) {
    // Pass through user-declared env. Empty string still sent so MCP server
    // sees "GITHUB_TOKEN=" and can fail loudly instead of using stale value.
    env[k] = v
  }
  return env
}

function resolveCwd(params: McpConnectParams): string | undefined {
  if (!params.cwd) return undefined
  // ".." reject defensively. Resolve relative-to-home then verify scope.
  if (params.cwd.includes('..')) {
    throw new Error('cwd must not contain ".."')
  }
  const expanded =
    params.cwd === '~'
      ? homedir()
      : params.cwd.startsWith('~/')
        ? resolve(homedir(), params.cwd.slice(2))
        : params.cwd
  if (!isAbsolute(expanded)) {
    throw new Error('cwd must be absolute (or start with "~/")')
  }
  const abs = resolve(expanded)
  if (!abs.startsWith(homedir())) {
    throw new Error(`cwd must be inside ${homedir()}`)
  }
  return abs
}

// Minimal MCP client over stdio. Used both for test() and the runtime bridge.
// Exported so the Pi runtime's MCP tool bridge (runtime/tools/mcp-tools.ts) can
// reuse the SAME JSON-RPC-over-stdio transport for per-turn tools/list +
// tools/call instead of writing a second client (ADR 0029 §4 — in-process MCP).
export class StdioMcpClient {
  private nextId = 1

  private pending = new Map<number, (res: JsonRpcResponse) => void>()

  private buffer = ''

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      let nl = this.buffer.indexOf('\n')
      while (nl >= 0) {
        const line = this.buffer.slice(0, nl).trim()
        this.buffer = this.buffer.slice(nl + 1)
        if (line) this.handleLine(line)
        nl = this.buffer.indexOf('\n')
      }
    })
  }

  private handleLine(line: string): void {
    let msg: unknown
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    const m = msg as Record<string, unknown>
    if (typeof m.id !== 'number') return // notification — ignore in pha 1
    const fn = this.pending.get(m.id)
    if (!fn) return
    this.pending.delete(m.id)
    fn(m as unknown as JsonRpcResponse)
  }

  request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.nextId
    this.nextId += 1
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
    return new Promise((resolveP, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP request timeout: ${method}`))
      }, timeoutMs)
      this.pending.set(id, (res) => {
        clearTimeout(timer)
        if (res.error) {
          reject(new Error(`MCP error ${res.error.code}: ${res.error.message}`))
        } else {
          resolveP(res.result)
        }
      })
      this.child.stdin.write(`${JSON.stringify(req)}\n`)
    })
  }

  notify(method: string, params: unknown): void {
    const req = { jsonrpc: '2.0' as const, method, params }
    this.child.stdin.write(`${JSON.stringify(req)}\n`)
  }
}

// Minimal contract both StdioMcpClient and HttpMcpClient expose. Lets
// `handshake()` work for either transport without branching.
interface McpClient {
  request: (method: string, params: unknown, timeoutMs: number) => Promise<unknown>
  notify: (method: string, params: unknown) => void | Promise<void>
}

async function handshake(
  client: McpClient,
  timeoutMs: number,
): Promise<{ tools: McpTool[]; resources: McpResource[] }> {
  await client.request(
    'initialize',
    {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'awog-sidecar', version: '0.1.0' },
    },
    timeoutMs,
  )
  client.notify('notifications/initialized', {})

  let tools: McpTool[] = []
  let resources: McpResource[] = []
  try {
    const toolsRes = (await client.request('tools/list', {}, timeoutMs)) as ToolsListResult
    if (toolsRes && Array.isArray(toolsRes.tools)) {
      tools = toolsRes.tools.map((t) => ({
        name: typeof t.name === 'string' ? t.name : '(unnamed)',
        description: typeof t.description === 'string' ? t.description : '',
      }))
    }
  } catch (err) {
    log.warn('mcp: tools/list failed', { err: err instanceof Error ? err.message : String(err) })
  }
  try {
    const resRes = (await client.request('resources/list', {}, timeoutMs)) as ResourcesListResult
    if (resRes && Array.isArray(resRes.resources)) {
      resources = resRes.resources.map((r) => ({
        uri: typeof r.uri === 'string' ? r.uri : '',
        mime: typeof r.mimeType === 'string' ? r.mimeType : '',
      }))
    }
  } catch {
    // Many servers don't expose resources — silently empty.
  }
  return { tools, resources }
}

// Extract readable text from a tools/call result's content array (for surfacing
// the tool/auth error message in the UI). Capped so a huge payload can't bloat
// the RPC response.
function extractCallText(content: CallToolResult['content']): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((c) => (c && typeof c.text === 'string' ? c.text : ''))
    .filter(Boolean)
    .join('\n')
    .slice(0, 1000)
}

// Optional auth probe (invoked by test() after a successful handshake): call one
// read-only tool and report whether it authenticated. A tool-level failure
// (isError, or a JSON-RPC error like a 401 relayed by the server) → ok:false so
// the caller shows "connected but token rejected" instead of a bare "OK".
async function probeHealth(
  client: McpClient,
  hc: McpHealthCheck,
  timeoutMs: number,
): Promise<McpProbeResult> {
  try {
    const res = (await client.request(
      'tools/call',
      { name: hc.tool, arguments: hc.args ?? {} },
      timeoutMs,
    )) as CallToolResult
    if (res && res.isError) {
      return {
        ok: false,
        tool: hc.tool,
        error: extractCallText(res.content) || 'tool returned an error',
      }
    }
    const preview = extractCallText(res?.content)
    return { ok: true, tool: hc.tool, ...(preview ? { preview } : {}) }
  } catch (err) {
    return { ok: false, tool: hc.tool, error: err instanceof Error ? err.message : String(err) }
  }
}

async function spawnChild(params: McpConnectParams): Promise<ChildProcessWithoutNullStreams> {
  if (params.transport !== 'stdio') {
    throw new Error(`transport ${params.transport} not supported for stdio spawn`)
  }
  if (!params.command) {
    throw new Error('stdio server requires command')
  }
  const env = await buildEnv(params)
  const cwd = resolveCwd(params)
  // execFile-style: argv array, no shell, no interpolation.
  return spawn(params.command, params.args ?? [], {
    env,
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    // detached: false → child inherits sidecar's process group, dies with us
    detached: false,
    windowsHide: true,
  })
}

class McpManager {
  // One-shot connectivity test. Stdio: spawn ephemeral child, handshake, kill.
  // Http: ssrf guard + ephemeral POST handshake (no process). Used by
  // `source.test` (Connections "Verify" / auto-enable) and `source.author`'s
  // post-write verify.
  //
  // `opts.timeoutMs` overrides the handshake budget. Default is the params'
  // `timeoutMs`. The author-verify passes a larger value because a first
  // `npx -y <pkg>` run also downloads the package before it can speak MCP.
  //
  // `opts.onLog` (optional) receives coarse-grained progress lines + the child's
  // raw stderr live, so a caller (source.tools) can stream a "what it's doing"
  // console to the UI. It is a pure observer — never affects the outcome.
  async test(
    params: McpConnectParams,
    opts: { timeoutMs?: number; onLog?: SourceLog } = {},
  ): Promise<McpTestOutcome> {
    const timeoutMs = opts.timeoutMs ?? params.timeoutMs
    const onLog = opts.onLog
    if (params.transport === 'sse') {
      return { ok: false, error: 'sse transport not supported yet' }
    }
    if (params.transport === 'http') {
      return this.testHttp(params, timeoutMs, onLog)
    }
    return this.testStdio(params, timeoutMs, onLog)
  }

  private async testStdio(
    params: McpConnectParams,
    timeoutMs: number,
    onLog?: SourceLog,
  ): Promise<McpTestOutcome> {
    const cmd = [params.command ?? '', ...(params.args ?? [])].filter(Boolean).join(' ')
    // Command + args are safe to echo (already shown in the Connection info table);
    // the child's env — where `secret:` refs expand — is NEVER logged.
    onLog?.({ level: 'info', message: `Spawning: ${cmd || '(no command)'}` })
    let child: ChildProcessWithoutNullStreams
    try {
      child = await spawnChild(params)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      onLog?.({ level: 'error', message: `Spawn failed: ${message}` })
      return { ok: false, error: message }
    }
    const stderr: string[] = []
    const stderrRl = createInterface({ input: child.stderr, crlfDelay: Infinity })
    stderrRl.on('line', (line) => {
      if (stderr.length < STDERR_RING_SIZE) stderr.push(line)
      onLog?.({ level: 'stderr', message: line })
    })
    const client = new StdioMcpClient(child)
    try {
      onLog?.({ level: 'info', message: `Handshake — initialize + tools/list (timeout ${timeoutMs}ms)` })
      const { tools, resources } = await handshake(client, timeoutMs)
      onLog?.({
        level: 'info',
        message: `Handshake complete — ${tools.length} tool(s), ${resources.length} resource(s)`,
      })
      // Run the auth probe (if configured) on the SAME live child so it inherits
      // the token env — then tear the child down.
      let probe: McpProbeResult | undefined
      if (params.healthCheck) {
        onLog?.({ level: 'info', message: `Auth probe — calling ${params.healthCheck.tool}` })
        probe = await probeHealth(client, params.healthCheck, timeoutMs)
        onLog?.({
          level: probe.ok ? 'info' : 'error',
          message: probe.ok
            ? `Auth probe passed (${probe.tool})`
            : `Auth probe failed (${probe.tool}): ${probe.error ?? 'rejected'}`,
        })
      }
      this.killChild(child)
      onLog?.({ level: 'info', message: 'Closed connection' })
      return { ok: true, tools, resources, stderr, ...(probe ? { probe } : {}) }
    } catch (err) {
      this.killChild(child)
      const message = err instanceof Error ? err.message : String(err)
      onLog?.({ level: 'error', message: `Handshake failed: ${message}` })
      return {
        ok: false,
        error: message,
        stderr,
      }
    }
  }

  private killChild(child: ChildProcessWithoutNullStreams): void {
    try {
      child.kill('SIGTERM')
    } catch {
      // ignore
    }
  }

  private async testHttp(
    params: McpConnectParams,
    timeoutMs: number,
    onLog?: SourceLog,
  ): Promise<McpTestOutcome> {
    if (!params.url) {
      onLog?.({ level: 'error', message: 'http transport requires url' })
      return { ok: false, error: 'http transport requires url' }
    }
    onLog?.({ level: 'info', message: `Connecting (HTTP) — ${params.url}` })
    const guard = ssrfCheck(params.url)
    if (!guard.ok) {
      const message = `SSRF guard rejected URL: ${guard.reason}`
      onLog?.({ level: 'error', message })
      return { ok: false, error: message }
    }
    // Header values (Authorization bearer, `secret:` header refs) are NEVER logged.
    // Prefix a bare `authType:'bearer'` token with `Bearer ` (post-expand; no-op
    // for oauth/none or an already-schemed value).
    const expandedHeaders = applyBearerScheme(
      params.authType,
      await expandSecrets(params.id, params.headers),
    )
    const client = new HttpMcpClient(params.url, expandedHeaders)
    try {
      onLog?.({ level: 'info', message: `Handshake — initialize + tools/list (timeout ${timeoutMs}ms)` })
      const { tools, resources } = await handshake(client, timeoutMs)
      onLog?.({
        level: 'info',
        message: `Handshake complete — ${tools.length} tool(s), ${resources.length} resource(s)`,
      })
      let probe: McpProbeResult | undefined
      if (params.healthCheck) {
        onLog?.({ level: 'info', message: `Auth probe — calling ${params.healthCheck.tool}` })
        probe = await probeHealth(client, params.healthCheck, timeoutMs)
        onLog?.({
          level: probe.ok ? 'info' : 'error',
          message: probe.ok
            ? `Auth probe passed (${probe.tool})`
            : `Auth probe failed (${probe.tool}): ${probe.error ?? 'rejected'}`,
        })
      }
      return { ok: true, tools, resources, ...(probe ? { probe } : {}) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      onLog?.({ level: 'error', message: `Handshake failed: ${message}` })
      return { ok: false, error: message }
    }
  }

  // No persistent MCP children remain (ADR 0060 D-3): the runtime bridge's
  // session pool (runtime/tools/mcp-tools.ts) owns cleanup of the children it
  // spawns via its own SIGTERM/SIGINT handlers. Retained as a no-op so the
  // process-exit wiring below stays in place for symmetry / future use.
  async shutdown(): Promise<void> {}
}

export const mcpManager = new McpManager()

// Wire graceful shutdown (no-op today; see shutdown()).
process.once('SIGTERM', () => {
  void mcpManager.shutdown()
})
process.once('SIGINT', () => {
  void mcpManager.shutdown()
})
