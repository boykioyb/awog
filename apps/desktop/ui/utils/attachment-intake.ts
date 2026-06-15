// Composer attachment intake — turns dropped / picked / pasted content into
// `SessionAttachment`s, deciding what actually reaches the model:
//   - image           → inline base64 data URL (rebuilt into an image block)
//   - text-decodable  → `preview` holds the UTF-8 content (sent as a text block)
//   - other binary    → attached display-only (chip), NOT sent to the model
//   - risky/executable→ rejected outright (exe, dll, dmg, …)
//
// Large pasted text is converted to a synthetic `pasted-text-N.txt` attachment
// via the same `preview` channel, so the composer stays clean and the content is
// delivered to the model as a delimited text block (see sidecar context-builder).
import type { SessionAttachment } from '~/types'

// Executable / installer / disk-image formats we refuse to attach. Attaching
// never executes a file, but these are binary noise to a model and the user
// explicitly asked to keep them out. Matched case-insensitively by extension.
const RISKY_EXTENSIONS = new Set<string>([
  'exe',
  'msi',
  'bat',
  'cmd',
  'com',
  'scr',
  'cpl',
  'ps1',
  'vbs',
  'vbe',
  'jse',
  'wsf',
  'wsh',
  'dll',
  'sys',
  'drv',
  'app',
  'dmg',
  'pkg',
  'apk',
  'ipa',
  'jar',
  'deb',
  'rpm',
  'appimage',
  'bin',
  'iso',
  'img',
])

// Per-attachment cap on text content (pasted text + text files). Bounds the
// JSONL session file and the per-turn token cost (resume re-feeds every turn).
// ~256k chars ≈ 64k tokens worst case — generous but not unbounded.
export const MAX_TEXT_ATTACHMENT_CHARS = 256 * 1024

// Read at most this many bytes off a file before sniffing/decoding. Caps memory
// for huge files and is sized to cover MAX_TEXT_ATTACHMENT_CHARS even for
// multi-byte UTF-8 (anything beyond is truncated content anyway).
const MAX_FILE_READ_BYTES = 1024 * 1024

const TRUNCATE_MARKER = '\n\n[... truncated: content too large to attach in full ...]'

// Default threshold (chars) above which a plain-text paste becomes an
// attachment instead of inline composer text. User-tunable in Settings.
export const DEFAULT_PASTE_THRESHOLD = 2000

export const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export const isRiskyFileName = (name: string): boolean => RISKY_EXTENSIONS.has(extensionOf(name))

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length

const newAttachmentId = (): string => `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

// Cap text content to MAX_TEXT_ATTACHMENT_CHARS, appending a visible marker when
// truncated so neither the user nor the model mistakes it for the full content.
const capText = (text: string): { value: string; truncated: boolean } =>
  text.length > MAX_TEXT_ATTACHMENT_CHARS
    ? { value: text.slice(0, MAX_TEXT_ATTACHMENT_CHARS) + TRUNCATE_MARKER, truncated: true }
    : { value: text, truncated: false }

const readDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })

// Heuristic binary sniff: a NUL byte in the first 8KB means "not text" (the same
// rule Git uses). Cheap and good enough to avoid feeding binary garbage as text.
const looksBinary = (buf: ArrayBuffer): boolean => {
  const view = new Uint8Array(buf, 0, Math.min(buf.byteLength, 8192))
  return view.includes(0)
}

export type FileIntake =
  | { ok: true; attachment: SessionAttachment; truncated: boolean }
  | { ok: false; reason: 'risky'; name: string }

// Classify + read one File into an intake outcome. Sequentially safe to call via
// Promise.all over a FileList.
export const intakeFile = async (file: File): Promise<FileIntake> => {
  if (isRiskyFileName(file.name)) {
    return { ok: false, reason: 'risky', name: file.name }
  }

  const base = {
    id: newAttachmentId(),
    name: file.name,
    size: formatBytes(file.size),
    ...(file.type ? { mime: file.type } : {}),
  }

  if (file.type.startsWith('image/')) {
    const url = await readDataUrl(file).catch(() => undefined)
    return {
      ok: true,
      truncated: false,
      attachment: { ...base, type: 'image', ...(url ? { url } : {}) },
    }
  }

  // Non-image: read the head only, deliver as text when decodable, else
  // display-only. Slicing first bounds memory for huge files.
  const slice = file.size > MAX_FILE_READ_BYTES ? file.slice(0, MAX_FILE_READ_BYTES) : file
  const buf = await slice.arrayBuffer().catch(() => null)
  if (!buf || looksBinary(buf)) {
    return { ok: true, truncated: false, attachment: { ...base, type: 'file' } }
  }
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(buf)
  const { value, truncated } = capText(decoded)
  return {
    ok: true,
    truncated: truncated || file.size > MAX_FILE_READ_BYTES,
    attachment: { ...base, type: 'file', preview: value },
  }
}

// Build a synthetic `.txt` attachment from a large plain-text paste. `index` is
// 1-based and only used for a human-friendly file name in the chip.
export const buildPastedTextAttachment = (
  text: string,
  index: number,
): { attachment: SessionAttachment; truncated: boolean } => {
  const { value, truncated } = capText(text)
  return {
    truncated,
    attachment: {
      id: newAttachmentId(),
      name: `pasted-text-${index}.txt`,
      type: 'file',
      mime: 'text/plain',
      size: formatBytes(byteLength(value)),
      preview: value,
    },
  }
}
