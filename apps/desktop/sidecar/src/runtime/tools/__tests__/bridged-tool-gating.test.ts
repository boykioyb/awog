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
