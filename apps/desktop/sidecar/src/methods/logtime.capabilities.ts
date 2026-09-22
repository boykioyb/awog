import { register } from '../transport/rpc.js'
import { enabledMcpSources, probeSources } from '../logtime/mcp.js'
import { loadSettings } from '../logtime/store.js'

// Dò `tools/list` của ĐÚNG những nguồn người dùng đã chọn (ADR 0091 D-2). Read-only.
//
// `available` là danh sách nguồn MCP đang bật, chỉ để UI gợi ý lúc bấm "Thêm nguồn" —
// không kèm năng lực, nên không tốn handshake nào. Dò chỉ chạy cho `settings.sourceIds`.
register('logtime.capabilities', async () => {
  const settings = await loadSettings()
  return {
    sources: await probeSources(settings.sourceIds),
    available: await enabledMcpSources(),
  }
})
