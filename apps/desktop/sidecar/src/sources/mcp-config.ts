// Một nguồn `mcp` → entry của McpServersConfig (transport đã resolve, secret đã
// expand, Bearer đã gắn). Tách ra vì Logtime (ADR 0091) cần đúng MỘT nguồn theo
// id, trong khi hai chỗ dùng sẵn — `sessions.send-message` và `tasks/agent-context`
// — dựng nó trong một vòng lặp qua TẤT CẢ source kèm gate/api/local.
//
// Hai vòng lặp đó hiện vẫn giữ bản inline của mình: gỡ chúng ra là sửa hai đường
// nóng (mỗi turn chat / mỗi node task) nên để lại cho một lần refactor riêng. Đây
// là chỗ đặt sẵn cho lần đó.

import { expandSecrets } from '../mcp/secrets.js'
import { applyBearerScheme } from '../mcp/auth-headers.js'
import { applyOAuthAuthorization } from './oauth-manager.js'
import type { McpServersConfig } from '../runtime/permission-types.js'
import type { McpSource } from '../types/shared.js'

// `null` = nguồn không bắc cầu được (thiếu command/url, hoặc transport sse chưa
// hỗ trợ). Caller quyết định báo lỗi thế nào — ở đây không throw.
export async function resolveSourceMcpConfig(
  source: McpSource,
): Promise<McpServersConfig[string] | null> {
  const transport = source.mcp.transport ?? 'http'
  if (transport === 'stdio') {
    if (!source.mcp.command) return null
    const env = await expandSecrets(source.id, source.mcp.env)
    return {
      type: 'stdio',
      command: source.mcp.command,
      ...(source.mcp.args ? { args: source.mcp.args } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
      timeoutMs: source.timeoutMs,
    }
  }
  if (transport === 'http') {
    if (!source.mcp.url) return null
    const expanded = applyBearerScheme(
      source.mcp.authType,
      await expandSecrets(source.id, source.mcp.headers),
    )
    // Token oauth được làm mới nếu sắp hết hạn — ADR 0060 D-4.
    const headers = await applyOAuthAuthorization(source, expanded)
    return {
      type: 'http',
      url: source.mcp.url,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      timeoutMs: source.timeoutMs,
    }
  }
  return null
}
