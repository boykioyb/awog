// Luật DENY do NGƯỜI DÙNG tự gõ (F3 của audit lần 4 — công tắc tắt hẳn một tool).
//
// Vì sao cần đường này: trước nó, Settings → Permissions chỉ làm được hai việc —
// chấp nhận một gợi ý (luôn ra `allow`) và xoá. Nghĩa là KHÔNG có cách nào tắt hẳn
// một tool: `disabledTools` là per-session và mặc định rỗng, nên tool bật theo mặc
// định thì bật ở mọi phiên chat. `Artifact` làm lộ ra chuyện đó, nhưng lỗ hổng là
// chung cho mọi tool.
//
// File này khoá HAI thứ, và cả hai đều load-bearing:
//  1. Đường ghi có tác dụng THẬT — luật viết ra chặn được lời gọi, kể cả ở
//     `execute` mode và auto-approve, tức đúng chỗ mà một "công tắc tắt" phải thắng.
//     Một công tắc chỉ có tác dụng ở mode dễ là công tắc nói dối.
//  2. Đường ghi CHỈ đi được một chiều. `permissions.acceptSuggestion` cố ý không
//     nhận văn bản luật từ UI vì một payload dựng tay ghi `Bash(*)` là cấp thêm
//     quyền (ADR 0080 mục 5). Đường này nhận văn bản được là nhờ `action` bị GHIM
//     thành 'deny' trong sidecar — nên test dưới đây kiểm chính điều đó: cùng một
//     chuỗi, parse theo chiều deny không bao giờ ra một luật cấp quyền.
//
// Run: `npx vitest run src/runtime/__tests__/user-deny-rule.test.ts`
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BeforeToolCallContext } from '@earendil-works/pi-agent-core'
import {
  clearSessionRules,
  listRulesInFile,
  parsePermissionRule,
  persistRule,
  userRuleFile,
} from '../../sessions/permission-rules.js'
import { makeBeforeToolCall } from '../permission.js'
import type { CanUseTool } from '../permission-types.js'
import { ARTIFACT_TOOL_NAME } from '../claude-sdk/artifact.js'

const sessionId = 'ses-user-deny'

function toolCtx(name: string, args: Record<string, unknown>): BeforeToolCallContext {
  return { toolCall: { id: 'tc-1', name, arguments: args }, args } as unknown as BeforeToolCallContext
}

const allowGate: CanUseTool = async () => ({ behavior: 'allow' })

// Đúng phép biến đổi mà `permissions.addDenyRule` làm: văn bản từ UI, action ghim.
function asUserDenyRule(text: string) {
  const parsed = parsePermissionRule(text, 'deny')
  if (!parsed) throw new Error(`not a rule: ${text}`)
  return parsed
}

let home: string
let originalHome: string | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-user-deny-'))
  originalHome = process.env.HOME
  process.env.HOME = home
  clearSessionRules(sessionId)
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  clearSessionRules(sessionId)
  await rm(home, { recursive: true, force: true })
})

describe('action bị ghim thành deny', () => {
  it('mọi văn bản luật đều ra action deny — không có chuỗi nào lật được sang allow', () => {
    for (const text of ['Artifact', 'Bash(*)', 'Write(**/.env)', 'WebFetch']) {
      expect(asUserDenyRule(text).action).toBe('deny')
    }
  })

  it('văn bản không đọc được ⇒ null, không lưu một luật vô hiệu', () => {
    // Luật cấm vô hiệu tệ hơn không có luật: người dùng tưởng đã tắt.
    for (const text of ['', '   ', '(', 'Bash(', 'has space(x)']) {
      expect(parsePermissionRule(text, 'deny')).toBeNull()
    }
  })
})

describe('luật người dùng gõ có tác dụng thật', () => {
  it('lưu ở tầng user và đọc lại được', async () => {
    const scope = await persistRule('user', asUserDenyRule(ARTIFACT_TOOL_NAME), {})
    expect(scope).toBe('user')
    const listed = await listRulesInFile(userRuleFile())
    expect(listed.status).toBe('ok')
    expect(listed.rules).toEqual([
      expect.objectContaining({ rule: ARTIFACT_TOOL_NAME, action: 'deny' }),
    ])
  })

  it('chặn được Artifact — đây chính là công tắc tắt mà F3 nói là không có', async () => {
    await persistRule('user', asUserDenyRule(ARTIFACT_TOOL_NAME), {})
    const hook = makeBeforeToolCall(allowGate, 'ask', sessionId)
    await expect(
      hook(toolCtx(ARTIFACT_TOOL_NAME, { action: 'publish', file_path: join(home, 'r.html') })),
    ).resolves.toMatchObject({ block: true })
  })

  it('chặn cả hành động CHỈ ĐỌC — tắt là tắt, không phải "chỉ hỏi thêm"', async () => {
    await persistRule('user', asUserDenyRule(ARTIFACT_TOOL_NAME), {})
    const hook = makeBeforeToolCall(allowGate, 'ask', sessionId)
    await expect(hook(toolCtx(ARTIFACT_TOOL_NAME, { action: 'list' }))).resolves.toMatchObject({
      block: true,
    })
  })

  it('execute mode KHÔNG miễn trừ — công tắc chỉ chạy ở mode dễ là công tắc nói dối', async () => {
    await persistRule('user', asUserDenyRule(ARTIFACT_TOOL_NAME), {})
    const hook = makeBeforeToolCall(allowGate, 'execute', sessionId)
    await expect(hook(toolCtx(ARTIFACT_TOOL_NAME, { action: 'list' }))).resolves.toMatchObject({
      block: true,
    })
  })

  it('auto-approve KHÔNG miễn trừ', async () => {
    await persistRule('user', asUserDenyRule(ARTIFACT_TOOL_NAME), {})
    const hook = makeBeforeToolCall(allowGate, 'ask', sessionId, true)
    await expect(hook(toolCtx(ARTIFACT_TOOL_NAME, { action: 'list' }))).resolves.toMatchObject({
      block: true,
    })
  })

  it('không đụng tới tool khác', async () => {
    await persistRule('user', asUserDenyRule(ARTIFACT_TOOL_NAME), {})
    const hook = makeBeforeToolCall(allowGate, 'ask', sessionId)
    await expect(hook(toolCtx('Read', { file_path: join(home, 'a.txt') }))).resolves.toBeUndefined()
  })
})
