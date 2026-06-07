// McpManager — lifecycle for MCP server child processes (stdio only, pha 1).
// See ADR 0014 Q3 for spawn / env whitelist / backoff / process-group rules.
//
// State diagram:
//   disabled ──enable──> idle ──start──> starting ──handshake-ok──> running
//                                            │              │
//                                            └─error──> error (logs kept)
//                                                           │
//                                            └────restart──┘
//
// SDK integration (sessions): the Anthropic Agent SDK spawns its OWN process
// per query when given an `mcpServers` map (ADR 0014 Q4). McpManager runs
// in parallel to provide: persisted config, test() for UI verify, and a
// best-effort snapshot of last-known status. It does NOT bridge tool calls.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { resolve, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import * as store from './store.js'
import { HttpMcpClient, ssrfCheck } from './http-client.js'
import { expandSecrets } from './secrets.js'
import type {
  McpServerConfig,
  McpServerSnapshot,
  McpStatus,
  McpTool,
  McpResource,
} from '../types/shared.js'

// Environment vars we pass through to children. Everything else is dropped —
// notably ANTHROPIC_API_KEY, OAuth tokens, and any leaked credential.
const ENV_WHITELIST = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR'] as const

const STDERR_RING_SIZE = 100
const TEST_TIMEOUT_MS = 5000
const STOP_GRACE_MS = 2000
const BACKOFF_MS = [1000, 3000, 5000]
const CRASH_WINDOW_MS = 60_000
const MAX_CRASHES = 3
// Idle stop (Sprint 3 C2): servers started manually (autoStart=false) get
// auto-stopped after this window of inactivity to free RAM. Triggers:
// `start`/`restart`/`test` reset the timer. autoStart=true servers are
// unaffected — they're meant to stay up.
const IDLE_STOP_MS = 5 * 60_000
const IDLE_CHECK_INTERVAL_MS = 30_000

interface RuntimeState {
  status: McpStatus
  tools: McpTool[]
  resources: McpResource[]
  lastError?: string | undefined
  lastStartedAt?: string | undefined
  // Reset by start/restart/test. Idle sweep stops the process when
  // Date.now() - lastActivityAt > IDLE_STOP_MS (only for autoStart=false).
  lastActivityAt?: number | undefined
  stderr: string[]
  child?: ChildProcessWithoutNullStreams | undefined
  crashTimestamps: number[]
  restartTimer?: NodeJS.Timeout | undefined
  manualStop: boolean
}

function makeInitial(): RuntimeState {
  return {
    status: 'idle',
    tools: [],
    resources: [],
    stderr: [],
    crashTimestamps: [],
    manualStop: false,
  }
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

async function buildEnv(config: McpServerConfig): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ENV_WHITELIST) {
    const val = process.env[key]
    if (typeof val === 'string') env[key] = val
  }
  // Expand `secret:KEY` placeholders against the OS keychain (ADR 0018) before
  // passing to the child. Plaintext values pass through. Missing keychain
  // entries become empty strings — the MCP server itself surfaces a clear
  // auth failure rather than the sidecar crashing.
  const expanded = await expandSecrets(config.id, config.env)
  for (const [k, v] of Object.entries(expanded)) {
    // Pass through user-declared env. Empty string still sent so MCP server
    // sees "GITHUB_TOKEN=" and can fail loudly instead of using stale value.
    env[k] = v
  }
  return env
}

function resolveCwd(config: McpServerConfig): string | undefined {
  if (!config.cwd) return undefined
  // ".." reject defensively. Resolve relative-to-home then verify scope.
  if (config.cwd.includes('..')) {
    throw new Error('cwd must not contain ".."')
  }
  const expanded = config.cwd === '~'
    ? homedir()
    : config.cwd.startsWith('~/')
      ? resolve(homedir(), config.cwd.slice(2))
      : config.cwd
  if (!isAbsolute(expanded)) {
    throw new Error('cwd must be absolute (or start with "~/")')
  }
  const abs = resolve(expanded)
  if (!abs.startsWith(homedir())) {
    throw new Error(`cwd must be inside ${homedir()}`)
  }
  return abs
}

// Minimal MCP client over stdio. Used both for test() and start() handshake.
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

async function spawnChild(config: McpServerConfig): Promise<ChildProcessWithoutNullStreams> {
  if (config.transport !== 'stdio') {
    throw new Error(`transport ${config.transport} not supported in pha 1`)
  }
  if (!config.command) {
    throw new Error('stdio server requires command')
  }
  const env = await buildEnv(config)
  const cwd = resolveCwd(config)
  // execFile-style: argv array, no shell, no interpolation.
  return spawn(config.command, config.args ?? [], {
    env,
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    // detached: false → child inherits sidecar's process group, dies with us
    detached: false,
    windowsHide: true,
  })
}

class McpManager {
  private runtime = new Map<string, RuntimeState>()

  private getOrInit(id: string): RuntimeState {
    let st = this.runtime.get(id)
    if (!st) {
      st = makeInitial()
      this.runtime.set(id, st)
    }
    return st
  }

  private emitStatus(id: string, st: RuntimeState): void {
    emit('mcp.status', {
      id,
      status: st.status,
      lastError: st.lastError,
      tools: st.tools,
      resources: st.resources,
      lastStartedAt: st.lastStartedAt,
    })
  }

  private pushStderr(id: string, st: RuntimeState, line: string): void {
    st.stderr.push(line)
    if (st.stderr.length > STDERR_RING_SIZE) {
      st.stderr.splice(0, st.stderr.length - STDERR_RING_SIZE)
    }
    emit('mcp.stderr-line', { id, line, at: new Date().toISOString() })
  }

  async start(id: string): Promise<void> {
    const config = await store.loadServer(id)
    if (!config) throw new Error(`mcp server not found: ${id}`)
    if (config.transport === 'sse') {
      throw new Error('sse transport not supported yet')
    }
    if (config.transport === 'http') {
      return this.startHttp(id, config)
    }
    return this.startStdio(id, config)
  }

  private async startStdio(id: string, config: McpServerConfig): Promise<void> {
    const st = this.getOrInit(id)
    if (st.child) return // already running — no-op
    st.status = 'starting'
    st.lastError = undefined
    st.manualStop = false
    this.emitStatus(id, st)

    let child: ChildProcessWithoutNullStreams
    try {
      child = await spawnChild(config)
    } catch (err) {
      st.status = 'error'
      st.lastError = err instanceof Error ? err.message : String(err)
      this.emitStatus(id, st)
      throw err
    }
    st.child = child

    // stderr capture
    const stderrRl = createInterface({ input: child.stderr, crlfDelay: Infinity })
    stderrRl.on('line', (line) => {
      this.pushStderr(id, st, line)
    })

    child.on('error', (err) => {
      st.lastError = err.message
      this.pushStderr(id, st, `[spawn-error] ${err.message}`)
    })
    child.on('exit', (code, signal) => {
      this.onChildExit(id, st, code, signal)
    })

    // Handshake
    const client = new StdioMcpClient(child)
    try {
      const { tools, resources } = await handshake(client, config.timeoutMs)
      st.tools = tools
      st.resources = resources
      st.status = 'running'
      st.lastStartedAt = new Date().toISOString()
      st.lastActivityAt = Date.now()
      this.emitStatus(id, st)
    } catch (err) {
      st.lastError = err instanceof Error ? err.message : String(err)
      st.status = 'error'
      this.emitStatus(id, st)
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore
      }
    }
  }

  // HTTP transport: no process, no stderr, no crash backoff. We do a one-shot
  // handshake to verify reachability + list tools, then mark the server
  // "running" — actual tool calls are issued by the Claude Agent SDK per-query
  // (ADR 0014 Q4), not by McpManager. status is effectively "last probe
  // result"; user can click Restart to re-probe.
  private async startHttp(id: string, config: McpServerConfig): Promise<void> {
    const st = this.getOrInit(id)
    st.status = 'starting'
    st.lastError = undefined
    st.manualStop = false
    this.emitStatus(id, st)

    if (!config.url) {
      st.status = 'error'
      st.lastError = 'http transport requires url'
      this.emitStatus(id, st)
      throw new Error(st.lastError)
    }
    const guard = ssrfCheck(config.url)
    if (!guard.ok) {
      st.status = 'error'
      st.lastError = `SSRF guard rejected URL: ${guard.reason}`
      this.emitStatus(id, st)
      throw new Error(st.lastError)
    }
    // Expand `secret:KEY` placeholders in headers before fetch — ADR 0018.
    const expandedHeaders = await expandSecrets(config.id, config.headers)
    const client = new HttpMcpClient(config.url, expandedHeaders)
    try {
      const { tools, resources } = await handshake(client, config.timeoutMs)
      st.tools = tools
      st.resources = resources
      st.status = 'running'
      st.lastStartedAt = new Date().toISOString()
      st.lastActivityAt = Date.now()
      this.emitStatus(id, st)
    } catch (err) {
      st.lastError = err instanceof Error ? err.message : String(err)
      st.status = 'error'
      this.emitStatus(id, st)
    }
  }

  private onChildExit(
    id: string,
    st: RuntimeState,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    st.child = undefined
    const wasRunning = st.status === 'running' || st.status === 'starting'
    if (st.manualStop) {
      st.status = 'idle'
      st.tools = []
      st.resources = []
      this.emitStatus(id, st)
      return
    }
    if (!wasRunning) return // already error, no-op
    // Crash. Record timestamp + decide backoff vs. give up.
    const now = Date.now()
    st.crashTimestamps = st.crashTimestamps.filter((ts) => now - ts < CRASH_WINDOW_MS)
    st.crashTimestamps.push(now)
    const reason = signal ?? (code !== null ? `exit ${code}` : 'unknown')
    st.lastError = `process exited (${reason})`
    if (st.crashTimestamps.length >= MAX_CRASHES) {
      st.status = 'error'
      this.emitStatus(id, st)
      log.warn('mcp: hit crash limit, giving up', { id, crashes: st.crashTimestamps.length })
      return
    }
    const delay = BACKOFF_MS[st.crashTimestamps.length - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]
    st.status = 'starting'
    this.emitStatus(id, st)
    st.restartTimer = setTimeout(() => {
      void this.start(id).catch((err: unknown) => {
        log.warn('mcp: auto-restart failed', {
          id,
          err: err instanceof Error ? err.message : String(err),
        })
      })
    }, delay)
  }

  async stop(id: string): Promise<void> {
    const st = this.runtime.get(id)
    if (!st) return
    if (st.restartTimer) {
      clearTimeout(st.restartTimer)
      st.restartTimer = undefined
    }
    st.manualStop = true
    const child = st.child
    if (!child) {
      st.status = 'idle'
      st.tools = []
      st.resources = []
      this.emitStatus(id, st)
      return
    }
    try {
      child.kill('SIGTERM')
    } catch {
      // ignore
    }
    await new Promise<void>((resolveP) => {
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore
        }
        resolveP()
      }, STOP_GRACE_MS)
      child.once('exit', () => {
        clearTimeout(timer)
        resolveP()
      })
    })
  }

  async restart(id: string): Promise<void> {
    const st = this.getOrInit(id)
    st.crashTimestamps = []
    await this.stop(id)
    st.manualStop = false
    await this.start(id)
  }

  // One-shot connectivity test. Stdio: spawn ephemeral child, handshake, kill.
  // Http: ssrf guard + ephemeral POST handshake (no process). Used by
  // `mcp.test` RPC for the McpEditor "Verify connection" button.
  async test(
    config: McpServerConfig,
  ): Promise<{ ok: boolean; tools?: McpTool[]; resources?: McpResource[]; error?: string; stderr?: string[] }> {
    if (config.transport === 'sse') {
      return { ok: false, error: 'sse transport not supported yet' }
    }
    if (config.transport === 'http') {
      return this.testHttp(config)
    }
    return this.testStdio(config)
  }

  private async testStdio(
    config: McpServerConfig,
  ): Promise<{ ok: boolean; tools?: McpTool[]; resources?: McpResource[]; error?: string; stderr?: string[] }> {
    let child: ChildProcessWithoutNullStreams
    try {
      child = await spawnChild(config)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    const stderr: string[] = []
    const stderrRl = createInterface({ input: child.stderr, crlfDelay: Infinity })
    stderrRl.on('line', (line) => {
      if (stderr.length < STDERR_RING_SIZE) stderr.push(line)
    })
    const client = new StdioMcpClient(child)
    try {
      const { tools, resources } = await handshake(client, Math.min(config.timeoutMs, TEST_TIMEOUT_MS))
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore
      }
      return { ok: true, tools, resources, stderr }
    } catch (err) {
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        stderr,
      }
    }
  }

  private async testHttp(
    config: McpServerConfig,
  ): Promise<{ ok: boolean; tools?: McpTool[]; resources?: McpResource[]; error?: string }> {
    if (!config.url) {
      return { ok: false, error: 'http transport requires url' }
    }
    const guard = ssrfCheck(config.url)
    if (!guard.ok) {
      return { ok: false, error: `SSRF guard rejected URL: ${guard.reason}` }
    }
    const expandedHeaders = await expandSecrets(config.id, config.headers)
    const client = new HttpMcpClient(config.url, expandedHeaders)
    try {
      const { tools, resources } = await handshake(
        client,
        Math.min(config.timeoutMs, TEST_TIMEOUT_MS),
      )
      return { ok: true, tools, resources }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  getSnapshot(config: McpServerConfig): McpServerSnapshot {
    const st = this.runtime.get(config.id)
    const status = !config.enabled ? 'disabled' : (st?.status ?? 'idle')
    const snap: McpServerSnapshot = {
      ...config,
      status,
      tools: st?.tools ?? [],
      resources: st?.resources ?? [],
    }
    if (st?.lastError) snap.lastError = st.lastError
    if (st?.lastStartedAt) snap.lastStartedAt = st.lastStartedAt
    return snap
  }

  getStderr(id: string): string[] {
    return this.runtime.get(id)?.stderr.slice() ?? []
  }

  async shutdown(): Promise<void> {
    const ids = [...this.runtime.keys()]
    await Promise.all(ids.map((id) => this.stop(id)))
  }

  // Called by index.ts on startup. Auto-starts every enabled+autoStart server.
  async hydrateAutoStart(): Promise<void> {
    const configs = await store.listServers()
    for (const cfg of configs) {
      this.getOrInit(cfg.id)
      if (cfg.enabled && cfg.autoStart && (cfg.transport === 'stdio' || cfg.transport === 'http')) {
        // Fire-and-forget; restart-safe (AC-3). Failures land in 'error' state.
        void this.start(cfg.id).catch((err: unknown) => {
          log.warn('mcp: autoStart failed', {
            id: cfg.id,
            err: err instanceof Error ? err.message : String(err),
          })
        })
      }
    }
    this.startIdleSweep()
  }

  // Idle sweep (Sprint 3 C2) — every 30s, look for running servers whose
  // config has autoStart=false and which haven't seen activity for
  // IDLE_STOP_MS. Stop them to free RAM. autoStart=true servers (the user
  // explicitly asked to keep running) are exempt. Re-spawn is manual:
  // user clicks Restart, or session SDK spawns its own per-query process
  // (sidecar McpManager spawn is separate — ADR 0014 Q4).
  private startIdleSweep(): void {
    setInterval(() => {
      void this.sweepIdle().catch((err: unknown) => {
        log.warn('mcp: idle sweep failed', {
          err: err instanceof Error ? err.message : String(err),
        })
      })
    }, IDLE_CHECK_INTERVAL_MS)
  }

  private async sweepIdle(): Promise<void> {
    const now = Date.now()
    const candidates: string[] = []
    for (const [id, st] of this.runtime.entries()) {
      if (st.status !== 'running') continue
      if (!st.lastActivityAt) continue
      if (now - st.lastActivityAt < IDLE_STOP_MS) continue
      candidates.push(id)
    }
    if (candidates.length === 0) return
    const configs = await store.listServers()
    const configById = new Map(configs.map((c) => [c.id, c]))
    for (const id of candidates) {
      const cfg = configById.get(id)
      // No config = file deleted while running, stop it anyway.
      // autoStart=true = exempt (user wants it kept up).
      if (cfg && cfg.autoStart) continue
      log.info('mcp: idle-stopping server', { id, idleMs: now - (this.runtime.get(id)?.lastActivityAt ?? 0) })
      // eslint-disable-next-line no-await-in-loop
      await this.stop(id)
    }
  }
}

export const mcpManager = new McpManager()

// Wire graceful shutdown so children die with the sidecar.
process.once('SIGTERM', () => {
  void mcpManager.shutdown()
})
process.once('SIGINT', () => {
  void mcpManager.shutdown()
})
