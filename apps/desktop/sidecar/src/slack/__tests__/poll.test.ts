import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SlackThread } from '../types.js'

vi.mock('../../util/logger.js', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))
vi.mock('../rpc.js', () => ({ emitSlackChanged: vi.fn() }))

const thread: SlackThread = {
  id: 'T0000TEAM:C0000CHAN:1760000000.000100',
  sourceId: 'src1',
  teamId: 'T0000TEAM',
  teamName: 'Malme',
  teamUrl: 'https://malme.slack.com/',
  channelId: 'C0000CHAN',
  channelName: 'dev',
  threadTs: '1760000000.000100',
  title: null,
  firstLine: 'x',
  projectId: null,
  sessionId: null,
  sessionSyncedTs: null,
  lastReplyTs: '1760000000.000100',
  lastSeenTs: '1760000000.000100',
  replyCount: 0,
  addedAt: 0,
  error: null,
}

let stored: SlackThread = { ...thread }
const api = vi.fn()

vi.mock('../store.js', async (orig) => {
  const real = await orig<typeof import('../store.js')>()
  return {
    ...real,
    listThreads: async () => [stored],
    mutateThreads: async (updates: ReadonlyMap<string, (t: SlackThread) => SlackThread>) => {
      const fn = updates.get(stored.id)
      if (!fn) return []
      const next = fn(stored)
      const changed = JSON.stringify(next) !== JSON.stringify(stored)
      stored = next
      return changed ? [stored.id] : []
    },
  }
})
vi.mock('../session.js', () => ({
  openSlackSession: async () => ({ teamId: 'T0000TEAM', api }),
}))

const { pollThreads } = await import('../poll.js')

beforeEach(() => {
  api.mockReset()
})

describe('pollThreads', () => {
  it('bỏ qua thread vừa poll < 15s, trừ khi force', async () => {
    api.mockResolvedValue({ ok: true, messages: [] })
    await pollThreads([thread.id])
    await pollThreads([thread.id])
    expect(api).toHaveBeenCalledTimes(1)
    await pollThreads([thread.id], { force: true })
    expect(api).toHaveBeenCalledTimes(2)
  })

  it('latest_reply / ts sai dạng không được ghi vào store', async () => {
    stored = { ...thread }
    api.mockResolvedValue({
      ok: true,
      messages: [
        { ts: thread.threadTs, latest_reply: '../../evil', reply_count: 3 },
        { ts: 'not-a-ts' },
        { ts: '1760000100.000000' },
      ],
    })
    await pollThreads([thread.id], { force: true })
    // latest_reply lệch ⇒ lấy reply mới nhất hợp lệ; ts rác bị bỏ.
    expect(stored.lastReplyTs).toBe('1760000100.000000')
    expect(stored.replyCount).toBe(3)
  })
})
