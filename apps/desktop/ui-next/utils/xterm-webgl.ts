import { WebglAddon } from '@xterm/addon-webgl'
import type { Terminal } from '@xterm/xterm'

// Bật renderer WebGL cho một xterm — renderer mặc định (canvas/DOM) giật khi TUI
// redraw full-screen liên tục (claude/codex CLI) và khi scroll buffer lớn.
// Phải gọi SAU `term.open()` (addon cần render service). Thất bại — thiếu WebGL,
// GPU bị chặn — thì giữ nguyên renderer mặc định, không nuôi lỗi lên UI.
// Mất context giữa chừng (GPU reset) → addon tự dispose, quay về canvas.
export function enableTerminalWebgl(term: Terminal): void {
  try {
    // preserveDrawingBuffer=true: trong Electron, canvas WebGL mặc định (buffer
    // không giữ lại) hay render ĐEN TOÀN BỘ sau compositor swap — cái giá là
    // một chút hiệu năng, vẫn rẻ hơn DOM renderer nhiều.
    const webgl = new WebglAddon(true)
    webgl.onContextLoss(() => webgl.dispose())
    term.loadAddon(webgl)
    // Repaint toàn bộ một nhịp sau khi renderer đổi — không có nó, khung đầu
    // tiên của renderer mới có thể để trống tới output tiếp theo.
    requestAnimationFrame(() => term.refresh(0, term.rows - 1))
  } catch {
    // Không WebGL — renderer mặc định vẫn đủ dùng, chỉ chậm hơn.
  }
}
