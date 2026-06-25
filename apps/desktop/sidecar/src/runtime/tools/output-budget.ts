// Context-window budget for tool output (rtk mindset — https://github.com/rtk-ai/rtk).
//
// A tool result is the single biggest, least-bounded thing a turn pours into the
// model's context. The rule rtk encodes — "signal over volume" — is that a tool
// MUST cap what it hands back BEFORE it reaches the LLM, and cap it by BYTES, not
// by line count: a single minified / vendored line can be megabytes, so a
// line-only cap is no cap at all. (That is exactly how a `Grep` over a non-repo's
// `node_modules` returned ~8MB in its first 500 lines and blew one turn to 5.1M
// tokens > the 1M provider limit.)
//
// Every tool that streams file/command output to the model should funnel through
// `clampForLlm` so one pathological match can't blow the prompt. When output is
// trimmed we say so in-band and, rtk-style, hint at how to recover the rest
// (narrow the query, scope a path) instead of silently dropping it.

export interface ClampOptions {
  // Hard ceiling on lines kept (applied before the byte cap).
  maxLines?: number
  // A single line longer than this is clamped (minified/vendored one-liners).
  maxLineChars?: number
  // Total budget for the joined result. The real defence — bytes, not lines.
  maxTotalChars?: number
  // Recovery hint appended to the truncation marker (e.g. "narrow the pattern").
  hint?: string
}

const DEFAULT_MAX_LINE_CHARS = 1_000
const DEFAULT_MAX_TOTAL_CHARS = 64 * 1024

export interface ClampResult {
  text: string
  truncated: boolean
  // Lines actually kept (≤ input length) — handy for a "showing X of Y" note.
  keptLines: number
}

// Clamp an array of output lines to a context-safe budget. Order is preserved;
// each line is clamped to `maxLineChars`, then lines are accumulated until the
// `maxTotalChars` budget (or `maxLines`) is hit. Returns the joined text plus
// whether anything was dropped so the caller can append the right marker.
export function clampForLlm(lines: string[], opts: ClampOptions = {}): ClampResult {
  const maxLineChars = opts.maxLineChars ?? DEFAULT_MAX_LINE_CHARS
  const maxTotalChars = opts.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS
  const maxLines = opts.maxLines ?? lines.length

  const kept: string[] = []
  let truncated = false
  let total = 0
  for (let i = 0; i < lines.length; i++) {
    if (kept.length >= maxLines) {
      truncated = true
      break
    }
    let line = lines[i]
    if (line.length > maxLineChars) {
      line = `${line.slice(0, maxLineChars)}…(line truncated)`
      truncated = true
    }
    // +1 for the joining newline. Stop before exceeding the byte budget so the
    // result is a hard bound regardless of how few lines that is.
    if (total + line.length + 1 > maxTotalChars) {
      truncated = true
      break
    }
    kept.push(line)
    total += line.length + 1
  }

  let text = kept.join('\n')
  if (truncated) {
    text += opts.hint ? `\n…(truncated — ${opts.hint})` : '\n…(truncated)'
  }
  return { text, truncated, keptLines: kept.length }
}
