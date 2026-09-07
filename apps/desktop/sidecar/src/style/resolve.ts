// Tra cứu Output Style của người dùng trên ĐƯỜNG NÓNG (mỗi lượt chat), ĐỒNG BỘ.
//
// Vì sao đồng bộ: `buildStylePrompt` (./styles.ts) là hàm sync và được gọi từ
// runtime/run-stream.ts + runtime/claude-sdk/run-stream.ts. Ở đây chỉ đọc TỐI ĐA
// 2 file nhỏ (đã cap 64KB) mỗi lượt, trong khi bản thân lượt chat tốn vài giây
// gọi model — nên chi phí không đáng kể, đổi lại KHÔNG cần cache và KHÔNG cần
// watcher: người dùng sửa file bằng editor ngoài thì lượt kế tiếp đã thấy ngay.
//
// Thứ tự ưu tiên: style project (gần người dùng nhất) → style global → (người
// gọi tự fallback về style dựng sẵn).

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import {
  MAX_STYLE_FILE_BYTES,
  globalStylesDir,
  parseStyleFile,
  projectStylesDir,
  styleFile,
  type StyleSource,
  type UserStyle,
} from './store.js'

type FsError = Error & { code?: string }

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// Đường dẫn project, đọc đồng bộ. projects/store.ts chỉ có API async nên đây là
// bản sao TỐI THIỂU của bố cục `~/.awog/projects/<id>.json` (ADR 0012) — đổi bố
// cục ở đó thì sửa cả chỗ này.
function projectPathSync(projectId: string): string | null {
  try {
    const file = join(awogHome(), 'projects', `${sanitizeChild(projectId)}.json`)
    const raw = readFileSync(file, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const path = (parsed as Record<string, unknown>).path
    return typeof path === 'string' && path.length > 0 ? path : null
  } catch (err) {
    if (!isMissing(err)) {
      log.warn('styles: cannot resolve project path', { projectId, err: errMessage(err) })
    }
    return null
  }
}

function readStyleSync(
  dir: string,
  id: string,
  source: StyleSource,
  projectId: string | undefined,
): UserStyle | null {
  let file: string
  try {
    // sanitizeChild ném khi id có hình dạng traversal — id đến từ session settings
    // (L1) nên phải bắt tại đây, đường nóng không được phép ném.
    file = styleFile(dir, id)
  } catch (err) {
    log.warn('styles: illegal style id', { id, err: errMessage(err) })
    return null
  }
  try {
    const info = statSync(file)
    if (info.size > MAX_STYLE_FILE_BYTES) {
      log.warn('styles: file too large — skipped', { file, size: info.size })
      return null
    }
    return parseStyleFile(readFileSync(file, 'utf8'), id, source, projectId, file)
  } catch (err) {
    if (!isMissing(err)) log.warn('styles: failed to read file', { file, err: errMessage(err) })
    return null
  }
}

export function resolveUserStyleSync(id: string, projectId?: string): UserStyle | null {
  if (projectId) {
    const path = projectPathSync(projectId)
    if (path) {
      const projectStyle = readStyleSync(projectStylesDir(path), id, 'project', projectId)
      if (projectStyle) return projectStyle
    }
  }
  return readStyleSync(globalStylesDir(), id, 'global', undefined)
}
