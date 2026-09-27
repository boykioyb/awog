// Per-session PTY state for the remote terminal panel. terminal.create is
// gated by the desktop's unattended switch (remote-gateway-policy); output
// arrives as terminal.data/exit events through the session subscription the
// store already holds — no second channel needed.

import { reactive } from 'vue'
import { gateway } from './gateway'
import type { TerminalDataPayload, TerminalExitPayload, TerminalRef } from './types'

export interface TermState {
  id: string
  sessionId: string
  out: string
  exited: boolean
  exitCode: number | null
}

const terms = reactive(new Map<string, TermState>())
const order = reactive(new Map<string, string[]>()) // sessionId → terminalIds

// CSI/OSC/charset escapes make sense to a real emulator; in a <pre> they render
// as garbage. This strips the common ones — it is a viewer, not xterm.js.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /(?:\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[()][0-2A-B]|\x1b[=>])/g
const stripAnsi = (s: string): string =>
  s.replace(ANSI_RE, '').replace(/\r(?!\n)/g, '\n')

const MAX_OUT = 200_000 // keep a tail, not an unbounded transcript

function state(id: string): TermState {
  let t = terms.get(id)
  if (!t) {
    t = { id, sessionId: '', out: '', exited: false, exitCode: null }
    terms.set(id, t)
  }
  return t
}

export function terminalsFor(sessionId: string): TermState[] {
  return (order.get(sessionId) ?? [])
    .map((id) => terms.get(id))
    .filter((t): t is TermState => !!t)
}

// Reconcile with the engine's list — a terminal may already exist (the desktop
// opened one, or we reconnect), otherwise create ours.
export async function ensureTerminal(
  projectId: string,
  sessionId: string,
): Promise<TermState> {
  const existing = (await gateway.request('terminal.list', { sessionId })) as {
    terminals: TerminalRef[]
  }
  for (const ref of existing.terminals) {
    const t = state(ref.terminalId)
    t.sessionId = ref.sessionId
    const ids = order.get(sessionId) ?? []
    if (!ids.includes(ref.terminalId)) order.set(sessionId, [...ids, ref.terminalId])
  }
  const mine = terminalsFor(sessionId).find((t) => !t.exited)
  if (mine) return mine

  const res = (await gateway.request('terminal.create', {
    projectId,
    sessionId,
    cols: 80,
    rows: 24,
  })) as { terminalId: string }
  const t = state(res.terminalId)
  t.sessionId = sessionId
  order.set(sessionId, [...(order.get(sessionId) ?? []), res.terminalId])
  return t
}

export function termWrite(t: TermState, data: string): void {
  void gateway.request('terminal.write', { terminalId: t.id, data }).catch(() => {})
}

export function termKill(t: TermState): void {
  void gateway.request('terminal.kill', { terminalId: t.id }).catch(() => {})
}

// Called from the store's event switch; payloads are already session-scoped by
// the gateway's subscription filter.
export function onTerminalData(p: TerminalDataPayload): void {
  const t = state(p.terminalId)
  t.sessionId = p.sessionId
  const ids = order.get(p.sessionId) ?? []
  if (!ids.includes(p.terminalId)) order.set(p.sessionId, [...ids, p.terminalId])
  t.out = stripAnsi(t.out + p.chunk).slice(-MAX_OUT)
}

export function onTerminalExit(p: TerminalExitPayload): void {
  const t = state(p.terminalId)
  t.sessionId = p.sessionId
  t.exited = true
  t.exitCode = p.exitCode
  t.out += `\n[process exited ${p.exitCode ?? '?'}${p.signal ? ` · ${p.signal}` : ''}]\n`
}
