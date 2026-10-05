// runRootId — resolver duy nhất "phiên này thuộc run nào" + cổng cấp tool của
// ba runner ê-kíp (board/channel/member) qua bản đồ ấm sessionManager.
//
// Vì sao có file này — hồi quy cho một lỗi đã xảy ra thật: lead của `teams.run`
// mất TRỌN tool ê-kíp trên cả hai runtime. `teams.run` materialize gốc kèm
// `teamId` ngay lượt tạo nhưng member spawn LƯỜI, nên resolver cũ (chỉ nhìn
// `teamRunId` hoặc "đã có con") trả null — không <team> block, không
// team_item_*/team_say/member_diff, đúng lúc lead cần chúng nhất để điều phối.
// Nhánh `teamId` cũng phải đi cùng phần bù của setRunMembership (xoá link spec
// khi member rời hẳn nhóm): thiếu nó, một phiên đã rời run tự nhận mình là
// gốc của một run ma.
//
// Mock theo khuôn store.test.ts: chỉ `getSessions` của sessionManager được
// thay — ba factory chỉ đụng đúng hàm đó lúc DỰNG (gate), phần còn lại của
// runner chỉ chạy khi tool được gọi.
//
// Run: `npx vitest run src/sessions/__tests__/run-root.test.ts`
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionSummary } from '../../types/shared.js'

const summaries: SessionSummary[] = []

vi.mock('../session-manager.js', () => ({
  sessionManager: { getSessions: () => summaries },
}))

const { runRootId } = await import('../run-root.js')
const { createBoardRunners } = await import('../../runtime/tools/board-tools.js')
const { createChannelRunners } = await import('../../runtime/tools/channel-tools.js')
const { createMemberRunners } = await import('../../runtime/tools/member-tools.js')

function seed(partial: Partial<SessionSummary> & { id: string }): SessionSummary {
  const s: SessionSummary = {
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
  summaries.push(s)
  return s
}

beforeEach(() => {
  summaries.length = 0
})

describe('runRootId — gốc của run', () => {
  it('member trả teamRunId của nó', () => {
    seed({ id: 'ses-root', teamId: 'team-1', teamSource: 'global' })
    seed({ id: 'ses-m1', teamRunId: 'ses-root', teamId: 'team-1' })
    expect(runRootId(summaries, 'ses-m1')).toBe('ses-root')
  })

  // Ca hồi quy chính: lead của teams.run là gốc NGAY khi tạo — link spec
  // `teamId` nhận diện nó trước cả khi member đầu tiên materialize.
  it('lead của teams.run (teamId, chưa con nào) là gốc của chính nó', () => {
    seed({ id: 'ses-lead', teamId: 'team-1', teamSource: 'global' })
    expect(runRootId(summaries, 'ses-lead')).toBe('ses-lead')
  })

  it('gốc nhóm ad-hoc (không teamId) vẫn nhận diện qua con', () => {
    seed({ id: 'ses-root' })
    seed({ id: 'ses-m1', teamRunId: 'ses-root' })
    expect(runRootId(summaries, 'ses-root')).toBe('ses-root')
  })

  it('phiên lẻ (không cha, không con, không teamId) → null', () => {
    seed({ id: 'ses-lone' })
    expect(runRootId(summaries, 'ses-lone')).toBeNull()
  })

  it('phiên đã rời nhóm (teamRunId/teamId đều đã gỡ) → null', () => {
    // setRunMembership strip link spec khi leavingGroup — fixture mô phỏng
    // header SAU khi strip: sạch cả hai field.
    seed({ id: 'ses-ex' })
    expect(runRootId(summaries, 'ses-ex')).toBeNull()
  })

  it('id lạ → null', () => {
    seed({ id: 'ses-root', teamId: 'team-1' })
    expect(runRootId(summaries, 'ses-khong-co')).toBeNull()
  })
})

// Cổng cấp tool phải đi qua ĐÚNG ba factory mà cả hai runtime dùng (Pi bọc
// AgentTool, Claude SDK bọc qua team-sdk-server) — test ở mức runners để một
// nhát bắt được lệch gate giữa hai nhánh.
describe('runner factories — lead của teams.run có tool ê-kíp ngay', () => {
  it('board + channel + member đều mở cho lead có teamId + project, dù chưa có con', () => {
    seed({ id: 'ses-lead', teamId: 'team-1', teamSource: 'global' })
    expect(createBoardRunners({ sessionId: 'ses-lead' })).not.toBeNull()
    expect(createChannelRunners({ sessionId: 'ses-lead' })).not.toBeNull()
    expect(createMemberRunners({ sessionId: 'ses-lead' })).not.toBeNull()
  })

  it('member cũng mở đủ ba nhóm — kế thừa project của gốc khi header thiếu', () => {
    seed({ id: 'ses-root', teamId: 'team-1' })
    seed({ id: 'ses-m1', teamRunId: 'ses-root', projectId: null })
    expect(createBoardRunners({ sessionId: 'ses-m1' })).not.toBeNull()
    expect(createChannelRunners({ sessionId: 'ses-m1' })).not.toBeNull()
    expect(createMemberRunners({ sessionId: 'ses-m1' })).not.toBeNull()
  })

  it('phiên lẻ không có tool nào — không trả một token schema nào', () => {
    seed({ id: 'ses-lone' })
    expect(createBoardRunners({ sessionId: 'ses-lone' })).toBeNull()
    expect(createChannelRunners({ sessionId: 'ses-lone' })).toBeNull()
    expect(createMemberRunners({ sessionId: 'ses-lone' })).toBeNull()
  })

  it('lead của run KHÔNG project: channel/member vẫn mở, board đóng (board theo project)', () => {
    seed({ id: 'ses-lead', teamId: 'team-1', projectId: null })
    expect(createBoardRunners({ sessionId: 'ses-lead' })).toBeNull()
    expect(createChannelRunners({ sessionId: 'ses-lead' })).not.toBeNull()
    expect(createMemberRunners({ sessionId: 'ses-lead' })).not.toBeNull()
  })

  // Board-worker lẻ (agents.run origin 'board' — phiên do board item spawn):
  // hợp đồng của nó LÀ board item — tin wake của boards.upsert/comment dẫn
  // team_item_* ngay từ đầu, nên thiếu tool là nó không bao giờ trả lời được
  // trên thread. Nhưng nó KHÔNG phải ê-kíp: channel/member vẫn đóng.
  it('board-worker lẻ (origin board + project): board mở, channel/member đóng', () => {
    seed({ id: 'ses-worker', origin: 'board' })
    expect(createBoardRunners({ sessionId: 'ses-worker' })).not.toBeNull()
    expect(createChannelRunners({ sessionId: 'ses-worker' })).toBeNull()
    expect(createMemberRunners({ sessionId: 'ses-worker' })).toBeNull()
  })

  it('board-worker KHÔNG project: không có chỗ đặt backlog — board vẫn đóng', () => {
    seed({ id: 'ses-worker', origin: 'board', projectId: null })
    expect(createBoardRunners({ sessionId: 'ses-worker' })).toBeNull()
  })

  it('member của run mang origin board vẫn là MEMBER — membership thắng marker nguồn', () => {
    seed({ id: 'ses-root', teamId: 'team-1' })
    seed({ id: 'ses-m1', teamRunId: 'ses-root', origin: 'board' })
    expect(createBoardRunners({ sessionId: 'ses-m1' })).not.toBeNull()
    expect(createChannelRunners({ sessionId: 'ses-m1' })).not.toBeNull()
    expect(createMemberRunners({ sessionId: 'ses-m1' })).not.toBeNull()
  })
})
