// Minimal YAML frontmatter parser + serializer for SKILL.md files. Scope is
// deliberately small: flat key:value where the value is a string or a string
// array (flow `[a, b]` or block `- a` form). That matches the SKILL.md schema
// shared with Claude Code SDK / craft-agents-oss — anything richer is rejected
// rather than guessed, so the file shape stays predictable.

const DELIM = '---'

export interface ParsedFrontmatter {
  data: Record<string, string | string[]>
  body: string
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const lines = raw.split(/\r?\n/)
  if (lines[0]?.trim() !== DELIM) {
    return { data: {}, body: raw }
  }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === DELIM) {
      end = i
      break
    }
  }
  if (end === -1) {
    return { data: {}, body: raw }
  }
  const fmLines = lines.slice(1, end)
  const data = parseFlatYaml(fmLines)
  const body = lines.slice(end + 1).join('\n').replace(/^\n+/, '')
  return { data, body }
}

function parseFlatYaml(lines: string[]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) {
      i += 1
      continue
    }
    const colon = line.indexOf(':')
    if (colon === -1) {
      i += 1
      continue
    }
    const key = line.slice(0, colon).trim()
    const rest = line.slice(colon + 1).trim()

    if (rest === '' || rest === '|' || rest === '>') {
      // Block array on following lines, e.g.
      //   globs:
      //     - "*.ts"
      //     - "*.tsx"
      const arr: string[] = []
      let j = i + 1
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
        arr.push(unquote(lines[j].replace(/^\s*-\s+/, '').trim()))
        j += 1
      }
      if (arr.length > 0) {
        out[key] = arr
        i = j
        continue
      }
      out[key] = ''
      i += 1
      continue
    }

    if (rest.startsWith('[') && rest.endsWith(']')) {
      const inner = rest.slice(1, -1).trim()
      out[key] = inner === '' ? [] : splitFlowList(inner).map(unquote)
      i += 1
      continue
    }

    out[key] = unquote(rest)
    i += 1
  }
  return out
}

function splitFlowList(inner: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (quote) {
      if (ch === quote) quote = null
      current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    if (ch === ',') {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function unquote(value: string): string {
  if (value.length < 2) return value
  const first = value[0]
  const last = value[value.length - 1]
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'")
  }
  return value
}

// Serializer ----------------------------------------------------------------

export function serializeFrontmatter(
  data: Record<string, string | string[] | undefined>,
  body: string,
): string {
  const lines: string[] = [DELIM]
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      lines.push(`${key}:`)
      for (const item of value) lines.push(`  - ${quote(item)}`)
      continue
    }
    if (value === '') continue
    lines.push(`${key}: ${quote(value)}`)
  }
  lines.push(DELIM)
  lines.push('')
  return `${lines.join('\n')}${body.endsWith('\n') ? body : `${body}\n`}`
}

function quote(value: string): string {
  // Quote when the value would otherwise be ambiguous to a YAML parser:
  // leading/trailing whitespace, special characters, or values that look like
  // booleans/numbers. Plain words pass through unchanged for readability.
  if (/^[A-Za-z][\w .\-/]*$/.test(value) && !/^(true|false|null|yes|no)$/i.test(value)) {
    return value
  }
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}"`
}
