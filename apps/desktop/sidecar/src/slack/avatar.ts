// Ảnh nhỏ (avatar user, ảnh emoji tuỳ chỉnh) → data URI, có cache đĩa.
//
// Vì sao data URI thay vì để renderer tự `<img src="https://…slack-edge.com">`:
// renderer không được gọi ra mạng ngoài allowlist của app, và một URL ảnh từ
// payload Slack là L1. Sidecar tải qua client (allowlist host + redirect có
// kiểm soát) rồi trả bytes; renderer không bao giờ thấy URL gốc.
//
// Avatar mặc định của Slack là URL gravatar kèm `d=<ảnh mặc định trên
// slack-edge>`. Gọi gravatar vừa ngoài allowlist vừa báo cho bên thứ ba biết
// email nào đang được xem, nên đi thẳng ảnh mặc định trong `d`.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseAllowedUrl } from './client.js'
import type { SlackSession } from './session.js'
import { log } from '../util/logger.js'

const IMAGE_MAX_BYTES = 1024 * 1024
// Tải hỏng thì nghỉ một lúc mới thử lại, để một avatar chết không bị tải lại
// ở mỗi lần mở thread.
const FAILURE_COOLDOWN_MS = 30 * 60_000

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}
const EXT_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_EXT).map(([mime, ext]) => [ext, mime]),
)

const failedAt = new Map<string, number>()
const inflight = new Map<string, Promise<string | null>>()

export function resolveImageUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.hostname === 'secure.gravatar.com' || url.hostname.endsWith('.gravatar.com')) {
    const fallback = url.searchParams.get('d')
    return fallback && parseAllowedUrl(fallback) ? fallback : null
  }
  return parseAllowedUrl(raw) ? raw : null
}

function toDataUri(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString('base64')}`
}

async function readCached(base: string): Promise<string | null> {
  for (const [ext, mime] of Object.entries(EXT_MIME)) {
    try {
      // eslint-disable-next-line no-await-in-loop -- thử lần lượt vài đuôi, dừng ở cái có
      return toDataUri(mime, await readFile(`${base}.${ext}`))
    } catch {
      // chưa có đuôi này — thử tiếp
    }
  }
  return null
}

export async function dropCachedImage(base: string): Promise<void> {
  await Promise.all(Object.keys(EXT_MIME).map((ext) => rm(`${base}.${ext}`, { force: true })))
}

// `base` = đường dẫn tuyệt đối KHÔNG kèm đuôi (đuôi lấy theo content-type thật).
export async function cachedImageDataUri(
  session: SlackSession,
  rawUrl: string | null,
  base: string,
  maxBytes: number = IMAGE_MAX_BYTES,
): Promise<string | null> {
  const cached = await readCached(base)
  if (cached) return cached
  if (!rawUrl) return null
  const url = resolveImageUrl(rawUrl)
  if (!url) return null
  const last = failedAt.get(base)
  if (last !== undefined && Date.now() - last < FAILURE_COOLDOWN_MS) return null
  const running = inflight.get(base)
  if (running) return running
  const task = (async (): Promise<string | null> => {
    try {
      const { bytes, contentType } = await session.fetchBytes(url, maxBytes)
      const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
      const ext = MIME_EXT[mime]
      if (!ext) throw new Error(`unsupported image type ${mime || '(none)'}`)
      await mkdir(dirname(base), { recursive: true, mode: 0o700 })
      await writeFile(`${base}.${ext}`, bytes, { mode: 0o600 })
      failedAt.delete(base)
      return toDataUri(mime, bytes)
    } catch (err) {
      failedAt.set(base, Date.now())
      log.warn('slack: image download failed', {
        err: err instanceof Error ? err.message : String(err),
      })
      return null
    } finally {
      inflight.delete(base)
    }
  })()
  inflight.set(base, task)
  return task
}
