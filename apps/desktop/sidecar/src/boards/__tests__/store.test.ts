// Board store — backlog theo project của Session Teams
// (docs/features/session-teams.md §1.2).
//
// Vì sao có file này: board là ĐIỂM GẶP chung của mọi member trong ê-kíp — hợp
// đồng status (`done`/`cancelled` của user, rollback khi lượt fail, stage wave)
// nằm trọn ở đây nên sai ở đây là sai trên mọi bề mặt (tool, RPC, cockpit).
//
// Mock theo khuôn inbox.test.ts: `HOME` trỏ vào mkdtemp để `awogHome()` (đọc
// $HOME trên POSIX) resolve sang đúng thư mục tạm, `emit` bắt event
// `board.changed`, logger bị tắt tiếng.
//
// Run: `npx vitest run src/boards/__tests__/store.test.ts`
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardItem, ProjectBoard } from '../../types/shared.js'

const emitted: { type: string; payload: unknown }[] = []

vi.mock('../../transport/stdio.js', () => ({
  emit: (type: string, payload: unknown) => {
    emitted.push({ type, payload })
  },
}))
vi.mock('../../util/logger.js', () => ({
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))

const {
  BoardError,
  MAX_BOARD_ITEMS,
  addBoardItemComment,
  checkStageWave,
  deleteBoardItem,
  getBoardItem,
  listBoardItems,
  rollbackInProgressItems,
  upsertBoardItem,
} = await import('../store.js')

let home: string
let originalHome: string | undefined
let n = 0

// Mỗi test một projectId RIÊNG: `announcedWaves` sống ở module scope, hai test
// dùng chung một project sẽ chia nhau bộ nhớ dedup của checkStageWave.
function pid(): string {
  n += 1
  return `proj-${n}`
}

// Ghi thẳng một file board — fixture cho các ca "file có sẵn" mà không phải
// upsert 500 lần qua API.
async function seedBoard(projectId: string, items: Partial<BoardItem>[]): Promise<void> {
  const dir = join(home, '.awog', 'boards')
  await mkdir(dir, { recursive: true })
  const board: ProjectBoard = {
    version: 1,
    items: items.map((it, i) => ({
      id: `bi-seed-${i}`,
      projectId,
      title: `seed ${i}`,
      status: 'todo',
      createdBy: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      comments: [],
      ...it,
    })),
  }
  await writeFile(join(dir, `${projectId}.json`), JSON.stringify(board), 'utf8')
}

async function readBoardFile(projectId: string): Promise<ProjectBoard> {
  const raw = await readFile(join(home, '.awog', 'boards', `${projectId}.json`), 'utf8')
  return JSON.parse(raw) as ProjectBoard
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-boards-'))
  originalHome = process.env.HOME
  process.env.HOME = home
  emitted.length = 0
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  await rm(home, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('upsertBoardItem — tạo mới', () => {
  it('tạo item với default + emit board.changed', async () => {
    const p = pid()
    const item = await upsertBoardItem(p, { title: 'Viết spec', createdBy: null })
    expect(item).toMatchObject({
      projectId: p,
      title: 'Viết spec',
      status: 'todo',
      createdBy: null,
      comments: [],
    })
    expect(item.id).toMatch(/^bi-[0-9a-f]+$/)
    const onDisk = await readBoardFile(p)
    expect(onDisk.items).toHaveLength(1)
    expect(emitted).toContainEqual({ type: 'board.changed', payload: { projectId: p } })
  })

  it('title được làm phẳng thành MỘT dòng và cắt ở 140 ký tự', async () => {
    const p = pid()
    const item = await upsertBoardItem(p, {
      title: `${'x'.repeat(160)}\nsecond line`,
      createdBy: 'ses-1',
    })
    expect(item.title).not.toContain('\n')
    expect(item.title.length).toBeLessThanOrEqual(140)
    expect(item.title.endsWith('…')).toBe(true)
  })

  it('từ chối tạo khi thiếu/khi title rỗng', async () => {
    const p = pid()
    await expect(upsertBoardItem(p, { createdBy: null })).rejects.toMatchObject({
      name: 'BoardError',
      code: 'invalid-input',
    })
    await expect(upsertBoardItem(p, { title: '   ', createdBy: null })).rejects.toMatchObject({
      code: 'invalid-input',
    })
    // Không có gì được ghi — item rỗng không được để lại file.
    expect(await listBoardItems(p)).toEqual([])
  })

  it('TỪ CHỐI desc quá 8000 ký tự thay vì âm thầm cắt', async () => {
    const p = pid()
    await expect(
      upsertBoardItem(p, { title: 't', desc: 'd'.repeat(8001), createdBy: null }),
    ).rejects.toBeInstanceOf(BoardError)
  })

  it('chặn khi board đầy (500 item)', async () => {
    const p = pid()
    await seedBoard(
      p,
      Array.from({ length: MAX_BOARD_ITEMS }, () => ({})),
    )
    await expect(upsertBoardItem(p, { title: 'tràn', createdBy: null })).rejects.toMatchObject({
      code: 'board-full',
    })
  })
})

describe('upsertBoardItem — update', () => {
  it('patch từng field; null trên assignee/stage là GỠ hẳn', async () => {
    const p = pid()
    const created = await upsertBoardItem(p, {
      title: 'Việc A',
      desc: 'mô tả',
      assigneeSessionId: 'ses-a',
      stage: 2,
      status: 'todo',
      createdBy: 'ses-lead',
    })
    const updated = await upsertBoardItem(p, {
      id: created.id,
      status: 'in_progress',
      assigneeSessionId: null,
      stage: null,
    })
    expect(updated.status).toBe('in_progress')
    expect('assigneeSessionId' in updated).toBe(false)
    expect('stage' in updated).toBe(false)
    // Provenance không bị đè bởi update.
    expect(updated.createdBy).toBe('ses-lead')
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt))
  })

  it('từ chối id lạ / status ngoài enum / stage không nguyên', async () => {
    const p = pid()
    await expect(
      upsertBoardItem(p, { id: 'bi-khong-co', title: 'x' }),
    ).rejects.toMatchObject({ code: 'unknown-item' })
    const item = await upsertBoardItem(p, { title: 'x', createdBy: null })
    await expect(
      upsertBoardItem(p, { id: item.id, status: 'lên-đỉnh' as never }),
    ).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(
      upsertBoardItem(p, { id: item.id, stage: 1.5 }),
    ).rejects.toMatchObject({ code: 'invalid-input' })
  })
})

describe('deleteBoardItem + addBoardItemComment', () => {
  it('xoá trả về item, id lạ trả null và KHÔNG emit', async () => {
    const p = pid()
    const item = await upsertBoardItem(p, { title: 'x', createdBy: null })
    expect((await deleteBoardItem(p, item.id))?.id).toBe(item.id)
    expect(await listBoardItems(p)).toEqual([])
    emitted.length = 0
    expect(await deleteBoardItem(p, item.id)).toBeNull()
    expect(emitted).toEqual([])
  })

  it('comment trả về bản ghi, null khi item không tồn tại, cap 100', async () => {
    const p = pid()
    const item = await upsertBoardItem(p, { title: 'x', createdBy: null })
    const c = await addBoardItemComment(p, item.id, {
      from: 'ses-a',
      fromTitle: 'Member A',
      text: 'đang làm',
    })
    expect(c).toMatchObject({ from: 'ses-a', fromTitle: 'Member A', text: 'đang làm' })
    expect(c?.id).toMatch(/^bc-/)
    expect(await addBoardItemComment(p, 'bi-lạ', { from: null, fromTitle: 'You', text: 'x' })).toBeNull()

    await seedBoard(p, [
      {
        id: item.id,
        comments: Array.from({ length: 100 }, (_, i) => ({
          id: `bc-${i}`,
          at: '2026-01-01T00:00:00.000Z',
          from: null,
          fromTitle: 'You',
          text: 'x',
        })),
      },
    ])
    await expect(
      addBoardItemComment(p, item.id, { from: null, fromTitle: 'You', text: 'tràn' }),
    ).rejects.toMatchObject({ code: 'comments-full' })
  })

  it('comment rỗng/quá 4000 bị từ chối', async () => {
    const p = pid()
    const item = await upsertBoardItem(p, { title: 'x', createdBy: null })
    await expect(
      addBoardItemComment(p, item.id, { from: null, fromTitle: 'You', text: '   ' }),
    ).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(
      addBoardItemComment(p, item.id, { from: null, fromTitle: 'You', text: 'y'.repeat(4001) }),
    ).rejects.toMatchObject({ code: 'invalid-input' })
  })
})

// Spec §1.2: lượt của assignee FAIL là một trong hai chỗ hệ thống tự sửa status
// — in_progress về todo + system comment. `blocked` KHÔNG bị cuốn vì đó là member
// TỰ báo kẹt, một trạng thái có chủ đích chứ không phải crash.
describe('rollbackInProgressItems — lượt fail trả việc về todo', () => {
  it('chỉ rollback item in_progress CỦA đúng session đó', async () => {
    const p = pid()
    const mine = await upsertBoardItem(p, {
      title: 'đang làm',
      assigneeSessionId: 'ses-me',
      status: 'in_progress',
      createdBy: 'ses-lead',
    })
    const blocked = await upsertBoardItem(p, {
      title: 'kẹt',
      assigneeSessionId: 'ses-me',
      status: 'blocked',
      createdBy: 'ses-me',
    })
    const other = await upsertBoardItem(p, {
      title: 'của người khác',
      assigneeSessionId: 'ses-other',
      status: 'in_progress',
      createdBy: 'ses-lead',
    })
    const todo = await upsertBoardItem(p, {
      title: 'chưa làm',
      assigneeSessionId: 'ses-me',
      status: 'todo',
      createdBy: 'ses-lead',
    })

    const count = await rollbackInProgressItems(p, 'ses-me')
    expect(count).toBe(1)

    const after = await getBoardItem(p, mine.id)
    expect(after?.status).toBe('todo')
    const sys = after?.comments.at(-1)
    expect(sys).toMatchObject({
      from: null,
      fromTitle: 'system',
      text: 'Turn failed; returned to todo',
    })

    // Ba trạng thái kia không động.
    expect((await getBoardItem(p, blocked.id))?.status).toBe('blocked')
    expect((await getBoardItem(p, other.id))?.status).toBe('in_progress')
    expect((await getBoardItem(p, todo.id))?.status).toBe('todo')
    expect(emitted).toContainEqual({ type: 'board.changed', payload: { projectId: p } })
  })

  it('không có gì để rollback → 0, không ghi file', async () => {
    const p = pid()
    const item = await upsertBoardItem(p, {
      title: 'x',
      assigneeSessionId: 'ses-me',
      status: 'done',
      createdBy: null,
    })
    emitted.length = 0
    expect(await rollbackInProgressItems(p, 'ses-me')).toBe(0)
    expect(emitted).toEqual([])
    expect((await getBoardItem(p, item.id))?.status).toBe('done')
  })
})

// Spec §5/§6: hết một "đợt" (stage thấp nhất xong hết) trong khi đợt sau còn việc
// → caller (tool) thông báo lead. Query có nhớ per project: chỉ trả kết quả lần
// đầu một stage đạt "xong" — nếu không, mọi update sau đó đều báo lại.
describe('checkStageWave — hết đợt', () => {
  it('stage thấp nhất xong + stage cao còn mở → báo {completedStage, nextStage}', async () => {
    const p = pid()
    await seedBoard(p, [
      { id: 'bi-a', stage: 1, status: 'done' },
      { id: 'bi-b', stage: 1, status: 'cancelled' },
      { id: 'bi-c', stage: 2, status: 'todo' },
      { id: 'bi-d', stage: 3, status: 'backlog' },
    ])
    await expect(checkStageWave(p)).resolves.toEqual({ completedStage: 1, nextStage: 2 })
  })

  it('stage thấp nhất còn item mở → null', async () => {
    const p = pid()
    await seedBoard(p, [
      { id: 'bi-a', stage: 1, status: 'in_progress' },
      { id: 'bi-b', stage: 2, status: 'todo' },
    ])
    await expect(checkStageWave(p)).resolves.toBeNull()
  })

  it('mọi stage đều xong (không còn đợt sau) → null', async () => {
    const p = pid()
    await seedBoard(p, [
      { id: 'bi-a', stage: 1, status: 'done' },
      { id: 'bi-b', stage: 2, status: 'done' },
    ])
    await expect(checkStageWave(p)).resolves.toBeNull()
  })

  it('item không gán stage không tham gia sóng → null khi chỉ có chúng', async () => {
    const p = pid()
    await seedBoard(p, [
      { id: 'bi-a', status: 'todo' },
      { id: 'bi-b', status: 'done' },
    ])
    await expect(checkStageWave(p)).resolves.toBeNull()
  })

  it('báo MỘT lần rồi im — update tiếp theo không post lại sóng cũ', async () => {
    const p = pid()
    await seedBoard(p, [
      { id: 'bi-a', stage: 1, status: 'done' },
      { id: 'bi-b', stage: 2, status: 'todo' },
    ])
    await expect(checkStageWave(p)).resolves.toEqual({ completedStage: 1, nextStage: 2 })
    // Cùng một trạng thái → null, dù được gọi lại bao nhiêu lần.
    await expect(checkStageWave(p)).resolves.toBeNull()
    await expect(checkStageWave(p)).resolves.toBeNull()
  })

  it('stage 2 xong nốt thì báo SÓNG MỚI (dedup theo stage, không phải theo project)', async () => {
    const p = pid()
    await seedBoard(p, [
      { id: 'bi-a', stage: 1, status: 'done' },
      { id: 'bi-b', stage: 2, status: 'done' },
      { id: 'bi-c', stage: 3, status: 'todo' },
    ])
    await expect(checkStageWave(p)).resolves.toEqual({ completedStage: 1, nextStage: 3 })
    await expect(checkStageWave(p)).resolves.toBeNull()
  })
})

describe('loadBoard — lọc mềm', () => {
  it('item mang projectId khác bị bỏ qua (file lỡ bị ghi nhầm)', async () => {
    const p = pid()
    await seedBoard(p, [
      { id: 'bi-dung', projectId: p },
      { id: 'bi-ngoai', projectId: 'proj-khac' },
      { id: 'bi-hong', status: 'khong-ton-tai' as never },
    ])
    const items = await listBoardItems(p)
    expect(items.map((i) => i.id)).toEqual(['bi-dung'])
  })

  it('board chưa tồn tại → rỗng', async () => {
    await expect(listBoardItems(pid())).resolves.toEqual([])
  })

  it('field khuôn Jira lạ trên đĩa bị gỡ nhẹ (item vẫn giữ)', async () => {
    const p = pid()
    await seedBoard(p, [
      {
        id: 'bi-ban',
        type: 'khong-ton-tai' as never,
        priority: 'nhanh' as never,
        severity: 'vo-cung' as never,
        parentId: 'bi-khong-co',
      },
      { id: 'bi-tu-cha', parentId: 'bi-tu-cha' },
    ])
    const items = await listBoardItems(p)
    const ban = items.find((i) => i.id === 'bi-ban')
    expect(ban?.type).toBeUndefined()
    expect(ban?.priority).toBeUndefined()
    expect(ban?.severity).toBeUndefined()
    expect(ban?.parentId).toBeUndefined()
    expect(items.find((i) => i.id === 'bi-tu-cha')?.parentId).toBeUndefined()
  })
})

describe('khuôn Jira — type/priority/severity/parentId', () => {
  it('tạo và sửa được đủ bốn field; null gỡ priority/severity/cha', async () => {
    const p = pid()
    const epic = await upsertBoardItem(p, { title: 'Epic A', type: 'epic', createdBy: null })
    expect(epic.type).toBe('epic')
    const sub = await upsertBoardItem(p, {
      title: 'Việc con',
      type: 'subtask',
      parentId: epic.id,
      priority: 'high',
      severity: 'major',
      createdBy: null,
    })
    expect(sub).toMatchObject({ type: 'subtask', parentId: epic.id, priority: 'high' })
    const patched = await upsertBoardItem(p, {
      id: sub.id,
      type: 'task',
      priority: 'low',
      severity: null,
      parentId: null,
    })
    expect(patched.type).toBe('task')
    expect(patched.priority).toBe('low')
    expect(patched.severity).toBeUndefined()
    expect(patched.parentId).toBeUndefined()
  })

  it('từ chối type/priority/severity ngoài enum', async () => {
    const p = pid()
    await expect(upsertBoardItem(p, { title: 't', type: 'nhiem-vu' })).rejects.toMatchObject({
      code: 'invalid-input',
    })
    await expect(
      upsertBoardItem(p, { title: 't', priority: 'choang' }),
    ).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(
      upsertBoardItem(p, { title: 't', severity: 'kinh-khung' }),
    ).rejects.toMatchObject({ code: 'invalid-input' })
  })

  it('parentId: cha phải tồn tại, không tự làm cha mình, không vòng', async () => {
    const p = pid()
    // Cha lạ — id hợp lệ nhưng không có item nào.
    await expect(
      upsertBoardItem(p, { title: 't', parentId: 'bi-deadbeef00' }),
    ).rejects.toMatchObject({ code: 'unknown-item' })
    const a = await upsertBoardItem(p, { title: 'A' })
    // Tự làm cha mình.
    await expect(
      upsertBoardItem(p, { id: a.id, parentId: a.id }),
    ).rejects.toMatchObject({ code: 'invalid-input' })
    const b = await upsertBoardItem(p, { title: 'B', parentId: a.id })
    const c = await upsertBoardItem(p, { title: 'C', parentId: b.id })
    // Vòng A←B←C←A bị chặn.
    await expect(upsertBoardItem(p, { id: a.id, parentId: c.id })).rejects.toMatchObject({
      code: 'invalid-input',
    })
    // Nhánh hợp lệ vẫn ghi được: A←B←C + A←D.
    const d = await upsertBoardItem(p, { title: 'D', parentId: a.id })
    expect(d.parentId).toBe(a.id)
  })

  it('xoá cha → con MỒ CÔI (parentId bị gỡ), không chết theo', async () => {
    const p = pid()
    const parent = await upsertBoardItem(p, { title: 'Cha' })
    const kid = await upsertBoardItem(p, { title: 'Con', parentId: parent.id })
    await deleteBoardItem(p, parent.id)
    const orphan = (await listBoardItems(p)).find((i) => i.id === kid.id)
    expect(orphan).toBeDefined()
    expect(orphan?.parentId).toBeUndefined()
  })
})
