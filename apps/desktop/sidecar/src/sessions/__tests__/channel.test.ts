// sessions/channel.ts — kênh chung của một nhóm: ai bị đánh thức bởi một post
// (docs/features/session-teams.md §1.3 + §6). Đây là bảng re-trigger của
// ê-kíp: post CÓ mentions → wake đúng người được gọi; member post không
// mention → wake lead (dedup 60s, bỏ qua khi lead đang chạy); post của lead /
// người dùng / eval / note / system → không wake ai.
//
// Vì sao có file này: toàn bộ nhịp "member báo → lead nhìn lại" và "lead gọi
// tên member dậy" đi qua hai nhánh wake này. Gãy ở đây ê-kíp chỉ còn pull —
// đúng căn bệnh "giao việc mà chả thấy diễn biến".
//
// Kênh ghi THẬT vào `~/.awog/team-runs/<rootId>/channel.jsonl` trên HOME tạm;
// inbox/runner bị mock để đọc đúng ai được gọi dậy. `__resetChannelDedup`
// xoá mốc dedup 60s giữa các test.
//
// Run: `npx vitest run src/sessions/__tests__/channel.test.ts`
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  inbox: [] as { from: string | null; to: string; text: string; comm?: boolean }[],
  active: [] as string[],
  emitted: [] as { type: string; payload: unknown }[],
  sessions: [] as {
    id: string
    projectId?: string
    title?: string
    teamRunId?: string
    agent?: { id: string }
    archived?: boolean
  }[],
  board: {} as Record<
    string,
    { id: string; assigneeSessionId?: string | null; status: string }[]
  >,
}))

vi.mock('../../transport/stdio.js', () => ({
  emit: (type: string, payload: unknown) => {
    state.emitted.push({ type, payload })
  },
}))
vi.mock('../../util/logger.js', () => ({
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))

vi.mock('../inbox.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../inbox.js')>()
  return {
    ...orig,
    oneLineLabel: (s: string) => s.replace(/\s+/g, ' ').trim(),
    postSessionMessage: async (input: {
      from: string | null
      to: string
      text: string
      comm?: boolean
    }) => {
      state.inbox.push(input)
      return { id: 'im-1', ...input }
    },
  }
})

vi.mock('../runner.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../runner.js')>()
  return { ...orig, activeSessionIds: () => [...state.active] }
})

vi.mock('../store.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../store.js')>()
  return {
    ...orig,
    listSessionSummaries: async () => [...state.sessions],
  }
})

vi.mock('../../boards/store.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../boards/store.js')>()
  return {
    ...orig,
    listBoardItems: async (pid: string) => [...(state.board[pid] ?? [])],
  }
})

const { postChannelEntry, readChannelTail, mirrorCommReply, __resetChannelDedup } = await import(
  '../channel.js'
)

const ROOT = 'ses-root'

let home: string
let originalHome: string | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-channel-'))
  originalHome = process.env['HOME']
  process.env['HOME'] = home
  state.inbox = []
  state.active = []
  state.emitted = []
  state.sessions = []
  state.board = {}
  __resetChannelDedup()
})

afterEach(async () => {
  process.env['HOME'] = originalHome
  await rm(home, { recursive: true, force: true })
})

describe('wake qua mentions — gọi đúng người dậy', () => {
  it('member post có mentions → từng đích được wake, lead KHÔNG bị ping thêm', async () => {
    await postChannelEntry(ROOT, {
      from: 'ses-po',
      fromTitle: 'PO',
      kind: 'chat',
      text: '@dev check giúp phần auth',
      mentions: ['ses-dev'],
    })
    expect(state.inbox).toHaveLength(1)
    expect(state.inbox[0]).toMatchObject({ from: 'ses-po', to: 'ses-dev' })
    expect(state.inbox[0]?.text).toContain('[channel] PO')
  })

  it('tin wake dẫn team_say + item_id — reply trong phiên riêng không lên kênh', async () => {
    // Entry gắn item: chỉ dẫn phải kèm item_id để câu trả lời rơi đúng Discuss.
    await postChannelEntry(ROOT, {
      from: null,
      fromTitle: 'user',
      kind: 'chat',
      text: '@dev còn vấn đề gì không?',
      mentions: ['ses-dev'],
      itemId: 'bi-aaaaaaaaaaaaaaaa',
    })
    expect(state.inbox[0]?.text).toContain('team_say')
    expect(state.inbox[0]?.text).toContain('item_id: "bi-aaaaaaaaaaaaaaaa"')
    expect(state.inbox[0]?.text).toContain('cannot see your transcript')
    // Entry không gắn item: team_say trần, không bịa item_id.
    await postChannelEntry(ROOT, {
      from: 'ses-po',
      fromTitle: 'PO',
      kind: 'chat',
      text: '@dev hỏi chung',
      mentions: ['ses-dev'],
    })
    expect(state.inbox[1]?.text).toContain('team_say')
    expect(state.inbox[1]?.text).not.toContain('item_id')
  })

  it('wake xong ghi vạch biên nhận system — ai nhận, ai đang trong lượt', async () => {
    state.sessions = [
      { id: 'ses-dev', projectId: 'p1', title: 'Dev' },
      { id: 'ses-qa', projectId: 'p1', title: 'QA' },
    ]
    state.active = ['ses-qa'] // QA đang trong một lượt → "mid-turn"
    await postChannelEntry(ROOT, {
      from: null,
      fromTitle: 'user',
      kind: 'chat',
      text: '@dev @qa hai anh check giúp',
      mentions: ['ses-dev', 'ses-qa'],
      itemId: 'bi-aaaaaaaaaaaaaaaa',
    })
    const last = (await readChannelTail(ROOT, 4000)).at(-1)
    expect(last).toMatchObject({ from: null, fromTitle: 'system', kind: 'system' })
    expect(last?.itemId).toBe('bi-aaaaaaaaaaaaaaaa')
    expect(last?.text).toContain('delivered to "Dev"')
    expect(last?.text).toContain('"QA" is mid-turn')
  })

  it('wake của kênh đều mang cờ comm — lượt trả lời nhanh kẹp model rẻ', async () => {
    // Mention-wake…
    await postChannelEntry(ROOT, {
      from: 'ses-po',
      fromTitle: 'PO',
      kind: 'chat',
      text: '@dev check giúp',
      mentions: ['ses-dev'],
    })
    // …và lead-wake (member post không mention).
    await postChannelEntry(ROOT, { from: 'ses-po', fromTitle: 'PO', kind: 'chat', text: 'báo' })
    expect(state.inbox).toHaveLength(2)
    expect(state.inbox.every((m) => m.comm === true)).toBe(true)
  })

  it('mentions nhiều người → tất cả được wake kể cả lead nếu nằm trong list', async () => {
    await postChannelEntry(ROOT, {
      from: 'ses-po',
      fromTitle: 'PO',
      kind: 'chat',
      text: 'họp nhanh',
      mentions: ['ses-dev', 'ses-root'],
    })
    expect(state.inbox.map((m) => m.to).sort()).toEqual(['ses-dev', 'ses-root'])
  })

  it('tự mention bị lọc — chỉ còn lead-wake như post thường', async () => {
    const entry = await postChannelEntry(ROOT, {
      from: 'ses-po',
      fromTitle: 'PO',
      kind: 'chat',
      text: 'tự nhắc mình',
      mentions: ['ses-po'],
    })
    expect(entry.mentions).toBeUndefined()
    expect(state.inbox).toHaveLength(1)
    expect(state.inbox[0]?.to).toBe(ROOT)
  })

  it('mention rác (id sai hình) bị lọc trước khi ghi', async () => {
    const entry = await postChannelEntry(ROOT, {
      from: 'ses-po',
      fromTitle: 'PO',
      kind: 'chat',
      text: 'alo',
      mentions: ['DROP TABLE', 'ses-dev', 'ses-dev'],
    })
    expect(entry.mentions).toEqual(['ses-dev'])
  })
})

describe('user post — sidecar tự resolve @handles trong text', () => {
  // Composer/UI chỉ map được handle trùng title; handle dạng slug-tên-AGENT
  // của lead ("product-delivery-team-lead" vs title phiên "Product Delivery
  // Team") từng rớt sạch → mentions rỗng → tin đi im lặng không ai được gọi.
  it('@<slug-tên-agent-lead> → wake gốc qua đuôi agent.id, mentions ghi vào entry', async () => {
    state.sessions = [
      {
        id: ROOT,
        projectId: 'p1',
        title: 'Product Delivery Team',
        agent: { id: 'product-delivery-team-product-delivery-team-lead' },
      },
      {
        id: 'ses-dev',
        teamRunId: ROOT,
        title: 'Dev',
        agent: { id: 'product-delivery-team-dev' },
      },
    ]
    const entry = await postChannelEntry(ROOT, {
      from: null,
      fromTitle: 'user',
      kind: 'chat',
      text: '@product-delivery-team-lead check lại',
      itemId: 'bi-aaaaaaaaaaaaaaaa',
    })
    expect(entry.mentions).toEqual([ROOT])
    expect(state.inbox).toHaveLength(1)
    expect(state.inbox[0]).toMatchObject({ to: ROOT, comm: true })
    const receipt = (await readChannelTail(ROOT, 4000)).at(-1)
    expect(receipt).toMatchObject({ kind: 'system', itemId: 'bi-aaaaaaaaaaaaaaaa' })
    expect(receipt?.text).toContain('delivered to "Product Delivery Team"')
  })

  it('@lead trần → wake gốc; member KHÔNG bị gọi nhầm', async () => {
    state.sessions = [
      { id: ROOT, title: 'Product Delivery Team' },
      { id: 'ses-dev', teamRunId: ROOT, title: 'Dev' },
    ]
    const entry = await postChannelEntry(ROOT, {
      from: null,
      fromTitle: 'user',
      kind: 'chat',
      text: '@lead xem giúp item này',
    })
    expect(entry.mentions).toEqual([ROOT])
    expect(state.inbox.map((m) => m.to)).toEqual([ROOT])
  })

  it('handle lạ không thuộc roster → không wake ai, entry vẫn ghi', async () => {
    state.sessions = [{ id: ROOT, title: 'Product Delivery Team' }]
    const entry = await postChannelEntry(ROOT, {
      from: null,
      fromTitle: 'user',
      kind: 'chat',
      text: '@khong-ai-ca alo',
    })
    expect(entry.mentions).toBeUndefined()
    expect(state.inbox).toHaveLength(0)
  })

  it('mentions client + resolve trùng người → dedup, không wake đúp', async () => {
    state.sessions = [
      { id: ROOT, title: 'Team' },
      { id: 'ses-dev', teamRunId: ROOT, title: 'Dev', agent: { id: 'team-dev' } },
    ]
    const entry = await postChannelEntry(ROOT, {
      from: null,
      fromTitle: 'user',
      kind: 'chat',
      text: '@dev check lại',
      mentions: ['ses-dev'],
    })
    expect(entry.mentions).toEqual(['ses-dev'])
    expect(state.inbox).toHaveLength(1)
  })
})

describe('wake lead — mặc định của post member', () => {
  it('member post không mention → lead được wake một lần', async () => {
    await postChannelEntry(ROOT, {
      from: 'ses-po',
      fromTitle: 'PO',
      kind: 'status',
      text: 'item bi-1 xong phần đầu, đang chờ review',
    })
    expect(state.inbox).toHaveLength(1)
    expect(state.inbox[0]).toMatchObject({ from: 'ses-po', to: ROOT })
  })

  it('lead wake → biên nhận + marker: reply của lead mirror lên kênh tag item gốc', async () => {
    state.sessions = [
      { id: ROOT, projectId: 'p1', title: 'Lead' },
      { id: 'ses-qa', projectId: 'p1', title: 'QA' },
    ]
    await postChannelEntry(ROOT, {
      from: 'ses-qa',
      fromTitle: 'QA',
      kind: 'chat',
      text: 'đợt 1 xong: KHÔNG ĐẠT — chi tiết ở bi-aaaaaaaaaaaaaaaa',
    })
    // Biên nhận gắn item được QA nhắc (itemIds → fallback tag đầu).
    const receipt = (await readChannelTail(ROOT, 4000)).at(-1)
    expect(receipt).toMatchObject({ kind: 'system', itemId: 'bi-aaaaaaaaaaaaaaaa' })
    expect(receipt?.text).toContain('delivered to "Lead"')
    // Lead trả lời lượt comm → mirror thành 'chat' của lead, cùng item.
    await mirrorCommReply(ROOT, 'duyệt — đúng hướng, PO cập nhật slide 9')
    const mirrored = (await readChannelTail(ROOT, 4000)).at(-1)
    expect(mirrored).toMatchObject({
      from: ROOT,
      kind: 'chat',
      itemId: 'bi-aaaaaaaaaaaaaaaa',
    })
  })

  it('lead bận/dedup → KHÔNG có biên nhận (tránh spam mỗi member post)', async () => {
    state.sessions = [{ id: ROOT, projectId: 'p1', title: 'Lead' }]
    state.active = [ROOT]
    await postChannelEntry(ROOT, { from: 'ses-po', fromTitle: 'PO', kind: 'chat', text: 'báo một' })
    const tail = await readChannelTail(ROOT, 4000)
    expect(tail.at(-1)?.kind).toBe('chat') // không có entry system nào mới
  })

  it('hai post member liên tiếp trong 60s → lead chỉ bị ping MỘT lần', async () => {
    for (const text of ['báo cáo một', 'báo cáo hai']) {
      await postChannelEntry(ROOT, {
        from: 'ses-po',
        fromTitle: 'PO',
        kind: 'chat',
        text,
      })
    }
    expect(state.inbox).toHaveLength(1)
    expect(state.inbox[0]?.to).toBe(ROOT)
  })

  it('lead đang chạy → post member không tốn lượt wake (và không đánh dấu dedup)', async () => {
    state.active = [ROOT]
    await postChannelEntry(ROOT, { from: 'ses-po', fromTitle: 'PO', kind: 'chat', text: 'một' })
    expect(state.inbox).toHaveLength(0)
    // Lead xong lượt → post tiếp theo wake bình thường (mốc dedup chưa bị đốt).
    state.active = []
    await postChannelEntry(ROOT, { from: 'ses-po', fromTitle: 'PO', kind: 'chat', text: 'hai' })
    expect(state.inbox).toHaveLength(1)
  })
})

describe('các post không được wake ai', () => {
  it('post của chính lead → im lặng', async () => {
    await postChannelEntry(ROOT, { from: ROOT, fromTitle: 'Lead', kind: 'chat', text: 'điều phối' })
    expect(state.inbox).toHaveLength(0)
  })

  it('post của người dùng (from=null) → im lặng', async () => {
    await postChannelEntry(ROOT, { from: null, fromTitle: 'User', kind: 'note', text: 'ghi chú' })
    expect(state.inbox).toHaveLength(0)
  })

  it.each(['eval', 'note', 'system'] as const)("kind '%s' của member → im lặng", async (kind) => {
    await postChannelEntry(ROOT, { from: 'ses-po', fromTitle: 'PO', kind, text: 'một dòng' })
    expect(state.inbox).toHaveLength(0)
  })
})

describe('entry trên đĩa + event', () => {
  it('post ghi vào JSONL, đọc tail trả đúng thứ tự, phát channel.appended', async () => {
    await postChannelEntry(ROOT, { from: 'ses-po', fromTitle: 'PO', kind: 'chat', text: 'một' })
    await postChannelEntry(ROOT, { from: 'ses-dev', fromTitle: 'Dev', kind: 'chat', text: 'hai' })
    const tail = await readChannelTail(ROOT)
    // Bỏ entry system (biên nhận lead-wake chen giữa) — test này kiểm thứ tự
    // append của các post member.
    expect(tail.filter((e) => e.kind !== 'system').map((e) => e.text)).toEqual([
      'một',
      'hai',
    ])
  })

  it('text rỗng sau redact → throw, không ghi gì', async () => {
    await expect(
      postChannelEntry(ROOT, { from: 'ses-po', fromTitle: 'PO', kind: 'chat', text: '   ' }),
    ).rejects.toThrow('empty')
    expect(await readChannelTail(ROOT)).toHaveLength(0)
  })

  it('wake tắc không làm hỏng entry — best-effort trọn vẹn', async () => {
    const bad = await import('../inbox.js')
    vi.spyOn(bad, 'postSessionMessage').mockRejectedValueOnce(new Error('inbox dead'))
    const entry = await postChannelEntry(ROOT, {
      from: 'ses-po',
      fromTitle: 'PO',
      kind: 'chat',
      text: 'vẫn phải vào kênh',
    })
    expect(entry.id).toMatch(/^tch-/)
    // Post member + biên nhận '"…" could not be reached' — entry thật vẫn trọn vẹn.
    expect((await readChannelTail(ROOT)).filter((e) => e.kind !== 'system')).toHaveLength(1)
  })
})

describe('itemIds — tự extract bi-… từ text', () => {
  it('text nhắc id board → thẻ phụ; thẻ chính bị loại; dedup', async () => {
    const e = await postChannelEntry(ROOT, {
      from: 'ses-lead',
      fromTitle: 'Lead',
      kind: 'eval',
      text: 'Duyệt bi-54bd58cc32443e23 kèm bi-a81d804f4449e0da; nhắc lại bi-54bd58cc32443e23.',
      itemId: 'bi-e013e20dd0ff3e4b',
    })
    expect(e.itemId).toBe('bi-e013e20dd0ff3e4b')
    expect(e.itemIds).toEqual(['bi-54bd58cc32443e23', 'bi-a81d804f4449e0da'])
  })

  it('không nhắc id nào → không có field itemIds', async () => {
    const e = await postChannelEntry(ROOT, {
      from: null,
      fromTitle: 'User',
      kind: 'note',
      text: 'trao đổi chung, không gắn item',
    })
    expect(e.itemIds).toBeUndefined()
  })

  it('id quá ngắn / chữ hoa / tiền tố khác → không extract', async () => {
    const e = await postChannelEntry(ROOT, {
      from: null,
      fromTitle: 'User',
      kind: 'note',
      text: 'bi-123 và BI-AABBCCDDEEFF0011 và ci-aabbccddeeff0011 đều không phải item',
    })
    expect(e.itemIds).toBeUndefined()
  })
})

describe('itemIds — suy luận item đang làm của member', () => {
  it('member post không nhắc bi-… → tag item đang do họ đảm nhận', async () => {
    state.sessions = [{ id: 'ses-dev', projectId: 'p1' }]
    state.board = {
      p1: [
        { id: 'bi-aaaaaaaaaaaaaaaa', assigneeSessionId: 'ses-dev', status: 'in_progress' },
        { id: 'bi-bbbbbbbbbbbbbbbb', assigneeSessionId: 'ses-dev', status: 'in_review' },
        { id: 'bi-cccccccccccccccc', assigneeSessionId: 'ses-dev', status: 'backlog' },
        { id: 'bi-dddddddddddddddd', assigneeSessionId: 'ses-po', status: 'in_progress' },
      ],
    }
    const e = await postChannelEntry(ROOT, {
      from: 'ses-dev',
      fromTitle: 'Dev',
      kind: 'status',
      text: '02-architecture.md v1.2 đã khớp schema, gửi anh em khớp tiếp',
    })
    expect(e.itemIds).toEqual(['bi-aaaaaaaaaaaaaaaa', 'bi-bbbbbbbbbbbbbbbb'])
  })

  it('member có thẻ chính/nhắc bi-… → KHÔNG suy luận thêm', async () => {
    state.sessions = [{ id: 'ses-dev', projectId: 'p1' }]
    state.board = {
      p1: [{ id: 'bi-aaaaaaaaaaaaaaaa', assigneeSessionId: 'ses-dev', status: 'in_progress' }],
    }
    const tagged = await postChannelEntry(ROOT, {
      from: 'ses-dev',
      fromTitle: 'Dev',
      kind: 'chat',
      text: 'xong phần này',
      itemId: 'bi-eeeeeeeeeeeeeeee',
    })
    expect(tagged.itemIds).toBeUndefined()
    const mentioned = await postChannelEntry(ROOT, {
      from: 'ses-dev',
      fromTitle: 'Dev',
      kind: 'chat',
      text: 'xử xong bi-ffffffffffffffff luôn',
    })
    expect(mentioned.itemIds).toEqual(['bi-ffffffffffffffff'])
  })

  it('lead (from === rootId) không suy luận — điều phối nhiều item', async () => {
    state.sessions = [{ id: ROOT, projectId: 'p1' }]
    state.board = {
      p1: [{ id: 'bi-aaaaaaaaaaaaaaaa', assigneeSessionId: ROOT, status: 'in_progress' }],
    }
    const e = await postChannelEntry(ROOT, {
      from: ROOT,
      fromTitle: 'Lead',
      kind: 'eval',
      text: 'nhận định chung của ê-kíp, không gắn item',
    })
    expect(e.itemIds).toBeUndefined()
  })
})

describe('mirrorCommReply — reply của lượt comm bắt buộc lên kênh', () => {
  it('được wake bởi mention → text lượt comm ghi thành chat entry tag item gốc', async () => {
    state.sessions = [{ id: 'ses-dev', projectId: 'p1', title: 'Dev' }]
    await postChannelEntry(ROOT, {
      from: null,
      fromTitle: 'user',
      kind: 'chat',
      text: '@dev còn vấn đề gì không?',
      mentions: ['ses-dev'],
      itemId: 'bi-aaaaaaaaaaaaaaaa',
    })
    const before = await readChannelTail(ROOT, 4000)
    await mirrorCommReply('ses-dev', 'đã check — không còn vấn đề, FAIL đã về 0')
    const tail = await readChannelTail(ROOT, 4000)
    // +2: chat mirror + biên nhận lead-wake (entry mirror là member post → wake lead).
    expect(tail).toHaveLength(before.length + 2)
    const mirrored = tail.find((e) => e.from === 'ses-dev' && e.kind === 'chat')
    expect(mirrored).toMatchObject({
      from: 'ses-dev',
      fromTitle: 'Dev',
      kind: 'chat',
      itemId: 'bi-aaaaaaaaaaaaaaaa',
    })
    expect(mirrored?.text).toContain('không còn vấn đề')
  })

  it('member đã tự team_say sau mốc wake → mirror bỏ qua, không đúp', async () => {
    state.sessions = [{ id: 'ses-dev', projectId: 'p1', title: 'Dev' }]
    await postChannelEntry(ROOT, {
      from: null,
      fromTitle: 'user',
      kind: 'chat',
      text: '@dev check giúp',
      mentions: ['ses-dev'],
    })
    // Member ngoan — tự post lên kênh trong lượt.
    await postChannelEntry(ROOT, {
      from: 'ses-dev',
      fromTitle: 'Dev',
      kind: 'chat',
      text: 'xong rồi anh',
    })
    const before = await readChannelTail(ROOT, 4000)
    await mirrorCommReply('ses-dev', 'xong rồi anh — bản transcript đầy đủ hơn')
    expect(await readChannelTail(ROOT, 4000)).toHaveLength(before.length)
  })

  it('không marker (lượt comm không đến từ wake kênh) → no-op', async () => {
    state.sessions = [{ id: 'ses-dev', projectId: 'p1', title: 'Dev' }]
    const before = await readChannelTail(ROOT, 4000)
    await mirrorCommReply('ses-dev', 'tin bị lạc')
    expect(await readChannelTail(ROOT, 4000)).toHaveLength(before.length)
  })

  it('marker tiêu hao một lần — mirror kế tiếp không còn ghi', async () => {
    state.sessions = [{ id: 'ses-dev', projectId: 'p1', title: 'Dev' }]
    await postChannelEntry(ROOT, {
      from: null,
      fromTitle: 'user',
      kind: 'chat',
      text: '@dev hỏi',
      mentions: ['ses-dev'],
    })
    await mirrorCommReply('ses-dev', 'trả lời lần một')
    const mid = await readChannelTail(ROOT, 4000)
    await mirrorCommReply('ses-dev', 'trả lời lần hai')
    expect(await readChannelTail(ROOT, 4000)).toHaveLength(mid.length)
  })
})
