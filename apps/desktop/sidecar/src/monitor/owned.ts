// Sổ đăng ký pid → CHỦ SỞ HỮU, cho những tiến trình mà sidecar tự spawn.
//
// Vì sao cần: dòng lệnh nói được tiến trình đó LÀ GÌ (`classify.ts` đọc argv của
// CLI claude, của codex app-server…), nhưng không nói được nó THUỘC VỀ AI. Một
// shell `zsh -lc pnpm test` thì mọi phiên đều spawn y hệt nhau. Chỉ nơi gọi
// spawn mới biết sessionId, nên nơi đó ghi lại một dòng ở đây.
//
// Một sổ dùng chung thay vì mỗi module tự phơi pid ra: chỗ dùng (snapshot.ts)
// chỉ phải biết MỘT nguồn, và thêm một loại tiến trình sau này là thêm một lời
// gọi `registerOwnedProcess`, không phải sửa lớp tổng hợp.
//
// Bản đồ này chỉ sống trong RAM: sidecar chết thì con của nó cũng chết theo
// (spawn đều `detached: false`), nên không có gì phải khôi phục sau khởi động.

export type OwnedKind =
  | 'terminal' // PTY của Workspace Panel / terminal toàn cục
  | 'background-shell' // Bash chạy nền (ADR 0066)
  | 'tool-shell' // Bash của một lượt (nhánh Pi/Codex)
  | 'codex-daemon' // `codex app-server`, DÙNG CHUNG cho mọi phiên cùng account
  | 'mcp-probe' // lần thử kết nối MCP (ngắn)

export interface OwnedProcess {
  pid: number
  kind: OwnedKind
  /** Phiên sở hữu. Absent với thứ dùng chung (codex daemon) hoặc không thuộc phiên nào. */
  sessionId?: string
  /** Nhãn ngắn hiện trên UI, ví dụ lệnh đang chạy. KHÔNG chứa secret. */
  label?: string
  startedAt: number
}

const owned = new Map<number, OwnedProcess>()

export function registerOwnedProcess(entry: Omit<OwnedProcess, 'startedAt'>): void {
  if (!Number.isInteger(entry.pid) || entry.pid <= 0) return
  owned.set(entry.pid, { ...entry, startedAt: Date.now() })
}

export function unregisterOwnedProcess(pid: number | undefined): void {
  if (pid === undefined) return
  owned.delete(pid)
}

export function listOwnedProcesses(): OwnedProcess[] {
  return [...owned.values()]
}

// Dọn những pid đã biến mất khỏi bảng tiến trình. Phần lớn nơi spawn đã tự gọi
// `unregisterOwnedProcess` trong handler 'exit', nhưng một tiến trình bị giết
// bởi bên thứ ba (hoặc một nơi spawn quên gỡ) sẽ đọng lại — bản chụp mỗi nhịp
// là chỗ rẻ nhất để chốt sổ.
export function pruneOwnedProcesses(alive: ReadonlySet<number>): void {
  for (const pid of owned.keys()) {
    if (!alive.has(pid)) owned.delete(pid)
  }
}
