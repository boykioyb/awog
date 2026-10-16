// Prompt của boards.recap: mọi nguồn trên MỘT dòng thời gian, ghi chú của người dùng
// tới SAU phải đứng sau (và nổi lên đầu) — hồi quy lỗi 2026-10-16: "Tôi đã trả lời KH"
// bị recap thành "chưa post" vì comment và transcript nằm ở hai khối rời.
//
// Run: `npx vitest run src/methods/__tests__/boards-recap.test.ts`
import { describe, expect, it, vi } from 'vitest'
import type { BoardItem, Session } from '../../types/shared.js'

vi.mock('../../util/logger.js', () => ({
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))

const { buildRecapPrompt } = await import('../boards.recap.js')

const item: BoardItem = {
  id: 'bi-0000000000000001',
  projectId: 'p',
  title: 'Slack thread',
  status: 'pending',
  createdBy: null,
  createdAt: '2026-10-16T02:00:00.000Z',
  updatedAt: '2026-10-16T02:43:00.748Z',
  comments: [
    { id: 'bc-1', at: '2026-10-16T02:43:00.737Z', from: null, fromTitle: 'system', text: 'in_review → pending' },
    { id: 'bc-2', at: '2026-10-16T02:43:00.748Z', from: null, fromTitle: 'You', text: 'Tôi đã trả lời KH, đợi KH phản hồi' },
  ],
}

const session = {
  id: 's1',
  title: 'Slack',
  projectId: 'p',
  createdAt: '2026-10-16T02:00:00.000Z',
  updatedAt: '2026-10-16T02:30:00.000Z',
  invitedAgentIds: [],
  pendingAgentIds: [],
  settings: { provider: 'anthropic', modelId: 'm', level: 'high', mode: 'ask' },
  messages: [
    { id: 'm1', role: 'user', text: 'đọc thread này', at: '2026-10-16T02:20:00.000Z' },
    { id: 'm2', role: 'agent', text: 'Nháp câu trả lời đã có, chưa post lên Slack.', at: '2026-10-16T02:29:00.000Z' },
  ],
} as unknown as Session

describe('buildRecapPrompt', () => {
  const prompt = buildRecapPrompt(item, [session])

  it('ghi chú người dùng đứng SAU tin cuối của transcript trên dòng thời gian', () => {
    expect(prompt.indexOf('chưa post')).toBeGreaterThan(-1)
    expect(prompt.lastIndexOf('User note: Tôi đã trả lời KH')).toBeGreaterThan(prompt.indexOf('chưa post'))
  })

  it('status hiện tại + ghi chú mới nhất nổi lên đầu nguồn', () => {
    const head = prompt.slice(0, prompt.indexOf('TIMELINE'))
    expect(head).toContain('CURRENT STATUS: pending (since 2026-10-16 02:43)')
    expect(head).toContain('LATEST USER NOTE (2026-10-16 02:43): Tôi đã trả lời KH')
  })
})
