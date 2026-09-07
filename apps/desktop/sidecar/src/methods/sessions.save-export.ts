import { z } from 'zod'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { register, RpcError } from '../transport/rpc.js'
import { loadSession } from '../sessions/store.js'
import { redactDeep } from '../sessions/redact.js'
import { loadProject } from '../projects/store.js'
import { awogHome } from '../util/path.js'
import type { Session } from '../types/shared.js'

// Persist an exported session transcript to disk. The UI renders the content
// (Markdown / standalone HTML, reusing useMarkdown) and sends it here; the SIDECAR
// owns the destination path entirely (never accepts a path from the UI) so there is
// no traversal surface. Files land in `<base>/.awog/exports/`, where base is the
// session's project root when known, else the AWOG home.
const MAX_CONTENT_BYTES = 16 * 1024 * 1024 // 16 MB — a transcript export, not a dump.

// Định dạng 'json' (WP2) KHÁC ba định dạng kia ở chỗ: nội dung do SIDECAR dựng, không
// nhận từ UI. Đây là bản xuất máy đọc được (chia sẻ / di cư) nên nó phải là transcript
// đã persist, không phải thứ UI đang render — vì vậy `content` thành optional và bị bỏ
// qua với 'json'.
const Params = z.object({
  sessionId: z.string().min(1),
  format: z.enum(['md', 'html', 'prompt', 'json']),
  content: z.string().max(MAX_CONTENT_BYTES).optional(),
})

type ExportFormat = z.infer<typeof Params>['format']

// File extension per export format. The summary "prompt" is plain markdown text, so
// it saves as `.prompt.md` — distinct from a full `.md` transcript export.
const EXT: Record<ExportFormat, string> = {
  md: 'md',
  html: 'html',
  prompt: 'prompt.md',
  json: 'json',
}

// Nhãn phiên bản của định dạng xuất JSON. Bên đọc (import / công cụ di cư) phải kiểm
// tra field này trước khi tin vào shape — nó là hợp đồng, không phải trang trí.
const JSON_EXPORT_FORMAT = 'awog.session.v1'

// Dựng bản xuất JSON có cấu trúc: header (mọi metadata của phiên trừ messages) +
// messages, TOÀN BỘ đi qua sessions/redact.ts. Xuất khẩu là file người dùng đem đi chia
// sẻ, nên một API key lỡ dán vào transcript không được đi theo (invariant #1). Bytes
// base64 của ảnh/PDF bị cắt ở đây (xem redact.ts) — chúng vẫn nằm trong
// ~/.awog/sessions/{id}/attachments/, còn file JSON thì giữ được kích thước dùng được.
function buildJsonExport(session: Session): string {
  const { messages, ...header } = session
  return JSON.stringify(
    {
      format: JSON_EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      header: redactDeep(header),
      messages: messages.map((m) => redactDeep(m)),
    },
    null,
    2,
  )
}

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

  // 'json' tự dựng nội dung; ba định dạng còn lại là bản render của UI nên phải có
  // `content` (fail fast thay vì ghi ra một file rỗng).
  let content: string
  if (params.format === 'json') {
    content = buildJsonExport(session)
  } else {
    if (params.content === undefined) throw new RpcError(-32602, 'Missing content')
    content = params.content
  }

  const shortId = params.sessionId.slice(0, 8)
  const filename = `${slugify(session.title)}-${shortId}.${EXT[params.format]}`
  const path = join(dir, filename)
  await writeFile(path, content, { encoding: 'utf8', mode: 0o600 })

  // Return the base + workspace-relative path alongside the absolute one so the UI
  // can reveal the file / open it in VS Code through the workspace-scoped shell IPC
  // (which validates root + rel — it never accepts a bare absolute path).
  return { path, root: base, rel: relative(base, path) }
})
