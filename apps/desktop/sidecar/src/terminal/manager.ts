// Interactive PTY manager for the Session workspace Terminal tab — see ADR 0019.
//
// node-pty is a native module loaded via dynamic import + graceful fallback
// (mirrors credentials/keychain.ts): if it cannot load, terminal.create returns
// a clear error and the rest of the sidecar keeps working.
//
// SECURITY (invariant #1/#3): cwd is always workspaceRoot (never from UI), the
// shell binary is fixed ($SHELL / platform default, empty arg array — no shell
// string concat), and sensitive env (OAuth/API tokens) is stripped before
// spawn so an interactive shell cannot `echo` the credential.

import { isAbsolute, resolve } from 'node:path'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'

export interface TerminalSessionRef {
  terminalId: string
  sessionId: string
  createdAt: number
}

// Một terminal đang mở, kèm ngữ cảnh đủ để tool `read_terminal` chọn đúng shell
// (runtime/tools/read-terminal-tool.ts).
export interface TerminalBufferRef {
  terminalId: string
  sessionId: string
  workspaceRoot: string
  createdAt: number
}

export interface TerminalBufferRead extends TerminalBufferRef {
  // Output THÔ (còn nguyên escape sequence ANSI) — bên đọc tự làm sạch.
  text: string
}

interface PtyProcess {
  pid: number
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

interface SpawnOptions {
  name: string
  cols: number
  rows: number
  cwd: string
  env: Record<string, string>
}

interface NodePtyModule {
  spawn(file: string, args: string[], options: SpawnOptions): PtyProcess
}

interface TerminalRecord {
  terminalId: string
  sessionId: string
  workspaceRoot: string
  createdAt: number
  pty: PtyProcess
  // Ring buffer output (xem RING BUFFER bên dưới).
  buffer: string
}

// RING BUFFER — vì sao có:
// Output của PTY chỉ được stream tới UI qua event `terminal.data`; sidecar không
// giữ lại gì. Nghĩa là model KHÔNG có cách nào đọc cái shell mà NGƯỜI DÙNG đang
// gõ (lỗi build vừa hiện, log server đang chạy…). Ta giữ lại phần đuôi output
// của mỗi terminal để tool `read_terminal` đọc được.
//
// Cắt từ ĐẦU (giữ đuôi): phần cuối màn hình mới là phần đáng đọc. Cap tính theo
// UTF-16 code unit của JS (xấp xỉ byte cho output terminal chủ yếu là ASCII) —
// đây là hàng rào chống phình bộ nhớ, không phải hạn ngạch chính xác.
const BUFFER_MAX_CHARS = 64 * 1024

function appendOutput(record: TerminalRecord, chunk: string): void {
  const next = record.buffer + chunk
  if (next.length <= BUFFER_MAX_CHARS) {
    record.buffer = next
    return
  }
  // Cắt tại ranh giới dòng gần nhất để không để lại một dòng cụt ở đầu buffer.
  const tail = next.slice(next.length - BUFFER_MAX_CHARS)
  const nl = tail.indexOf('\n')
  record.buffer = nl >= 0 ? tail.slice(nl + 1) : tail
}

// Abuse guard only — a host may open several tabs AND split each into panes, so
// this must stay well above any realistic layout. NOT a lifetime policy: a shell
// lives until the user closes it (see the note on idle-kill below).
const MAX_PER_SESSION = 20

// Strip credentials before handing env to an interactive shell (invariant #1).
const SENSITIVE_EXACT = new Set(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'])
const SENSITIVE_SUFFIX = /(_TOKEN|_KEY|_SECRET)$/i

// The sidecar is launched as `electron --run-as-node`, so its env carries flags
// that hijack any `node`/`electron` the USER runs from the shell (ELECTRON_RUN_AS_NODE
// makes an electron binary behave as plain node; NODE_OPTIONS is inherited by every
// node child). A real terminal must not leak the host process's runtime flags.
const HOST_RUNTIME_VARS = ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'ELECTRON_NO_ATTACH_CONSOLE']

// Ngữ cảnh hạ tầng của phiên (ADR 0088, task 0.13) — chỉ TÊN, không bí mật.
// Nhờ vậy người dùng gõ `aws s3 ls` trong terminal của phiên là trúng đúng
// account đang hiện trên thanh ngữ cảnh, không phải profile `default`.
export interface TerminalInfraContext {
  awsProfile?: string | undefined
  awsRegion?: string | undefined
}

function sanitizedEnv(infra?: TerminalInfraContext): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (SENSITIVE_EXACT.has(key) || SENSITIVE_SUFFIX.test(key)) continue
    if (HOST_RUNTIME_VARS.includes(key)) continue
    out[key] = value
  }
  // What a terminal emulator is expected to advertise (TERM itself is set by
  // node-pty from `name`). Only fill LANG when absent — never override the user's.
  out.TERM_PROGRAM = 'AWOG'
  out.COLORTERM = 'truecolor'
  if (!out.LANG) out.LANG = 'en_US.UTF-8'
  // Ghi ĐÈ (không phải "chỉ điền khi trống"): phiên đã ghim một account thì cái
  // đang ghim mới là sự thật, còn `AWS_PROFILE` thừa hưởng từ môi trường của
  // AWOG chính là thứ hay trỏ vào production mà không ai để ý. Bộ lọc
  // SENSITIVE_SUFFIX ở trên GIỮ NGUYÊN — nó vẫn chặn AWS_SECRET_ACCESS_KEY /
  // AWS_SESSION_TOKEN, và ta cố tình chỉ truyền tên profile.
  if (infra?.awsProfile) out.AWS_PROFILE = infra.awsProfile
  // Hai biến region, xem chú thích ở `runtime/tools/shell.ts`.
  if (infra?.awsRegion) {
    out.AWS_REGION = infra.awsRegion
    out.AWS_DEFAULT_REGION = infra.awsRegion
  }
  return out
}

function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC ?? 'powershell.exe'
  return process.env.SHELL ?? '/bin/bash'
}

// macOS GUI apps inherit a minimal env, so a non-login shell skips `.zprofile`
// (Homebrew/nvm/pyenv PATH) — Terminal.app and VS Code both spawn a LOGIN shell
// there for exactly this reason. Elsewhere the desktop session already exports
// the profile, so a plain interactive shell (like most Linux emulators) is right.
function shellArgs(shell: string): string[] {
  if (process.platform !== 'darwin') return []
  const name = shell.slice(shell.lastIndexOf('/') + 1)
  return name === 'zsh' || name === 'bash' || name === 'fish' || name === 'sh' ? ['-l'] : []
}

let modulePromise: Promise<NodePtyModule | null> | null = null

async function getPty(): Promise<NodePtyModule | null> {
  if (!modulePromise) {
    // String-join hides the specifier from tsc's static resolver — the dep is
    // optional-at-build (ADR 0019) and may not be installed yet.
    const modPath = ['node', 'pty'].join('-')
    modulePromise = import(modPath)
      .then((mod) => mod as unknown as NodePtyModule)
      .catch((err: unknown) => {
        log.warn('terminal: node-pty import failed — terminal disabled', {
          err: err instanceof Error ? err.message : String(err),
        })
        return null
      })
  }
  return modulePromise
}

class TerminalManager {
  private terminals = new Map<string, TerminalRecord>()

  private idCounter = 0

  async create(params: {
    workspaceRoot: string
    sessionId: string
    cols: number
    rows: number
    // Ngữ cảnh hạ tầng đang ghim (ADR 0088, task 0.13). Tuỳ chọn vì đường truyền
    // chưa có: TODO(0.8) — `methods/terminal.ts` phải lấy từ `SessionHeader.infra`
    // → `Project.infra` → `settings.infra` và truyền xuống đây.
    infra?: TerminalInfraContext | undefined
  }): Promise<{ terminalId: string }> {
    if (!isAbsolute(params.workspaceRoot)) {
      throw new Error('workspaceRoot must be absolute')
    }
    const pty = await getPty()
    if (!pty) throw new Error('Terminal unavailable: node-pty not installed')

    const sessionCount = [...this.terminals.values()].filter(
      (t) => t.sessionId === params.sessionId,
    ).length
    if (sessionCount >= MAX_PER_SESSION) {
      throw new Error(`Too many terminals for this session (max ${MAX_PER_SESSION})`)
    }

    const shell = defaultShell()
    const proc = pty.spawn(shell, shellArgs(shell), {
      name: 'xterm-256color',
      cols: params.cols,
      rows: params.rows,
      cwd: params.workspaceRoot,
      env: sanitizedEnv(params.infra),
    })
    return { terminalId: this.track(proc, params.sessionId, params.workspaceRoot) }
  }

  // Spawn an ARBITRARY command in a PTY — the caller supplies file/args/env fully.
  //
  // SECURITY: unlike `create()` (which fixes the shell + strips secret env itself),
  // this trusts the caller to have built a safe invocation. The one caller is
  // `methods/infra.kube-exec.ts` (`kubectl exec -it`), where: the binary comes from
  // `resolveInfraBinary` (allowlisted path), argv is built on the sidecar with the
  // pod/container names run through DNS-1123 regexes and `--context`/`--namespace`
  // injected by `withContext` (never from the UI), and env comes from `infraEnv`
  // (which routes through `filteredShellEnv` → OAuth/API tokens stripped). Do NOT
  // add a caller that forwards a UI-supplied file/args/env verbatim.
  async spawnProcess(params: {
    file: string
    args: string[]
    env: Record<string, string>
    cwd: string
    cols: number
    rows: number
    // Grouping key only (list/limit). Not a security boundary — the command safety
    // is the caller's, per the note above.
    sessionId: string
  }): Promise<{ terminalId: string }> {
    if (!isAbsolute(params.cwd)) throw new Error('cwd must be absolute')
    const pty = await getPty()
    if (!pty) throw new Error('Terminal unavailable: node-pty not installed')

    const sessionCount = [...this.terminals.values()].filter(
      (t) => t.sessionId === params.sessionId,
    ).length
    if (sessionCount >= MAX_PER_SESSION) {
      throw new Error(`Too many terminals for this session (max ${MAX_PER_SESSION})`)
    }

    const proc = pty.spawn(params.file, params.args, {
      name: 'xterm-256color',
      cols: params.cols,
      rows: params.rows,
      cwd: params.cwd,
      env: params.env,
    })
    return { terminalId: this.track(proc, params.sessionId, params.cwd) }
  }

  // Register a freshly spawned PTY: ring buffer + terminal.data/exit fan-out. Shared
  // by create() and spawnProcess() so both stream + reap identically.
  private track(proc: PtyProcess, sessionId: string, workspaceRoot: string): string {
    const terminalId = `term-${Date.now().toString(36)}-${(this.idCounter += 1).toString(36)}`
    const record: TerminalRecord = {
      terminalId,
      sessionId,
      workspaceRoot,
      createdAt: Date.now(),
      pty: proc,
      buffer: '',
    }
    this.terminals.set(terminalId, record)

    proc.onData((chunk) => {
      appendOutput(record, chunk)
      emit('terminal.data', { terminalId, sessionId, chunk })
    })
    proc.onExit(({ exitCode, signal }) => {
      this.terminals.delete(terminalId)
      emit('terminal.exit', { terminalId, sessionId, exitCode, signal })
    })

    return terminalId
  }

  write(terminalId: string, data: string): void {
    const record = this.terminals.get(terminalId)
    if (!record) throw new Error('Unknown terminal')
    record.pty.write(data)
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const record = this.terminals.get(terminalId)
    if (!record) throw new Error('Unknown terminal')
    record.pty.resize(cols, rows)
  }

  kill(terminalId: string): void {
    const record = this.terminals.get(terminalId)
    if (!record) return
    this.terminals.delete(terminalId)
    try {
      record.pty.kill()
    } catch {
      // already exited — onExit cleanup may have raced
    }
  }

  list(sessionId?: string): TerminalSessionRef[] {
    return [...this.terminals.values()]
      .filter((t) => sessionId === undefined || t.sessionId === sessionId)
      .map((t) => ({ terminalId: t.terminalId, sessionId: t.sessionId, createdAt: t.createdAt }))
  }

  // Terminal đang mở trong ĐÚNG workspace root này, mới nhất trước.
  listForWorkspace(workspaceRoot: string): TerminalBufferRef[] {
    const root = resolve(workspaceRoot)
    return [...this.terminals.values()]
      .filter((t) => resolve(t.workspaceRoot) === root)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((t) => ({
        terminalId: t.terminalId,
        sessionId: t.sessionId,
        workspaceRoot: t.workspaceRoot,
        createdAt: t.createdAt,
      }))
  }

  // Đọc đuôi ring buffer. `lines` > 0 ⇒ chỉ lấy N dòng cuối. null = không có
  // terminal đó (chưa từng tồn tại, hoặc đã thoát — record bị xoá ở onExit nên
  // buffer biến mất theo, không giữ lịch sử của shell đã chết).
  readBuffer(terminalId: string, lines?: number): TerminalBufferRead | null {
    const record = this.terminals.get(terminalId)
    if (!record) return null
    let text = record.buffer
    if (lines !== undefined && lines > 0) {
      const parts = text.split('\n')
      if (parts.length > lines) text = parts.slice(parts.length - lines).join('\n')
    }
    return {
      terminalId: record.terminalId,
      sessionId: record.sessionId,
      workspaceRoot: record.workspaceRoot,
      createdAt: record.createdAt,
      text,
    }
  }

  // NO idle-kill. A shell is a user-owned document, not a pooled resource: reaping
  // it after N minutes of silence killed shells the user had simply left open, and
  // worse, killed long-running-but-quiet commands (build/watch/ssh) mid-flight —
  // something no real terminal does. Lifetime is owned by the UI (close tab/pane,
  // host unmount) plus shutdown() below; an idle PTY costs a sleeping process.
  shutdown(): void {
    for (const record of this.terminals.values()) {
      try {
        record.pty.kill()
      } catch {
        // ignore
      }
    }
    this.terminals.clear()
  }
}

export const terminalManager = new TerminalManager()

// ─── Đọc buffer cho runtime (tool `read_terminal`) ─────────────────────────
//
// PHẠM VI = workspace root, KHÔNG phải session id. Khoá gom nhóm PTY do UI cấp
// là `ses:<Session.id số>` / `global:<project>` / `ssh:<hostId>`, trong khi runtime
// chỉ biết engine session id (`ses-…`) — hai không gian id khác nhau nên lọc theo
// session sẽ luôn rỗng. Lọc theo workspace root vừa chạy đúng (bắt được cả tab
// terminal toàn cục của cùng project, nơi người dùng gõ nhiều nhất) vừa là ranh
// giới tin cậy đúng: đúng thư mục mà agent vốn đã được Read/Write/Bash.

export function listTerminalsForWorkspace(workspaceRoot: string): TerminalBufferRef[] {
  return terminalManager.listForWorkspace(workspaceRoot)
}

export function readTerminalBuffer(
  terminalId: string,
  lines?: number,
): TerminalBufferRead | null {
  return terminalManager.readBuffer(terminalId, lines)
}

// Kill child shells with the sidecar (mirrors mcpManager). stdin-close exit
// also sends SIGHUP to children, so orphan shells are doubly guarded.
process.once('SIGTERM', () => terminalManager.shutdown())
process.once('SIGINT', () => terminalManager.shutdown())
