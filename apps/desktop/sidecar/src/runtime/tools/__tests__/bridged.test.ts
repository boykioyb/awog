// Bảng bắc cầu phải khớp THỰC TẾ, không phải khớp trí nhớ.
//
// Lớp bug "tool bắc cầu đổi tên" đã xảy ra năm lần, và mỗi lần đều là cùng một
// hình dạng: một chỗ so tên bằng chuỗi trần, im lặng bỏ sót ở nhánh Claude SDK —
// tức đúng nhánh của provider phổ biến nhất. Bảng này là nguồn duy nhất; test này
// giữ nó khỏi trôi khỏi các server thật.
import { describe, expect, it } from 'vitest'
import {
  AWOG_BRIDGE_SERVER_OF,
  bridgedNameOf,
  unbridgeAwogToolName,
  withBridgedAliases,
} from '../bridged.js'
import { SURFACE_MCP_SERVER, SURFACE_TOOL_NAMES } from '../surface-tools.js'
import { READ_TERMINAL_TOOL_NAMES, TERMINAL_MCP_SERVER } from '../read-terminal-tool.js'
import { BROWSER_MCP_SERVER, BROWSER_TOOL_NAME } from '../browser-tool.js'

describe('bảng khớp với hằng tên server thật', () => {
  // Đổi tên một server mà quên bảng ⇒ test đỏ ngay, thay vì phát hiện qua một
  // hàng transcript lạ sáu tuần sau.
  it('mọi tool surface đều có mặt, trỏ đúng server', () => {
    for (const name of SURFACE_TOOL_NAMES) {
      expect(AWOG_BRIDGE_SERVER_OF[name], `thiếu ${name} trong bảng`).toBe(SURFACE_MCP_SERVER)
    }
  })

  it('read_terminal và browser_tool trỏ đúng server', () => {
    for (const name of READ_TERMINAL_TOOL_NAMES) {
      expect(AWOG_BRIDGE_SERVER_OF[name]).toBe(TERMINAL_MCP_SERVER)
    }
    expect(AWOG_BRIDGE_SERVER_OF[BROWSER_TOOL_NAME]).toBe(BROWSER_MCP_SERVER)
  })
})

describe('gấp tên (hiển thị)', () => {
  it('gấp tool CỦA TA về tên trần', () => {
    expect(unbridgeAwogToolName('mcp__awogwiki__wiki_read')).toBe('wiki_read')
    expect(unbridgeAwogToolName(`mcp__${TERMINAL_MCP_SERVER}__read_terminal`)).toBe('read_terminal')
  })

  it('KHÔNG gấp khi server không phải của tool đó', () => {
    // Hàng rào quan trọng: một MCP server của người khác tình cờ tên `awogwiki`
    // không được mượn nhãn của AWOG, và một tool của ta dưới server SAI cũng vậy.
    expect(unbridgeAwogToolName('mcp__someoneelse__wiki_read')).toBe('mcp__someoneelse__wiki_read')
    expect(unbridgeAwogToolName('mcp__awogwiki__read_terminal')).toBe('mcp__awogwiki__read_terminal')
  })

  it('để nguyên tên không phải MCP và tên MCP dị dạng', () => {
    expect(unbridgeAwogToolName('Read')).toBe('Read')
    expect(unbridgeAwogToolName('mcp__nosep')).toBe('mcp__nosep')
    expect(unbridgeAwogToolName('mcp____empty')).toBe('mcp____empty')
  })
})

describe('nở tên (lọc quyền)', () => {
  it('thêm dạng bắc cầu mà GIỮ tên gốc', () => {
    // Giữ cả hai vì người dùng có thể đã viết sẵn dạng bắc cầu, và whitelist phải
    // khớp trên cả hai nhánh chứ không phải chuyển từ nhánh này sang nhánh kia.
    const out = withBridgedAliases(['Read', 'wiki_read'])
    expect(out).toContain('Read')
    expect(out).toContain('wiki_read')
    expect(out).toContain('mcp__awogwiki__wiki_read')
  })

  it('tool không bắc cầu thì không sinh alias', () => {
    expect(withBridgedAliases(['Read', 'Bash'])).toEqual(['Read', 'Bash'])
  })

  it('mảng rỗng vẫn là mảng rỗng', () => {
    // `allowedTools` rỗng nghĩa là CẤM HẾT, khác hẳn "không đặt" (cho hết). Hàm
    // không được phép làm mờ ranh giới đó; ca "không đặt" do KIỂU chặn (hàm không
    // nhận undefined) chứ không do một nhánh runtime.
    expect(withBridgedAliases([])).toEqual([])
  })

  it('không nhân đôi khi đã có sẵn dạng bắc cầu', () => {
    const out = withBridgedAliases(['wiki_read', 'mcp__awogwiki__wiki_read'])
    expect(out).toHaveLength(2)
  })
})

describe('bridgedNameOf', () => {
  it('trả null cho tool không bắc cầu', () => {
    expect(bridgedNameOf('Read')).toBeNull()
  })

  it('mọi entry trong bảng sinh ra tên gấp lại được về chính nó', () => {
    // Bất biến vòng tròn: nở rồi gấp phải ra tên ban đầu, cho MỌI dòng của bảng.
    for (const name of Object.keys(AWOG_BRIDGE_SERVER_OF)) {
      const bridged = bridgedNameOf(name)
      expect(bridged).not.toBeNull()
      expect(unbridgeAwogToolName(bridged as string)).toBe(name)
    }
  })
})
