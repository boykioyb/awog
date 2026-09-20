// Hành động dọn CHUYÊN BIỆT: chạy đúng công cụ của từng thứ, thay vì vứt thư mục
// của nó vào Thùng rác.
//
// VÌ SAO CẦN, dù đã có Thùng rác: nhiều thứ chiếm chỗ nhất trên máy dev nằm
// NGOÀI thư mục nhà (`/Library/Developer`, ổ đĩa ảo của Docker) hoặc có cấu trúc
// mà xoá thủ công là hỏng (kho gói của pnpm dùng hard link; simulator có sổ đăng
// ký riêng). Công cụ của chúng biết cái gì bỏ được, ta thì không.
//
// ⚠ BẢO MẬT — luật của module này:
//   1. Lệnh nằm trong DANH MỤC CỐ ĐỊNH dưới đây. UI chỉ gửi `id`; không có đường
//      nào để một chuỗi từ renderer trở thành lệnh chạy.
//   2. `execFile` với MẢNG đối số, không `shell: true` — không có nội suy shell.
//   3. Không có mục nào xoá dữ liệu người dùng: tất cả đều là cache/bản dựng lại
//      được. Mỗi mục ghi rõ MẤT GÌ để người dùng tự quyết.
//   4. UI phải hiện lệnh nguyên văn trước khi chạy (`command` trả kèm).

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { RpcError } from '../transport/rpc.js'

const exec = promisify(execFile)

/** Dọn xong mới biết giải phóng được bao nhiêu; lệnh nào cũng có thể chạy lâu. */
const RUN_TIMEOUT_MS = 600_000
const PROBE_TIMEOUT_MS = 5_000

export interface CleanupAction {
  id: string
  label: string
  /** Lệnh nguyên văn để UI hiện ra TRƯỚC khi chạy. */
  command: string
  /** Mất gì khi chạy — người dùng không suy ra được từ tên lệnh. */
  hint: string
  /** Công cụ có trên máy này không. Không có thì UI không liệt kê. */
  available: boolean
}

interface Recipe {
  id: string
  label: string
  bin: string
  args: string[]
  hint: string
  /** Đối số để kiểm tra công cụ tồn tại — phải là lệnh CHỈ ĐỌC. */
  probe: string[]
}

const RECIPES: readonly Recipe[] = [
  {
    id: 'simctl-unavailable',
    label: 'Xoá simulator không còn dùng được',
    bin: 'xcrun',
    args: ['simctl', 'delete', 'unavailable'],
    probe: ['simctl', 'help'],
    hint: 'Chỉ xoá simulator thuộc bản SDK đã gỡ. Simulator đang dùng được giữ nguyên.',
  },
  {
    id: 'brew-cleanup',
    label: 'Dọn Homebrew',
    bin: 'brew',
    args: ['cleanup', '--prune=all'],
    probe: ['--version'],
    hint: 'Xoá bản cũ của các package đã nâng cấp và file tải về. Package đang dùng giữ nguyên.',
  },
  {
    id: 'docker-prune',
    label: 'Dọn rác Docker',
    bin: 'docker',
    args: ['system', 'prune', '-f'],
    probe: ['version', '--format', '{{.Client.Version}}'],
    // CỐ Ý không dùng `-a --volumes`: cái đó xoá cả image không có container đang
    // chạy VÀ volume dữ liệu — tức xoá database trong container của người dùng.
    hint: 'Xoá container đã dừng, network thừa và layer mồ côi. KHÔNG đụng image đang dùng hay volume dữ liệu.',
  },
  {
    id: 'pnpm-store-prune',
    label: 'Dọn kho gói pnpm',
    bin: 'pnpm',
    args: ['store', 'prune'],
    probe: ['--version'],
    hint: 'Chỉ bỏ gói không project nào còn tham chiếu. An toàn hơn hẳn việc xoá cả thư mục store.',
  },
  {
    id: 'npm-cache-clean',
    label: 'Xoá cache npm',
    bin: 'npm',
    args: ['cache', 'clean', '--force'],
    probe: ['--version'],
    hint: 'npm tải lại khi cần. Không ảnh hưởng node_modules đã cài.',
  },
  {
    id: 'go-clean-cache',
    label: 'Xoá cache build của Go',
    bin: 'go',
    args: ['clean', '-cache'],
    probe: ['version'],
    hint: 'Lần build Go kế tiếp sẽ lâu hơn vì phải dựng lại từ đầu.',
  },
]

function commandOf(r: Recipe): string {
  return [r.bin, ...r.args].join(' ')
}

/** Công cụ có trên máy không. Dùng lệnh CHỈ ĐỌC, và lỗi = không có. */
async function probe(r: Recipe): Promise<boolean> {
  try {
    await exec(r.bin, r.probe, { timeout: PROBE_TIMEOUT_MS })
    return true
  } catch {
    return false
  }
}

export async function listCleanupActions(): Promise<CleanupAction[]> {
  const checked = await Promise.all(
    RECIPES.map(async (r) => ({
      id: r.id,
      label: r.label,
      command: commandOf(r),
      hint: r.hint,
      available: await probe(r),
    })),
  )
  // Không liệt kê công cụ máy không có: một nút bấm vào chỉ để báo "command not
  // found" thì thà đừng hiện.
  return checked.filter((a) => a.available)
}

export interface CleanupResult {
  id: string
  command: string
  /** Output đã cắt — nhiều lệnh in ra hàng trăm dòng. */
  output: string
  ok: boolean
}

const OUTPUT_CAP = 4_000

export async function runCleanupAction(id: string): Promise<CleanupResult> {
  const recipe = RECIPES.find((r) => r.id === id)
  // Không tìm thấy id ⇒ dừng. Đây là chỗ bảo đảm renderer không thể tự nghĩ ra
  // một lệnh: nó chỉ chọn được trong danh mục trên.
  if (!recipe) throw new RpcError(-32602, `Unknown cleanup action: ${id}`)

  const command = commandOf(recipe)
  try {
    const { stdout, stderr } = await exec(recipe.bin, recipe.args, {
      timeout: RUN_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    })
    const out = `${stdout}${stderr}`.trim()
    return { id, command, ok: true, output: out.slice(0, OUTPUT_CAP) }
  } catch (err) {
    // Nhiều công cụ trả mã khác 0 kèm thông tin hữu ích (không có gì để dọn,
    // thiếu quyền). Đưa nguyên văn lên UI thay vì nuốt thành "thất bại".
    const e = err as { stdout?: string; stderr?: string; message?: string }
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || (e.message ?? 'failed')
    return { id, command, ok: false, output: out.slice(0, OUTPUT_CAP) }
  }
}
