// Minimal ZIP reader for the OOXML previews (docx / xlsx — both are ZIP
// containers of XML parts). Zero-dependency by design: pulling in a zip/office
// library would need an ADR (CLAUDE.md "không thêm dependency mới"), while OOXML
// only ever uses two storage methods — stored (0) and deflate (8) — and Chromium
// gives us the inflater for free via DecompressionStream('deflate-raw').
//
// Reads the central directory once (entry name → offsets) and inflates a part
// lazily on demand, so a workbook with 40 sheets only decompresses the sheets the
// user actually looks at.

/**
 * Byte buffer backed by a plain (non-shared) ArrayBuffer. Spelled out because the
 * DOM's BlobPart / DecompressionStream inputs reject a possibly-shared buffer, and
 * every producer here (base64 decode, fetch, inflate) already gives us one.
 */
export type Bytes = Uint8Array<ArrayBuffer>

export type ZipEntry = {
  name: string
  /** 0 = stored, 8 = deflate. Anything else is unsupported (throws on read). */
  method: number
  compressedSize: number
  size: number
  /** Offset of the local file header (data offset is derived on read). */
  headerOffset: number
}

export type Zip = {
  bytes: Bytes
  view: DataView
  entries: Map<string, ZipEntry>
}

const SIG_EOCD = 0x06054b50
const SIG_EOCD64 = 0x06064b50
const SIG_EOCD64_LOCATOR = 0x07064b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

const U32_MAX = 0xffffffff
// The end-of-central-directory record sits in the last 22 bytes + an optional
// comment (max 64 KB), so that tail is all we scan.
const EOCD_SCAN = 22 + 0xffff

const utf8 = new TextDecoder('utf-8')

export class ZipError extends Error {}

/** Parse the central directory. Throws ZipError when `bytes` is not a ZIP. */
export function openZip(bytes: Bytes): Zip {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEocd(view)
  let entryCount = view.getUint16(eocd + 10, true)
  let cdOffset = view.getUint32(eocd + 16, true)

  // ZIP64: the 32-bit fields are saturated and the real values live in the ZIP64
  // EOCD record, located through the locator that precedes the classic EOCD.
  if (cdOffset === U32_MAX || entryCount === 0xffff) {
    const locator = eocd - 20
    if (locator >= 0 && view.getUint32(locator, true) === SIG_EOCD64_LOCATOR) {
      const rec = Number(view.getBigUint64(locator + 8, true))
      if (view.getUint32(rec, true) !== SIG_EOCD64) throw new ZipError('Bad ZIP64 directory')
      entryCount = Number(view.getBigUint64(rec + 32, true))
      cdOffset = Number(view.getBigUint64(rec + 48, true))
    }
  }

  const entries = new Map<string, ZipEntry>()
  let p = cdOffset
  for (let i = 0; i < entryCount; i++) {
    if (p + 46 > view.byteLength || view.getUint32(p, true) !== SIG_CENTRAL) break
    const method = view.getUint16(p + 10, true)
    let compressedSize = view.getUint32(p + 20, true)
    let size = view.getUint32(p + 24, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    let headerOffset = view.getUint32(p + 42, true)
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen))

    // ZIP64 extended information: the saturated fields appear, in order, inside
    // extra field 0x0001 (uncompressed, compressed, local header offset).
    if (size === U32_MAX || compressedSize === U32_MAX || headerOffset === U32_MAX) {
      const z64 = findExtra(view, p + 46 + nameLen, extraLen, 0x0001)
      if (z64 != null) {
        let q = z64
        if (size === U32_MAX) {
          size = Number(view.getBigUint64(q, true))
          q += 8
        }
        if (compressedSize === U32_MAX) {
          compressedSize = Number(view.getBigUint64(q, true))
          q += 8
        }
        if (headerOffset === U32_MAX) headerOffset = Number(view.getBigUint64(q, true))
      }
    }

    // Directory markers carry no payload — skip them so lookups only see parts.
    if (!name.endsWith('/')) entries.set(name, { name, method, compressedSize, size, headerOffset })
    p += 46 + nameLen + extraLen + commentLen
  }

  if (!entries.size) throw new ZipError('Empty ZIP directory')
  return { bytes, view, entries }
}

export const hasZipEntry = (zip: Zip, name: string): boolean => zip.entries.has(name)

/** Inflate one part. Returns null when the part is absent. */
export async function zipEntryBytes(zip: Zip, name: string): Promise<Bytes | null> {
  const entry = zip.entries.get(name)
  if (!entry) return null
  const { view, bytes } = zip
  const h = entry.headerOffset
  if (h + 30 > view.byteLength || view.getUint32(h, true) !== SIG_LOCAL) {
    throw new ZipError(`Bad local header for ${name}`)
  }
  const nameLen = view.getUint16(h + 26, true)
  const extraLen = view.getUint16(h + 28, true)
  const start = h + 30 + nameLen + extraLen
  const raw = bytes.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return raw
  if (entry.method !== 8)
    throw new ZipError(`Unsupported compression (${entry.method}) for ${name}`)
  return inflateRaw(raw)
}

/** Inflate one part and decode it as UTF-8 text. Null when the part is absent. */
export async function zipEntryText(zip: Zip, name: string): Promise<string | null> {
  const bytes = await zipEntryBytes(zip, name)
  return bytes ? utf8.decode(bytes) : null
}

// Raw deflate through the platform stream (off the main thread, no dependency).
async function inflateRaw(data: Bytes): Promise<Bytes> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function findEocd(view: DataView): number {
  const from = Math.max(0, view.byteLength - EOCD_SCAN)
  for (let p = view.byteLength - 22; p >= from; p--) {
    if (view.getUint32(p, true) === SIG_EOCD) return p
  }
  throw new ZipError('Not a ZIP file')
}

// Locate an extra-field payload by header id; returns its data offset or null.
function findExtra(view: DataView, offset: number, len: number, id: number): number | null {
  let p = offset
  const end = offset + len
  while (p + 4 <= end) {
    const fieldId = view.getUint16(p, true)
    const fieldLen = view.getUint16(p + 2, true)
    if (fieldId === id) return p + 4
    p += 4 + fieldLen
  }
  return null
}

/** base64 (from fs.readFileBase64) → bytes, in chunks so long files don't blow the stack. */
export function base64ToBytes(b64: string): Bytes {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** bytes → base64, used to inline docx images as data URLs. */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let out = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(out)
}
