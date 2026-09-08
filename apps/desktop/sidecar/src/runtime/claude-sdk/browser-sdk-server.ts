// Embedded browser on the Claude SDK path (ADR 0043, đính chính 2026-09-07).
//
// Trước file này, `browser_tool` chỉ tồn tại trên nhánh Pi. Nghĩa là người dùng đổi
// sang tài khoản Anthropic — runtime MẠNH HƠN — thì MẤT khả năng duyệt web: agent
// còn WebFetch (HTML thô, không chạy JS) chứ không mở được trang, không bấm được nút,
// không đọc được console/network. Một năng lực biến mất khi đổi nhà cung cấp thì với
// người dùng nó là app hỏng, không phải "khác runtime".
//
// One in-process SDK MCP server keyed `awogbrowser` → SDK expose
// `mcp__awogbrowser__browser_tool`. Handler gọi ĐÚNG hàm mà Pi AgentTool gọi
// (`runBrowserAction` trong runtime/tools/browser-tool.ts), nên hàng rào SSRF, hàng
// rào nonce chống prompt injection, việc khử bí mật và mọi cap kích thước là MỘT bản
// duy nhất. Chỉ schema tham số bị khai hai lần (TypeBox bên kia, zod bên này); mô tả
// tool — lớp hàng rào số 1, thứ model thực sự đọc — dùng chung hằng
// BROWSER_TOOL_DESCRIPTION.
//
// NAMING: tên tool của ta (`browser_tool`) KHÔNG bắt đầu bằng `mcp_`. Tiền tố đó do
// Anthropic dành riêng và một custom tool dùng nó làm lượt OAuth trả 400 (repo đã
// trả giá một lần với `mcp_describe`/`mcp_call`). Namespace `mcp__` mà SDK tự thêm
// vào tool MCP bắc cầu là quy ước của chính API, không liên quan — giống
// `mcp__awogwiki__*`.
//
// Permission gate: đã khớp CẢ HAI cách gọi tên. `runtime/permission.ts` dùng
// `isBrowserToolName(name)` nên tên bắc cầu `mcp__awogbrowser__browser_tool` cũng
// bị gate như tên trần — plan mode vẫn read-only ở nhánh này. (Khối cảnh báo cũ ở
// đây nói ngược lại và đã lỗi thời: một comment sai về trạng thái bảo mật còn nguy
// hiểm hơn không có comment.)

import { z } from 'zod'
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk'
import {
  BROWSER_TOOL_DESCRIPTION,
  BROWSER_TOOL_NAME,
  runBrowserAction,
  type BrowserActionInput,
  BROWSER_MCP_SERVER,
} from '../tools/browser-tool.js'
export { BROWSER_MCP_SERVER }

// `isError` là thứ khiến một ref chết / một tab không tồn tại render thành bước LỖI
// thay vì một cú bấm coi như thành công. Lõi báo hỏng bằng `details.isError` (không
// throw — xem tools/tool-error.ts), nên phải khiêng cờ đó qua cầu tường minh.
function bridge(result: Awaited<ReturnType<typeof runBrowserAction>>): {
  content: { type: 'text'; text: string }[]
  isError?: boolean
} {
  const text = result.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
  return {
    content: [{ type: 'text', text }],
    ...(result.details?.isError === true ? { isError: true } : {}),
  }
}

export function buildBrowserToolSdkServer(cwd: string): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: BROWSER_MCP_SERVER,
    version: '1.0.0',
    tools: [
      tool(
        BROWSER_TOOL_NAME,
        BROWSER_TOOL_DESCRIPTION,
        {
          action: z
            .enum([
              'navigate',
              'snapshot',
              'click',
              'fill',
              'extract',
              'screenshot',
              'console',
              'network',
              'network_body',
              'viewport',
              'tabs',
              'tab_new',
              'tab_select',
              'tab_close',
            ])
            .describe('The browser action to perform.'),
          url: z.string().optional().describe('For navigate / tab_new: absolute http/https URL.'),
          ref: z
            .string()
            .optional()
            .describe(
              'For click/fill: the ref_N id of an element from the last snapshot of this tab. Prefer this over selector.',
            ),
          selector: z
            .string()
            .optional()
            .describe(
              'CSS selector for click/fill/extract, or the subtree to limit snapshot to. Use only when no ref applies.',
            ),
          value: z.string().optional().describe('For fill: the text to enter.'),
          mode: z
            .enum(['text', 'dom'])
            .optional()
            .describe('For extract: text (innerText) or dom (outerHTML). Default text.'),
          level: z
            .enum(['all', 'error', 'warning', 'info', 'verbose'])
            .optional()
            .describe('For console: which severity to return. Default all.'),
          filter: z
            .string()
            .optional()
            .describe(
              'For network: substring of the URL, or an exact resource type (xhr, fetch, document, script, image).',
            ),
          limit: z
            .number()
            .optional()
            .describe('For console/network: how many recent entries (default 50).'),
          requestId: z
            .string()
            .optional()
            .describe('For network_body: the id printed by the network action.'),
          preset: z
            .enum(['mobile', 'tablet', 'desktop', 'wide'])
            .optional()
            .describe('For viewport: a device preset. Or give width/height instead.'),
          width: z.number().optional().describe('For viewport: CSS pixels wide.'),
          height: z.number().optional().describe('For viewport: CSS pixels tall.'),
          mobile: z
            .boolean()
            .optional()
            .describe('For viewport: emulate touch + a mobile user agent.'),
          tabId: z
            .string()
            .optional()
            .describe('Which tab to act on. Defaults to the active tab.'),
        },
        async (args) => bridge(await runBrowserAction(cwd, args as BrowserActionInput)),
      ),
    ],
  })
}
