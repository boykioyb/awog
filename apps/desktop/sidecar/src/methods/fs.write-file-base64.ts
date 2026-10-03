// fs.writeFileBase64 — bản nhị phân của fs.writeFile (ADR 0022): export bundle
// (.zip…), file binary do người dùng chọn chỗ lưu qua hộp thoại OS. Cùng 3
// invariant: gốc phải absolute, path phải lọt vào gốc qua assertInsideWorkspace,
// ghi atomic qua sibling .tmp + rename.
//
// KHÔNG được dùng để đọc/ghi credential hay file nội bộ — giống fs.writeFile,
// nội dung là bytes mờ, sidecar không parse (invariant #8).

import { z } from 'zod'
import { writeFile, rename, stat } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { register, RpcError } from '../transport/rpc.js'
import { assertInsideWorkspace } from '../git/path-sanitize.js'

// Giữ ngang fs.writeFile (8 MiB) — đủ cho export bundle, không mở đường cho
// payload bệnh lý qua kênh IPC.
const MAX_BYTES = 8 * 1024 * 1024

const Params = z.object({
  workspaceRoot: z.string().min(1),
  path: z.string().min(1),
  contentBase64: z.string(),
})

register('fs.writeFileBase64', async (raw): Promise<{ bytesWritten: number }> => {
  const params = Params.parse(raw)
  if (!isAbsolute(params.workspaceRoot)) {
    throw new RpcError(-32602, 'workspaceRoot must be absolute')
  }
  const abs = assertInsideWorkspace(params.workspaceRoot, params.path)

  const buf = Buffer.from(params.contentBase64, 'base64')
  if (buf.byteLength > MAX_BYTES) {
    throw new RpcError(-32602, `File too large to write (> ${MAX_BYTES} bytes)`)
  }

  // Refuse to clobber a directory with a file write.
  try {
    const st = await stat(abs)
    if (st.isDirectory()) throw new RpcError(-32602, 'Path is a directory')
  } catch (err) {
    if (err instanceof RpcError) throw err
    // ENOENT — target chưa tồn tại, ghi mới bình thường.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }

  // Random suffix so concurrent saves of the same file (same pid) can't collide
  // on the temp path (infosec F4) — giống hệt fs.writeFile.
  const tmp = `${abs}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`
  await writeFile(tmp, buf)
  await rename(tmp, abs)
  return { bytesWritten: buf.byteLength }
})
