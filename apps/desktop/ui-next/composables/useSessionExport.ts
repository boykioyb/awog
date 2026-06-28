// Export a session transcript to Markdown or a self-contained HTML document.
//
// Rendering is client-side (reuses useMarkdown's sanitized marked+Shiki pipeline for
// the HTML body), so no transcript text is rendered by the sidecar. Saving to disk
// goes through the `sessions.save-export` RPC, which owns the destination path
// entirely (never accepts a path from the UI) — see that method for the path rules.
//
// SoC: this composable builds strings + calls IPC; it imports no fs/SDK. The export
// HTML is a standalone, neutral light document (good for sharing/printing) and is
// deliberately self-styled — it can't reference the app's CSS theme vars off-app.

import type { AssistantBlock, Session } from '~/composables/useSessionsData'
import { useMarkdown, type MdSegment } from '~/composables/useMarkdown'
import { useSidecar } from '~/composables/useSidecar'

export type ExportFormat = 'md' | 'html'

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] ?? c)

// One assistant block → a Markdown fragment. Text passes through; the other block
// kinds render as compact, readable annotations so the export is a faithful record
// of the turn (reasoning, tool steps, plan, gates) without the live-UI chrome.
function blockToMd(b: AssistantBlock): string {
  switch (b.kind) {
    case 'text':
      return b.text.trim()
    case 'thinking':
      return quote(`💭 _Thinking_\n\n${b.text.trim()}`)
    case 'step': {
      const head = `\`${b.tool}\`${b.target ? ` ${b.target}` : ''}`
      const res = b.result ? ` — ${truncate(b.result, 200)}` : ''
      return `- ${head}${res}`
    }
    case 'plan': {
      const items = b.items.map((it, i) => `${i + 1}. ${it}`).join('\n')
      return `**📋 Plan — ${b.title}**\n\n${items}`
    }
    case 'question': {
      const parts = b.items.map((q) => {
        const opts = q.options.map((o) => `  - ${o.label}`).join('\n')
        const ans = q.answer ? `\n\n  _Answer: ${q.answer}_` : ''
        return `**❓ ${q.prompt}**\n${opts}${ans}`
      })
      return parts.join('\n\n')
    }
    case 'perm':
      return `- _permission:_ \`${b.tool}\` ${b.target} (${b.status ?? 'pending'})`
    case 'steer':
      return quote(`✋ _Steering:_ ${b.text.trim()}`)
    case 'error':
      return quote(`⚠️ ${b.text.trim()}`)
    default:
      return ''
  }
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')
}

function truncate(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function roleHeading(role: 'user' | 'assistant' | 'system'): string {
  if (role === 'user') return '### 🧑 User'
  if (role === 'assistant') return '### 🤖 Assistant'
  return '### ⚙️ System'
}

export function useSessionExport() {
  const { renderMarkdown } = useMarkdown()
  const sc = useSidecar()

  // Assemble the full transcript as Markdown, with a small metadata header.
  function buildMarkdown(session: Session): string {
    const out: string[] = []
    out.push(`# ${session.title || 'Session'}`)
    const meta = [
      session.project ? `**Project:** ${session.project}` : '',
      session.model ? `**Model:** ${session.model}` : '',
      `**Exported:** ${new Date().toISOString()}`,
    ].filter(Boolean)
    if (meta.length) out.push(meta.join(' · '))

    for (const m of session.msgs) {
      out.push(roleHeading(m.role))
      if (m.role === 'assistant') {
        const body = m.blocks
          .map(blockToMd)
          .filter((s) => s.trim())
          .join('\n\n')
        out.push(body || '_(no content)_')
      } else {
        out.push(m.text.trim() || '_(empty)_')
      }
    }
    return `${out.join('\n\n')}\n`
  }

  // Render the Markdown body to sanitized HTML and wrap it in a standalone document.
  function buildHtml(session: Session): string {
    const md = buildMarkdown(session)
    const segments: MdSegment[] = renderMarkdown(md)
    const body = segments
      .map((seg) =>
        seg.type === 'html'
          ? seg.html
          : `<pre class="codeplain"><code>${escapeHtml(seg.code)}</code></pre>`,
      )
      .join('\n')
    const title = escapeHtml(session.title || 'Session')
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #f6f7f8; color: #1a1a1a;
  font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.wrap { max-width: 820px; margin: 0 auto; padding: 32px 20px 80px; }
h1 { font-size: 26px; margin: 0 0 4px; }
h3 { margin: 28px 0 8px; padding-top: 16px; border-top: 1px solid #e2e4e7; font-size: 15px; color: #555; }
p, li { overflow-wrap: anywhere; }
blockquote { margin: 8px 0; padding: 4px 14px; border-left: 3px solid #cdd1d6; color: #555; background: #eef0f2; border-radius: 4px; }
pre { background: #0d1117; color: #e6edf3; padding: 14px 16px; border-radius: 8px; overflow-x: auto; font-size: 13px; }
pre.codeplain { background: #1f2328; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
:not(pre) > code { background: #e8eaed; padding: 1px 5px; border-radius: 4px; font-size: 0.9em; }
a { color: #2563eb; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #d9dce0; padding: 6px 10px; text-align: left; }
img { max-width: 100%; }
.exp-meta { color: #777; font-size: 13px; }
</style>
</head>
<body>
<main class="wrap md">
${body}
</main>
</body>
</html>
`
  }

  function buildContent(session: Session, format: ExportFormat): string {
    return format === 'html' ? buildHtml(session) : buildMarkdown(session)
  }

  // Copy to the OS clipboard. Returns false when the clipboard API is unavailable
  // (non-secure context / browser dev) so the caller can surface a hint.
  async function copyToClipboard(content: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(content)
      return true
    } catch (err) {
      console.warn('[sessionExport] clipboard write failed', err)
      return false
    }
  }

  // Persist to disk via the sidecar. Returns the saved absolute path, or null when
  // not running in the Electron shell (browser dev) or the session has no engineId.
  async function saveToDisk(
    session: Session,
    format: ExportFormat,
    content: string,
  ): Promise<string | null> {
    if (!sc.available || !session.engineId) return null
    try {
      const res = await sc.request<{ path: string }>('sessions.save-export', {
        sessionId: session.engineId,
        format,
        content,
      })
      return res.path
    } catch (err) {
      console.warn('[sessionExport] save failed', err)
      return null
    }
  }

  return {
    buildMarkdown,
    buildHtml,
    buildContent,
    copyToClipboard,
    saveToDisk,
    canSave: sc.available,
  }
}
