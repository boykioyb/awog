// Thin typed wrapper around the sidecar terminal.* PTY RPCs (ADR 0019). Output
// flows back asynchronously via `terminal.data` / `terminal.exit` events — use
// useSidecar().onEvent to subscribe. Ported from apps/desktop/ui.
import { useSidecar } from './useSidecar'

export type TerminalSessionRef = { terminalId: string; sessionId: string }

// Pluggable backend for WorkspaceTerminal. The default backend is a local PTY
// (terminal.*); an SSH backend (ssh.*) supplies the same shape so one xterm
// widget drives both (ADR 0063). `create` opens a channel and returns its opaque
// id; `dataEvent`/`exitEvent` are the sidecar event types to route on; `idField`
// is the payload key carrying that id (`terminalId` for PTY, `connId` for SSH).
export interface TerminalTransport {
  create: (cols: number, rows: number) => Promise<{ id: string }>
  write: (id: string, data: string) => Promise<unknown>
  resize: (id: string, cols: number, rows: number) => Promise<unknown>
  kill: (id: string) => Promise<unknown>
  dataEvent: string
  exitEvent: string
  idField: string
}

// One entry in WorkspaceTerminal's "+" new-tab dropdown. `transport` omitted →
// the host's default backend (local PTY); provided → the new tab runs on that
// transport (e.g. an SSH channel to a saved host). `icon` is an Icon name. The
// host (GlobalTerminalHost) owns the list so WorkspaceTerminal stays unaware of
// SSH/projects — it just spawns a tab with whatever transport it's handed.
export interface TerminalTabKind {
  id: string
  label: string
  icon?: string
  transport?: TerminalTransport
}

// Agent CLI mà khung chat của một phiên có thể đổi chỗ sang ("Open in CLI"). CLI
// NATIVE của phiên (claude cho anthropic, codex cho openai) tiếp tục transcript
// của chính phiên; 'devin' mở một phiên RIÊNG trong cùng workspace (engine trả
// `linked: false`). Bỏ trống `cli` khi gọi openCli → engine tự chọn native.
export type CliKind = 'claude' | 'codex' | 'devin'

// Kết quả sessions.openCli. `linked` = CLI nối tiếp transcript của phiên này
// (cli native); `alreadyOpen` = một PTY CLI còn sống đã được gắn lại thay vì
// spawn thêm một cái thứ hai.
export type OpenCliResult = {
  terminalId: string
  cli: CliKind
  linked: boolean
  alreadyOpen?: boolean
}

export function useTerminalApi() {
  const sidecar = useSidecar()
  return {
    create: (workspaceRoot: string, sessionId: string, cols: number, rows: number) =>
      sidecar.request<{ terminalId: string }>('terminal.create', {
        workspaceRoot,
        sessionId,
        cols,
        rows,
      }),
    write: (terminalId: string, data: string) =>
      sidecar.request<{ ok: true }>('terminal.write', { terminalId, data }),
    resize: (terminalId: string, cols: number, rows: number) =>
      sidecar.request<{ ok: true }>('terminal.resize', { terminalId, cols, rows }),
    kill: (terminalId: string) => sidecar.request<{ ok: true }>('terminal.kill', { terminalId }),
    list: (sessionId?: string) =>
      sidecar.request<{ terminals: TerminalSessionRef[] }>('terminal.list', {
        ...(sessionId !== undefined ? { sessionId } : {}),
      }),
    // Gắn một agent CLI thật vào workspace của phiên (PTY, gom dưới khoá
    // `cli:<engineId>`). `sessionId` là ENGINE id; `cli` bỏ trống → CLI native
    // của phiên. Lỗi engine: phiên đang bận, runtime không hỗ trợ, codex thiếu
    // thread, thiếu binary devin.
    openCli: (engineSessionId: string, cli: CliKind | undefined, cols: number, rows: number) =>
      sidecar.request<OpenCliResult>('sessions.openCli', {
        sessionId: engineSessionId,
        ...(cli !== undefined ? { cli } : {}),
        cols,
        rows,
      }),
    // Gấp các tin mới phía CLI vào transcript AWOG (hàng nhập về mang
    // `via: <cli>`). Engine cũng bắn `session.cli-synced` sau khi nhập.
    syncCli: (engineSessionId: string) =>
      sidecar.request<{ imported: number }>('sessions.syncCli', {
        sessionId: engineSessionId,
      }),
  }
}
