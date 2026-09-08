// Siêu dữ liệu cài đặt của một template bundle — phần biến template từ "import
// một lần" thành **plugin cài lại được** (WP10). Sống trong file phụ
// `.install.json` NGAY TRONG bundle, tách khỏi `template.json` vì `template.json`
// là manifest (nội dung) còn file này là provenance + baseline đồng bộ: hai lý
// do thay đổi khác nhau (SRP).
//
// Mỗi entity giữ **một ảnh chụp nội dung của NGUỒN tại lần đồng bộ gần nhất**
// (`baseline`, vai trò như merge-base của git) — KHÔNG phải hash file trên đĩa:
//
//   disk   ≠ baseline  ⇒ người dùng đã sửa cục bộ   (localModified)
//   remote ≠ baseline  ⇒ nguồn có bản mới            (status)
//   cả hai             ⇒ xung đột, phải hỏi người dùng
//
// Đây là chỗ dễ làm sai: nếu sau khi người dùng chọn "giữ bản local" mà ta ghi
// baseline = nội dung trên đĩa, thì lần cập nhật SAU sẽ thấy local == baseline
// (coi như không ai sửa) và ghi đè bản local ấy trong im lặng — đúng thứ WP10
// cấm. Giữ baseline = nội dung nguồn nên bản local luôn ở trạng thái "đã sửa",
// và lần nguồn đổi tiếp lại thành xung đột để hỏi lại.
//
// baseline RỖNG = entity chỉ còn tồn tại cục bộ (nguồn đã bỏ, người dùng chọn
// giữ) ⇒ không còn nằm trong hợp đồng đồng bộ, không bị báo "removed" nữa.
//
// Hash dùng **git blob SHA-1** (`sha1("blob <len>\0" + content)`) — đúng thuật
// toán GitHub trả trong tree entry, nên `templates.checkUpdate` so được nội dung
// mà KHÔNG phải tải một byte blob nào về.
//
// Tên file bắt đầu bằng dấu chấm nên `listTemplates()` (bỏ qua entry `.`) và
// mọi vòng lặp entity đều không nhầm nó là entity.

import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { safeHomepage } from './homepage.js'
import type { ProjectTemplate, TemplateEntityRef } from '../types/shared.js'

export const INSTALL_META_NAME = '.install.json'
export const MANIFEST_NAME = 'template.json'

// File do AWOG sinh ra tại chỗ — không thuộc nội dung bundle nên không vào baseline.
const LOCAL_ONLY_FILES = new Set<string>([INSTALL_META_NAME, MANIFEST_NAME])

// Git blob SHA-1 của một buffer. Cùng công thức `git hash-object`.
export function blobHash(buf: Buffer): string {
  return createHash('sha1').update(`blob ${buf.byteLength}\0`).update(buf).digest('hex')
}

// relPath trong bundle → git blob sha.
const HashMapSchema = z.record(z.string().max(1024), z.string().max(64))

const InstallMetaSchema = z.object({
  sourceUrl: z.string().min(1).max(2048),
  sourceRef: z.string().min(1).max(256),
  installedAt: z.string().max(64),
  version: z.string().max(120).optional(),
  // Trang chủ người xuất bản khai trong danh mục — siêu dữ liệu phụ, KHÔNG bắt
  // buộc: `.install.json` do bản app cũ ghi không có field này và vẫn đọc bình
  // thường. Nội dung của nó còn phải qua `safeHomepage` (xem read/write dưới).
  homepage: z.string().max(2048).optional(),
  // `${kind}/${id}` → ảnh chụp nội dung nguồn của entity đó lúc đồng bộ.
  entities: z.record(z.string().max(400), HashMapSchema),
})

export type HashMap = z.infer<typeof HashMapSchema>
export type TemplateInstallMeta = z.infer<typeof InstallMetaSchema>

// Khoá định danh 1 entity trong 1 bundle — hàm DUY NHẤT dựng khoá này.
export function entityKeyOf(kind: string, id: string): string {
  return `${kind}/${id}`
}

// `ProjectTemplate` + metadata plugin. `types/shared.ts` là contract chung của
// nhiều feature nên không nới ở đó; phần mở rộng chỉ sống trong lớp templates và
// đi lên UI qua JSON (field thừa được giữ nguyên khi serialize).
export type InstalledTemplate = ProjectTemplate & {
  version?: string
  sourceUrl?: string
  sourceRef?: string
  installedAt?: string
  homepage?: string
}

export function installMetaFile(bundleDir: string): string {
  return join(bundleDir, INSTALL_META_NAME)
}

// Đọc metadata. Thiếu / hỏng / sai schema ⇒ null (template coi như bundle local,
// không có nguồn để check update) — L1: nội dung file luôn phải validate.
export async function readInstallMeta(bundleDir: string): Promise<TemplateInstallMeta | null> {
  let raw: string
  try {
    raw = await readFile(installMetaFile(bundleDir), 'utf8')
  } catch {
    return null
  }
  try {
    const parsed = InstallMetaSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return null
    // zod chỉ nói "là chuỗi ≤ 2048" — chưa nói link có bấm được an toàn không.
    // File này nằm trong thư mục người dùng: sửa tay được, và bản app cũ có thể
    // đã ghi một homepage chưa qua lọc. Nên lọc LẠI lúc đọc, đúng khuôn `readCache`
    // của marketplace.ts. Homepage hỏng chỉ rụng field, meta vẫn dùng được.
    return withSafeHomepage(bundleDir, parsed.data)
  } catch {
    return null
  }
}

// Một chỗ áp phép lọc cho cả đường đọc lẫn đường ghi. `id` trong log là tên thư
// mục bundle — đủ để tra ra template nào khai sai.
function withSafeHomepage(bundleDir: string, meta: TemplateInstallMeta): TemplateInstallMeta {
  const homepage = safeHomepage('install-meta', basename(bundleDir), meta.homepage)
  if (homepage === meta.homepage) return meta
  const next: TemplateInstallMeta = { ...meta }
  delete next.homepage
  return homepage ? { ...next, homepage } : next
}

export async function writeInstallMeta(
  bundleDir: string,
  meta: TemplateInstallMeta,
): Promise<void> {
  const file = installMetaFile(bundleDir)
  const tmp = `${file}.tmp.${process.pid}`
  // `homepage` đến từ danh mục do người lạ xuất bản (L1) — lọc TRƯỚC khi nó
  // thành một dòng trên đĩa, đừng để một `javascript:` nằm chờ được bấm.
  const safe = withSafeHomepage(bundleDir, meta)
  await writeFile(tmp, JSON.stringify(safe, null, 2), 'utf8')
  await rename(tmp, file)
}

// Liệt kê mọi file thường (KHÔNG theo symlink) dưới `root`, path tương đối,
// phân tách bằng '/'. Dùng cho cả baseline lẫn ảnh chụp trạng thái đĩa hiện tại.
export async function listFilesRecursive(root: string, prefix = ''): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      // eslint-disable-next-line no-await-in-loop
      out.push(...(await listFilesRecursive(join(root, entry.name), rel)))
    } else if (entry.isFile()) {
      out.push(rel)
    }
  }
  return out
}

// Bảng relPath → blobHash cho mọi file nội dung của bundle (bỏ template.json +
// .install.json: cả hai được sinh lại tại chỗ nên không so được với nguồn).
export async function hashBundleFiles(bundleDir: string): Promise<Record<string, string>> {
  const files = (await listFilesRecursive(bundleDir)).filter((f) => !LOCAL_ONLY_FILES.has(f))
  const out: Record<string, string> = {}
  for (const rel of files) {
    // eslint-disable-next-line no-await-in-loop
    out[rel] = blobHash(await readFile(join(bundleDir, rel)))
  }
  return out
}

// Mọi file thuộc một entity: `entityFile` có thể là 1 file (agent .md, hook
// .json…) hoặc 1 thư mục (skill/<id>/…). Trả về path tương đối gốc bundle.
export async function entityFiles(bundleDir: string, entityFile: string): Promise<string[]> {
  const abs = join(bundleDir, entityFile)
  let st: Awaited<ReturnType<typeof stat>>
  try {
    st = await stat(abs)
  } catch {
    return []
  }
  if (st.isDirectory()) {
    const rels = await listFilesRecursive(abs)
    return rels.map((r) => `${entityFile}/${r}`)
  }
  return st.isFile() ? [entityFile] : []
}

// Hai bảng hash giống nhau hoàn toàn? (cùng tập key + cùng giá trị)
export function sameHashes(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every((k) => a[k] === b[k])
}

// Lọc bảng hash theo danh sách file của một entity.
export function pickHashes(all: HashMap, files: string[]): HashMap {
  const out: HashMap = {}
  for (const f of files) {
    const h = all[f]
    if (h !== undefined) out[f] = h
  }
  return out
}

// Baseline cho lần fetch mới: đĩa CHÍNH LÀ nội dung nguồn vừa tải về.
export async function baselineFromDisk(
  bundleDir: string,
  entities: TemplateEntityRef[],
): Promise<Record<string, HashMap>> {
  const disk = await hashBundleFiles(bundleDir)
  const out: Record<string, HashMap> = {}
  for (const ref of entities) {
    // eslint-disable-next-line no-await-in-loop
    out[entityKeyOf(ref.kind, ref.id)] = pickHashes(disk, await entityFiles(bundleDir, ref.file))
  }
  return out
}
