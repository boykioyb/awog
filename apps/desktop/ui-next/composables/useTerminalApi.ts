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
  }
}
