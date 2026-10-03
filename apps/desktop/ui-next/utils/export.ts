// Export helpers dùng chung (agents zip, team/board/issue JSON, issue md…).
// Flow giống useShareExport.saveToFile: saveFilePath (hộp thoại OS, trả đường
// dẫn người dùng chọn) → dir đó làm workspaceRoot của fs.writeFile(Base64) —
// quyền ghi chỉ vừa đúng thư mục đích, không nới thêm.
import { zipSync, strToU8 } from 'fflate'
import { saveFilePath } from '~/composables/useFolderPicker'
import { useFsApi } from '~/composables/useFsApi'

// Uint8Array → base64 theo chunk (btoa không nhận mảng lớn một lúc).
function u8ToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

// Cắt đường dẫn trả về từ dialog thành (dir, name) — cắt cả '/' lẫn '\' vì
// dialog Windows trả backslash (xem comment tương tự trong useShareExport).
function splitPicked(picked: string): { dir: string; name: string } {
  const cut = Math.max(picked.lastIndexOf('/'), picked.lastIndexOf('\\'))
  return cut <= 0
    ? { dir: picked.slice(0, 1), name: picked.slice(1) }
    : { dir: picked.slice(0, cut), name: picked.slice(cut + 1) }
}

export interface ExportFile {
  name: string
  content: string
}

/** Mở dialog chọn chỗ lưu, trả {dir,name} hoặc null khi người dùng huỷ. */
export async function pickSaveTarget(
  defaultName: string,
  filters?: { name: string; extensions: string[] }[],
): Promise<{ dir: string; name: string } | null> {
  const picked = await saveFilePath({ defaultPath: defaultName, ...(filters ? { filters } : {}) })
  return picked ? splitPicked(picked) : null
}

/** Ghi file TEXT — trả tên file đã ghi, null khi huỷ/fail. Caller tự toast. */
export async function saveTextFile(
  defaultName: string,
  content: string,
  filters?: { name: string; extensions: string[] }[],
): Promise<string | null> {
  const target = await pickSaveTarget(defaultName, filters)
  if (!target) return null
  const fs = useFsApi()
  await fs.writeFile(target.dir, target.name, content)
  return target.name
}

/** Ghi file ZIP (fflate, level mặc định) — trả tên file, null khi huỷ/fail. */
export async function saveZipFile(
  defaultName: string,
  files: ExportFile[],
): Promise<string | null> {
  const target = await pickSaveTarget(defaultName, [{ name: 'ZIP', extensions: ['zip'] }])
  if (!target) return null
  const entries: Record<string, Uint8Array> = {}
  for (const f of files) entries[f.name] = strToU8(f.content)
  const zipped = zipSync(entries)
  const fs = useFsApi()
  await fs.writeFileBase64(target.dir, target.name, u8ToBase64(zipped))
  return target.name
}

/** Slug an toàn đặt tên file export — chỉ ASCII + dash, không rỗng. */
export function exportSlug(raw: string, fallback = 'export'): string {
  const s = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || fallback
}
