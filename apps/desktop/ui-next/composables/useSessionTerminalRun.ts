import { ref } from 'vue'
import { useWorkspacePanel } from '~/composables/useWorkspacePanel'

// Chạy một lệnh shell lấy từ code block trong transcript, vào terminal CỦA PHIÊN
// (cwd = project) chứ không phải dock terminal toàn cục (cwd = home) — lệnh model
// đề xuất gần như luôn nói về repo đang mở.
//
// Đăng ký kiểu module-level, cùng khuôn với useWorkspacePanel / useStatusConfig:
// nút Run nằm sâu trong DOM markdown của transcript, còn `runText` thì nằm trên
// instance WorkspaceTerminal bên trong workspace panel. Luồn ref qua chừng ấy tầng
// chỉ để gọi một hàm là không đáng; một registry theo khoá PTY thì hai bên tự tìm
// thấy nhau và không bên nào phải biết bên kia tồn tại.

/** `runText` trả về false khi chưa có pane sống để ghi (PTY còn đang spawn). */
type Runner = (text: string) => boolean

const runners = new Map<string, Runner>()

/** Đang có lệnh nào chờ terminal sẵn sàng — để nút Run tự khoá, không xếp hàng. */
const busy = ref(false)

export function registerTerminalRunner(key: string, run: Runner): void {
  runners.set(key, run)
}
export function unregisterTerminalRunner(key: string): void {
  runners.delete(key)
}

// Mẫu lệnh phá huỷ / không hoàn tác được. Cố ý để RỘNG và chấp nhận báo nhầm: giá
// của một lần hỏi thừa là một cú Enter, còn giá của một lần bỏ sót là mất dữ liệu.
// Đây KHÔNG phải hàng rào bảo mật (người dùng vẫn chạy được mọi thứ trong terminal
// bên cạnh) — nó chỉ chặn cú misclick trên một lệnh do model sinh ra.
const DESTRUCTIVE = [
  /\brm\s+(-\w*\s+)*-\w*[rf]/, // rm -rf, rm -fr, rm -r -f
  /\bsudo\b/,
  /\bdd\s+if=/,
  /\bmkfs\b/,
  /\bchmod\s+-R\b/,
  /\bchown\s+-R\b/,
  /\bgit\s+(push\s+.*(--force|-f)\b|reset\s+--hard|clean\s+-\w*[fd])/,
  /\bdocker\s+(system\s+prune|volume\s+rm|rm\s+-f)/,
  /\bkubectl\s+delete\b/,
  /\b(npm|pnpm|yarn)\s+publish\b/,
  /\bcurl\b[^|]*\|\s*(sudo\s+)?(ba)?sh\b/, // curl … | sh
  /\bwget\b[^|]*\|\s*(sudo\s+)?(ba)?sh\b/,
  />\s*\/dev\/[a-z]/, // > /dev/sda
  /\btruncate\s+-s\s*0\b/,
  /\bDROP\s+(TABLE|DATABASE)\b/i,
]

/** Lệnh này có khớp mẫu phá huỷ nào không (khớp trên TỪNG dòng). */
export function isDestructiveCommand(command: string): boolean {
  return command
    .split('\n')
    .some((line) => DESTRUCTIVE.some((re) => re.test(line.replace(/\s+/g, ' ').trim())))
}

const READY_TIMEOUT_MS = 6000
const POLL_MS = 120

export function useSessionTerminalRun() {
  const { openViews, toggleView } = useWorkspacePanel()

  /**
   * Ghi `command` vào terminal của phiên `sessionId`.
   * - `alt` = true → chỉ dán, KHÔNG xuống dòng (người dùng tự đọc lại rồi Enter).
   * - Mở sẵn khung Terminal nếu đang đóng, rồi CHỜ PTY spawn xong mới ghi: viết
   *   sớm một nhịp thì `runText` trả false và lệnh rơi vào hư không.
   */
  async function run(sessionId: number | string, command: string, alt = false): Promise<boolean> {
    const text = command.trim()
    if (!text || busy.value) return false
    const key = `ses:${sessionId}`

    // Mở khung Terminal nếu chưa mở. `toggleView` sẽ ĐÓNG nếu đang mở, nên phải
    // kiểm tra trước — bấm Run khi terminal đang mở mà lại đóng nó đi thì vô lý.
    if (!openViews.value.includes('Terminal')) toggleView('Terminal')

    busy.value = true
    try {
      const deadline = Date.now() + READY_TIMEOUT_MS
      const payload = alt ? text : `${text}\n`
      for (;;) {
        if (runners.get(key)?.(payload)) return true
        if (Date.now() > deadline) return false
        await new Promise((r) => setTimeout(r, POLL_MS))
      }
    } finally {
      busy.value = false
    }
  }

  return { run, busy }
}
