// boards.detectTracking (docs/features/session-issue-tracking.md §3.6) — tìm link
// GitHub trong các phiên đã làm issue rồi đọc sprint / milestone / ngày qua gh GraphQL.
//
// gh bị mock ở tầng runner: test kiểm (1) owner/name/number đi bằng BIẾN chứ không
// ghép vào query, (2) chấm điểm link chọn đúng issue chính, (3) đọc iteration /
// milestone / field ngày, (4) thiếu scope read:project được báo lại.
//
// Run: `npx vitest run src/methods/__tests__/boards-detect-tracking.test.ts`
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardItem, Session } from '../../types/shared.js'

const h = vi.hoisted(() => ({
  item: null as BoardItem | null,
  sessions: [] as Session[],
  calls: [] as string[][],
  responses: [] as unknown[],
}))

vi.mock('../../util/logger.js', () => ({
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))
vi.mock('../../boards/store.js', () => ({
  getBoardItem: async () => h.item,
}))
vi.mock('../../boards/session-issue.js', () => ({
  issueExecutorSessions: async () => h.sessions,
}))
vi.mock('../../github/runner.js', () => ({
  isValidGhLogin: (v: string) => /^[A-Za-z\d-]{1,39}$/.test(v),
  runGhAccountAllowPartial: async (args: string[]) => {
    h.calls.push(args)
    return JSON.stringify(h.responses.shift() ?? { data: {} })
  },
}))

const { dispatch } = await import('../../transport/rpc.js')
await import('../boards.detect-tracking.js')

function session(id: string, partial: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    projectId: 'proj-a',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    invitedAgentIds: [],
    pendingAgentIds: [],
    messages: [],
    settings: { provider: 'anthropic', modelId: 'm', level: 'high', mode: 'ask' },
    ...partial,
  }
}

const ISSUE = 'https://github.com/structuralengine/yahagi/issues/737'
const OTHER = 'https://github.com/structuralengine/yahagi/issues/12'
const PR = 'https://github.com/structuralengine/yahagi/pull/740'

beforeEach(() => {
  h.item = {
    id: 'bi-0000000000000001',
    projectId: 'proj-a',
    title: 'x',
    status: 'in_progress',
    createdBy: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    comments: [],
  }
  h.sessions = []
  h.calls = []
  h.responses = []
})

describe('boards.detectTracking', () => {
  it('không có link GitHub nào → không gọi gh, trả rỗng', async () => {
    h.sessions = [session('s1', { messages: [{ id: 'm1', role: 'user', text: 'hello', at: '' }] })]
    const res = await dispatch('boards.detectTracking', { projectId: 'proj-a', itemId: h.item!.id })
    expect(res).toEqual({ issueLinks: [], prLinks: [], missingProjectScope: false })
    expect(h.calls).toHaveLength(0)
  })

  it('chọn issue người dùng mở phiên từ đó, đọc sprint + milestone + ngày; owner/repo đi bằng biến', async () => {
    h.sessions = [
      session('s1', {
        aboutGhUrl: ISSUE,
        messages: [
          { id: 'm1', role: 'agent', text: `see also ${OTHER} and ${PR}`, at: '' },
        ],
      }),
    ]
    h.responses = [
      {
        data: {
          a0: {
            issueOrPullRequest: {
              __typename: 'Issue',
              url: ISSUE,
              milestone: { title: 'v1.2', dueOn: '2026-11-30T00:00:00Z' },
              projectItems: {
                nodes: [
                  {
                    fieldValues: {
                      nodes: [
                        {
                          __typename: 'ProjectV2ItemFieldIterationValue',
                          title: 'Sprint 7',
                          startDate: '2026-10-13',
                          duration: 14,
                          field: { name: 'Sprint' },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
          a1: { issueOrPullRequest: { __typename: 'Issue', url: OTHER } },
          a2: { issueOrPullRequest: { __typename: 'PullRequest', url: PR, closingIssuesReferences: { nodes: [{ url: ISSUE }] } } },
        },
      },
    ]
    const res = (await dispatch('boards.detectTracking', {
      projectId: 'proj-a',
      itemId: h.item!.id,
      account: 'sora-hoa',
    })) as Record<string, unknown>
    expect(res).toMatchObject({
      issueLinks: [ISSUE, OTHER],
      prLinks: [PR],
      sprint: 'Sprint 7',
      milestone: 'v1.2',
      startDate: '2026-10-13',
      dueDate: '2026-10-26',
      source: ISSUE,
      missingProjectScope: false,
    })
    // Một lượt gh (issue đóng bởi PR đã có trong danh sách — không gọi thêm).
    expect(h.calls).toHaveLength(1)
    const query = h.calls[0]!.find((a) => a.startsWith('query='))!
    expect(query).not.toContain('structuralengine')
    expect(query).not.toContain('737')
    expect(h.calls[0]).toContain('o0=structuralengine')
  })

  it('PR không mang kế hoạch → đọc thêm issue nó đóng', async () => {
    h.sessions = [session('s1', { aboutGhUrl: PR })]
    h.responses = [
      { data: { a0: { issueOrPullRequest: { __typename: 'PullRequest', url: PR, closingIssuesReferences: { nodes: [{ url: ISSUE }] } } } } },
      { data: { a0: { issueOrPullRequest: { __typename: 'Issue', url: ISSUE, milestone: { title: 'M1' } } } } },
    ]
    const res = (await dispatch('boards.detectTracking', { projectId: 'proj-a', itemId: h.item!.id })) as Record<string, unknown>
    expect(h.calls).toHaveLength(2)
    expect(res).toMatchObject({ milestone: 'M1', source: ISSUE, issueLinks: [ISSUE], prLinks: [PR] })
  })

  it('token thiếu scope read:project → vẫn có milestone, báo missingProjectScope', async () => {
    h.item!.issueLinks = [ISSUE]
    h.responses = [
      {
        data: { a0: { issueOrPullRequest: { __typename: 'Issue', url: ISSUE, milestone: { title: 'M2' }, projectItems: null } } },
        errors: [{ type: 'INSUFFICIENT_SCOPES', message: "Your token has not been granted the required scopes: ['read:project']" }],
      },
    ]
    const res = (await dispatch('boards.detectTracking', { projectId: 'proj-a', itemId: h.item!.id })) as Record<string, unknown>
    expect(res).toMatchObject({ milestone: 'M2', missingProjectScope: true })
    expect(res.sprint).toBeUndefined()
  })

  it('từ chối account không hợp lệ', async () => {
    await expect(
      dispatch('boards.detectTracking', { projectId: 'proj-a', itemId: h.item!.id, account: 'bad name;rm' }),
    ).rejects.toBeTruthy()
  })
})
