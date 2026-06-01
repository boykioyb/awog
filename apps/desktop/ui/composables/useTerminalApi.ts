// Thin typed wrapper around the sidecar terminal.* PTY RPCs (ADR 0019). Data
// flows back asynchronously via `terminal.data` / `terminal.exit` events — use
// useSidecar().onEvent to subscribe.
import type { TerminalSessionRef } from '~/types'
import { useSidecar } from './useSidecar'

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
