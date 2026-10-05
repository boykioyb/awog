// boards.upsert — đường của NGƯỜI DÙNG (kéo cột, sửa item, nút "+"): khi item
// đáp vào tay một phiên thì phiên đó phải được wake, và mọi transition phải
// để lại system comment trên thread (docs/features/session-teams.md §7).
//
// Vì sao có file này: "kéo sang Cần làm = lệnh triển khai" là một trong hai
// cửa giao việc (cửa kia là boards.comment). Gãy ở đây = kéo item xong agent
// nằm im — người dùng tưởng đã giao mà ê-kíp không hề biết.
//
// Board store chạy THẬT trên HOME tạm; inbox/summaries bị mock để đọc đúng ai
// được gọi dậy và tin đi từ đâu.
//
// Run: `npx vitest run src/methods/__tests__/boards-upsert.test.ts`
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardItem, SessionSummary } from '../../types/shared.js'

const state = vi.hoisted(() => ({
  summaries: [] as SessionSummary[],
  inbox: [] as { from: string | null; to: string; text: string }[],
}))

vi.mock('../../transport/stdio.js', () => ({ emit: () => {} }))
vi.mock('../../util/logger.js', () => ({
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))

vi.mock('../../sessions/inbox.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../sessions/inbox.js')>()
  return {
    ...orig,
    postSessionMessage: async (input: { from: string | null; to: string; text: string }) => {
      state.inbox.push(input)
      return { id: 'im-1', ...input }
    },
  }
})

vi.mock('../../sessions/store.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../sessions/store.js')>()
  return { ...orig, listSessionSummaries: async () => [...state.summaries] }
})

const { dispatch } = await import('../../transport/rpc.js')
const { getBoardItem } = await import('../../boards/store.js')
await import('../boards.upsert.js')

const PID = 'proj-upsert'

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

async function upsert(item: Record<string, unknown>): Promise<{ item: BoardItem }> {
  return (await dispatch('boards.upsert', { projectId: PID, item })) as { item: BoardItem }
}

function title() {
  n += 1
  return `Việc ${n}`
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-boards-upsert-'))
  originalHome = process.env['HOME']
  process.env['HOME'] = home
  state.summaries = [
    session({ id: 'ses-root', title: 'Lead', teamId: 'squad-1' }),
    session({ id: 'ses-po', title: 'PO', teamRunId: 'ses-root' }),
    session({ id: 'ses-dev', title: 'Dev', teamRunId: 'ses-root' }),
  ]
  state.inbox = []
})

afterEach(async () => {
  process.env['HOME'] = originalHome
  await rm(home, { recursive: true, force: true })
})

describe('boards.upsert — wake khi item đáp vào tay phiên', () => {
  it('tạo mới có assignee ở todo → assignee được wake, tin đi TỪ lead của nó', async () => {
    const res = await upsert({ title: title(), status: 'todo', assigneeSessionId: 'ses-po' })
    expect(res.item.status).toBe('todo')
    expect(state.inbox).toHaveLength(1)
    // Member nhận tin từ gốc nhóm — run edge nên đi trọn pipeline giao-chạy.
    expect(state.inbox[0]).toMatchObject({ from: 'ses-root', to: 'ses-po' })
    expect(state.inbox[0]?.text).toContain(res.item.id)
    expect(state.inbox[0]?.text).toContain('was assigned to you')
  })

  it('tạo mới có assignee nhưng đỗ backlog → KHÔNG wake (bãi đỗ im lặng)', async () => {
    await upsert({ title: title(), status: 'backlog', assigneeSessionId: 'ses-po' })
    expect(state.inbox).toHaveLength(0)
  })

  it('kéo backlog → todo với assignee sẵn → wake (đây là lệnh triển khai)', async () => {
    const res = await upsert({ title: title(), status: 'backlog', assigneeSessionId: 'ses-po' })
    state.inbox = []
    await upsert({ id: res.item.id, status: 'todo' })
    expect(state.inbox).toHaveLength(1)
    expect(state.inbox[0]?.to).toBe('ses-po')
  })

  it('đổi chủ khi item đang sống → chủ mới được wake', async () => {
    const res = await upsert({
      title: title(),
      status: 'in_progress',
      assigneeSessionId: 'ses-po',
    })
    state.inbox = []
    await upsert({ id: res.item.id, assigneeSessionId: 'ses-dev' })
    expect(state.inbox[0]?.to).toBe('ses-dev')
  })

  it('assignee là gốc run → tin đi với from=null (không có ai trên nó)', async () => {
    await upsert({ title: title(), status: 'todo', assigneeSessionId: 'ses-root' })
    expect(state.inbox[0]).toMatchObject({ from: null, to: 'ses-root' })
  })
})

describe('boards.upsert — KHÔNG wake khi không có transition đáng báo', () => {
  it('đổi status in_progress→in_review giữ nguyên chủ → yên lặng', async () => {
    const res = await upsert({ title: title(), status: 'todo', assigneeSessionId: 'ses-po' })
    state.inbox = []
    await upsert({ id: res.item.id, status: 'in_review' })
    expect(state.inbox).toHaveLength(0)
  })

  it('đổi chủ trên item backlog → không wake (chưa phải việc sống)', async () => {
    const res = await upsert({ title: title(), status: 'backlog' })
    state.inbox = []
    await upsert({ id: res.item.id, assigneeSessionId: 'ses-po' })
    expect(state.inbox).toHaveLength(0)
  })

  it('kéo item done → không ai được gọi nữa', async () => {
    const res = await upsert({
      title: title(),
      status: 'in_review',
      assigneeSessionId: 'ses-po',
    })
    state.inbox = []
    await upsert({ id: res.item.id, status: 'done' })
    expect(state.inbox).toHaveLength(0)
  })

  it('assignee đã archived → ghi item bình thường, không ai được báo', async () => {
    state.summaries[1] = session({ id: 'ses-po', title: 'PO', teamRunId: 'ses-root', archived: true })
    await upsert({ title: title(), status: 'todo', assigneeSessionId: 'ses-po' })
    expect(state.inbox).toHaveLength(0)
  })
})

describe('boards.upsert — vết transition trên thread', () => {
  it('tạo có assignee → system comment "assigned to …"', async () => {
    const res = await upsert({ title: title(), status: 'todo', assigneeSessionId: 'ses-po' })
    const thread = (await getBoardItem(PID, res.item.id))?.comments ?? []
    expect(
      thread.some((c) => c.fromTitle === 'system' && c.text.includes('assigned to "PO"')),
    ).toBe(true)
  })

  it('kéo cột → system comment "backlog → todo"', async () => {
    const res = await upsert({ title: title(), status: 'backlog' })
    await upsert({ id: res.item.id, status: 'todo' })
    const thread = (await getBoardItem(PID, res.item.id))?.comments ?? []
    expect(thread.some((c) => c.text.includes('backlog → todo'))).toBe(true)
  })

  it('gỡ assignee → system comment "unassigned"', async () => {
    const res = await upsert({ title: title(), status: 'todo', assigneeSessionId: 'ses-po' })
    await upsert({ id: res.item.id, assigneeSessionId: null })
    const thread = (await getBoardItem(PID, res.item.id))?.comments ?? []
    expect(thread.some((c) => c.text.includes('unassigned'))).toBe(true)
  })
})
