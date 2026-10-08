// `awog` bare → dashboard. claude-style full-screen panel: what exists
// (sessions/projects/accounts/sources) + one-key shortcuts into the real
// subcommands. Single read loop, redraws on resize.

import type { Engine } from '../transport.js'
import { listProjects, cmdProjectLs, type Project } from './project.js'
import { loadCliState } from '../cli-state.js'
import { note, sgr } from '../tty.js'
import { cmdChat } from './chat.js'
import { cmdSessionLs } from './session.js'
import { cmdSourceLs } from './source.js'
import { cmdAccountLs } from './account.js'
interface SessionSummary {
  id: string
  title?: string
  updatedAt?: string
  settings?: { provider?: string; modelId?: string }
}

interface SourceSummary {
  slug: string
  name: string
  type: string
  enabled: boolean
  connectionStatus?: string
}

interface AccountBucket {
  activeAccountId?: string | null
  accounts?: Array<{ id: string; label?: string }>
}

function clear(): void {
  process.stdout.write('\x1b[2J\x1b[H')
}

function frame(lines: string[]): void {
  const w = process.stdout.columns ?? 80
  const hr = '─'.repeat(Math.max(20, w - 4))
  process.stdout.write(`\n  ${sgr.accent('awog')} ${sgr.dim('· terminal client')}\n`)
  process.stdout.write(`  ${sgr.dim(hr)}\n`)
  for (const l of lines) process.stdout.write(`${l}\n`)
  process.stdout.write(`  ${sgr.dim(hr)}\n`)
  process.stdout.write(
    `  ${sgr.dim('[c] chat  [s] sessions  [p] projects  [m] sources  [a] accounts  [q] quit')}\n`,
  )
}

async function paint(engine: Engine): Promise<void> {
  const [sessionsRes, projects, sourcesRes, accountsRes, cliState] = await Promise.all([
    engine.rpc<{ sessions?: SessionSummary[] }>('sessions.list').catch(() => ({}) as { sessions?: SessionSummary[] }),
    listProjects(engine).catch(() => [] as Project[]),
    engine.rpc<{ sources?: SourceSummary[] }>('source.list').catch(() => ({}) as { sources?: SourceSummary[] }),
    engine
      .rpc<{ providers?: Record<string, AccountBucket> }>('accounts.list')
      .catch(() => ({}) as { providers?: Record<string, AccountBucket> }),
    loadCliState(),
  ])

  const sessions = (sessionsRes.sessions ?? []).slice(0, 5)
  const sources = (sourcesRes.sources ?? []).filter((s) => s.enabled)
  const active = Object.entries(accountsRes.providers ?? {})
    .map(([p, b]) => `${p}:${b.accounts?.find((a) => a.id === b.activeAccountId)?.label ?? b.activeAccountId ?? '—'}`)
    .join('  ')
  const defProject = cliState.projectId

  const lines: string[] = []
  lines.push(`  ${sgr.bold('Sessions')} ${sgr.dim(`(${sessions.length} shown)`)}`)
  for (const s of sessions) {
    const w = process.stdout.columns ?? 80
    const title = s.title ?? ''
    const maxTitle = Math.max(10, w - 46)
    const clipped = title.length > maxTitle ? `${title.slice(0, maxTitle - 1)}…` : title
    lines.push(
      `    ${sgr.accent(s.id)}  ${sgr.dim(s.updatedAt?.slice(5, 16).replace('T', ' ') ?? '')}  ${clipped}`,
    )
  }
  lines.push('')
  lines.push(
    `  ${sgr.bold('Projects')} ${sgr.dim(`(${projects.length})`)}  ` +
      `${sgr.dim('default:')} ${defProject ? sgr.accent(defProject) : sgr.dim('—')}`,
  )
  lines.push(
    `  ${sgr.bold('Sources')}   ${sgr.dim(`${sources.filter((s) => s.connectionStatus === 'connected').length}/${sources.length} connected`)}`,
  )
  lines.push(`  ${sgr.bold('Accounts')}  ${sgr.dim(active)}`)
  frame(lines)
}

export async function cmdDash(engine: Engine): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stdout.write(
      'awog dashboard needs a TTY — commands: chat, session ls, project ls, source ls, account ls, models ls, task run, login\n',
    )
    return
  }
  // Raw mode so single keys arrive without Enter.
  process.stdin.setRawMode?.(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')

  clear()
  await paint(engine)

  const redraw = () => {
    clear()
    void paint(engine)
  }
  process.stdout.on('resize', redraw)

  const onKey = (key: string) => {
    const k = key.toLowerCase()
    if (k === 'q' || k === '\u0003' /* ctrl-c */) {
      cleanup()
      process.exit(0)
    }
    if (k === 'c') {
      cleanup()
      note(`${sgr.accent('·')} starting chat…`)
      void cmdChat(engine, {})
      return
    }
    if (k === 's' || k === 'p' || k === 'm' || k === 'a') {
      cleanup()
      const run: Record<string, () => Promise<void>> = {
        s: () => cmdSessionLs(engine, false),
        p: () => cmdProjectLs(engine, false),
        m: () => cmdSourceLs(engine, false),
        a: () => cmdAccountLs(engine, false),
      }
      void run[k]!().then(() => {
        note(sgr.dim('press any key to return to dashboard…'))
        const back = () => {
          process.stdin.off('data', back)
          cmdDash(engine).catch(() => process.exit(0))
        }
        process.stdin.on('data', back)
      })
      return
    }
  }
  process.stdin.on('data', onKey)

  function cleanup(): void {
    process.stdin.off('data', onKey)
    process.stdout.off('resize', redraw)
    process.stdin.setRawMode?.(false)
    clear()
  }
}
