// Danh mục tool AWOG chuẩn — tách từ SessionConfigPopover để hai nơi dùng chung:
//   • popover Tools của phiên (denylist `disabledTools`)
//   • picker Whitelist tool của agent (frontmatter `tools`)
// Thêm/bớt tool ở ĐÂY — không copy lộn xộn.

// `mcp__awogsurfaces__<tool>` trên nhánh Claude SDK: tắt bằng tên trần chỉ tắt
// nhánh Pi, nên danh sách Surfaces tách riêng để phát alias (xem namesFor).
export const SURFACE_TOOLS = [
  'mark_chapter',
  'send_user_file',
  'suggest_task',
  'suggest_followups',
  'report_findings',
]

// Tool ĐI QUA server bắc cầu trên nhánh Claude SDK — bảng tool → SERVER, không
// phải tiền tố cứng: từ khi `read_terminal` đi qua `awogterm`, giả định "mọi thứ
// bắc cầu đều nằm dưới awogsurfaces" không còn đúng.
export const BRIDGE_SERVER_OF: Record<string, string> = {
  ...Object.fromEntries(SURFACE_TOOLS.map((tl) => [tl, 'awogsurfaces'])),
  schedule_wakeup: 'awogsurfaces',
  read_terminal: 'awogterm',
  browser_tool: 'awogbrowser',
  dev_server: 'awogdev',
  code_index: 'awogcode',
  list_sessions: 'awogsessions',
  send_session_message: 'awogsessions',
}

export const TOOL_GROUPS: [string, string[]][] = [
  // code_index tra mã theo SYMBOL (định nghĩa / tham chiếu / blast radius) — cùng
  // họ đọc mã với Grep/Glob, nên nó ở đây chứ không ở Exec.
  ['File', ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'NotebookEdit', 'code_index']],
  // read_terminal reads the tail of a PTY the USER typed in — off here means the
  // model cannot see the user's terminals at all.
  // dev_server nói về chính những background shell ở nhóm này: list/logs/stop, cộng
  // một `start` chỉ trả về lệnh để model chạy qua Bash.
  ['Exec', ['Bash', 'BashOutput', 'KillShell', 'monitor', 'read_terminal', 'dev_server']],
  // `Artifact` chỉ có trên nhánh Claude SDK (provider anthropic); nhánh Pi tắt nó
  // là no-op, giống `WebSearch`. Xếp vào Web vì đây là nhóm chạm mạng — và là tool
  // DUY NHẤT ở đây đẩy nội dung RA: publish trang có URL chia sẻ được, lưu bền
  // dưới tài khoản Claude của người dùng.
  ['Web', ['WebFetch', 'WebSearch', 'browser_tool', 'Artifact']],
  // list_sessions / send_session_message = kênh nhắn sang phiên KHÁC.
  [
    'Agent',
    [
      'Task',
      'TodoWrite',
      'ExitPlanMode',
      'schedule_wakeup',
      'list_sessions',
      'send_session_message',
    ],
  ],
  // Model-initiated surfaces: chapters, file cards, task suggestions, follow-ups.
  ['Surfaces', SURFACE_TOOLS],
]

export const ALL_TOOLS = TOOL_GROUPS.flatMap(([, tools]) => tools)

export const TOOL_ALIASES: Record<string, string[]> = Object.fromEntries(
  Object.entries(BRIDGE_SERVER_OF).map(([tl, server]) => [tl, [`mcp__${server}__${tl}`]]),
)

/** Tên trần + alias bắc cầu — denylist phải ghi cả hai dạng. */
export const toolNamesFor = (tl: string): string[] => [tl, ...(TOOL_ALIASES[tl] ?? [])]
