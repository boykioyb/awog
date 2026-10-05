// boards.comment — đường "chat nhận việc" trên thread của một board item
// (docs/features/session-teams.md §6): comment của người dùng PHẢI đánh thức
// được người nhận — assignee sống, spec đang đỗ (assigneeRef → materialize +
// gán), hay đích của một @mention.
//
// Vì sao có file này — lỗi đã xảy ra thật: comment chỉ wake
// `assigneeSessionId`, nên item đỗ backlog với spec chưa materialize thì
// comment lưu xong im lặng không ai nghe. Khúc dàn nhạc (ref → spawn → gán →
// ping → aggregate wake) là phần dễ gãy nhất của pipeline và nằm NGOÀI phần
// thuần đã được mentions.test.ts phủ.
//
// Board store chạy THẬT trên HOME tạm (khuôn store.test.ts); mọi đường ra
// ngoài — inbox, spawn qua dispatch, roster spec — bị mock để đọc đúng cuộc
// gọi. `dispatch` của rpc bọc bản thật: ba method spawn bị chặn ghi lại, còn
// lại (kể cả chính boards.comment) chạy vào registry thật.
//
// Run: `npx vitest run src/methods/__tests__/boards-comment.test.ts`
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, BoardItem, SessionSummary, TeamSpec } from '../../types/shared.js'

// Trạng thái dùng chung giữa các vi.mock — hoisted trước mọi factory.
const state = vi.hoisted(() => ({
  summaries: [] as SessionSummary[],
  inbox: [] as { from: string | null; to: string; text: string }[],
  inboxError: null as Error | null,
  active: [] as string[],
  dispatched: [] as { method: string; params: Record<string, unknown> }[],
  agents: [] as Agent[],
  teams: [] as TeamSpec[],
  runTeam: null as TeamSpec | null,
  llmDefaults: undefined as Record<string, unknown> | undefined,
}))

// Id giả trả về cho từng đường spawn — khác nhau để test nhận diện đúng đích.
const SPAWN_ID: Record<string, Record<string, unknown>> = {
  'agents.run': { sessionId: 'ses-new-agent' },
  'teams.run': { rootId: 'ses-new-lead' },
  'sessions.materializeMember': { sessionId: 'ses-new-member' },
}

vi.mock('../../transport/rpc.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../transport/rpc.js')>()
  return {
    ...orig,
    dispatch: async (method: string, params: unknown) => {
      const fake = SPAWN_ID[method]
      if (fake) {
        state.dispatched.push({ method, params: params as Record<string, unknown> })
        return fake
      }
      return orig.dispatch(method, params)
    },
  }
})

vi.mock('../../transport/stdio.js', () => ({ emit: () => {} }))
vi.mock('../../util/logger.js', () => ({
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))

vi.mock('../../sessions/inbox.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../sessions/inbox.js')>()
  return {
    ...orig,
    postSessionMessage: async (input: { from: string | null; to: string; text: string }) => {
      if (state.inboxError) throw state.inboxError
      state.inbox.push(input)
      return { id: 'im-1', ...input }
    },
  }
})

vi.mock('../../sessions/runner.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../sessions/runner.js')>()
  return { ...orig, activeSessionIds: () => [...state.active] }
})

vi.mock('../../sessions/store.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../sessions/store.js')>()
  return {
    ...orig,
    listSessionSummaries: async () => [...state.summaries],
    setSessionLlmOverride: async () => true,
  }
})

vi.mock('../../agents/store.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../agents/store.js')>()
  return {
    ...orig,
    listAgents: async () => ({ agents: [...state.agents], reports: [] }),
    loadAgent: async (id: string, source: 'global' | 'project', projectId?: string) =>
      state.agents.find(
        (a) => a.id === id && a.source === source && (a.projectId ?? undefined) === projectId,
      ) ?? null,
  }
})

vi.mock('../../teams/store.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../teams/store.js')>()
  return {
    ...orig,
    listTeams: async () => [...state.teams],
    loadTeam: async (id: string, source: 'global' | 'project', projectId?: string) =>
      state.teams.find(
        (t) => t.id === id && (t.source ?? 'global') === source && t.projectId === projectId,
      ) ?? null,
  }
})

vi.mock('../../projects/store.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../projects/store.js')>()
  return { ...orig, loadProject: async () => ({ llmDefaults: state.llmDefaults }) }
})

vi.mock('../../settings/store.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../settings/store.js')>()
  return { ...orig, resolveSettings: async () => ({ effective: {} }) }
})

vi.mock('../../sessions/team-members.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../sessions/team-members.js')>()
  return { ...orig, loadRunTeam: async () => state.runTeam }
})

const { dispatch } = await import('../../transport/rpc.js')
const { upsertBoardItem, getBoardItem } = await import('../../boards/store.js')
await import('../boards.comment.js')

const PID = 'proj-comment'

let home: string
let originalHome: string | undefined
let n = 0

function session(partial: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    title: partial.id,
    projectId: PID,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'idle',
    invitedAgentIds: [],
    pendingAgentIds: [],
    settings: { provider: 'anthropic', modelId: 'm', level: 'high', mode: 'execute' },
    ...partial,
  }
}

function agent(partial: Partial<Agent> & { id: string }): Agent {
  return {
    source: 'global',
    name: partial.id,
    description: '',
    provider: 'anthropic',
    model: 'm',
    systemPrompt: '',
    role: '',
    ...partial,
  }
}

// Tạo item mới qua API thật — id độc nhất để các test không đạp nhau.
async function seedItem(patch: Partial<BoardItem> = {}): Promise<BoardItem> {
  n += 1
  return upsertBoardItem(PID, { title: `Việc ${n}`, status: 'backlog', ...patch })
}

async function comment(itemId: string, text: string) {
  return (await dispatch('boards.comment', { projectId: PID, itemId, text })) as {
    comment: { text: string }
    item: BoardItem
    wake: string
  }
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-boards-comment-'))
  originalHome = process.env['HOME']
  process.env['HOME'] = home
  state.summaries = []
  state.inbox = []
  state.inboxError = null
  state.active = []
  state.dispatched = []
  state.agents = []
  state.teams = []
  state.runTeam = null
  state.llmDefaults = undefined
})

afterEach(async () => {
  process.env['HOME'] = originalHome
  await rm(home, { recursive: true, force: true })
})

describe('boards.comment — đường assignee sống', () => {
  it('assignee rảnh → ping trực tiếp, wake delivered + vạch biên nhận trong thread', async () => {
    const it = await seedItem({ assigneeSessionId: 'ses-po', status: 'in_progress' })
    state.summaries = [session({ id: 'ses-po', title: 'PO' })]
    const res = await comment(it.id, 'check giúp em spec này')
    expect(res.wake).toBe('delivered')
    expect(state.inbox).toHaveLength(1)
    expect(state.inbox[0]?.to).toBe('ses-po')
    expect(state.inbox[0]?.from).toBeNull()
    expect(state.inbox[0]?.text).toContain('New comment')
    expect(state.dispatched).toHaveLength(0)
    // Biên nhận: user THẤY ngay tin đã tới ai — không phải đợi agent reply.
    expect(
      res.item.comments.some(
        (c) => c.fromTitle === 'system' && c.text.includes('delivered to "PO"'),
      ),
    ).toBe(true)
  })

  it('assignee đang bận → wake queued + biên nhận nói rõ "đang bận, đọc sau lượt"', async () => {
    const it = await seedItem({ assigneeSessionId: 'ses-po' })
    state.summaries = [session({ id: 'ses-po' })]
    state.active = ['ses-po']
    const res = await comment(it.id, 'ping')
    expect(res.wake).toBe('queued')
    expect(
      res.item.comments.some(
        (c) => c.fromTitle === 'system' && c.text.includes('is mid-turn'),
      ),
    ).toBe(true)
  })

  it('assignee đã đóng/archived → none, không gọi inbox, biên nhận báo không còn hoạt động', async () => {
    const it = await seedItem({ assigneeSessionId: 'ses-dead' })
    state.summaries = [session({ id: 'ses-dead', archived: true })]
    const res = await comment(it.id, 'còn đó không')
    expect(res.wake).toBe('none')
    expect(state.inbox).toHaveLength(0)
    expect(
      res.item.comments.some(
        (c) => c.fromTitle === 'system' && c.text.includes('no longer active'),
      ),
    ).toBe(true)
  })

  it('inbox lỗi → wake failed nhưng comment vẫn đã ghi', async () => {
    const it = await seedItem({ assigneeSessionId: 'ses-po' })
    state.summaries = [session({ id: 'ses-po' })]
    state.inboxError = new Error('inbox dead')
    const res = await comment(it.id, 'alo')
    expect(res.wake).toBe('failed')
    expect(res.comment.text).toBe('alo')
  })
})

describe('boards.comment — spec đang đỗ (assigneeRef) phải được đánh thức', () => {
  it("ref 'agent:' → agents.run spawn + gán sessionId + ping + system comment", async () => {
    const it = await seedItem({ assigneeRef: 'agent:global||product-owner' })
    state.agents = [agent({ id: 'product-owner', name: 'Product Owner' })]
    const res = await comment(it.id, 'nhận việc giúp anh')
    expect(res.wake).toBe('delivered')
    // Spawn đúng spec, đúng project, đánh dấu board, title = title việc.
    expect(state.dispatched).toHaveLength(1)
    const call = state.dispatched[0]!
    expect(call.method).toBe('agents.run')
    expect(call.params['agent']).toMatchObject({ id: 'product-owner', source: 'global' })
    expect(call.params['projectId']).toBe(PID)
    expect(call.params['origin']).toBe('board')
    expect(call.params['title']).toBe(it.title)
    expect(call.params['settings']).toMatchObject({ provider: 'anthropic' })
    // Item giờ có chủ thật, ref đã gỡ, vết giao việc nằm trong thread.
    expect(res.item.assigneeSessionId).toBe('ses-new-agent')
    expect(res.item.assigneeRef).toBeUndefined()
    expect(res.item.comments.some((c) => c.fromTitle === 'system' && c.text.includes('assigned'))).toBe(true)
    // Ping tới phiên mới với giọng "được giao".
    expect(state.inbox).toHaveLength(1)
    expect(state.inbox[0]?.to).toBe('ses-new-agent')
    expect(state.inbox[0]?.text).toContain('is now assigned to you')
  })

  it("ref 'team:' → teams.run → gán root mới", async () => {
    const it = await seedItem({ assigneeRef: 'team:global||core-squad' })
    state.teams = [
      { id: 'core-squad', name: 'Core Squad', members: [], createdAt: '', updatedAt: '' },
    ]
    const res = await comment(it.id, 'ê-kíp nhận giúp')
    expect(state.dispatched[0]?.method).toBe('teams.run')
    expect(state.dispatched[0]?.params['id']).toBe('core-squad')
    expect(res.item.assigneeSessionId).toBe('ses-new-lead')
    expect(state.inbox[0]?.to).toBe('ses-new-lead')
  })

  it("ref 'member:' → sessions.materializeMember với đúng runId/title/item", async () => {
    const it = await seedItem({ assigneeRef: 'member:ses-root|PO' })
    state.summaries = [session({ id: 'ses-root', teamId: 't1' })]
    await comment(it.id, 'po vào việc')
    expect(state.dispatched[0]?.method).toBe('sessions.materializeMember')
    expect(state.dispatched[0]?.params).toMatchObject({
      rootId: 'ses-root',
      member: 'PO',
      itemTitle: it.title,
      itemId: it.id,
    })
  })

  it('spec đã bị xoá (loadAgent null) → không ai được báo, item giữ nguyên ref', async () => {
    const it = await seedItem({ assigneeRef: 'agent:global||ghost' })
    const res = await comment(it.id, 'alo')
    expect(res.wake).toBe('none')
    expect(res.item.assigneeSessionId).toBeUndefined()
    expect(res.item.assigneeRef).toBe('agent:global||ghost')
    expect(state.inbox).toHaveLength(0)
  })
})

describe('boards.comment — @mention trên item trống chủ', () => {
  it('@agent-spec → spawn + tự gán làm chủ + ping', async () => {
    const it = await seedItem({})
    state.agents = [agent({ id: 'dev', name: 'Developer' })]
    const res = await comment(it.id, '@developer nhận việc nhé')
    expect(res.item.assigneeSessionId).toBe('ses-new-agent')
    expect(state.dispatched[0]?.method).toBe('agents.run')
    expect(state.inbox[0]?.text).toContain('is now assigned to you')
  })

  it('@phiên-sống → không spawn, gán thẳng phiên đó', async () => {
    const it = await seedItem({})
    state.summaries = [session({ id: 'ses-po', title: 'PO Agent', teamId: 't1' })]
    const res = await comment(it.id, '@po-agent nhận nhé')
    expect(res.item.assigneeSessionId).toBe('ses-po')
    expect(state.dispatched).toHaveLength(0)
    expect(state.inbox[0]?.to).toBe('ses-po')
  })

  it('@không-khớp-ai → comment vẫn lưu, wake none, không spawn', async () => {
    const it = await seedItem({})
    const res = await comment(it.id, '@nobody ơi')
    expect(res.wake).toBe('none')
    expect(res.comment.text).toBe('@nobody ơi')
    expect(state.dispatched).toHaveLength(0)
  })

  it('không assignee không mention → none thuần, KHÔNG ghi vạch biên nhận', async () => {
    const it = await seedItem({})
    const res = await comment(it.id, 'ghi chú thôi')
    expect(res.wake).toBe('none')
    expect(state.inbox).toHaveLength(0)
    expect(
      res.item.comments.some((c) => c.fromTitle === 'system' && c.text.includes('delivered')),
    ).toBe(false)
  })
})

describe('boards.comment — mention trên item ĐÃ có chủ', () => {
  it('assignee được ping + mention spawn được ping riêng, không cướp việc', async () => {
    const it = await seedItem({ assigneeSessionId: 'ses-po' })
    state.summaries = [session({ id: 'ses-po' })]
    state.agents = [agent({ id: 'qa', name: 'QA Tester' })]
    const res = await comment(it.id, '@qa-tester review giúp em với')
    expect(res.wake).toBe('delivered')
    expect(res.item.assigneeSessionId).toBe('ses-po')
    expect(state.inbox).toHaveLength(2)
    const [toAssignee, toMentioned] = state.inbox
    expect(toAssignee?.to).toBe('ses-po')
    expect(toAssignee?.text).toContain('New comment')
    expect(toMentioned?.to).toBe('ses-new-agent')
    expect(toMentioned?.text).toContain('mentioned you')
  })

  it('mention trùng assignee → chỉ một ping (dedupe)', async () => {
    const it = await seedItem({ assigneeSessionId: 'ses-po' })
    state.summaries = [session({ id: 'ses-po', title: 'PO Agent' })]
    await comment(it.id, '@po-agent xem lại')
    expect(state.inbox).toHaveLength(1)
    expect(state.dispatched).toHaveLength(0)
  })

  it('item của chính user + @agent → ping mention, KHÔNG cướp việc', async () => {
    const it = await seedItem({ assigneeSessionId: 'user' })
    state.agents = [agent({ id: 'dev', name: 'Developer' })]
    const res = await comment(it.id, '@developer góp ý giúp')
    expect(res.item.assigneeSessionId).toBe('user')
    expect(state.inbox).toHaveLength(1)
    expect(state.inbox[0]?.to).toBe('ses-new-agent')
    expect(state.inbox[0]?.text).toContain('mentioned you')
  })
})

describe('boards.comment — bench member của run item', () => {
  it('@po khớp member spec của run → materializeMember, không spawn lẻ', async () => {
    const it = await seedItem({ assigneeSessionId: 'ses-lead' })
    state.summaries = [
      session({ id: 'ses-lead', teamId: 'squad-1' }),
      session({ id: 'ses-m1', teamRunId: 'ses-lead', title: 'Dev' }),
    ]
    state.runTeam = {
      id: 'squad-1',
      name: 'Squad',
      members: [{ title: 'PO' }, { title: 'Dev' }],
      createdAt: '',
      updatedAt: '',
    }
    await comment(it.id, '@po phối hợp với lead giúp')
    // Assignee ping trước, mention sau — member của run đi đường
    // materializeMember chứ không phải agents.run.
    expect(state.inbox).toHaveLength(2)
    expect(state.dispatched[0]?.method).toBe('sessions.materializeMember')
    expect(state.dispatched[0]?.params).toMatchObject({ rootId: 'ses-lead', member: 'PO' })
  })
})
