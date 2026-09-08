// Hàng rào ĐÍCH của kênh nhắn tin giữa các phiên (F3, lượt audit 2026-09-08).
//
// Vì sao có file này: `list_sessions` nói với model "đây là những phiên bạn nhắn
// được", còn `send_session_message` thì nhận id nào cũng gửi. Một model bị
// prompt-injection từ file trong workspace vì thế nhắn được vào MỘT PHIÊN BẤT KỲ của
// cùng người dùng — kể cả phiên nguội hàng tháng mà không ai còn mở, tức không ai
// đọc để nhận ra tin đó là giả. Hai nửa phải đọc chung một vị từ thì lời hứa của
// danh bạ mới là lời hứa thật.
//
// Hàng rào này áp cho tin do MODEL gửi. Người dùng bấm gửi từ UI (`from: null`) thì
// không: họ chọn đích bằng mắt trên danh sách của chính họ, và siết luồng đó là siết
// nhầm người.
//
// Chạy trên CẢ HAI runtime tự nhiên, vì cả hai đi qua đúng hàm này
// (`createSessionMessagingRunners` → `postSessionMessage`).
//
// Run: `npx vitest run src/sessions/__tests__/inbox.test.ts`
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface Summary {
  id: string
  title: string
  projectId: string | null
  createdAt: string
  updatedAt: string
  archived?: boolean
}

let summaries: Summary[] = []
let running: string[] = []

vi.mock('../store.js', () => ({
  listSessionSummaries: async () => summaries,
}))
vi.mock('../runner.js', () => ({
  activeSessionIds: () => running,
}))
vi.mock('../../transport/stdio.js', () => ({
  emit: () => {},
}))

const { InboxError, listSessionContacts, postSessionMessage } = await import('../inbox.js')

const DAY_MS = 24 * 60 * 60 * 1000
const SENDER = 'ses-sender'

function at(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString()
}

function session(id: string, over: Partial<Summary> = {}): Summary {
  return {
    id,
    title: id,
    projectId: null,
    createdAt: at(2 * DAY_MS),
    updatedAt: at(60_000),
    ...over,
  }
}

// Mỗi test dùng id đích RIÊNG: sổ cái chống lạm dụng trong inbox.ts sống ở module
// scope, nên hai test dùng chung một id sẽ chia nhau bộ đếm.
let n = 0
function freshId(): string {
  n += 1
  return `ses-target-${n}`
}

beforeEach(() => {
  summaries = [session(SENDER)]
  running = []
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function send(to: string, from: string | null = SENDER) {
  return postSessionMessage({ from, to, text: 'báo cáo xong việc' })
}

describe('postSessionMessage — đích phải nằm trong danh bạ (tin của model)', () => {
  it('nhận phiên vừa hoạt động', async () => {
    const id = freshId()
    summaries.push(session(id, { updatedAt: at(60_000) }))
    await expect(send(id)).resolves.toMatchObject({ to: id })
  })

  it('nhận phiên nguội NHƯNG đang chạy một lượt', async () => {
    // Vị từ đọc `activeSessionIds()` trước khi xét thời gian — một phiên chạy dài
    // (task nhiều giờ) vẫn phải nhận được báo cáo.
    const id = freshId()
    summaries.push(session(id, { updatedAt: at(10 * DAY_MS) }))
    running = [id]
    await expect(send(id)).resolves.toMatchObject({ to: id })
  })

  it('TỪ CHỐI phiên idle đã nguội quá 24h', async () => {
    const id = freshId()
    summaries.push(session(id, { updatedAt: at(2 * DAY_MS) }))
    await expect(send(id)).rejects.toMatchObject({
      name: 'InboxError',
      code: 'unreachable-target',
    })
  })

  it('TỪ CHỐI phiên có updatedAt không đọc được', async () => {
    // Fail fast: một mốc thời gian hỏng không được rơi về "cho qua".
    const id = freshId()
    summaries.push(session(id, { updatedAt: 'không phải ngày', createdAt: 'cũng không' }))
    await expect(send(id)).rejects.toBeInstanceOf(InboxError)
  })

  it('KHÔNG bắt gọi list_sessions trước — trả lời một phiên vừa nhắn tới vẫn gửi được', async () => {
    // Ràng theo "cùng lượt" sẽ chặn đúng luồng hợp lệ này (id nằm sẵn trong khối tin
    // đến), mà không chặn được kẻ tấn công — nó chỉ việc bảo model gọi list_sessions
    // trước, danh bạ không phải bí mật.
    const id = freshId()
    summaries.push(session(id))
    await expect(send(id)).resolves.toMatchObject({ to: id })
  })
})

describe('postSessionMessage — luồng người dùng không bị siết', () => {
  it('người dùng gửi được vào một phiên nguội mà model không gửi được', async () => {
    const id = freshId()
    summaries.push(session(id, { updatedAt: at(30 * DAY_MS) }))
    await expect(send(id, null)).resolves.toMatchObject({ to: id, from: null })
    await expect(send(id)).rejects.toMatchObject({ code: 'unreachable-target' })
  })
})

describe('listSessionContacts — cùng một vị từ với postSessionMessage', () => {
  it('phiên nguội không có trong danh bạ, và cũng không nhận được tin', async () => {
    const cold = freshId()
    const warm = freshId()
    summaries.push(session(cold, { updatedAt: at(2 * DAY_MS) }), session(warm))
    const ids = (await listSessionContacts(SENDER)).map((c) => c.id)
    expect(ids).toContain(warm)
    expect(ids).not.toContain(cold)
    await expect(send(warm)).resolves.toMatchObject({ to: warm })
    await expect(send(cold)).rejects.toMatchObject({ code: 'unreachable-target' })
  })

  it('phiên đã lưu trữ vẫn bị từ chối với lý do riêng của nó', async () => {
    const id = freshId()
    summaries.push(session(id, { archived: true }))
    await expect(send(id)).rejects.toMatchObject({ code: 'archived-target' })
  })
})
