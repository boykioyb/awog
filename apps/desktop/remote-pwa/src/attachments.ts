import { randomId } from './util'
import type { SessionAttachment } from './types'

// Turn a picked/captured file into the attachment shape the runtime expects
// (SessionAttachment: images carry an inline base64 `url`, text files their UTF-8
// content in `preview`).
//
// Images are DOWNSCALED before they leave the phone — a modern camera shot is
// 3-8 MB and the gateway caps a WS frame at 1 MB (F-3), so a raw base64 photo
// would simply bounce. 1280px/JPEG-0.8 keeps a screenshot readable for the model
// at roughly a tenth of the bytes.

const MAX_IMAGE_EDGE = 1280
const JPEG_QUALITY = 0.8
const MAX_TEXT_CHARS = 100_000
// Budget for one message's inline attachments — applied per file here AND to the
// whole batch in the composer. Leaves headroom under the gateway's 1 MB frame cap
// for the message text + JSON envelope.
export const MAX_ATTACHMENT_BYTES = 700_000

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('Không đọc được tệp'))
    fr.readAsDataURL(file)
  })
}

function readAsText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('Không đọc được tệp'))
    fr.readAsText(file)
  })
}

interface Downscaled {
  url: string
  width: number
  height: number
}

async function downscale(file: File): Promise<Downscaled | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    return { url: canvas.toDataURL('image/jpeg', JPEG_QUALITY), width, height }
  } catch {
    return null
  }
}

const isTextual = (file: File): boolean =>
  file.type.startsWith('text/') ||
  /\.(md|txt|json|ya?ml|ts|tsx|js|jsx|vue|css|html|sh|py|go|rs|java|sql|toml|ini|log)$/i.test(
    file.name,
  )

// Returns the attachment, or throws with a user-facing reason (too big / wrong
// kind) so the composer can surface it instead of failing silently.
export async function toAttachment(file: File): Promise<SessionAttachment> {
  if (file.type.startsWith('image/')) {
    const small = await downscale(file)
    const url = small?.url ?? (await readAsDataUrl(file))
    if (url.length > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name}: ảnh quá lớn`)
    return {
      id: randomId(),
      name: file.name || 'image.jpg',
      type: 'image',
      mime: small ? 'image/jpeg' : file.type,
      url,
      size: formatSize(file.size),
      ...(small ? { width: small.width, height: small.height } : {}),
    }
  }
  if (!isTextual(file)) {
    // Binary attachments reference an on-disk path on the desktop — a phone has
    // no such path (the gateway strips it), so there is nothing to send.
    throw new Error(`${file.name}: chỉ hỗ trợ ảnh và tệp văn bản`)
  }
  const text = await readAsText(file)
  if (text.length > MAX_TEXT_CHARS) throw new Error(`${file.name}: tệp quá dài`)
  return {
    id: randomId(),
    name: file.name,
    type: 'file',
    mime: file.type || 'text/plain',
    preview: text,
    size: formatSize(file.size),
  }
}
