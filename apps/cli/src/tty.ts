// Interactive helpers for the `awog` CLI: readline prompts on the real TTY.
// Everything goes to stderr so `-p`/piped output on stdout stays clean for
// scripting (streams the model's reply verbatim; UI chrome never mixes in).
//
// ANSI only — zero deps, honors NO_COLOR + non-TTY (styles become no-ops so
// piped output stays raw text).

import { createInterface, type Interface } from 'node:readline'

const RESET = '[0m'
const CODES = {
  reset: RESET,
  bold: '[1m',
  dim: '[2m',
  italic: '[3m',
  underline: '[4m',
  fg: {
    black: '[30m', red: '[31m', green: '[32m', yellow: '[33m',
    blue: '[34m', magenta: '[35m', cyan: '[36m', white: '[37m',
    gray: '[90m', brightRed: '[91m', brightGreen: '[92m',
    brightYellow: '[93m', brightBlue: '[94m', brightMagenta: '[95m',
    brightCyan: '[96m', brightWhite: '[97m',
  },
  bg: {
    red: '[41m', green: '[42m', yellow: '[43m',
    blue: '[44m', magenta: '[45m', cyan: '[46m',
    gray: '[100m', brightGray: '[47m',
  },
} as const

type Fg = keyof typeof CODES.fg
type Bg = keyof typeof CODES.bg

function colorsOn(): boolean {
  return Boolean(process.stderr.isTTY) && process.env.NO_COLOR === undefined
}

/** Wrap `s` in SGR codes when colors are on; plain string otherwise. */
export function style(
  s: string,
  opts: { fg?: Fg; bg?: Bg; bold?: boolean; dim?: boolean; italic?: boolean } = {},
): string {
  if (!colorsOn() || !s) return s
  let out = ''
  if (opts.bold) out += CODES.bold
  if (opts.dim) out += CODES.dim
  if (opts.italic) out += CODES.italic
  if (opts.fg) out += CODES.fg[opts.fg]
  if (opts.bg) out += CODES.bg[opts.bg]
  return `${out}${s}${RESET}`
}

export const sgr = {
  accent: (s: string) => style(s, { fg: 'cyan', bold: true }),
  ok: (s: string) => style(s, { fg: 'green' }),
  warn: (s: string) => style(s, { fg: 'yellow' }),
  err: (s: string) => style(s, { fg: 'brightRed' }),
  dim: (s: string) => style(s, { dim: true }),
  bold: (s: string) => style(s, { bold: true }),
  tool: (s: string) => style(s, { fg: 'yellow' }),
  label: (s: string) => style(s, { fg: 'brightBlack' as Fg }),
}

export function isTTY(): boolean {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY)
}

// ── Status / chrome ──────────────────────────────────────────────────────────

// ── Table renderer ───────────────────────────────────────────────────────────
// Fixed-width columns aligned to the terminal. `flex` column gets the leftover
// width; cells truncate with '…'. All styling happens inside cell values via
// sgr.* — this only pads/truncates (ANSI-aware).

const ANSI_RE = /\x1b\[[0-9;]*m/g
const vis = (s: string): number => s.replace(ANSI_RE, '').length
const cut = (s: string, w: number): string => {
  const plain = s.replace(ANSI_RE, '')
  if (plain.length <= w) return s
  if (w <= 1) return plain.slice(0, w)
  // Strip styling on truncated cells: an unclosed SGR would bleed into the row.
  return `${plain.slice(0, w - 1)}…`
}

/** columns: fixed width or 'flex' (absorbs remaining terminal width). */
export function table(
  headers: string[],
  rows: string[][],
  columns: Array<number | 'flex'>,
): string {
  const width = process.stderr.isTTY ? (process.stderr.columns ?? 80) : 80
  const gap = 2
  const fixed = columns.reduce<number>((sum, c) => sum + (c === 'flex' ? 0 : c), 0)
  const gaps = gap * (columns.length - 1)
  const flexW = Math.max(
    8,
    width - fixed - gaps - 2, // 2 = left indent
  )

  const colW = columns.map((c) => (c === 'flex' ? flexW : c))

  const line = (cells: string[], isHeader = false): string => {
    const parts = cells.map((cell, i) => {
      const w = colW[i]!
      const clipped = cut(cell, w)
      const pad = ' '.repeat(Math.max(0, w - vis(clipped)))
      return isHeader ? sgr.dim(sgr.bold(clipped)) : clipped + pad
    })
    return `  ${parts.join(' '.repeat(gap))}`.trimEnd()
  }

  const out = [line(headers, true)]
  for (const row of rows) out.push(line(row))
  return out.join('\n')
}

// ── Step card renderer ───────────────────────────────────────────────────────
// Tool steps print as a rounded card: ╭─ header, │ body lines, ╰─ tail — the
// same visual idiom as the app's inline step blocks. Diff/terminal/file/list
// detail bodies are styled (add/remove lines, exit codes, paths).

function truncMiddle(s: string, w: number): string {
  const plain = s.replace(ANSI_RE, '')
  if (plain.length <= w) return s
  if (w < 8) return plain.slice(0, w)
  const half = Math.floor((w - 1) / 2)
  return `${plain.slice(0, half)}…${plain.slice(plain.length - (w - half - 1))}`
}

/** Paint one unified-diff hunk line: + green, − red, @@ cyan, rest dim. */
function paintDiffLine(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return style(line, { fg: 'green' })
  if (line.startsWith('-') && !line.startsWith('---')) return style(line, { fg: 'red' })
  if (line.startsWith('@@')) return style(line, { fg: 'cyan' })
  if (line.startsWith('+++') || line.startsWith('---')) return sgr.bold(line)
  return sgr.dim(line)
}

export interface StepCard {
  icon: string // already-styled glyph (✓/✗/⠿)
  title: string // e.g. "Edit apps/cli/src/cli.ts"
  meta?: string // right-side dim bit (+12 −3, exit 0…)
  body?: string[] // detail lines, already styled
}

export function renderStepCard(card: StepCard): string {
  const w = process.stderr.isTTY ? Math.min(process.stderr.columns ?? 80, 110) : 80
  const inner = Math.max(30, w - 4)
  const headMeta = card.meta ? ` ${sgr.dim(card.meta)}` : ''
  const head = `  ${sgr.dim('╭─')} ${card.icon} ${sgr.bold(truncMiddle(card.title, inner - 8))}${headMeta}`
  const lines = [head]
  for (const b of (card.body ?? []).slice(0, 24)) {
    lines.push(`  ${sgr.dim('│')} ${cut(b, inner)}`)
  }
  if ((card.body?.length ?? 0) > 24) {
    lines.push(`  ${sgr.dim('│')} ${sgr.dim(`… ${card.body!.length - 24} more lines`)}`)
  }
  lines.push(`  ${sgr.dim('╰─')}`)
  return lines.join('\n')
}

/** SessionStep.detail → card body lines (styled). */
export function detailBody(detail: unknown): { body?: string[] | undefined; meta?: string | undefined } {
  if (!detail || typeof detail !== 'object') return {}
  const d = detail as {
    kind?: string
    diff?: string
    content?: string
    command?: string
    output?: string
    exitCode?: number
    items?: Array<{ label?: string; path?: string; snippet?: string }>
    path?: string
  }
  if (d.kind === 'diff' && typeof d.diff === 'string') {
    const adds = (d.diff.match(/^\+[^+]/gm) ?? []).length
    const dels = (d.diff.match(/^-[^-]/gm) ?? []).length
    return {
      meta: `+${adds} −${dels}`,
      body: d.diff.split('\n').slice(0, 40).map(paintDiffLine),
    }
  }
  if (d.kind === 'terminal') {
    const out = (d.output ?? '').split('\n').slice(-14)
    return {
      meta: d.exitCode !== undefined ? `exit ${d.exitCode}` : undefined,
      body: out.map((l) => sgr.dim(l)),
    }
  }
  if (d.kind === 'file' && typeof d.content === 'string') {
    return { body: d.content.split('\n').slice(0, 30).map((l) => sgr.dim(l)) }
  }
  if (d.kind === 'list' && Array.isArray(d.items)) {
    return {
      body: d.items.slice(0, 20).map((it) =>
        `${sgr.accent(it.path ?? it.label ?? '')}${it.snippet ? sgr.dim(`  ${it.snippet.slice(0, 60)}`) : ''}`,
      ),
    }
  }
  return {}
}

export function note(msg: string): void {
  process.stderr.write(`${msg}\n`)
}

/** `· label` status line — accent dot, dim text. */
export function status(msg: string): void {
  note(`${sgr.accent('·')} ${sgr.dim(msg)}`)
}

/** Waiting spinner on stderr; call `stop()` before printing results. */
export function spinner(label: string): { stop: (final?: string) => void } {
  if (!isTTY()) return { stop: () => {} }
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let i = 0
  const line = () => `${sgr.accent(frames[i % frames.length]!)} ${sgr.dim(label)}`
  process.stderr.write(line())
  const t = setInterval(() => {
    i++
    process.stderr.write(`\r${line()}`)
  }, 80)
  return {
    stop(final?: string) {
      clearInterval(t)
      process.stderr.write(`\r\x1b[2K`)
      if (final) note(final)
    },
  }
}

// ── Shared readline ──────────────────────────────────────────────────────────
// ONE Interface owns stdin for the process's life. The REPL routes `line` to
// the chat handler; when a question (permission/choice/text) is pending, the
// next line resolves that instead — two Interfaces fighting over stdin was why
// answers once landed as chat turns.

let sharedRl: Interface | null = null
// FIFO — concurrent pending questions (two permission prompts from parallel
// tool calls) resolve in display order instead of overwriting each other.
const pendingQuestions: Array<(answer: string) => void> = []
let replHandler: ((line: string) => void) | null = null
let replClose: (() => void) | null = null

function repl(): Interface {
  if (sharedRl) return sharedRl
  sharedRl = createInterface({ input: process.stdin, output: process.stderr })
  sharedRl.on('line', (line) => {
    const t = line.trim()
    const q = pendingQuestions.shift()
    if (q) {
      q(t)
      if (!pendingQuestions.length && replHandler) sharedRl!.setPrompt(`${sgr.accent('❯')} `)
      sharedRl!.prompt()
      return
    }
    if (t.length && replHandler) replHandler(t)
    else sharedRl!.prompt()
  })
  sharedRl.on('close', () => replClose?.())
  return sharedRl
}

export async function askLine(question: string): Promise<string> {
  // REPL active → borrow its readline (the 'line' router resolves the pending
  // question). Otherwise a standalone Interface is fine — nothing else reads.
  if (sharedRl) {
    process.stderr.write(question)
    return new Promise<string>((resolve) => {
      pendingQuestions.push(resolve)
    })
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  const { promise, resolve } = Promise.withResolvers<string>()
  rl.question(question, (answer) => {
    rl.close()
    resolve(answer)
  })
  return promise
}

/** Single-key picker for permission prompts: y / n / a(lways). */
export async function askPermission(
  toolName: string,
  detail: string,
): Promise<'allow' | 'deny' | 'always'> {
  const head = `${sgr.warn('⚡')} ${sgr.bold(toolName)}`
  const body = sgr.dim(detail)
  const opts =
    `${sgr.bold('[')}${sgr.ok('y')}${sgr.bold(']')} allow  ` +
    `${sgr.bold('[')}${sgr.err('n')}${sgr.bold(']')} deny  ` +
    `${sgr.bold('[')}${sgr.accent('a')}${sgr.bold(']')} always (session)`
  if (!isTTY()) {
    process.stderr.write(`${head} ${body}\npermission required but no TTY — denying\n`)
    return 'deny'
  }
  process.stderr.write(`\n${head}\n  ${body}\n  ${opts}: `)
  const answer = (await askLine('')).trim().toLowerCase()
  if (answer === 'a' || answer === 'always') return 'always'
  if (answer === 'n' || answer === 'no') return 'deny'
  return 'allow'
}

/** Numbered picker for AskUserQuestion: one option per line, digits select. */
export async function askChoice(
  header: string,
  question: string,
  options: Array<{ label: string; description?: string }>,
  multiSelect: boolean,
): Promise<string[]> {
  process.stderr.write(
    `\n${sgr.accent('?')} ${header ? `${sgr.dim(`${header} — `)}` : ''}${sgr.bold(question)}\n`,
  )
  options.forEach((o, i) => {
    process.stderr.write(
      `   ${sgr.dim(`${i + 1})`)} ${o.label}${o.description ? sgr.dim(` — ${o.description}`) : ''}\n`,
    )
  })
  const raw = await askLine(
    `   ${sgr.dim(multiSelect ? 'pick (comma-sep) or type a custom answer' : 'pick 1..n or type a custom answer')}: `,
  )
  const trimmed = raw.trim()
  if (!/^\d+(,\s*\d+)*$/.test(trimmed)) {
    return trimmed ? [trimmed] : []
  }
  const picks = trimmed
    .split(',')
    .map((s) => Number(s.trim()) - 1)
    .filter((i) => i >= 0 && i < options.length)
    .map((i) => options[i]!.label)
  return picks
}

/** Free-text box for 'text'/'number' AskUserQuestion kinds. */
export async function askText(header: string, question: string): Promise<string> {
  return askLine(`\n${sgr.accent('?')} ${header ? `${sgr.dim(`${header} — `)}` : ''}${question}: `)
}

// ── Markdown-lite renderer for streamed model text (TTY only) ────────────────
// Plain chunks go through verbatim; we style per completed line at flush time.
// Streaming deltas append to a line buffer; styled once the line closes.

export function createReplyRenderer(): { push: (delta: string) => void; flush: () => void } {
  let buf = ''
  let inCode = false
  const enabled = colorsOn()

  const paint = (line: string): string => {
    if (!enabled) return line
    if (/^```/.test(line)) {
      inCode = !inCode
      return sgr.dim(line)
    }
    if (inCode) return style(line, { fg: 'brightWhite', bg: 'gray' })
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) return sgr.bold(sgr.accent(h[2]!))
    if (/^\s*[-*•]\s/.test(line)) {
      return line.replace(/^(\s*)([-*•])(\s)/, (_m, a, _b, c) => `${a}${sgr.accent('•')}${c}`)
    }
    // inline `code` + **bold**
    return line
      .replace(/`([^`]+)`/g, (_m, g) => style(g as string, { fg: 'cyan' }))
      .replace(/\*\*([^*]+)\*\*/g, (_m, g) => sgr.bold(g as string))
  }

  return {
    push(delta: string) {
      buf += delta
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        process.stdout.write(`${paint(line)}\n`)
      }
    },
    flush() {
      if (buf.length) {
        process.stdout.write(paint(buf))
        buf = ''
      }
    },
  }
}

// ── REPL ─────────────────────────────────────────────────────────────────────

export function createRepl(onLine: (line: string) => void, onClose: () => void): Interface {
  const rl = repl()
  replHandler = onLine
  replClose = onClose
  rl.setPrompt(`${sgr.accent('❯')} `)
  rl.prompt()
  return rl
}

