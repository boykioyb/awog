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
