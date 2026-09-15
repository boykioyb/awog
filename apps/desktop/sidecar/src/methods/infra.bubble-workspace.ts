// `infra.bubble-workspace` — bảo đảm thư mục làm việc của PHIÊN BONG BÓNG tồn tại.
//
// YÊU CẦU NGƯỜI DÙNG: "bubble session ở góc phải màn hình… folder tương tác sẽ là
// awog-infra (không phải awog, tôi muốn nó là infra riêng, tạo folder mới nếu chưa
// có)". Nghĩa là phiên thu nhỏ phải chạy trong một project RIÊNG, không dùng chung
// workspace với repo đang mở — nếu dùng chung, mọi file agent tạo ra khi đang xem
// hạ tầng sẽ rơi vào git working tree của chính AWOG, và `git status` của người
// dùng sẽ bẩn vì một việc không liên quan.
//
// VÌ SAO CẦN MỘT RPC RIÊNG thay vì `fs.createDir`: `fs.createDir` chỉ tạo được
// thư mục BÊN TRONG một workspace đã có (`assertInsideWorkspace`). Ở đây ta đang
// tạo CHÍNH cái workspace đó, nên không có gốc nào để kiểm — cùng tình huống với
// `projects.clone` (nó cũng tạo một thư mục ở đường dẫn người dùng đặt).
//
// CHỌN CHỖ Ở ĐÂU. Không hardcode đường dẫn của bất kỳ ai. Thứ tự:
//   1. `dir` do người dùng chọn (nút "Đổi thư mục" → hộp thoại native của hệ điều
//      hành). Đây là đường duy nhất người dùng chỉ đích danh.
//   2. Cạnh những project đã có: thư mục cha của project được TẠO GẦN NHẤT. Đặt
//      cạnh code của bạn là mặc định hợp lý, và nó không đoán bừa vào `$HOME`.
//   3. Không có project nào ⇒ `$HOME`.
//
// HÀNG RÀO. Từ chối đường dẫn hệ thống và những chỗ rõ ràng là sai (`/`, `$HOME`
// trần, `~/.awog`, `/etc`, `/usr`, `/System`). Một RPC tạo thư mục ở đường dẫn tuỳ
// ý mà không có hàng rào nào là một nguyên thuỷ ghi đĩa, kể cả khi nó chỉ `mkdir`.
import { z } from 'zod'
import { mkdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path'
import { register, RpcError } from '../transport/rpc.js'
import { listProjects } from '../projects/store.js'
import { awogHome } from '../util/path.js'

/** Tên thư mục cố định — nó là một phần của yêu cầu, không phải cấu hình. */
export const BUBBLE_DIR_NAME = 'awog-infra'

const Params = z.object({
  dir: z.string().min(1).max(4096).optional(),
})

const DENIED_ROOTS = ['/etc', '/usr', '/bin', '/sbin', '/var', '/System', '/Library']

function denyReason(target: string): string | null {
  const abs = resolve(target)
  const root = parse(abs).root
  if (abs === root) return 'refusing a filesystem root'
  if (abs === resolve(homedir())) return 'refusing the home directory itself'
  if (abs === resolve(awogHome())) return 'refusing the AWOG data directory'
  for (const d of DENIED_ROOTS) {
    if (abs === d || abs.startsWith(`${d}/`)) return `refusing a system path (${d})`
  }
  return null
}

async function exists(p: string): Promise<'dir' | 'file' | 'no'> {
  try {
    const st = await stat(p)
    return st.isDirectory() ? 'dir' : 'file'
  } catch {
    return 'no'
  }
}

/** Thư mục cha mặc định: cạnh project được tạo gần nhất, không thì `$HOME`. */
export async function defaultParentDir(): Promise<string> {
  try {
    const projects = await listProjects()
    if (projects.length > 0) {
      const newest = projects
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0]
      const p = newest?.path
      if (p && isAbsolute(p)) {
        const parent = dirname(p)
        if (parent && parent !== p && (await exists(parent)) === 'dir') return parent
      }
    }
  } catch {
    // Không đọc được danh sách project ⇒ rơi về $HOME. Đây là đường phụ của một
    // tiện ích, không phải đường an toàn — nên nó không được làm hỏng lượt gọi.
  }
  return homedir()
}

register('infra.bubble-workspace', async (raw) => {
  const p = Params.parse(raw)
  const parent = await defaultParentDir()
  const target = p.dir ? resolve(p.dir) : join(parent, BUBBLE_DIR_NAME)

  if (!isAbsolute(target)) throw new RpcError(-32602, 'dir must be absolute')
  const denied = denyReason(target)
  if (denied) throw new RpcError(-32602, denied)

  const state = await exists(target)
  if (state === 'file') throw new RpcError(-32602, 'that path is a file, not a folder')
  const created = state === 'no'
  if (created) await mkdir(target, { recursive: true })

  return { ok: true as const, path: target, name: basename(target), created, parent }
})
