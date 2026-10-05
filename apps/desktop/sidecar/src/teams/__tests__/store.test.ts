// Team spec store — round-trip ~/.awog/teams/<id>.json.
//
// Vì sao có file này: `instructions` (chỉ dẫn cấp đội → prompt lead mỗi run)
// từng bị BỎ SÓT ở cả hai đầu — parse() không đọc, saveTeam() không ghi — nên
// spec user lưu qua UI mất sạch instructions mà không một lỗi báo. Test dưới
// pin hợp đồng: field nào upsert vào thì list/load phải trả lại y hệt.
//
// Mock theo khuôn boards/store.test.ts: `HOME` trỏ vào mkdtemp để `awogHome()`
// resolve sang thư mục tạm, logger tắt tiếng.
//
// Run: `npx vitest run src/teams/__tests__/store.test.ts`
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamSpec } from '../../types/shared.js'

vi.mock('../../util/logger.js', () => ({
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))
// projects/store phục vụ tier project — suite này chỉ chạm global, nhưng import
// đường truyền kéo theo store kia nên cần HOME giả trước khi import (đã làm ở
// beforeEach trước `await import`).
vi.mock('../../transport/stdio.js', () => ({ emit: () => {} }))

const { listTeams, loadTeam, saveTeam, deleteTeam } = await import('../store.js')

let home: string
let originalHome: string | undefined

function spec(patch: Partial<TeamSpec> = {}): TeamSpec {
  return {
    id: 'team-x',
    name: 'X Team',
    members: [{ title: 'Dev' }, { title: 'QA' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  }
}

// Ghi thẳng file spec — fixture cho ca "file có sẵn" (spec viết tay / từ app
// khác), không qua saveTeam để test đường ĐỌC độc lập đường ghi.
async function seedTeam(obj: Record<string, unknown>): Promise<void> {
  const dir = join(home, '.awog', 'teams')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${obj.id}.json`), JSON.stringify(obj), 'utf8')
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-teams-'))
  originalHome = process.env.HOME
  process.env.HOME = home
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  await rm(home, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('instructions — round-trip đầu-cuối', () => {
  it('saveTeam → listTeams trả lại instructions', async () => {
    await saveTeam(spec({ instructions: 'Chỉ lead tạo item; member báo lead.' }))
    const [loaded] = await listTeams([])
    expect(loaded?.instructions).toBe('Chỉ lead tạo item; member báo lead.')
  })

  it('loadTeam trả instructions khi đọc lẻ', async () => {
    await saveTeam(spec({ instructions: 'sub-task gắn parent_id' }))
    const loaded = await loadTeam('team-x', 'global')
    expect(loaded?.instructions).toBe('sub-task gắn parent_id')
  })

  it('spec viết tay có instructions → parse đọc được', async () => {
    await seedTeam({
      id: 'team-x',
      name: 'X Team',
      members: [{ title: 'Dev' }],
      instructions: 'hand-written rule',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const [loaded] = await listTeams([])
    expect(loaded?.instructions).toBe('hand-written rule')
  })

  it('instructions rỗng → file không còn field, đọc về undefined', async () => {
    await saveTeam(spec({ instructions: 'có nội dung' }))
    await saveTeam(spec({ instructions: '  ' }))
    const loaded = await loadTeam('team-x', 'global')
    expect(loaded?.instructions).toBeUndefined()
  })

  it('spec không instructions → đọc về undefined, không bịa', async () => {
    await saveTeam(spec())
    const [loaded] = await listTeams([])
    expect(loaded?.instructions).toBeUndefined()
  })
})

describe('saveTeam — các field khác vẫn nguyên', () => {
  it('ghi đủ name/desc/lead/members + đọc lại', async () => {
    await saveTeam(
      spec({
        desc: 'test team',
        instructions: 'rule',
        lead: { id: 'agent-lead', source: 'global' },
        members: [{ title: 'Dev', agent: { id: 'agent-dev', source: 'global' } }],
      }),
    )
    const loaded = await loadTeam('team-x', 'global')
    expect(loaded).toMatchObject({
      name: 'X Team',
      desc: 'test team',
      instructions: 'rule',
      lead: { id: 'agent-lead', source: 'global' },
      members: [{ title: 'Dev', agent: { id: 'agent-dev', source: 'global' } }],
    })
  })

  it('deleteTeam xoá được file', async () => {
    await saveTeam(spec())
    await deleteTeam('team-x', 'global')
    expect(await loadTeam('team-x', 'global')).toBeNull()
  })
})
