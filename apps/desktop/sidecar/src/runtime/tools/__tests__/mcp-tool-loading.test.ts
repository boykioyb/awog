// Tests cho logic CHỌN LỌC tool MCP của cả hai runtime (gói #9 — nạp tool theo
// yêu cầu). Hai hàm đều thuần, không chạm transport/IPC, nên test chỉ khẳng định
// đúng phần chính sách.
//
// Run với vitest: `npx vitest run src/runtime/tools/__tests__/mcp-tool-loading.test.ts`
// (vitest chưa nằm trong devDeps của sidecar — xem git/__tests__/discover.test.ts).
import { describe, expect, it } from 'vitest'
import { selectDirectMcpServers } from '../mcp-tools.js'
import { alwaysLoadExternalMcp, buildSdkEnv } from '../../claude-sdk/shared.js'

// Ngân sách nhánh Pi: 6000 byte tổng, 3000 byte cho một server.
describe('selectDirectMcpServers (Pi)', () => {
  it('giữ trực tiếp mọi server khi tổng schema vừa ngân sách', () => {
    const direct = selectDirectMcpServers([
      { serverId: 'a', bytes: 1_000 },
      { serverId: 'b', bytes: 2_000 },
    ])
    expect([...direct].sort()).toEqual(['a', 'b'])
  })

  it('hoãn server tự nó vượt trần từng-server, giữ các server nhỏ bên cạnh', () => {
    // Đây là ca all-or-nothing cũ: tổng 22KB ⇒ TẤT CẢ bị đẩy sau meta-tool, kể cả
    // hai server gần như miễn phí.
    const direct = selectDirectMcpServers([
      { serverId: 'playwright', bytes: 20_000 },
      { serverId: 'tiny', bytes: 400 },
      { serverId: 'small', bytes: 900 },
    ])
    expect([...direct].sort()).toEqual(['small', 'tiny'])
  })

  it('hoãn tất cả khi không server nào lọt trần từng-server', () => {
    const direct = selectDirectMcpServers([
      { serverId: 'big1', bytes: 4_000 },
      { serverId: 'big2', bytes: 3_001 },
    ])
    expect(direct.size).toBe(0)
  })

  it('dừng đúng lúc ngân sách cạn, ưu tiên server rẻ nhất', () => {
    const direct = selectDirectMcpServers([
      { serverId: 'c', bytes: 2_500 },
      { serverId: 'a', bytes: 2_500 },
      { serverId: 'b', bytes: 2_500 },
    ])
    // 2500 + 2500 = 5000 lọt; thêm cái thứ ba là 7500 > 6000.
    expect(direct.size).toBe(2)
  })

  it('tất định: cùng đầu vào (khác thứ tự) cho cùng kết quả', () => {
    const input = [
      { serverId: 'zeta', bytes: 2_500 },
      { serverId: 'alpha', bytes: 2_500 },
      { serverId: 'mid', bytes: 2_500 },
    ]
    const first = [...selectDirectMcpServers(input)].sort()
    const second = [...selectDirectMcpServers([...input].reverse())].sort()
    expect(first).toEqual(second)
    // Bằng byte ⇒ so serverId, nên hai cái đầu bảng chữ cái thắng.
    expect(first).toEqual(['alpha', 'mid'])
  })

  it('không server nào ⇒ tập rỗng', () => {
    expect(selectDirectMcpServers([]).size).toBe(0)
  })
})

// Nhánh Claude SDK: không đo được byte (SDK sở hữu kết nối) nên chính sách dựa
// trên số server gắn + timeoutMs đã khai.
describe('alwaysLoadExternalMcp (Claude SDK)', () => {
  it('S2: bộ gắn nhỏ vẫn nạp thẳng ở turn-1', () => {
    expect(alwaysLoadExternalMcp({}, 1)).toBe(true)
    expect(alwaysLoadExternalMcp({}, 2)).toBe(true)
  })

  it('S1: gắn từ 3 server trở lên thì hoãn hết cho tool-search', () => {
    expect(alwaysLoadExternalMcp({}, 3)).toBe(false)
    expect(alwaysLoadExternalMcp({}, 9)).toBe(false)
  })

  it('S3: server khai timeout dài hơn trần connect 5s thì không bao giờ nạp thẳng', () => {
    expect(alwaysLoadExternalMcp({ timeoutMs: 30_000 }, 1)).toBe(false)
    // Đúng bằng trần thì vẫn được — trần là "lớn hơn mới chặn".
    expect(alwaysLoadExternalMcp({ timeoutMs: 5_000 }, 1)).toBe(true)
  })
})

// Cờ bật tool-search của CLI (buildSdkEnv). Chính cờ này quyết định hai hàm chính
// sách trên có tác dụng hay không: SDK hoãn tool "when tool search is enabled", mà
// setting `toolSearchEnabled` của CLI mặc định FALSE — thiếu cờ thì mọi schema vẫn
// bị inline vào từng request, và `alwaysLoad: false` chỉ là no-op.
describe('buildSdkEnv — ENABLE_TOOL_SEARCH', () => {
  it('bật trên OAuth (endpoint first-party)', () => {
    const env = buildSdkEnv({ kind: 'oauth', accessToken: 'tok' })
    expect(env.ENABLE_TOOL_SEARCH).toBe('true')
  })

  it('bật trên api-key không có baseURL (vẫn là api.anthropic.com)', () => {
    const env = buildSdkEnv({ kind: 'apikey', apiKey: 'sk-test' })
    expect(env.ENABLE_TOOL_SEARCH).toBe('true')
  })

  it('KHÔNG bật khi có baseURL riêng — endpoint đó có thể trả 400 với request shape mới', () => {
    const env = buildSdkEnv({
      kind: 'apikey',
      apiKey: 'sk-test',
      baseURL: 'http://localhost:11434',
    })
    expect(env.ENABLE_TOOL_SEARCH).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBe('http://localhost:11434')
  })
})
