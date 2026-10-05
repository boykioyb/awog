// boards/mentions — phần THUẦN của đường "@handle nhận việc" trong comment
// board item: parse handle, match phiên sống / spec agent / spec team, và tìm
// gốc run của item để lần bench member.
//
// Vì sao có file này — trước đây boards.comment chỉ wake `assigneeSessionId`:
// item đỗ backlog với `assigneeRef` (spec chưa materialize) hoặc user gõ
// "@lead nhận việc" thì comment lưu xong không ai nghe thấy gì. Mention phải
// resolve đúng một đích CÓ THẬT, đúng project, đúng thứ tự (sống → bench →
// spec) — test ở mức hàm thuần, spawn/ping nằm ngoài tầm.
//
// Run: `npx vitest run src/boards/__tests__/mentions.test.ts`
import { describe, expect, it } from 'vitest'
import {
  itemRunRoot,
  leadHandle,
  matchAgentSpec,
  matchLiveSession,
  matchTeamSpec,
  MAX_MENTIONS_PER_COMMENT,
  mentionHandles,
} from '../mentions.js'
import type { Agent, BoardItem, SessionSummary, TeamSpec } from '../../types/shared.js'

function session(partial: Partial<SessionSummary> & { id: string }): SessionSummary {
  return {
    title: partial.id,
    projectId: 'proj-a',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'idle',
    invitedAgentIds: [],
    pendingAgentIds: [],
    settings: {
      provider: 'anthropic',
      modelId: 'm',
      level: 'high',
      mode: 'execute',
    },
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

function team(partial: Partial<TeamSpec> & { id: string }): TeamSpec {
  return {
    name: partial.id,
    members: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

function item(partial: Partial<BoardItem>): BoardItem {
  return {
    id: 'it-1',
    projectId: 'proj-a',
    title: 'Việc gì đó',
    status: 'backlog',
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    comments: [],
    ...partial,
  }
}

describe('mentionHandles — quét @handle trong text', () => {
  it('bắt handle slug, giữ thứ tự, lowercase', () => {
    expect(mentionHandles('@PO check @Tech-Lead nhé')).toEqual(['po', 'tech-lead'])
  })

  it('bỏ token không phải handle — @skill:x, @đường/dẫn/file, email', () => {
    expect(mentionHandles('@skill:foo xem @docs/readme.md và a@b.com')).toEqual([])
  })

  it('bỏ dấu tiếng Việt — "@khac" và "@khác" cùng canonical hoá', () => {
    expect(mentionHandles('@khac-project xem @khác-project')).toEqual(['khac-project'])
  })

  it('tên đặc ký của composer — "/", "—", "&" gấp về gạch', () => {
    // agentHandle("QA/QC — Testing & Automation") = "qa/qc-—-testing-&-
    // automation" — chỉ khoảng trắng thành '-', đặc ký giữ nguyên.
    expect(mentionHandles('@qa/qc-—-testing-&-automation xem thử')).toEqual([
      'qa-qc-testing-automation',
    ])
  })

  it('dedupe handle lặp + trần MAX_MENTIONS_PER_COMMENT', () => {
    expect(mentionHandles('@po @po @dev')).toEqual(['po', 'dev'])
    const spam = Array.from({ length: 10 }, (_, i) => `@a${i}`).join(' ')
    expect(mentionHandles(spam)).toHaveLength(MAX_MENTIONS_PER_COMMENT)
  })
})

describe('matchLiveSession — phiên sống board-capable cùng project', () => {
  const sessions = [
    session({
      id: 'ses-member',
      title: 'Product Delivery Team Lead',
      teamRunId: 'ses-root',
    }),
    session({ id: 'ses-root', title: 'Lead', teamId: 'team-1' }),
    session({ id: 'ses-worker', title: 'Fix login bug', origin: 'board' }),
    session({ id: 'ses-chat', title: 'Small Talk' }),
    session({
      id: 'ses-other',
      title: 'Product Delivery Team Lead',
      teamRunId: 'x',
      projectId: 'proj-b',
    }),
    session({
      id: 'ses-dead',
      title: 'Ghost',
      teamId: 'team-2',
      archived: true,
    }),
  ]

  it('khớp theo title-slug của member run', () => {
    expect(matchLiveSession('product-delivery-team-lead', sessions, 'proj-a')?.id).toBe(
      'ses-member',
    )
  })

  it('board-worker lẻ (origin board) cũng được gọi — nó có board tools', () => {
    expect(matchLiveSession('fix-login-bug', sessions, 'proj-a')?.id).toBe('ses-worker')
  })

  it('khớp theo id phiên và theo agent bind', () => {
    const withAgent = [
      session({
        id: 'ses-x',
        title: 'X',
        teamId: 't',
        agent: { id: 'po-agent' },
      }),
    ]
    expect(matchLiveSession('ses-x', withAgent, 'proj-a')?.id).toBe('ses-x')
    expect(matchLiveSession('po-agent', withAgent, 'proj-a')?.id).toBe('ses-x')
  })

  it('phiên chat thường (không nhóm, không origin board) KHÔNG được gọi', () => {
    expect(matchLiveSession('small-talk', sessions, 'proj-a')).toBeUndefined()
  })

  it('cùng title nhưng project khác → không gọi nhầm', () => {
    // ses-member (proj-a) thắng ses-other (proj-b); hỏi proj-c thì không ai.
    expect(matchLiveSession('product-delivery-team-lead', sessions, 'proj-b')?.id).toBe('ses-other')
    expect(matchLiveSession('product-delivery-team-lead', sessions, 'proj-c')).toBeUndefined()
  })

  it('phiên archived → bỏ qua', () => {
    expect(matchLiveSession('ghost', sessions, 'proj-a')).toBeUndefined()
  })

  it('member thiếu projectId kế thừa project của gốc', () => {
    const orphan = [
      session({ id: 'ses-root', title: 'Lead', teamId: 't1' }),
      session({
        id: 'ses-m',
        title: 'PO Member',
        teamRunId: 'ses-root',
        projectId: null,
      }),
    ]
    expect(matchLiveSession('po-member', orphan, 'proj-a')?.id).toBe('ses-m')
  })

  it('handle slug-tên-agent khớp ĐUÔI agent.id — đúng bệnh lead thật', () => {
    // Phiên lead thật: title là tên TEAM còn agent.id là '<team>-<role>' nên
    // handle "product-delivery-team-lead" không bắt được theo title.
    const run = [
      session({
        id: 'ses-lead',
        title: 'Product Delivery Team',
        teamId: 'team-pdt',
        agent: { id: 'product-delivery-team-product-delivery-team-lead' },
      }),
    ]
    expect(
      matchLiveSession('product-delivery-team-lead', run, 'proj-a')?.id,
    ).toBe('ses-lead')
  })

  it('exact match của phiên khác thắng suffix mơ hồ', () => {
    const run = [
      session({
        id: 'ses-a',
        title: 'Reviewer cũ',
        teamId: 't',
        agent: { id: 'code-reviewer' },
      }),
      session({
        id: 'ses-b',
        title: 'Reviewer mới',
        teamId: 't',
        agent: { id: 'reviewer' },
      }),
    ]
    // 'reviewer' khớp exact với agent 'reviewer' (ses-b), không rơi vào đuôi
    // '-reviewer' của 'code-reviewer' (ses-a).
    expect(matchLiveSession('reviewer', run, 'proj-a')?.id).toBe('ses-b')
  })
})

describe('leadHandle — handle trỏ vào lead của run', () => {
  const root = session({
    id: 'ses-root',
    title: 'Product Delivery Team',
    agent: { id: 'product-delivery-team-product-delivery-team-lead' },
  })
  const spec = team({ id: 'team-pdt', name: 'Product Delivery Team' })

  it("'lead' trần và slug tên agent của lead đều đúng", () => {
    expect(leadHandle('lead', root, spec)).toBe(true)
    expect(leadHandle('product-delivery-team-lead', root, spec)).toBe(true)
  })

  it('khớp cả khi thiếu spec team (đuôi agent.id / title)', () => {
    expect(leadHandle('product-delivery-team-lead', root, null)).toBe(true)
  })

  it('handle member thường không đụng lead', () => {
    expect(leadHandle('dev', root, spec)).toBe(false)
    expect(leadHandle('product-delivery-team-dev', root, spec)).toBe(false)
  })
})

describe('matchAgentSpec / matchTeamSpec — spec tier', () => {
  const agents = [
    agent({ id: 'po', name: 'Product Owner' }),
    agent({
      id: 'po',
      name: 'PO của project',
      source: 'project',
      projectId: 'proj-a',
    }),
    agent({
      id: 'other-pj',
      name: 'Pj Agent',
      source: 'project',
      projectId: 'proj-b',
    }),
  ]
  const teams = [
    team({ id: 'squad', name: 'Core Squad' }),
    team({
      id: 'other',
      name: 'Khác Project',
      source: 'project',
      projectId: 'proj-b',
    }),
  ]

  it('project-tier shadow global trùng id', () => {
    expect(matchAgentSpec('po', agents, 'proj-a')?.name).toBe('PO của project')
    expect(matchAgentSpec('po', agents, 'proj-c')?.name).toBe('Product Owner')
  })

  it('khớp theo name-slug và bỏ spec project khác', () => {
    expect(matchAgentSpec('product-owner', agents, 'proj-a')?.id).toBe('po')
    expect(matchAgentSpec('pj-agent', agents, 'proj-a')).toBeUndefined()
    expect(matchAgentSpec('other-pj', agents, 'proj-a')).toBeUndefined()
  })

  it('team spec: global + project mình được, project khác thì không', () => {
    expect(matchTeamSpec('core-squad', teams, 'proj-a')?.id).toBe('squad')
    expect(matchTeamSpec('khac-project', teams, 'proj-a')).toBeUndefined()
    expect(matchTeamSpec('khac-project', teams, 'proj-b')?.id).toBe('other')
  })
})

describe('itemRunRoot — gốc run mà item thuộc về', () => {
  const root = session({ id: 'ses-root', teamId: 'team-1' })
  const member = session({ id: 'ses-m', teamRunId: 'ses-root' })

  it('qua assignee đang sống — member của run → gốc', async () => {
    const it = item({ assigneeSessionId: 'ses-m' })
    expect((await itemRunRoot([root, member], it))?.id).toBe('ses-root')
  })

  it('qua assigneeRef member:<runId>|<title> đang đỗ', async () => {
    const it = item({ assigneeRef: 'member:ses-root|PO' })
    expect((await itemRunRoot([root, member], it))?.id).toBe('ses-root')
  })

  it('item mồ côi (không assignee, không ref) → null', async () => {
    expect(await itemRunRoot([root, member], item({}))).toBeNull()
    const agentRef = item({ assigneeRef: 'agent:global||po' })
    expect(await itemRunRoot([root, member], agentRef)).toBeNull()
  })

  it('assignee của chính user → không lần run nào', async () => {
    const it = item({ assigneeSessionId: 'user' })
    expect(await itemRunRoot([root, member], it)).toBeNull()
  })
})
