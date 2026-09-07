// Lưu / nạp chỉ mục trên đĩa.
//
// Nhà của nó là `~/.awog/codeindex/` — dữ liệu AWOG tự sinh, KHÔNG phải cấu hình
// dùng chung với Claude Code CLI, nên theo ADR 0070 nó thuộc `.awog` chứ không
// phải `.claude`. Cũng cố ý KHÔNG nằm trong repo người dùng: chỉ mục là cache
// dựng lại được, không đáng để lọt vào `git status` hay `.gitignore` của họ.
//
// BẢO MẬT: nội dung đọc lại từ đĩa là dữ liệu L1 (file có thể hỏng, bị sửa tay,
// hoặc là bản của một schema cũ). Nó đi thẳng vào việc trả path/line cho model,
// nên phải qua zod trước. Bản không hợp lệ bị VỨT rồi dựng lại — không bao giờ
// vá tạm, vì một chỉ mục nửa hợp lệ sẽ trả toạ độ sai mà không ai biết.

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { awogHome } from '../util/path.js'
import { log } from '../util/logger.js'
import { CODE_INDEX_SCHEMA_VERSION, type CodeIndex } from './types.js'

const DIR_NAME = 'codeindex'
// Chỉ mục lớn hơn mức này gần như chắc chắn là hỏng/độc; từ chối đọc thay vì nạp
// vài trăm MB vào heap của sidecar.
const MAX_INDEX_BYTES = 64 * 1024 * 1024

const DeclSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['function', 'class', 'interface', 'type', 'enum', 'const', 'method']),
  line: z.number().int().positive(),
  exported: z.boolean(),
  container: z.string().optional(),
})

const ImportSchema = z.object({
  spec: z.string().min(1),
  line: z.number().int().positive(),
  names: z.array(z.string()),
  kind: z.enum(['import', 'reexport', 'dynamic', 'require']),
  target: z.string().optional(),
  external: z.boolean(),
})

const FileSchema = z.object({
  path: z.string().min(1),
  mtimeMs: z.number(),
  size: z.number().int().nonnegative(),
  decls: z.array(DeclSchema),
  imports: z.array(ImportSchema),
  refs: z.record(z.string(), z.array(z.number().int().positive())),
  partial: z.boolean(),
})

const IndexSchema = z.object({
  version: z.number().int(),
  root: z.string().min(1),
  builtAt: z.number(),
  files: z.array(FileSchema),
  skipped: z.number().int().nonnegative(),
  truncated: z.boolean(),
  source: z.enum(['git', 'walk']),
})

function indexDir(): string {
  return join(awogHome(), DIR_NAME)
}

// Tên file = tên thư mục gốc + băm đường dẫn tuyệt đối. Băm để hai repo trùng
// tên (`~/a/awog` và `~/b/awog`) không giẫm lên chỉ mục của nhau; giữ tên gốc để
// người dùng mở thư mục ra còn đoán được file nào của repo nào.
export function indexFileFor(root: string): string {
  const hash = createHash('sha1').update(root).digest('hex').slice(0, 12)
  const label = basename(root).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 40) || 'repo'
  return join(indexDir(), `${label}-${hash}.json`)
}

export async function loadIndex(root: string): Promise<CodeIndex | null> {
  const file = indexFileFor(root)
  let raw: string
  try {
    const st = await stat(file)
    if (st.size > MAX_INDEX_BYTES) {
      log.warn('codeindex: index file too large, discarding', { file, size: st.size })
      await unlink(file).catch(() => undefined)
      return null
    }
    raw = await readFile(file, 'utf8')
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    log.warn('codeindex: index file is not valid JSON, discarding', { file })
    return null
  }
  const res = IndexSchema.safeParse(parsed)
  if (!res.success) {
    log.warn('codeindex: index file failed validation, discarding', {
      file,
      issue: res.error.issues[0]?.message ?? 'unknown',
    })
    return null
  }
  // Schema cũ / chỉ mục của repo khác ⇒ bỏ, dựng lại. Rẻ hơn nhiều so với việc
  // trả lời bằng dữ liệu không còn đúng.
  if (res.data.version !== CODE_INDEX_SCHEMA_VERSION || res.data.root !== root) return null
  return res.data
}

export async function saveIndex(index: CodeIndex): Promise<number> {
  const file = indexFileFor(index.root)
  await mkdir(indexDir(), { recursive: true })
  // Không format: chỉ mục là dữ liệu máy đọc, thêm khoảng trắng làm phình ~40%.
  const body = JSON.stringify(index)
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, body, 'utf8')
  await rename(tmp, file)
  return Buffer.byteLength(body)
}

export async function indexBytesOnDisk(root: string): Promise<number> {
  try {
    return (await stat(indexFileFor(root))).size
  } catch {
    return 0
  }
}
