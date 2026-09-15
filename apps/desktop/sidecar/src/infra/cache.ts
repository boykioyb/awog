// Thư mục cache do SIDECAR quản lý cho những lệnh hạ tầng cần GHI RA FILE.
//
// VÌ SAO CẦN. `classify.ts` cố ý để `s3api get-object` ngoài allowlist `read`
// (infosec audit #1, mức critical): lệnh đó nhận một positional là ĐƯỜNG DẪN ĐÍCH,
// nên nếu nó là `read` thì một lệnh "chỉ đọc" trở thành nguyên thuỷ ghi file tuỳ ý
// — kể cả `~/.ssh/authorized_keys`. Nhưng Explorer cần xem trước một object S3, và
// xem trước thì phải có file trên đĩa.
//
// CÁCH GIẢI: thu hẹp quyền ghi vào MỘT thư mục do sidecar sở hữu. `classifyAws`
// chỉ nâng `get-object` lên `read` khi positional đích nằm trong thư mục này; mọi
// đường dẫn khác vẫn rơi về `write` như cũ. Kiểm tra dùng `resolve()` nên `..`
// không lách qua được.
//
// HỆ QUẢ VỀ QUYỀN: `s3api get-object` → cache là `read`, chạy tự động. Đó là mức
// đúng: nó không đổi gì trên AWS, và đích ghi đã bị khoá vào một thư mục mà người
// dùng không đặt tên.
//
// File 0600/0700 vì object trong bucket có thể là bất cứ thứ gì — kể cả một file
// cấu hình mà người dùng không muốn người khác trên máy đọc được.

import { mkdir, chmod } from 'node:fs/promises'
import { dirname, resolve, sep, join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'

const CACHE_CHILD = 'infra-cache'

export function infraCacheDir(): string {
  return join(awogHome(), CACHE_CHILD)
}

/** Đường dẫn tuyệt đối của một object trong cache: `<cache>/<bucket>/<key>`. */
export function infraCachePath(bucket: string, key: string): string {
  const dir = join(infraCacheDir(), sanitizeChild(bucket))
  // `key` có `/` (nó là đường dẫn giả trong bucket) nên KHÔNG đi qua
  // sanitizeChild; từng đoạn được kiểm riêng để `..` không leo ra ngoài.
  const parts = key.split('/').filter((p) => p !== '')
  if (parts.length === 0) throw new Error('Empty object key')
  const safe = parts.map((p) => sanitizeChild(p))
  return join(dir, ...safe)
}

/** `p` có nằm trong thư mục cache (đã resolve, chống `..`) hay không. */
export function isInsideInfraCache(p: string): boolean {
  const root = resolve(infraCacheDir())
  const abs = resolve(p)
  return abs === root || abs.startsWith(root + sep)
}

/**
 * Tạo thư mục chứa `abs` với quyền 0700. Trả về `abs` để call site dùng thẳng
 * trong argv mà không phải ghép lại (một lần ghép thứ hai là một chỗ để lệch).
 */
export async function ensureCacheFileDir(abs: string): Promise<string> {
  const dir = dirname(resolve(abs))
  if (!isInsideInfraCache(dir)) {
    throw new Error('Refusing to write outside the infra cache directory')
  }
  await mkdir(dir, { recursive: true })
  await chmod(infraCacheDir(), 0o700).catch(() => {})
  return abs
}
