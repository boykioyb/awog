// team-members — ghế song song của một spec member (member_instance).
//
// Vì sao có file này: "member là ROLE không phải singleton" đứng hay ngã ở
// phép khớp liveMemberSession — khớp sai một chữ là dispatch đổ vào nhầm
// phiên (ghế gốc bốc nhầm "Dev 2", hoặc ngược lại), và đây là hành vi lead
// tự quyết nên không có người nào nhìn trước khi tiền chảy.
//
// `loadMemberLlmOverride` chạy board store THẬT trên HOME tạm (khuôn
// store.test.ts); các hàm khớp thuần là unit test trên summaries giả.
//
// Run: `npx vitest run src/sessions/__tests__/team-members.test.ts`
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectBoard, SessionSummary, TeamSpec } from '../../types/shared.js'

vi.mock('../../transport/stdio.js', () => ({ emit: () => {} }))
vi.mock('../../util/logger.js', () => ({
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))

const { liveMemberSession, memberSeatTitle, loadMemberLlmOverride, MAX_MEMBER_INSTANCES } =
  await import('../team-members.js')

type Member = TeamSpec['members'][number]
const DEV: Member = { title: 'Dev' }
const DEV_BOUND: Member = { title: 'Dev', agent: { id: 'dev-agent' } }

let n = 0
function session(partial: Partial<SessionSummary> & { id: string }): SessionSummary {
  n += 1
  return {
    title: partial.id,
    projectId: 'proj-tm',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'idle',
    invitedAgentIds: [],
    pendingAgentIds: [],
    settings: { provider: 'anthropic', modelId: 'm', level: 'high', mode: 'execute' },
    ...partial,
  }
}

const RUN = 'ses-root'

describe('memberSeatTitle', () => {
  it('ghế gốc = title spec; ghế N = "<title> N"', () => {
    expect(memberSeatTitle(DEV)).toBe('Dev')
    expect(memberSeatTitle(DEV, 1)).toBe('Dev')
    expect(memberSeatTitle(DEV, 2)).toBe('Dev 2')
    expect(memberSeatTitle(DEV, MAX_MEMBER_INSTANCES)).toBe(`Dev ${MAX_MEMBER_INSTANCES}`)
  })
})

describe('liveMemberSession — ghế gốc vs ghế instance', () => {
  it('ghế N khớp đúng phiên "<title> N" — không đụng ghế gốc', () => {
    const summaries = [
      session({ id: 'ses-dev1', title: 'Dev', teamRunId: RUN }),
      session({ id: 'ses-dev2', title: 'Dev 2', teamRunId: RUN }),
    ]
    expect(liveMemberSession(summaries, RUN, DEV)?.id).toBe('ses-dev1')
    expect(liveMemberSession(summaries, RUN, DEV, 2)?.id).toBe('ses-dev2')
    expect(liveMemberSession(summaries, RUN, DEV, 3)).toBeUndefined()
  })

  it('member bind agent: ghế gốc khớp agent.id nhưng LOẠI phiên instance-titled', () => {
    // "Dev 2" mang cùng agent binding — nếu ghế gốc chưa spawn, lookup "Dev"
    // KHÔNG được bốc nhầm "Dev 2" (item giao "Dev" phải spawn ghế gốc).
    const only2 = [session({ id: 'ses-dev2', title: 'Dev 2', teamRunId: RUN, agent: { id: 'dev-agent' } })]
    expect(liveMemberSession(only2, RUN, DEV_BOUND)).toBeUndefined()
    const both = [
      session({ id: 'ses-dev1', title: 'Dev', teamRunId: RUN, agent: { id: 'dev-agent' } }),
      session({ id: 'ses-dev2', title: 'Dev 2', teamRunId: RUN, agent: { id: 'dev-agent' } }),
    ]
    expect(liveMemberSession(both, RUN, DEV_BOUND)?.id).toBe('ses-dev1')
  })

  it('phiên lưu trữ không tính còn sống — kể cả ghế instance', () => {
    const summaries = [
      session({ id: 'ses-dead', title: 'Dev 2', teamRunId: RUN, archived: true }),
    ]
    expect(liveMemberSession(summaries, RUN, DEV, 2)).toBeUndefined()
  })

  it('phiên ngoài run khác không bị nhận nhầm', () => {
    const summaries = [session({ id: 'ses-other', title: 'Dev 2', teamRunId: 'ses-other-run' })]
    expect(liveMemberSession(summaries, RUN, DEV, 2)).toBeUndefined()
  })

  it('title spec có ký tự regex ("Dev — FE, BE") vẫn khớp ghế đúng', () => {
    const m: Member = { title: 'Dev — FE, BE' }
    const summaries = [
      session({ id: 'ses-i2', title: 'Dev — FE, BE 2', teamRunId: RUN }),
    ]
    expect(liveMemberSession(summaries, RUN, m)).toBeUndefined()
    expect(liveMemberSession(summaries, RUN, m, 2)?.id).toBe('ses-i2')
  })
})

describe('loadMemberLlmOverride — ghế kế thừa config của role', () => {
  const PID = 'proj-tm-override'
  let home: string
  let originalHome: string | undefined

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'awog-tm-'))
    originalHome = process.env['HOME']
    process.env['HOME'] = home
    const dir = join(home, '.awog', 'boards')
    await mkdir(dir, { recursive: true })
    const board: ProjectBoard = {
      version: 1,
      items: [
        {
          id: 'bi-1',
          projectId: PID,
          title: 'T',
          status: 'todo',
          comments: [],
          createdBy: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          assigneeConfig: {
            'member:Dev': { modelId: 'role-model', level: 'medium' },
            'member:Dev 2': { modelId: 'seat-model', level: 'high' },
          },
        },
      ],
    }
    await writeFile(join(dir, `${PID}.json`), JSON.stringify(board), 'utf8')
  })

  afterEach(async () => {
    process.env['HOME'] = originalHome
    await rm(home, { recursive: true, force: true })
  })

  it('key member:<seat> thắng; không có thì kế thừa member:<title>', async () => {
    expect(await loadMemberLlmOverride(PID, 'bi-1', 'Dev', 'Dev 2')).toEqual({
      modelId: 'seat-model',
      level: 'high',
    })
    expect(await loadMemberLlmOverride(PID, 'bi-1', 'Dev', 'Dev 3')).toEqual({
      modelId: 'role-model',
      level: 'medium',
    })
    expect(await loadMemberLlmOverride(PID, 'bi-1', 'Dev')).toEqual({
      modelId: 'role-model',
      level: 'medium',
    })
  })
})
