import { z } from 'zod'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { register, RpcError } from '../transport/rpc.js'
import { loadSession } from '../sessions/store.js'
import { loadProject } from '../projects/store.js'
import { awogHome } from '../util/path.js'

// Persist an exported session transcript to disk. The UI renders the content
// (Markdown / standalone HTML, reusing useMarkdown) and sends it here; the SIDECAR
// owns the destination path entirely (never accepts a path from the UI) so there is
// no traversal surface. Files land in `<base>/.awog/exports/`, where base is the
// session's project root when known, else the AWOG home.
const MAX_CONTENT_BYTES = 16 * 1024 * 1024 // 16 MB — a transcript export, not a dump.

const Params = z.object({
  sessionId: z.string().min(1),
  format: z.enum(['md', 'html']),
  content: z.string().max(MAX_CONTENT_BYTES),
})

// Slugify a session title into a safe filename stem: keep alnum/dash/underscore,
// collapse the rest to single dashes, trim, bound length. Always non-empty.
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'session'
}

register('sessions.save-export', async (raw) => {
  const params = Params.parse(raw)
  const session = await loadSession(params.sessionId)
  if (!session) throw new RpcError(-32004, 'Session not found')

  // Resolve a safe base directory. project.path is the user's own workspace root
  // (chosen at project setup), so writing under it is expected; otherwise fall back
  // to the AWOG home. The filename is derived + slugified (no UI-supplied path).
  let base = awogHome()
  if (session.projectId) {
    const project = await loadProject(session.projectId)
    if (project?.path) base = project.path
  }
  const dir = join(base, '.awog', 'exports')
  await mkdir(dir, { recursive: true, mode: 0o700 })

  const shortId = params.sessionId.slice(0, 8)
  const filename = `${slugify(session.title)}-${shortId}.${params.format}`
  const path = join(dir, filename)
  await writeFile(path, params.content, { encoding: 'utf8', mode: 0o600 })

  // Return the base + workspace-relative path alongside the absolute one so the UI
  // can reveal the file / open it in VS Code through the workspace-scoped shell IPC
  // (which validates root + rel — it never accepts a bare absolute path).
  return { path, root: base, rel: relative(base, path) }
})
