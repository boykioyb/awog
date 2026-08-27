// Streaming-render diagnostics for the "reply shows truncated until the app is
// restarted" bug. A cheap, always-on ring buffer that records the lifecycle of a
// streaming assistant turn at the TWO layers that can truncate a reply:
//
//   • msg   — SessionMessageItem snapshots the in-memory `message.blocks` the moment
//             the turn finalizes (how many text runs the STORE holds + their lengths).
//             Answers: "did the store/streaming layer receive the whole reply?"
//   • block — SessionTextBlock records renderSrc vs props.text across mount / stream-end
//             flush / KeepAlive (de)activate / unmount. Answers: "did a mounted block
//             stall its render below the settled text?"
//
// Only DISCRETE lifecycle events are recorded (never per-delta), so the cost is a
// handful of entries per turn — safe to leave on. When the bug reproduces, WITHOUT
// restarting the app open the DevTools console and run:
//
//     __awogStreamDiag.dump()      // prints + returns the table; copy it back to me
//     __awogStreamDiag.clear()     // reset before a fresh repro
//
// A record whose `ev` is `STALL` (block rendered fewer chars than the settled text at a
// point where it should be complete) or `msg-short` is also warned immediately, so even
// a plain console screenshot is actionable. Cross-referencing a msg `finalize` total
// with the on-disk JSONL `fullText` decides store-layer (b) vs render-layer (a); the
// block `STALL`/`unmount` rows then point at the exact stalled run.

export type StreamDiagRecord = {
  t: number // ms since the first record
  src: 'block' | 'msg'
  key: string // block instance id (bNN) or `msg#<idx>`
  ev: string // lifecycle event
  textLen: number // block: props.text length; msg: total text-block chars in memory
  renderLen: number // block: renderSrc length; msg: unused (0)
  streaming: boolean
  connected: boolean // block: root el.isConnected; msg: n/a (true)
  note?: string // freeform (role, before/after lengths, per-block breakdown)
}

const CAP = 2000
const buf: StreamDiagRecord[] = []
let t0 = 0
let installed = false
let seq = 0

// Stable per-instance id for a diag source (e.g. one SessionTextBlock). Module-scoped
// so it survives across setups; `<script setup>` top-level state would be per-instance.
export function nextDiagId(prefix = 'b'): string {
  return `${prefix}${++seq}`
}

function fmt(r: StreamDiagRecord): string {
  const lens = r.src === 'block' ? `render=${r.renderLen}/${r.textLen}` : `textTotal=${r.textLen}`
  const flags = `str=${r.streaming ? 1 : 0} con=${r.connected ? 1 : 0}`
  const note = r.note ? ` | ${r.note}` : ''
  return `${String(r.t).padStart(6)}ms ${r.src.padEnd(5)} ${r.key.padEnd(14)} ${r.ev.padEnd(12)} ${lens} ${flags}${note}`
}

function install(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  ;(window as unknown as { __awogStreamDiag: unknown }).__awogStreamDiag = {
    dump(): string {
      const text = buf.map(fmt).join('\n')
      console.warn(`[stream-diag] ${buf.length} records\n${text}`)
      return text
    },
    records: (): StreamDiagRecord[] => buf.slice(),
    clear(): void {
      buf.length = 0
      t0 = 0
      console.warn('[stream-diag] cleared')
    },
  }
}

export function streamDiag(rec: Omit<StreamDiagRecord, 't'>): void {
  install()
  const now = typeof performance !== 'undefined' ? performance.now() : 0
  if (!t0) t0 = now
  const full: StreamDiagRecord = { t: Math.round(now - t0), ...rec }
  buf.push(full)
  if (buf.length > CAP) buf.splice(0, buf.length - CAP)
  // Surface a genuine stall right away so it's visible even without dumping.
  if (rec.ev === 'STALL' || rec.ev === 'msg-short') console.warn(`[stream-diag] ${fmt(full)}`)
}
