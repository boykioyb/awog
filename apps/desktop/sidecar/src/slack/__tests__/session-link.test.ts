import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SlackThread, SlackThreadDetail } from '../types.js'

vi.mock('../../util/logger.js', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))

const THREAD_ID = 'T0000TEAM:C0000CHAN:1760000000.000100'

let stored: SlackThread
const events: Array<{ type: string; payload: unknown }> = []
const createdSessions: Array<{ id: string; mcpServerIds?: string[] }> = []
let liveIds: string[] = []
let sessionCounter = 0

vi.mock('../../transport/stdio.js', () => ({
  emit: (type: string, payload: unknown) => {
    events.push({ type, payload })
  },
}))
vi.mock('../rpc.js', () => ({
  SLACK_RPC_CODE: -32040,
  emitSlackChanged: (ids: string[]) => {
    events.push({ type: 'slack.changed', payload: { threadIds: ids } })
  },
}))
vi.mock('../store.js', async (orig) => {
  const real = await orig<typeof import('../store.js')>()
  return {
    ...real,
    requireThread: async () => ({ ...stored }),
    mutateThread: async (_id: string, fn: (t: SlackThread) => SlackThread | null) => {
      // Nhường event loop để hai lời gọi song song thật sự đan xen nếu không có khoá.
      await new Promise((r) => setTimeout(r, 5))
      stored = fn(stored) ?? stored
      return { ...stored }
    },
  }
})
vi.mock('../thread.js', () => ({
  ThreadUnavailableError: class extends Error {},
  loadFullThreadDetail: async (): Promise<SlackThreadDetail> => ({
    thread: stored,
    messages: [
      {
        ts: '1760000000.000100',
        userId: 'U0000AAAA',
        botName: null,
        text: 'root',
        editedTs: null,
        reactions: [],
        files: [],
        unfurls: [],
        isParent: true,
        subtype: null,
      },
      {
        ts: '1760000200.000000',
        userId: 'U0000AAAA',
        botName: null,
        text: 'reply',
        editedTs: null,
        reactions: [],
        files: [],
        unfurls: [],
        isParent: false,
        subtype: null,
      },
    ],
    users: {},
    selfUserId: 'U0000SELF',
    channels: {},
    customEmoji: {},
  }),
}))
vi.mock('../../sessions/store.js', () => ({
  createSession: async (s: { id: string; mcpServerIds?: string[] }) => {
    createdSessions.push(s)
    liveIds.push(s.id)
  },
  flushSession: async () => undefined,
  listSessionSummaries: async () => liveIds.map((id) => ({ id, archived: false })),
}))
vi.mock('../../sessions/spawn.js', () => ({
  mintSessionId: () => {
    sessionCounter += 1
    return `ses-${sessionCounter}`
  },
}))
vi.mock('../../projects/store.js', () => ({
  loadProject: async () => ({ id: 'p1', llmDefaults: { mcpServerIds: ['notion', 'slack-src', 'slack-mcp'] } }),
}))
vi.mock('../../sources/store.js', () => ({
  listSources: async () => [
    { id: 'notion', provider: 'notion', type: 'mcp', mcp: { url: 'https://mcp.notion.com/mcp' } },
    { id: 'slack-src', provider: 'slack', type: 'mcp', mcp: { url: 'https://example.com' } },
    { id: 'slack-mcp', provider: 'custom', type: 'mcp', mcp: { url: 'https://mcp.slack.com/mcp' } },
  ],
}))
vi.mock('../../sources/oauth-manager.js', () => ({ getFreshToken: async () => null }))
const tainted: string[] = []
let taintFails = false
vi.mock('../taint.js', () => ({
  markSessionSlackTainted: async (id: string) => {
    if (taintFails) throw new Error('disk full')
    events.push({ type: 'taint', payload: id })
    tainted.push(id)
  },
}))

const { openThreadSession, pushThreadToSession } = await import('../session-link.js')

const settings = { provider: 'anthropic', modelId: 'm', level: 'high', mode: 'ask' } as const

beforeEach(() => {
  stored = {
    id: THREAD_ID,
    sourceId: 'src1',
    teamId: 'T0000TEAM',
    teamName: 'Malme',
    teamUrl: 'https://malme.slack.com/',
    channelId: 'C0000CHAN',
    channelName: 'dev',
    threadTs: '1760000000.000100',
    title: null,
    firstLine: 'root',
    projectId: 'p1',
    sessionId: null,
    sessionSyncedTs: null,
    lastReplyTs: '1760000200.000000',
    lastSeenTs: '1760000200.000000',
    replyCount: 1,
    addedAt: 0,
    error: null,
  }
  events.length = 0
  createdSessions.length = 0
  liveIds = []
  tainted.length = 0
  taintFails = false
})

describe('openThreadSession', () => {
  it('bấm đúp song song chỉ tạo MỘT phiên', async () => {
    const [a, b] = await Promise.all([
      openThreadSession(THREAD_ID, { ...settings }),
      openThreadSession(THREAD_ID, { ...settings }),
    ])
    expect(createdSessions).toHaveLength(1)
    expect(a.sessionId).toBe(b.sessionId)
    expect(b.created).toBe(false)
  })

  it('loại nguồn Slack (provider slack + host mcp.slack.com) khỏi whitelist MCP', async () => {
    await openThreadSession(THREAD_ID, { ...settings })
    expect(createdSessions[0]?.mcpServerIds).toEqual(['notion'])
  })

  it('mốc đồng bộ chỉ được ghi SAU khi khối đã giao', async () => {
    await openThreadSession(THREAD_ID, { ...settings })
    const inbox = events.findIndex((e) => e.type === 'session.inbox-message')
    const created = events.findIndex((e) => e.type === 'session.created')
    expect(created).toBeGreaterThanOrEqual(0)
    expect(inbox).toBeGreaterThan(created)
    expect(stored.sessionSyncedTs).toBe('1760000200.000000')
  })
})

describe('cờ nhiễm Slack', () => {
  it('đánh dấu phiên TRƯỚC khi giao khối (open + push)', async () => {
    const r = await openThreadSession(THREAD_ID, { ...settings })
    const taint = events.findIndex((e) => e.type === 'taint')
    const inbox = events.findIndex((e) => e.type === 'session.inbox-message')
    expect(tainted).toEqual([r.sessionId])
    expect(taint).toBeGreaterThanOrEqual(0)
    expect(inbox).toBeGreaterThan(taint)

    liveIds = ['ses-x']
    stored = { ...stored, sessionId: 'ses-x', sessionSyncedTs: '1760000100.000000' }
    await pushThreadToSession(THREAD_ID)
    expect(tainted).toContain('ses-x')
  })

  it('ghi cờ hỏng ⇒ không giao khối, không dời mốc', async () => {
    liveIds = ['ses-x']
    stored = { ...stored, sessionId: 'ses-x', sessionSyncedTs: '1760000100.000000' }
    taintFails = true
    await expect(pushThreadToSession(THREAD_ID)).rejects.toThrow('disk full')
    expect(events.filter((e) => e.type === 'session.inbox-message')).toHaveLength(0)
    expect(stored.sessionSyncedTs).toBe('1760000100.000000')
  })
})

describe('pushThreadToSession', () => {
  it('hai lần push song song: lần sau thấy mốc mới, không giao trùng', async () => {
    liveIds = ['ses-x']
    stored = { ...stored, sessionId: 'ses-x', sessionSyncedTs: '1760000100.000000' }
    const [a, b] = await Promise.all([
      pushThreadToSession(THREAD_ID),
      pushThreadToSession(THREAD_ID),
    ])
    expect([a.pushed, b.pushed].sort()).toEqual([false, true])
    expect(events.filter((e) => e.type === 'session.inbox-message')).toHaveLength(1)
  })
})
