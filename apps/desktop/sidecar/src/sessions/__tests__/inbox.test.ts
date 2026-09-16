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
  groupParentId?: string
  groupRole?: string
  messageCount?: number
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

const { InboxError, listGroupChildren, listSessionContacts, postSessionMessage } = await import(
  '../inbox.js'
)

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

// Miễn trần hop cho GIAO VIỆC dọc một cạnh của cây nhóm (cha ↔ con).
//
// Trần hop đo độ dài của MỌI chuỗi (mốc inbound + 1), không riêng ping-pong A↔B. Một
// phiên điều phối giao việc lần lượt cho BA → TL → Dev vì thế tiêu hết ngân sách sau
// hai vòng giao–báo rồi cả nhóm đứng im 30 phút. Anh em nhắn nhau ("hỏi ngang") thì
// KHÔNG được miễn — đó đúng là thứ trần hop sinh ra để chặn.
describe('postSessionMessage — giao việc cha ↔ con miễn trần hop', () => {
  // Đẩy mốc hop của `id` lên quá MAX_HOPS bằng một chuỗi qua lại với một phiên lạ.
  async function exhaustHops(id: string) {
    const other = freshId()
    summaries.push(session(other))
    // ses→other (1), other→id (2), id→other (3), other→id (4) ⇒ mốc của id là 4,
    // nên lời gửi TIẾP THEO của id tính ra hops 5 và chạm trần MAX_HOPS = 4.
    await postSessionMessage({ from: SENDER, to: other, text: 'x' })
    await postSessionMessage({ from: other, to: id, text: 'x' })
    await postSessionMessage({ from: id, to: other, text: 'x' })
    await postSessionMessage({ from: other, to: id, text: 'x' })
  }

  it('anh em nhắn nhau VẪN bị trần hop cắt', async () => {
    const parent = freshId()
    const a = freshId()
    const b = freshId()
    summaries.push(
      session(parent),
      session(a, { groupParentId: parent }),
      session(b, { groupParentId: parent }),
    )
    await exhaustHops(a)
    await expect(postSessionMessage({ from: a, to: b, text: 'hỏi ngang' })).rejects.toMatchObject({
      code: 'loop-detected',
    })
  })

  it('con báo lên CHA thì đi được dù chuỗi đã dài', async () => {
    const parent = freshId()
    const child = freshId()
    summaries.push(session(parent), session(child, { groupParentId: parent }))
    await exhaustHops(child)
    await expect(
      postSessionMessage({ from: child, to: parent, text: 'xong việc' }),
    ).resolves.toMatchObject({ to: parent })
  })

  it('cha giao xuống CON thì đi được dù chuỗi đã dài', async () => {
    const parent = freshId()
    const child = freshId()
    summaries.push(session(parent), session(child, { groupParentId: parent }))
    await exhaustHops(parent)
    await expect(
      postSessionMessage({ from: parent, to: child, text: 'làm tiếp việc này' }),
    ).resolves.toMatchObject({ to: child })
  })

  it('con NGUỘI quá 24h vẫn nhận được việc từ cha', async () => {
    // Tư cách thành viên nhóm thay thế phép thử "hoạt động trong 24h": một phiên con
    // nguội vài ngày vẫn là thành viên nhóm người dùng dựng ra.
    const parent = freshId()
    const child = freshId()
    summaries.push(
      session(parent),
      session(child, { groupParentId: parent, updatedAt: at(5 * DAY_MS) }),
    )
    await expect(
      postSessionMessage({ from: parent, to: child, text: 'việc mới' }),
    ).resolves.toMatchObject({ to: child })
  })

  it('nhưng một phiên NGUỘI ngoài nhóm thì vẫn bị từ chối', async () => {
    const cold = freshId()
    summaries.push(session(cold, { updatedAt: at(5 * DAY_MS) }))
    await expect(send(cold)).rejects.toMatchObject({ code: 'unreachable-target' })
  })

  it('giao việc KHÔNG nâng mốc hop của phiên nhận', async () => {
    // Nếu nâng, một dây chuyền giao việc sẽ đẩy mốc lên rồi lần sau phiên đó hỏi ngang
    // một phiên khác là chạm trần ngay, dù chưa trao đổi vòng nào.
    const parent = freshId()
    const child = freshId()
    const stranger = freshId()
    summaries.push(session(parent), session(child, { groupParentId: parent }), session(stranger))
    await exhaustHops(parent)
    await postSessionMessage({ from: parent, to: child, text: 'việc' })
    await expect(
      postSessionMessage({ from: child, to: stranger, text: 'hỏi nhờ' }),
    ).resolves.toMatchObject({ to: stranger })
  })
})

// Nhóm phiên (cây kiểu trang Notion) hiện ra trong danh bạ: một danh bạ chỉ có tiêu
// đề buộc model phải ĐOÁN xem trong mấy phiên tên na ná nhau thì phiên nào là người
// review. Tên nhóm = tiêu đề phiên CHA, nên nó phải giải được từ `groupParentId`.
describe('listSessionContacts — nhóm và vai', () => {
  it('phiên con mang tên nhóm của cha và vai của chính nó', async () => {
    const parent = freshId()
    const child = freshId()
    summaries.push(
      session(parent, { title: 'Ship feature X' }),
      session(child, { groupParentId: parent, groupRole: 'Reviewer' }),
    )
    const contacts = await listSessionContacts(SENDER)
    expect(contacts.find((c) => c.id === child)).toMatchObject({
      group: 'Ship feature X',
      role: 'Reviewer',
    })
  })

  it('phiên CHA cũng mang tên nhóm — chính là tiêu đề của nó', async () => {
    const parent = freshId()
    const child = freshId()
    summaries.push(
      session(parent, { title: 'Ship feature X' }),
      session(child, { groupParentId: parent }),
    )
    const contacts = await listSessionContacts(SENDER)
    expect(contacts.find((c) => c.id === parent)?.group).toBe('Ship feature X')
    // Cha không có vai: vai là thứ người dùng đặt cho THÀNH VIÊN trong nhóm.
    expect(contacts.find((c) => c.id === parent)?.role).toBeUndefined()
  })

  it('phiên không thuộc nhóm nào thì không mang field nào', async () => {
    const lone = freshId()
    summaries.push(session(lone))
    const contact = (await listSessionContacts(SENDER)).find((c) => c.id === lone)
    expect(contact?.group).toBeUndefined()
    expect(contact?.role).toBeUndefined()
  })

  it('tên nhóm đọc được kể cả khi phiên CHA đã nguội khỏi danh bạ', async () => {
    // Cha nguội 2 ngày ⇒ rơi khỏi danh bạ, nhưng con vẫn phải nói được nó thuộc nhóm
    // nào. Đây là lý do bản đồ tiêu đề dựng trên TOÀN BỘ summaries, không phải trên
    // danh bạ đã lọc.
    const parent = freshId()
    const child = freshId()
    summaries.push(
      session(parent, { title: 'Nhóm nguội', updatedAt: at(2 * DAY_MS) }),
      session(child, { groupParentId: parent }),
    )
    const contacts = await listSessionContacts(SENDER)
    expect(contacts.map((c) => c.id)).not.toContain(parent)
    expect(contacts.find((c) => c.id === child)?.group).toBe('Nhóm nguội')
  })
})

// Bảng trạng thái nhóm cho phiên CHA. Luật quan trọng nhất ở đây là thứ nó KHÔNG trả:
// không preview, không transcript — cùng một luật với danh bạ.
describe('listGroupChildren — trạng thái phiên con', () => {
  it('chỉ trả con TRỰC TIẾP, không trả cháu', async () => {
    const parent = freshId()
    const child = freshId()
    const grandchild = freshId()
    summaries.push(
      session(parent),
      session(child, { groupParentId: parent }),
      session(grandchild, { groupParentId: child }),
    )
    const rows = await listGroupChildren(parent)
    expect(rows.map((r) => r.id)).toEqual([child])
    // Nhưng vẫn nói được nhánh đó còn sâu bao nhiêu.
    expect(rows[0]?.descendants).toBe(1)
  })

  it('đánh dấu phiên con đang chạy một lượt', async () => {
    const parent = freshId()
    const busy = freshId()
    const calm = freshId()
    summaries.push(
      session(parent),
      session(busy, { groupParentId: parent }),
      session(calm, { groupParentId: parent }),
    )
    running = [busy]
    const rows = await listGroupChildren(parent)
    expect(rows.find((r) => r.id === busy)?.busy).toBe(true)
    expect(rows.find((r) => r.id === calm)?.busy).toBe(false)
  })

  it('bỏ qua phiên con đã lưu trữ', async () => {
    const parent = freshId()
    const gone = freshId()
    summaries.push(session(parent), session(gone, { groupParentId: parent, archived: true }))
    await expect(listGroupChildren(parent)).resolves.toEqual([])
  })

  it('KHÔNG trả nội dung phiên con — chỉ metadata', async () => {
    const parent = freshId()
    const child = freshId()
    summaries.push(session(parent), session(child, { groupParentId: parent, groupRole: 'Dev' }))
    const row = (await listGroupChildren(parent))[0]
    // Khoá danh sách field: thêm một field mang nội dung (preview, lastMessage…) sẽ
    // làm test này đỏ, và đó CHÍNH LÀ điều cần xảy ra — nội dung một phiên không được
    // rò sang context của phiên khác.
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'busy',
      'descendants',
      'id',
      'messageCount',
      'role',
      'title',
      'updatedAt',
    ])
  })

  it('phiên không có con thì trả mảng rỗng', async () => {
    const lone = freshId()
    summaries.push(session(lone))
    await expect(listGroupChildren(lone)).resolves.toEqual([])
  })
})

// Nhóm chỉ có HAI CẤP — kiểm ở tầng vị từ miễn trần: con-của-con không tồn tại, nên
// "cháu" luôn là anh em của ai đó và chịu trần hop như mọi trao đổi tự phát.
describe('isGroupHandoff — chỉ đi dọc cạnh cha–con', () => {
  it('anh em (cùng một cha) KHÔNG được miễn trần', async () => {
    const parent = freshId()
    const a = freshId()
    const b = freshId()
    const other = freshId()
    summaries.push(
      session(parent),
      session(a, { groupParentId: parent }),
      session(b, { groupParentId: parent }),
      session(other),
    )
    // Đẩy mốc hop của `a` lên 4 (xem exhaustHops ở describe trên).
    await postSessionMessage({ from: SENDER, to: other, text: 'x' })
    await postSessionMessage({ from: other, to: a, text: 'x' })
    await postSessionMessage({ from: a, to: other, text: 'x' })
    await postSessionMessage({ from: other, to: a, text: 'x' })
    await expect(postSessionMessage({ from: a, to: b, text: 'ngang' })).rejects.toMatchObject({
      code: 'loop-detected',
    })
  })
})
