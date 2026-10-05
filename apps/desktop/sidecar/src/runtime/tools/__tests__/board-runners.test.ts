// createBoardRunners — nhịp làm việc của ê-kíp nhìn qua board, phía RUNNER.
// run-root.test.ts trả lời "ai được cấp tool"; file này trả lời câu hỏi lớn
// hơn của người dùng: "có thật sự thấy ai nhận việc, tiến độ ra sao, xong có
// ai báo lại không?"
//
// Vì sao có file này: mọi dấu vết sống của ê-kíp — transition comment trên
// thread, wake lead khi in_review/blocked, wake assignee khi đổi chủ/bốc việc,
// cấm agent tự đóng done/cancelled — nằm ở behavior của runner, không phải
// ở gate. Gãy ở đây là ê-kíp "chạy mà không ai thấy" — đúng lỗi đã bị báo.
//
// Board store chạy THẬT trên HOME tạm (khuôn store.test.ts); inbox/runner/
// roster bị mock để đọc đúng ai được gọi dậy.
//
// Run: `npx vitest run src/runtime/tools/__tests__/board-runners.test.ts`
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardItem, SessionSummary, TeamSpec } from '../../../types/shared.js'

const state = vi.hoisted(() => ({
  summaries: [] as SessionSummary[],
  inbox: [] as { from: string | null; to: string; text: string }[],
  active: [] as string[],
  runTeam: null as TeamSpec | null,
  materialized: [] as Record<string, unknown>[],
  materializeResult: { sessionId: 'ses-mat', title: 'PO', spawned: true },
  materializeError: null as Error | null,
}))

vi.mock('../../../transport/stdio.js', () => ({ emit: vi.fn() }))
vi.mock('../../../util/logger.js', () => ({
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))

vi.mock('../../../sessions/session-manager.js', () => ({
  sessionManager: { getSessions: () => [...state.summaries] },
}))

vi.mock('../../../sessions/inbox.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../sessions/inbox.js')>()
  return {
    ...orig,
    postSessionMessage: async (input: { from: string | null; to: string; text: string }) => {
      state.inbox.push(input)
      return { id: 'im-1', ...input }
    },
  }
})

vi.mock('../../../sessions/runner.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../sessions/runner.js')>()
  return { ...orig, activeSessionIds: () => [...state.active] }
})

vi.mock('../../../sessions/store.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../sessions/store.js')>()
  return { ...orig, listSessionSummaries: async () => [...state.summaries] }
})

vi.mock('../../../sessions/team-members.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../sessions/team-members.js')>()
  return {
    ...orig,
    loadRunTeam: async () => state.runTeam,
    materializeMember: async (input: Record<string, unknown>) => {
      if (state.materializeError) throw state.materializeError
      state.materialized.push(input)
      return { ...state.materializeResult }
    },
  }
})

const { createBoardRunners } = await import('../board-tools.js')
const { upsertBoardItem, getBoardItem, listBoardItems } = await import('../../../boards/store.js')

const PID = 'proj-runners'

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

// Ê-kíp chuẩn: root + hai member.
function crew() {
  state.summaries = [
    session({ id: 'ses-root', title: 'Lead', teamId: 'squad-1' }),
    session({ id: 'ses-po', title: 'PO', teamRunId: 'ses-root' }),
    session({ id: 'ses-dev', title: 'Dev', teamRunId: 'ses-root' }),
  ]
}

function runnersOf(sessionId: string) {
  const r = createBoardRunners({ sessionId })
  if (!r) throw new Error(`no board runners for ${sessionId}`)
  return r
}

async function seedItem(patch: Partial<BoardItem> = {}): Promise<BoardItem> {
  n += 1
  return upsertBoardItem(PID, {
    title: `Việc ${n}`,
    status: 'backlog',
    createdBy: 'user',
    ...patch,
  })
}

// Transition comment ghi fire-and-forget (`void addBoardItemComment` bên
// trong runner) — poll với nhịp ngắn thay vì đoán một lần flush.
async function waitComment(
  itemId: string,
  pred: (c: { from: string | null; fromTitle: string | null; text: string }) => boolean,
): Promise<boolean> {
  for (let i = 0; i < 30; i++) {
    const item = await getBoardItem(PID, itemId)
    if (item?.comments.some(pred)) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return false
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-board-runners-'))
  originalHome = process.env['HOME']
  process.env['HOME'] = home
  state.summaries = []
  state.inbox = []
  state.active = []
  state.runTeam = null
  state.materialized = []
  state.materializeError = null
  crew()
})

afterEach(async () => {
  process.env['HOME'] = originalHome
  await rm(home, { recursive: true, force: true })
})

describe('member báo tiến độ — vòng đời in_review/blocked', () => {
  it('member → in_review: item cập nhật + lead được wake qua inbox', async () => {
    const item = await seedItem({ status: 'in_progress', assigneeSessionId: 'ses-po' })
    const res = await runnersOf('ses-po').updateItem({
      item_id: item.id,
      status: 'in_review',
    })
    expect(res.isError).toBeFalsy()
    expect(res.text).toContain('lead was woken')
    expect((await getBoardItem(PID, item.id))?.status).toBe('in_review')
    expect(state.inbox).toHaveLength(1)
    expect(state.inbox[0]).toMatchObject({ from: 'ses-po', to: 'ses-root' })
    expect(state.inbox[0]?.text).toContain('→ in_review')
  })

  it('member → blocked: lead cũng được wake', async () => {
    const item = await seedItem({ status: 'in_progress', assigneeSessionId: 'ses-po' })
    await runnersOf('ses-po').updateItem({ item_id: item.id, status: 'blocked' })
    expect(state.inbox[0]?.to).toBe('ses-root')
    expect(state.inbox[0]?.text).toContain('→ blocked')
  })

  it('member → in_progress: KHÔNG wake lead (không phải điểm báo)', async () => {
    const item = await seedItem({ status: 'todo', assigneeSessionId: 'ses-po' })
    await runnersOf('ses-po').updateItem({ item_id: item.id, status: 'in_progress' })
    expect(state.inbox).toHaveLength(0)
  })

  it('set lại in_review lần hai (không phải transition) → không wake thêm', async () => {
    const item = await seedItem({ status: 'in_review', assigneeSessionId: 'ses-po' })
    await runnersOf('ses-po').updateItem({ item_id: item.id, status: 'in_review' })
    expect(state.inbox).toHaveLength(0)
  })

  it('done/cancelled bị chặn bằng LỜI — chỉ user đóng việc', async () => {
    const item = await seedItem({ status: 'in_review', assigneeSessionId: 'ses-po' })
    for (const status of ['done', 'cancelled'] as const) {
      const res = await runnersOf('ses-po').updateItem({ item_id: item.id, status })
      expect(res.isError).toBe(true)
      expect(res.text).toContain("user's call")
    }
    expect((await getBoardItem(PID, item.id))?.status).toBe('in_review')
    expect(state.inbox).toHaveLength(0)
  })
})

describe('điều phối — đổi chủ, bốc việc, bench member', () => {
  it('lead reassign → assignee mới được wake qua inbox + bubble "Giao cho @…"', async () => {
    const item = await seedItem({ status: 'todo', assigneeSessionId: 'ses-po' })
    const res = await runnersOf('ses-root').updateItem({
      item_id: item.id,
      assignee_session_id: 'ses-dev',
    })
    expect(res.text).toContain('assignee was woken')
    expect(state.inbox[0]).toMatchObject({ from: 'ses-root', to: 'ses-dev' })
    expect(state.inbox[0]?.text).toContain(item.id)
    expect(
      await waitComment(item.id, (c) => c.from === 'ses-root' && c.text.includes('Giao cho')),
    ).toBe(true)
  })

  it('kéo item backlog → todo với assignee sẵn → assignee được wake', async () => {
    const item = await seedItem({ status: 'backlog', assigneeSessionId: 'ses-dev' })
    await runnersOf('ses-root').updateItem({ item_id: item.id, status: 'todo' })
    expect(state.inbox[0]?.to).toBe('ses-dev')
  })

  it('assignee_member: materialize lazy rồi gán, member KHÔNG được wake kép', async () => {
    state.runTeam = {
      id: 'squad-1',
      name: 'Squad',
      members: [{ title: 'PO' }],
      createdAt: '',
      updatedAt: '',
    }
    const item = await seedItem({ status: 'todo' })
    const res = await runnersOf('ses-root').updateItem({
      item_id: item.id,
      assignee_member: 'PO',
    })
    expect(res.isError).toBeFalsy()
    expect(state.materialized).toHaveLength(1)
    expect(state.materialized[0]).toMatchObject({
      runId: 'ses-root',
      member: { title: 'PO' },
    })
    // Tin giao việc đầu inbox của member mang id+title thật của item.
    expect(state.materialized[0]?.['dispatchPrompt']).toContain(item.id)
    expect(state.materialized[0]?.['dispatchPrompt']).toContain(item.title)
    const updated = await getBoardItem(PID, item.id)
    expect(updated?.assigneeSessionId).toBe('ses-mat')
    // Tin đầu inbox của member vừa đẻ đã là lời giao việc — không wake thêm.
    expect(state.inbox).toHaveLength(0)
  })

  it('member_instance: ghế song song "Dev 2" của cùng role — prompt mang title ghế', async () => {
    state.runTeam = {
      id: 'squad-1',
      name: 'Squad',
      members: [{ title: 'Dev' }],
      createdAt: '',
      updatedAt: '',
    }
    const item = await seedItem({ status: 'todo' })
    const res = await runnersOf('ses-root').updateItem({
      item_id: item.id,
      assignee_member: 'Dev',
      member_instance: 2,
    })
    expect(res.isError).toBeFalsy()
    expect(state.materialized).toHaveLength(1)
    expect(state.materialized[0]).toMatchObject({
      runId: 'ses-root',
      member: { title: 'Dev' },
      instance: 2,
    })
    // Prompt giới thiệu member bằng title GHẾ — phiên mới đẻ tự nhận là "Dev 2".
    expect(state.materialized[0]?.['dispatchPrompt']).toContain('"Dev 2"')
  })

  it('member_instance không kèm assignee_member → lỗi bằng lời', async () => {
    const item = await seedItem({ status: 'todo' })
    const res = await runnersOf('ses-root').updateItem({
      item_id: item.id,
      member_instance: 2,
    })
    expect(res.isError).toBe(true)
    expect(res.text).toContain('assignee_member')
    expect(state.materialized).toHaveLength(0)
  })

  it('member_instance vượt cap ghế → lỗi bằng lời, không spawn', async () => {
    state.runTeam = {
      id: 'squad-1',
      name: 'Squad',
      members: [{ title: 'Dev' }],
      createdAt: '',
      updatedAt: '',
    }
    const item = await seedItem({ status: 'todo' })
    const res = await runnersOf('ses-root').updateItem({
      item_id: item.id,
      assignee_member: 'Dev',
      member_instance: 99,
    })
    expect(res.isError).toBe(true)
    expect(res.text).toContain('seat cap')
    expect(state.materialized).toHaveLength(0)
  })

  it('assignee_member lên item backlog → từ chối bằng lời, không spawn phí', async () => {
    state.runTeam = {
      id: 'squad-1',
      name: 'Squad',
      members: [{ title: 'PO' }],
      createdAt: '',
      updatedAt: '',
    }
    const item = await seedItem({ status: 'backlog' })
    const res = await runnersOf('ses-root').updateItem({
      item_id: item.id,
      assignee_member: 'PO',
    })
    expect(res.isError).toBe(true)
    expect(state.materialized).toHaveLength(0)
  })

  it('reassign sang phiên KHÔNG tồn tại → lỗi, không ghi item', async () => {
    const item = await seedItem({ status: 'todo', assigneeSessionId: 'ses-po' })
    const res = await runnersOf('ses-root').updateItem({
      item_id: item.id,
      assignee_session_id: 'ses-ghost',
    })
    expect(res.isError).toBe(true)
    expect((await getBoardItem(PID, item.id))?.assigneeSessionId).toBe('ses-po')
  })

  it('reassign sang phiên ngoài run → item đổi chủ nhưng KHÔNG wake', async () => {
    state.summaries.push(session({ id: 'ses-loner', title: 'Lone' }))
    const item = await seedItem({ status: 'in_progress', assigneeSessionId: 'ses-po' })
    const res = await runnersOf('ses-root').updateItem({
      item_id: item.id,
      assignee_session_id: 'ses-loner',
    })
    expect(res.isError).toBeFalsy()
    expect((await getBoardItem(PID, item.id))?.assigneeSessionId).toBe('ses-loner')
    expect(state.inbox).toHaveLength(0)
  })
})

describe('board-worker lẻ (origin: board) — run một người', () => {
  beforeEach(() => {
    state.summaries = [session({ id: 'ses-worker', title: 'Solo', origin: 'board' })]
  })

  it('worker → in_review: item cập nhật, KHÔNG có lead để wake', async () => {
    const item = await seedItem({ status: 'in_progress', assigneeSessionId: 'ses-worker' })
    const res = await runnersOf('ses-worker').updateItem({
      item_id: item.id,
      status: 'in_review',
    })
    expect(res.isError).toBeFalsy()
    expect((await getBoardItem(PID, item.id))?.status).toBe('in_review')
    expect(res.text).not.toContain('lead was woken')
    expect(state.inbox).toHaveLength(0)
  })

  it('worker gán việc cho phiên khác được phép (run một người không rào runId)', async () => {
    state.summaries.push(session({ id: 'ses-friend', title: 'Friend' }))
    const item = await seedItem({ status: 'todo', assigneeSessionId: 'ses-worker' })
    const res = await runnersOf('ses-worker').updateItem({
      item_id: item.id,
      assignee_session_id: 'ses-friend',
    })
    expect(res.isError).toBeFalsy()
    expect(state.inbox[0]?.to).toBe('ses-friend')
  })
})

describe('team_item_comment — giọng của agent trên thread', () => {
  it('member comment → ghi với from = sessionId của mình', async () => {
    const item = await seedItem({ status: 'in_progress', assigneeSessionId: 'ses-po' })
    const res = await runnersOf('ses-po').commentItem({
      item_id: item.id,
      text: 'Em đang xử lý phần auth, chiều có bản đầu.',
    })
    expect(res.isError).toBeFalsy()
    const thread = (await getBoardItem(PID, item.id))?.comments ?? []
    const mine = thread.find((c) => c.text.includes('phần auth'))
    expect(mine?.from).toBe('ses-po')
  })
})

describe('team_item_create — giao việc từ trong ê-kíp', () => {
  it('lead tạo item gán member → todo + member được wake + bubble giao việc', async () => {
    const res = await runnersOf('ses-root').createItem({
      title: 'Viết spec auth',
      assignee_session_id: 'ses-po',
    })
    expect(res.isError).toBeFalsy()
    const itemId = res.itemId as string
    const item = await getBoardItem(PID, itemId)
    expect(item?.status).toBe('todo')
    expect(item?.assigneeSessionId).toBe('ses-po')
    expect(item?.createdBy).toBe('ses-root')
    expect(state.inbox[0]?.to).toBe('ses-po')
    expect(
      await waitComment(itemId, (c) => c.from === 'ses-root' && c.text.includes('Giao cho')),
    ).toBe(true)
  })

  it('tạo item không chủ → đỗ backlog, không ai bị gọi', async () => {
    const res = await runnersOf('ses-root').createItem({ title: 'Grooming sau' })
    expect(res.isError).toBeFalsy()
    const item = await getBoardItem(PID, res.itemId as string)
    expect(item?.status).toBe('backlog')
    expect(state.inbox).toHaveLength(0)
  })

  it('lead tách việc: subtask gắn parent_id + type/severity ghi đúng field', async () => {
    const epicRes = await runnersOf('ses-root').createItem({
      title: 'Phân tán đơn hàng',
      type: 'epic',
      priority: 'urgent',
    })
    const epic = await getBoardItem(PID, epicRes.itemId as string)
    expect(epic).toMatchObject({ type: 'epic', priority: 'urgent' })
    const subRes = await runnersOf('ses-root').createItem({
      title: 'Tách phần thanh toán',
      type: 'subtask',
      parent_id: epic!.id,
      severity: 'major',
    })
    const sub = await getBoardItem(PID, subRes.itemId as string)
    expect(sub).toMatchObject({ type: 'subtask', parentId: epic!.id, severity: 'major' })
  })

  it('tạo + sửa item phát board.item-touched kèm actor, no-change thì im lặng', async () => {
    const { emit } = await import('../../../transport/stdio.js')
    const create = await runnersOf('ses-root').createItem({ title: 'Việc mới' })
    expect(emit).toHaveBeenCalledWith(
      'board.item-touched',
      expect.objectContaining({
        action: 'created',
        itemId: create.itemId,
        title: 'Việc mới',
        actorTitle: 'Lead',
      }),
    )
    await runnersOf('ses-root').updateItem({
      item_id: create.itemId as string,
      status: 'in_progress',
    })
    expect(emit).toHaveBeenCalledWith(
      'board.item-touched',
      expect.objectContaining({
        action: 'updated',
        itemId: create.itemId,
        changes: expect.arrayContaining([expect.stringContaining('in_progress')]),
      }),
    )
    vi.mocked(emit).mockClear()
    await runnersOf('ses-root').updateItem({ item_id: create.itemId as string, status: 'in_progress' })
    expect(emit).not.toHaveBeenCalledWith('board.item-touched', expect.anything())
  })

  it('parent_id trỏ hụt → lỗi bằng LỜI, item không được tạo', async () => {
    const res = await runnersOf('ses-root').createItem({
      title: 'Con mồ côi',
      type: 'subtask',
      parent_id: 'bi-deadbeef00',
    })
    expect(res.isError).toBe(true)
    expect(res.text).toContain('parent')
    expect((await listBoardItems(PID)).every((i) => i.title !== 'Con mồ côi')).toBe(true)
  })

  it('update đổi cha/ưu tiên được; parent_id:null tách về cấp trên', async () => {
    const a = await seedItem({ title: 'Cha' })
    const b = await seedItem({ title: 'Con', parentId: a.id })
    const res = await runnersOf('ses-root').updateItem({
      item_id: b.id,
      parent_id: null,
      priority: 'low',
      type: 'story',
    })
    expect(res.isError).toBeFalsy()
    const item = await getBoardItem(PID, b.id)
    expect(item?.parentId).toBeUndefined()
    expect(item).toMatchObject({ priority: 'low', type: 'story' })
  })
})
