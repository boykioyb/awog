import type { SessionTokenKind } from '~/types'

export interface TextSegment {
  kind: 'text' | 'token'
  tokenKind?: SessionTokenKind
  text: string
}

/**
 * Tokenize text containing `@mention`, `$agent`, `/command` into renderable segments.
 *
 * Pure function — không phụ thuộc DOM, store, hay reactive state. Dùng cho cả
 * preview render (SessionMessageList) lẫn các caller khác cần parse cùng grammar.
 *
 * Token rules:
 * - `$<handle>` → kind `'agent'`
 * - `@<path>` chứa `/` hoặc `.` → kind `'file'`; ngược lại → kind `'skill'`
 * - `/<word>` → kind `'command'`
 *
 * @example
 * tokenizeMessage('hello $alice see @src/main.ts /run')
 * // → [{kind:'text',text:'hello '}, {kind:'token',tokenKind:'agent',text:'$alice'}, ...]
 */
export const tokenizeMessage = (text: string): TextSegment[] => {
  const out: TextSegment[] = []
  // matches @path/file, @skill, $agent, /command
  const re = /([@$])([\w./-]+)|\/(\w+)/g
  let last = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) })
    const full = m[0]
    let tk: SessionTokenKind
    if (m[1] === '$') tk = 'agent'
    else if (m[1] === '@') tk = full.includes('/') || full.includes('.') ? 'file' : 'skill'
    else tk = 'command'
    out.push({ kind: 'token', tokenKind: tk, text: full })
    last = m.index + full.length
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}
