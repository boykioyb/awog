// Hồi quy cho một lớp bug đã xảy ra thật: một tool được bắc cầu sang nhánh Claude
// SDK đổi tên thành `mcp__<server>__<tool>`, trong khi cổng quyền vẫn so bằng tên
// TRẦN. Kết quả là lời gọi bắc cầu lọt qua cổng — `browser_tool` chạy được
// navigate/click/fill ngay trong plan mode, thứ vốn hứa read-only.
//
// Bug này không lộ ra ở typecheck (hai chuỗi đều hợp lệ) và không lộ ở nhánh Pi
// (tên trần vẫn khớp), nên nó chỉ hiện khi người dùng đổi sang provider anthropic.
// Mỗi lần bắc thêm một tool sang SDK là một lần lỗi này có thể quay lại.
//
// Run: `npx vitest run src/runtime/tools/__tests__/bridged-tool-gating.test.ts`
import { describe, expect, it } from 'vitest'
import {
  BROWSER_TOOL_NAME,
  isBrowserToolName,
  isMutatingBrowserAction,
} from '../browser-tool.js'
import { SURFACE_MCP_SERVER, SURFACE_TOOL_NAMES } from '../surface-tools.js'
import { WAKEUP_TEXT } from '../wakeup-tool.js'
import {
  READ_TERMINAL_TEXT,
  READ_TERMINAL_TOOL_NAMES,
  TERMINAL_MCP_SERVER,
} from '../read-terminal-tool.js'
import {
  DEV_SERVER_MCP_SERVER,
  DEV_SERVER_TEXT,
  DEV_SERVER_TOOL_NAMES,
} from '../dev-server-tool.js'
import {
  CODE_INDEX_MCP_SERVER,
  CODE_INDEX_TEXT,
  CODE_INDEX_TOOL_NAMES,
} from '../code-index-tool.js'
import {
  SESSION_MESSAGING_MCP_SERVER,
  SESSION_MESSAGING_TEXT,
  SESSION_MESSAGING_TOOL_NAMES,
} from '../session-tools.js'
import { stepFromToolUse } from '../../../sessions/step-mapper.js'

const BRIDGED = `mcp__awogbrowser__${BROWSER_TOOL_NAME}`

describe('isBrowserToolName', () => {
  it('khớp tên trần của nhánh Pi', () => {
    expect(isBrowserToolName(BROWSER_TOOL_NAME)).toBe(true)
  })

  it('khớp tên bắc cầu của nhánh Claude SDK', () => {
    expect(isBrowserToolName(BRIDGED)).toBe(true)
  })

  it('khớp bất kể tên server, vì server có thể được đặt lại', () => {
    expect(isBrowserToolName(`mcp__somethingelse__${BROWSER_TOOL_NAME}`)).toBe(true)
  })

  it('KHÔNG khớp tool khác chỉ vì tên chứa chuỗi con', () => {
    // `endsWith('__browser_tool')` chứ không phải `includes('browser_tool')`:
    // một tool tên `browser_tool_helper` của bên thứ ba không được ăn theo cổng này.
    expect(isBrowserToolName('browser_tool_helper')).toBe(false)
    expect(isBrowserToolName('mcp__x__browser_tool_helper')).toBe(false)
    expect(isBrowserToolName('my_browser_tool')).toBe(false)
  })

  it('KHÔNG khớp chuỗi rỗng hay tên khác hẳn', () => {
    expect(isBrowserToolName('')).toBe(false)
    expect(isBrowserToolName('Bash')).toBe(false)
  })
})

describe('isMutatingBrowserAction', () => {
  it('gate các action đổi trạng thái', () => {
    for (const action of ['navigate', 'click', 'fill', 'tab_new']) {
      expect(isMutatingBrowserAction({ action })).toBe(true)
    }
  })

  it('không gate các action chỉ quan sát', () => {
    for (const action of ['screenshot', 'extract', 'snapshot', 'console', 'network']) {
      expect(isMutatingBrowserAction({ action })).toBe(false)
    }
  })

  it('args hỏng ⇒ không coi là mutating, và vì thế KHÔNG được tự cho qua', () => {
    // Hàm này chỉ trả lời "có phải mutating không". Args hỏng trả false, nghĩa là
    // lời gọi đó không bị gate — chấp nhận được vì action không hợp lệ sẽ bị chính
    // tool từ chối ở bước sau. Test ghi lại giao kèo đó cho rõ.
    expect(isMutatingBrowserAction(null)).toBe(false)
    expect(isMutatingBrowserAction(undefined)).toBe(false)
    expect(isMutatingBrowserAction({})).toBe(false)
    expect(isMutatingBrowserAction({ action: 42 })).toBe(false)
    expect(isMutatingBrowserAction('navigate')).toBe(false)
  })
})

// `schedule_wakeup` (gói #14) đi nhờ server `awogsurfaces` trên nhánh Claude SDK.
// Đó là một lựa chọn CÓ ĐIỀU KIỆN: nó chỉ đúng chừng nào tên tool nằm trong
// SURFACE_TOOL_NAMES, vì đó là thứ duy nhất khiến step-mapper gấp tên bắc cầu về
// tên trần. Gỡ tên khỏi danh sách đó ⇒ cùng một lời gọi hiện "Wake-up" trên Pi và
// "awogsurfaces: schedule_wakeup" trên SDK — im lặng, không ai thấy cho tới khi
// nhìn transcript của một phiên anthropic.
describe('schedule_wakeup bắc cầu qua awogsurfaces', () => {
  const BARE = 'schedule_wakeup'
  const BRIDGED = `mcp__${SURFACE_MCP_SERVER}__${BARE}`

  it('tên nằm trong danh sách được gấp tên', () => {
    expect(SURFACE_TOOL_NAMES as readonly string[]).toContain(BARE)
  })

  // Đi qua API công khai `stepFromToolUse` — đúng hàm transcript thật gọi — chứ
  // không export thêm hàm nội bộ chỉ để test nhìn thấy.
  const labelOf = (name: string): string =>
    stepFromToolUse({ id: 't1', name, input: { in_seconds: 600, note: 'x' } }).label

  it('hai runtime cho ra CÙNG một nhãn', () => {
    expect(labelOf(BARE)).toBe('Wake-up')
    expect(labelOf(BRIDGED)).toBe('Wake-up')
  })

  it('KHÔNG gấp tên của một server lạ trùng tên tool', () => {
    // Hàng rào có sẵn của unbridgeSurfaceToolName: chỉ hậu tố của CHÍNH ta mới
    // được gấp. Một MCP server của người khác vẫn hiện như một hàng MCP.
    expect(labelOf(`mcp__someoneelse__${BARE}`)).toBe(`someoneelse: ${BARE}`)
  })

  it('chính sách chỉ có MỘT bản cho cả hai runtime', () => {
    // Mô tả và mô tả tham số đến từ WAKEUP_TEXT; nhánh Pi dựng TypeBox, nhánh SDK
    // dựng zod, cùng nguồn. Nếu ai đó chép chuỗi sang bridge rồi sửa một bên, test
    // này không bắt được — nhưng nó bắt được việc GỠ nguồn dùng chung.
    expect(WAKEUP_TEXT.description.length).toBeGreaterThan(200)
    expect(WAKEUP_TEXT.inSeconds).toContain('seconds')
    expect(WAKEUP_TEXT.note).toContain('characters')
  })
})

// `read_terminal` bắc cầu qua server RIÊNG `awogterm` — cố ý khác `schedule_wakeup`.
//
// Lý do khác: tên server hiện ra trong luật quyền và trong `disabledTools`, nên nó
// phải nói đúng tool là gì. Một wake-up là thứ model đặt VÀO phiên; đọc terminal
// của người dùng là một NGUỒN ĐỌC. Gộp chung thì một luật viết cho
// `mcp__awogsurfaces__*` sẽ vô tình phủ luôn một tool đọc dữ liệu L1.
describe('read_terminal bắc cầu qua awogterm', () => {
  const BARE = 'read_terminal'
  const BRIDGED = `mcp__${TERMINAL_MCP_SERVER}__${BARE}`

  const labelOf = (name: string): string =>
    stepFromToolUse({ id: 't1', name, input: { lines: 50 } }).label
  const iconOf = (name: string): string =>
    stepFromToolUse({ id: 't1', name, input: { lines: 50 } }).tool ?? ''

  it('tên nằm trong danh sách được gấp tên', () => {
    expect(READ_TERMINAL_TOOL_NAMES as readonly string[]).toContain(BARE)
  })

  it('hai runtime cho ra CÙNG nhãn VÀ cùng icon', () => {
    // Icon quan trọng không kém nhãn: thiếu gấp tên thì hàng rơi về `task`
    // (sparkles) thay vì `terminal`, và người đọc transcript không nhận ra đây là
    // một lần đọc terminal.
    expect(labelOf(BARE)).toBe('Terminal')
    expect(labelOf(BRIDGED)).toBe('Terminal')
    expect(iconOf(BARE)).toBe('terminal')
    expect(iconOf(BRIDGED)).toBe('terminal')
  })

  it('KHÔNG gấp tên của một server lạ trùng tên tool', () => {
    expect(labelOf(`mcp__someoneelse__${BARE}`)).toBe(`someoneelse: ${BARE}`)
  })

  it('chính sách chỉ có MỘT bản cho cả hai runtime', () => {
    // Hai hàng rào bảo mật (khử bí mật + hàng rào nonce) nằm trong `runReadTerminal`,
    // và cả hai nhánh gọi đúng hàm đó. Test này chỉ giữ được nguồn chuỗi dùng chung;
    // phần thân được giữ bằng việc bridge KHÔNG có nhánh dựng lại nào.
    expect(READ_TERMINAL_TEXT.description).toContain('UNTRUSTED DATA')
    expect(READ_TERMINAL_TEXT.lines).toContain('trailing lines')
  })
})

// `dev_server` bắc cầu qua server RIÊNG `awogdev`.
//
// Cùng tiêu chí đã dùng cho `read_terminal`: tên server hiện ra trong luật quyền và
// trong `disabledTools`, nên nó phải nói đúng tool là gì. Một surface là thứ model
// ĐẶT VÀO transcript; `dev_server` thì ĐỌC log L1 của một tiến trình và DỪNG được
// tiến trình đó — hai việc mà một luật viết cho `mcp__awogsurfaces__*` không được
// phép vô tình phủ.
describe('dev_server bắc cầu qua awogdev', () => {
  const BARE = 'dev_server'
  const BRIDGED = `mcp__${DEV_SERVER_MCP_SERVER}__${BARE}`

  const labelOf = (name: string): string =>
    stepFromToolUse({ id: 't1', name, input: { action: 'list' } }).label
  const iconOf = (name: string): string =>
    stepFromToolUse({ id: 't1', name, input: { action: 'list' } }).tool ?? ''

  it('tên nằm trong danh sách được gấp tên', () => {
    expect(DEV_SERVER_TOOL_NAMES as readonly string[]).toContain(BARE)
  })

  it('hai runtime cho ra CÙNG nhãn VÀ cùng icon', () => {
    expect(labelOf(BARE)).toBe('Dev server')
    expect(labelOf(BRIDGED)).toBe('Dev server')
    expect(iconOf(BARE)).toBe('terminal')
    expect(iconOf(BRIDGED)).toBe('terminal')
  })

  it('KHÔNG gấp tên của một server lạ trùng tên tool', () => {
    expect(labelOf(`mcp__someoneelse__${BARE}`)).toBe(`someoneelse: ${BARE}`)
  })

  it('chính sách chỉ có MỘT bản cho cả hai runtime', () => {
    // Giao kèo quan trọng nhất của tool này — `start` KHÔNG tự spawn, nó trả về
    // nguyên văn lệnh để model chạy qua `Bash`, tức qua đúng cổng quyền — nằm
    // trong mô tả dùng chung. Chép chuỗi sang bridge rồi bỏ câu đó đi là tháo một
    // hàng rào, nên test giữ lấy nguồn chung.
    expect(DEV_SERVER_TEXT.description).toContain('does NOT launch anything')
    expect(DEV_SERVER_TEXT.description).toContain('run_in_background')
    expect(DEV_SERVER_TEXT.lines).toContain('matching lines')
  })
})

// `code_index` bắc cầu qua server RIÊNG `awogcode`.
describe('code_index bắc cầu qua awogcode', () => {
  const BARE = 'code_index'
  const BRIDGED = `mcp__${CODE_INDEX_MCP_SERVER}__${BARE}`

  const labelOf = (name: string): string =>
    stepFromToolUse({ id: 't1', name, input: { action: 'refs', symbol: 'x' } }).label
  const iconOf = (name: string): string =>
    stepFromToolUse({ id: 't1', name, input: { action: 'refs', symbol: 'x' } }).tool ?? ''

  it('tên nằm trong danh sách được gấp tên', () => {
    expect(CODE_INDEX_TOOL_NAMES as readonly string[]).toContain(BARE)
  })

  it('hai runtime cho ra CÙNG nhãn VÀ cùng icon', () => {
    expect(labelOf(BARE)).toBe('Code index')
    expect(labelOf(BRIDGED)).toBe('Code index')
    expect(iconOf(BARE)).toBe('search')
    expect(iconOf(BRIDGED)).toBe('search')
  })

  it('KHÔNG gấp tên của một server lạ trùng tên tool', () => {
    expect(labelOf(`mcp__someoneelse__${BARE}`)).toBe(`someoneelse: ${BARE}`)
  })

  it('chính sách chỉ có MỘT bản cho cả hai runtime', () => {
    // Lời tự thú về chỗ mù của parser là thứ giữ model khỏi kết luận "không ai gọi
    // hàm này" rồi xoá. Nó phải đi cùng tool ở CẢ HAI nhánh.
    expect(CODE_INDEX_TEXT.description).toContain('NOT the TypeScript compiler')
    expect(CODE_INDEX_TEXT.description).toContain('confirm with Grep before deleting')
    expect(CODE_INDEX_TEXT.symbol).toContain('case-sensitive')
  })
})

// `list_sessions` + `send_session_message` bắc cầu qua server RIÊNG `awogsessions`.
//
// Vì sao không đi nhờ `awogsurfaces`: một surface đặt một thẻ vào transcript của
// CHÍNH phiên này; hai tool ở đây đọc danh bạ các phiên khác và GHI vào hộp thư của
// một phiên khác. Biên tin cậy khác hẳn, nên một cú tắt "surfaces" không được phép
// vô tình khoá kênh liên phiên (và ngược lại).
describe('list_sessions + send_session_message bắc cầu qua awogsessions', () => {
  const bridged = (bare: string): string => `mcp__${SESSION_MESSAGING_MCP_SERVER}__${bare}`

  const labelOf = (name: string): string =>
    stepFromToolUse({ id: 't1', name, input: { session_id: 'ses-1', message: 'hi' } }).label
  const iconOf = (name: string): string =>
    stepFromToolUse({ id: 't1', name, input: { session_id: 'ses-1', message: 'hi' } }).tool ?? ''

  it('cả hai tên nằm trong danh sách được gấp tên', () => {
    expect(SESSION_MESSAGING_TOOL_NAMES as readonly string[]).toContain('list_sessions')
    expect(SESSION_MESSAGING_TOOL_NAMES as readonly string[]).toContain('send_session_message')
  })

  it('hai runtime cho ra CÙNG nhãn VÀ cùng icon', () => {
    expect(labelOf('list_sessions')).toBe('Sessions')
    expect(labelOf(bridged('list_sessions'))).toBe('Sessions')
    expect(labelOf('send_session_message')).toBe('Message')
    expect(labelOf(bridged('send_session_message'))).toBe('Message')
    // Lưu ý về sức mạnh của phép kiểm này: `task` CŨNG là giá trị rơi mặc định
    // của `pickStepTool`, nên với hai tool này khẳng định icon là ghi lại chủ ý
    // chứ không bắt được việc thiếu dòng trong `TOOL_NAME_MAP` — đã kiểm chứng
    // bằng cách gỡ dòng đó ra và thấy test vẫn xanh. Cái bắt được lỗ hổng ở đây
    // là khẳng định NHÃN ngay trên (gỡ dòng bảng gấp tên ⇒ 'awogsessions:
    // list_sessions'). Dòng trong bảng icon vẫn được giữ tường minh vì mặc định
    // có thể đổi, còn chủ ý thì không.
    for (const name of [
      'list_sessions',
      bridged('list_sessions'),
      'send_session_message',
      bridged('send_session_message'),
    ]) {
      expect(iconOf(name)).toBe('task')
    }
  })

  it('KHÔNG gấp tên của một server lạ trùng tên tool', () => {
    expect(labelOf('mcp__someoneelse__list_sessions')).toBe('someoneelse: list_sessions')
    expect(labelOf('mcp__someoneelse__send_session_message')).toBe(
      'someoneelse: send_session_message',
    )
  })

  it('chính sách chỉ có MỘT bản cho cả hai runtime', () => {
    // Hai câu quan trọng nhất: danh bạ là nhãn KHÔNG tin được, và gửi tin thì
    // KHÔNG khởi động lượt nào ở phiên đích (nên đừng ngồi chờ trả lời).
    expect(SESSION_MESSAGING_TEXT.listDescription).toContain('untrusted labels')
    expect(SESSION_MESSAGING_TEXT.sendDescription).toContain('no reply to wait for')
    expect(SESSION_MESSAGING_TEXT.message).toContain('characters')
  })
})
