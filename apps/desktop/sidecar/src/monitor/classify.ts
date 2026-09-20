// Đọc DÒNG LỆNH để biết một tiến trình là gì.
//
// Không có API hệ điều hành nào nói "tiến trình này là renderer của Electron" hay
// "đây là CLI của phiên X", nhưng argv thì nói — và nói chính xác:
//   • Chromium tự dán `--type=renderer|gpu-process|utility` lên tiến trình con.
//   • CLI của Claude Agent SDK mang `--resume=<sdkSessionId>` — đúng cái khoá
//     AWOG đã lưu ở `Session.sdkSessionId`, nên map tiến trình → phiên là TRA
//     BẢNG, không phải suy đoán theo thời điểm spawn (đo trên máy thật, xem
//     docs/features/activity-monitor.md).
//   • Sidecar dùng CHUNG binary với Electron main (`ELECTRON_RUN_AS_NODE`), nên
//     phân biệt hai cái chỉ còn dựa vào đối số `…/sidecar/lib/src/index.js`.
//
// Dòng lệnh là dữ liệu L1 (chứa lệnh do model sinh) ⇒ đi qua `redactString` rồi
// mới rời sidecar.

import { basename } from 'node:path'
import { redactString } from '../sessions/redact.js'

export type ProcessKind =
  | 'electron-main'
  | 'electron-renderer'
  | 'electron-gpu'
  | 'electron-utility'
  | 'sidecar'
  | 'claude-cli'
  | 'codex-daemon'
  | 'git'
  | 'shell'
  | 'node'
  | 'other'

export interface Classified {
  kind: ProcessKind
  /** Nhãn ngắn hiện ở cột "Tiến trình". */
  label: string
  /** Khoá resume của Claude Agent SDK, chỉ có ở `claude-cli`. */
  sdkSessionId?: string
  /** Model đang chạy, nếu argv nói ra. */
  model?: string
}

// Trần độ dài dòng lệnh gửi lên UI. Bảng chỉ hiện một dòng; phần đuôi dài chỉ
// tổ tốn băng thông IPC mỗi 2 giây.
const COMMAND_MAX_CHARS = 400

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

function flagValue(command: string, flag: string, pattern = '\\S+'): string | undefined {
  const re = new RegExp(`${flag}(?:=|\\s+)(${pattern})`, 'i')
  return re.exec(command)?.[1]
}

// Đối số đầu tiên KHÔNG bắt đầu bằng `-` sau binary — đủ để nhận "codex app-server"
// và để lấy tên file js mà sidecar chạy.
function firstArg(command: string): string | undefined {
  const parts = command.split(/\s+/)
  return parts.slice(1).find((p) => p && !p.startsWith('-'))
}

export function classify(command: string): Classified {
  const bin = basename((command.split(/\s+/)[0] ?? '').replace(/\/$/, ''))

  // Tiến trình con của Chromium tự khai loại trên argv.
  const chromiumType = flagValue(command, '--type')
  if (chromiumType === 'renderer') return { kind: 'electron-renderer', label: 'Renderer' }
  if (chromiumType === 'gpu-process') return { kind: 'electron-gpu', label: 'GPU' }
  if (chromiumType) {
    const sub = flagValue(command, '--utility-sub-type')
    const short = sub?.split('.').pop()
    return { kind: 'electron-utility', label: short ? `Utility · ${short}` : `Utility · ${chromiumType}` }
  }

  // CLI của Claude Agent SDK. Nhận theo argv đặc trưng chứ không theo tên file:
  // `claude` là tên quá phổ biến để làm bằng chứng một mình.
  if (/--input-format\s+stream-json|claude-agent-sdk-[a-z0-9]+-[a-z0-9]+\/claude/.test(command)) {
    const sdkSessionId = flagValue(command, '--resume', UUID)
    const model = flagValue(command, '--model')
    return {
      kind: 'claude-cli',
      label: 'Claude CLI',
      ...(sdkSessionId ? { sdkSessionId } : {}),
      ...(model ? { model } : {}),
    }
  }

  if (bin === 'codex' && firstArg(command) === 'app-server') {
    return { kind: 'codex-daemon', label: 'Codex app-server' }
  }

  // Electron main vs sidecar: cùng binary, khác ở chỗ sidecar được đưa cho một
  // file js để chạy (ELECTRON_RUN_AS_NODE).
  const arg = firstArg(command)
  if (arg?.endsWith('.js') && /[/\\]sidecar[/\\]/.test(arg)) {
    return { kind: 'sidecar', label: 'Engine (sidecar)' }
  }
  if (/AWOG(\.app)?([/\\]|$)/i.test(command) && !arg) {
    return { kind: 'electron-main', label: 'AWOG (main)' }
  }

  if (bin === 'git' || bin === 'gh') return { kind: 'git', label: bin }
  if (['zsh', 'bash', 'sh', 'fish'].includes(bin)) return { kind: 'shell', label: bin }
  if (bin === 'node' || bin === 'pnpm' || bin === 'npm') return { kind: 'node', label: bin }
  return { kind: 'other', label: bin || 'unknown' }
}

/** Dòng lệnh đã khử bí mật + cắt ngắn, an toàn để hiện trên UI. */
export function safeCommand(command: string): string {
  const redacted = redactString(command)
  return redacted.length > COMMAND_MAX_CHARS ? `${redacted.slice(0, COMMAND_MAX_CHARS)}…` : redacted
}

/**
 * Tên ỨNG DỤNG mà một tiến trình thuộc về — để gom nhóm.
 *
 * ⚠ KHÔNG tách argv0 bằng khoảng trắng: đường dẫn bundle của macOS đầy khoảng
 * trắng (`/Applications/Google Chrome.app/…`), nên `split(/\s+/)[0]` cắt ra
 * `/Applications/Google` rồi basename ra "Google" — đúng cái làm bảng hiện ba
 * dòng cùng tên "Google"/"Claude" mà không phân biệt được gì (lỗi đã đo).
 *
 * Lấy bundle NGOÀI CÙNG: helper của Chrome nằm ở
 * `…/Google Chrome.app/Contents/Frameworks/Google Chrome Helper.app/…`, và thứ
 * người dùng muốn gom là "Google Chrome", không phải từng helper.
 */
export function appNameOf(command: string): string {
  const bundle = /\/([^/]+)\.app\//.exec(command)
  if (bundle?.[1]) return bundle[1]
  // Không phải bundle: lấy phần trước cờ đầu tiên rồi mới basename. Vẫn có thể
  // sai với đường dẫn có khoảng trắng mà không có cờ, nhưng đó là ca hiếm và
  // hậu quả chỉ là một nhãn xấu, không phải một nhóm sai.
  const head = command.split(/\s+-/)[0] ?? command
  return head.slice(head.lastIndexOf('/') + 1) || 'unknown'
}
