// `awog` bare → dashboard. Bordered panel à la `claude`, painted on the
// ALTERNATE SCREEN (smcup) so repaints never stack into the user's scrollback
// and `q` restores the previous terminal content.
//
// Three modes:
//   dash       — summary (newest sessions) + hotkeys
//   picker     — `s` opens a scrollable picker over ALL sessions; enter resumes
//   transcript — `t` opens the selected session's FULL transcript; scroll it.
//
// Keys: ↑↓/j/k move/scroll, PgUp/PgDn page, g/G first/last, Enter resume,
// Esc back, c/s/p/m/a jump to the matching command, q quit.
// Zero-dep ANSI — keypress events come from readline's emitKeypressEvents.

import { emitKeypressEvents } from 'node:readline'
import type { Engine } from '../transport.js'
import { cmdProjectLs, listProjects, type Project } from './project.js'
import { loadCliState } from '../cli-state.js'
import { cut, note, sgr } from '../tty.js'
import { cmdChat, historyLines } from './chat.js'
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

const ANSI_RE = /\x1b\[[0-9;]*m/g
const visLen = (s: string) => s.replace(ANSI_RE, '').length

const ALT_ON = '\x1b[?1049h'
const ALT_OFF = '\x1b[?1049l'
const CLEAR = '\x1b[2J\x1b[H'

export async function cmdDash(engine: Engine): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stdout.write(
      'awog dashboard needs a TTY — commands: chat, session ls, project ls, source ls, account ls, models ls, task run, login\n',
    )
    return
  }

  let mode: 'dash' | 'picker' | 'transcript' = 'dash'
  let sessions: SessionSummary[] = []
  let allSessions: SessionSummary[] | null = null // picker data, fetched on `s`
  let totalSessions = 0
  let sel = 0 // dash selection
  let psel = 0 // picker selection
  let ptop = 0 // picker scroll offset
  let tlines: string[] = [] // transcript mode buffer
  let ttop = 0 // transcript scroll offset
  let tid = '' // transcript session id
  let summary = { projects: 0, defaultName: '', defaultId: '', connected: 0, sources: 0, accounts: '' }

  const W = () => Math.max(48, Math.min(process.stdout.columns ?? 80, 100))
  const IW = () => W() - 4 // borders + one space padding each side
  // Rows available for the session list inside the box: total rows minus
  // title(1) + blank(1) + top border(1) + header(1) + gap(1) + 3 info rows +
  // gap(1) + hotkeys(1) + bottom(1).
  const listRows = () => Math.max(3, (process.stdout.rows ?? 24) - 10)

  const row = (content = '') => {
    const pad = Math.max(0, IW() - visLen(content))
    return `  ${sgr.dim('│')} ${content}${' '.repeat(pad)} ${sgr.dim('│')}`
  }
  const top = (label: string) => {
    const fill = Math.max(1, IW() + 2 - visLen(label) - 3)
    return `  ${sgr.dim('╭─')} ${label} ${sgr.dim(`─${'─'.repeat(fill)}╮`)}`
  }
  const bottom = () => `  ${sgr.dim(`╰${'─'.repeat(IW() + 2)}╯`)}`

  const sessionRow = (s: SessionSummary, selected: boolean, idW: number): string => {
    const fixed = 5 + idW + 2 + 11 + 2 // marker+pad + id + gap + time + gap
    const maxTitle = Math.max(8, IW() - fixed)
    const title = s.title ?? ''
    const clipped = title.length > maxTitle ? `${title.slice(0, maxTitle - 1)}…` : title
    const time = s.updatedAt?.slice(5, 16).replace('T', ' ') ?? ''
    const marker = selected ? '▸' : ' '
    const line = ` ${marker} ${s.id.padEnd(idW)}  ${time}  ${clipped}`
    return row(selected ? sgr.inverse(line.padEnd(IW())) : line)
  }

  function paint(lines: string[], label: string): void {
    process.stdout.write(`${CLEAR}\n${top(label)}\n${lines.join('\n')}\n${bottom()}\n`)
  }

  function paintDash(): void {
    const lines: string[] = []
    const head = `Sessions (${totalSessions})`
    lines.push(
      row(
        `${sgr.bold(head)}` +
          ' '.repeat(Math.max(1, IW() - visLen(head) - 26)) +
          sgr.dim('↑↓ pick · t transcript · enter resume'),
      ),
    )
    const idW = Math.max(...sessions.map((s) => s.id.length), 4)
    for (const [i, s] of sessions.entries()) lines.push(sessionRow(s, i === sel, idW))
    lines.push(row())
    lines.push(
      row(
        `  ${sgr.bold('Projects')} ${sgr.dim(`(${summary.projects})`)}   ${sgr.dim('default:')} ${
          summary.defaultName
            ? `${sgr.accent(summary.defaultName)} ${sgr.dim(`(${summary.defaultId})`)}`
            : summary.defaultId
              ? sgr.accent(summary.defaultId)
              : sgr.dim('—')
        }`,
      ),
    )
    lines.push(row(`  ${sgr.bold('Sources')}   ${sgr.dim(`${summary.connected}/${summary.sources} connected`)}`))
    lines.push(row(`  ${sgr.bold('Accounts')}  ${sgr.dim(summary.accounts)}`))
    lines.push(row())
    lines.push(
      row(
        `  ${sgr.dim('[c]')} chat  ${sgr.dim('[s]')} session picker  ${sgr.dim('[p]')} projects  ` +
          `${sgr.dim('[m]')} sources  ${sgr.dim('[a]')} accounts  ${sgr.dim('[q]')} quit`,
      ),
    )
    paint(lines, `${sgr.accent('awog')} ${sgr.dim('· terminal client')}`)
  }

  function paintPicker(): void {
    const all = allSessions ?? []
    const visible = listRows()
    // Keep selection inside the scroll window.
    if (psel < ptop) ptop = psel
    if (psel >= ptop + visible) ptop = psel - visible + 1
    const slice = all.slice(ptop, ptop + visible)
    const idW = Math.max(...all.map((s) => s.id.length), 4)

    const lines: string[] = []
    const head = `Sessions (${all.length})`
    lines.push(
      row(
        `${sgr.bold(head)}` +
          ' '.repeat(Math.max(1, IW() - visLen(head) - 30)) +
          sgr.dim('↑↓/pgdn · t transcript · enter · esc'),
      ),
    )
    for (const [i, s] of slice.entries()) lines.push(sessionRow(s, ptop + i === psel, idW))
    // Fill the frame so the box doesn't jitter while paging.
    for (let i = slice.length; i < visible; i++) lines.push(row())
    lines.push(row())
    lines.push(
      row(
        sgr.dim(
          `  ${psel + 1}/${all.length}   ` +
            (ptop > 0 ? 'more ↑   ' : '') +
            (ptop + visible < all.length ? 'more ↓' : ''),
        ),
      ),
    )
    paint(lines, `${sgr.accent('awog')} ${sgr.dim('· session picker')}`)
  }

  // Full scrollable transcript of the selected session — t opens, esc back.
  // ttop = -1 means "pinned to the tail": the effective window start is derived
  // per paint and the sentinel survives empty/short buffers.
  function paintTranscript(): void {
    const visible = Math.max(3, (process.stdout.rows ?? 24) - 8)
    const maxTop = Math.max(0, tlines.length - visible)
    const effTop = ttop < 0 ? maxTop : Math.min(ttop, maxTop)
    const slice = tlines.slice(effTop, effTop + visible)

    const sess = (allSessions ?? []).find((s) => s.id === tid)
    const title = sess?.title ?? tid
    const lines: string[] = []
    lines.push(
      row(
        `${sgr.bold('Transcript')}${sgr.dim(`  ${tid} — ${title.slice(0, Math.max(8, IW() - 60))}`)}` +
          ' '.repeat(1) +
          sgr.dim('  ↑↓ · space/pgdn · g/G · enter resume · esc'),
      ),
    )
    for (const l of slice) lines.push(row(cut(l, IW())))
    for (let i = slice.length; i < visible; i++) lines.push(row())
    lines.push(row())
    lines.push(
      row(
        sgr.dim(
          `  line ${Math.min(effTop + 1, tlines.length)}–${Math.min(
            effTop + visible,
            tlines.length,
          )}/${tlines.length}   ` +
            (effTop > 0 ? '↑ more   ' : '') +
            (effTop + visible < tlines.length ? '↓ more' : ''),
        ),
      ),
    )
    paint(lines, `${sgr.accent('awog')} ${sgr.dim('· transcript')}`)
  }

  async function refresh(): Promise<void> {
    const [sessionsRes, projects, sourcesRes, accountsRes, cliState] = await Promise.all([
      engine.rpc<{ sessions?: SessionSummary[] }>('sessions.list').catch(() => ({}) as { sessions?: SessionSummary[] }),
      listProjects(engine).catch(() => [] as Project[]),
      engine.rpc<{ sources?: SourceSummary[] }>('source.list').catch(() => ({}) as { sources?: SourceSummary[] }),
      engine
        .rpc<{ providers?: Record<string, AccountBucket> }>('accounts.list')
        .catch(() => ({}) as { providers?: Record<string, AccountBucket> }),
      loadCliState(),
    ])

    const all = sessionsRes.sessions ?? []
    totalSessions = all.length
    allSessions = all // picker rides on the same fetch — one RPC total
    sessions = all.slice(0, listRows())
    if (sel >= sessions.length) sel = Math.max(0, sessions.length - 1)
    if (psel >= all.length) psel = Math.max(0, all.length - 1)

    const sources = (sourcesRes.sources ?? []).filter((s) => s.enabled)
    const defProj = projects.find((p) => p.id === (cliState.projectId ?? ''))
    summary = {
      projects: projects.length,
      defaultName: defProj?.name ?? '',
      defaultId: cliState.projectId ?? '',
      connected: sources.filter((s) => s.connectionStatus === 'connected').length,
      sources: sources.length,
      accounts: Object.entries(accountsRes.providers ?? {})
        .map(
          ([p, b]) => `${p}:${b.accounts?.find((a) => a.id === b.activeAccountId)?.label ?? b.activeAccountId ?? '—'}`,
        )
        .join('  '),
    }

    // transcript mode owns its own buffer — a data refresh leaves it alone
    if (mode === 'picker') paintPicker()
    else if (mode === 'dash') paintDash()
  }
  const repaint = () => {
    refresh().catch(() => {}) // a paint failure must never kill the dashboard
  }

  // ── Raw key loop on the alternate screen ────────────────────────────────────
  process.stdout.write(ALT_ON)
  emitKeypressEvents(process.stdin)
  process.stdin.setRawMode?.(true)
  process.stdin.resume()

  const cleanup = (restoreScreen: boolean) => {
    process.stdin.off('keypress', onKey)
    process.stdout.off('resize', repaint)
    process.stdin.setRawMode?.(false)
    process.stdout.write(restoreScreen ? ALT_OFF : CLEAR)
  }

  const resume = (id: string) => {
    cleanup(false) // keep the dash on scrollback; chat continues below it
    note(`${sgr.accent('·')} resuming ${id}…`)
    void cmdChat(engine, { sessionId: id })
  }

  const onKey = async (str: string, key: { name?: string; ctrl?: boolean }) => {
    const list = mode === 'picker' ? (allSessions ?? []) : sessions
    const cur = mode === 'picker' ? psel : sel

    // ── transcript mode: scroll the buffer, esc leaves, enter resumes ──────
    if (mode === 'transcript') {
      const visible = Math.max(3, (process.stdout.rows ?? 24) - 8)
      const maxTop = Math.max(0, tlines.length - visible)
      const cur = ttop < 0 ? maxTop : ttop // resolve the tail-pin once
      if (key.name === 'up' || str === 'k') {
        ttop = Math.max(0, cur - 1)
        paintTranscript()
        return
      }
      if (key.name === 'down' || str === 'j') {
        // scrolling down past the end re-pins to the tail
        const next = Math.min(maxTop, cur + 1)
        ttop = next >= maxTop ? -1 : next
        paintTranscript()
        return
      }
      if (key.name === 'pageup' || str === ' ') {
        ttop = Math.max(0, cur - visible)
        paintTranscript()
        return
      }
      if (key.name === 'pagedown') {
        const next = Math.min(maxTop, cur + visible)
        ttop = next >= maxTop ? -1 : next
        paintTranscript()
        return
      }
      if (str === 'g') {
        ttop = 0
        paintTranscript()
        return
      }
      if (str === 'G') {
        ttop = -1 // tail
        paintTranscript()
        return
      }
      if (key.name === 'return') {
        resume(tid)
        return
      }
      if (key.name === 'escape' || str.toLowerCase() === 'q') {
        mode = 'dash'
        repaint()
        return
      }
      return // swallow everything else while the transcript is up
    }

    if (key.name === 'up' || str === 'k') {
      if (mode === 'picker') psel = Math.max(0, psel - 1)
      else sel = Math.max(0, sel - 1)
      repaint()
      return
    }
    if (key.name === 'down' || str === 'j') {
      if (mode === 'picker') psel = Math.min(list.length - 1, psel + 1)
      else sel = Math.min(list.length - 1, sel + 1)
      repaint()
      return
    }
    if (mode === 'picker' && (key.name === 'pageup' || str === ' ')) {
      psel = Math.max(0, psel - listRows())
      repaint()
      return
    }
    if (mode === 'picker' && key.name === 'pagedown') {
      psel = Math.min(list.length - 1, psel + listRows())
      repaint()
      return
    }
    if (key.name === 'escape' && mode === 'picker') {
      mode = 'dash'
      repaint()
      return
    }
    if (key.name === 'return' && list[cur]) {
      resume(list[cur]!.id)
      return
    }
    const k = str.toLowerCase()
    if (k === 'q' || (key.ctrl && k === 'c')) {
      cleanup(true)
      await engine.close() // kills the spawned engine; no-op detach on socket
      process.exit(0)
    }
    if (k === 'c') {
      cleanup(false)
      note(`${sgr.accent('·')} starting chat…`)
      void cmdChat(engine, {})
      return
    }
    if (k === 's') {
      mode = mode === 'picker' ? 'dash' : 'picker'
      repaint()
      return
    }
    if (k === 't' && list[cur]) {
      // Open the FULL transcript of the selected session — scrollable.
      tid = list[cur]!.id
      mode = 'transcript'
      ttop = -1 // land at the tail on open; scroll up un-pins it
      tlines = []
      paintTranscript()
      void historyLines(engine, tid)
        .then((l) => {
          tlines = l
          if (mode === 'transcript') paintTranscript()
        })
        .catch(() => {})
      return
    }
    const run: Record<string, () => Promise<void>> = {
      p: () => cmdProjectLs(engine, false),
      m: () => cmdSourceLs(engine, false),
      a: () => cmdAccountLs(engine, false),
    }
    if (run[k]) {
      cleanup(true) // leave alt screen so the table prints into normal scrollback
      void run[k]!().then(() => {
        note(sgr.dim('press any key to return to dashboard…'))
        const back = () => {
          process.stdin.off('keypress', back)
          process.stdout.write(ALT_ON)
          repaint()
        }
        process.stdin.setRawMode?.(true)
        process.stdin.on('keypress', back)
      })
    }
  }
  process.stdin.on('keypress', onKey)
  process.stdout.on('resize', repaint)

  await refresh()
}
