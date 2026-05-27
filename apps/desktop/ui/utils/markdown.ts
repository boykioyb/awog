import { Marked } from 'marked'

// Use a dedicated instance so we don't mutate the global parser if other code uses marked.
const md = new Marked({
  // `gfm` + `breaks` give the most natural rendering for LLM replies (line breaks preserved,
  // tables/strikethrough supported). `html: false` (default in marked) means raw HTML in the
  // markdown source is escaped — required by AWOG security invariant #4 for L1 untrusted content.
  gfm: true,
  breaks: true,
})

export function renderMarkdown(source: string): string {
  return md.parse(source ?? '', { async: false }) as string
}
