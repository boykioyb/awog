// Phiên ↔ issue (docs/features/session-issue-tracking.md).
//
// Vì sao có file này: đây là chỗ hệ thống TỰ ghi board thay người dùng — tạo issue
// ở lượt đầu, kéo issue về in_progress, đổi tên theo auto-title, bỏ theo dõi. Sai
// ở đây là board đầy rác (issue trùng) hoặc mất việc (xoá nhầm issue có trao đổi).
//
// Board chạy THẬT trên HOME tạm (cùng khuôn store.test.ts); sessions/store bị mock
// bằng một bản đồ phiên trong bộ nhớ — test không cần session-manager ấm.
//
// Run: `npx vitest run src/boards/__tests__/session-issue.test.ts`
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../../types/shared.js'

const emitted: { type: string; payload: unknown }[] = []
const sessions = new Map<string, Session>()

vi.mock('../../transport/stdio.js', () => ({
  emit: (type: string, payload: unknown) => {
    emitted.push({ type, payload })
  },
}))
vi.mock('../../util/logger.js', () => ({
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))
vi.mock('../../sessions/store.js', () => ({
  loadSession: async (id: string) => sessions.get(id) ?? null,
  listSessionSummaries: async () => [...sessions.values()],
  setSessionIssue: async (id: string, issueId: string | null, untracked?: boolean) => {
    const s = sessions.get(id)
    if (!s) return false
    const { issueId: _i, issueUntracked: oldU, ...rest } = s
    const next: Session = { ...rest }
    if (issueId !== null) next.issueId = issueId
    if (untracked ?? oldU === true) next.issueUntracked = true
    sessions.set(id, next)
    return true
  },
}))

const { addBoardItemComment, getBoardItem, listBoardItems, upsertBoardItem } = await import('../store.js')
const {
  detachSessionFromIssue,
  onSessionTurnStart,
  setSessionIssueByUser,
  syncIssueTitle,
  tracksIssue,
  unlinkIssueSessions,
} = await import('../session-issue.js')

let home: string
let originalHome: string | undefined

function seedSession(partial: Partial<Session> & { id: string }): Session {
  const s: Session = {
    title: 'New session',
    projectId: 'proj-a',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    invitedAgentIds: [],
    pendingAgentIds: [],
    messages: [],
    settings: { provider: 'anthropic', modelId: 'm', level: 'high', mode: 'ask' },
    ...partial,
  }
  sessions.set(s.id, s)
  return s
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-session-issue-'))
  originalHome = process.env.HOME
  process.env.HOME = home
  emitted.length = 0
  sessions.clear()
})

afterEach(async () => {
  process.env.HOME = originalHome
  await rm(home, { recursive: true, force: true })
})

describe('onSessionTurnStart', () => {
  it('lượt đầu của phiên có project: tạo issue in_progress, phiên là assignee, title từ prompt', async () => {
    seedSession({ id: 'ses-a' })
    await onSessionTurnStart('ses-a', '\n  Fix login redirect loop\nmore detail')
    const items = await listBoardItems('proj-a')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      title: 'Fix login redirect loop',
      status: 'in_progress',
      assigneeSessionId: 'ses-a',
      autoTitle: true,
    })
    expect(sessions.get('ses-a')?.issueId).toBe(items[0]?.id)
    expect(emitted.some((e) => e.type === 'session.issue')).toBe(true)
  })

  it('mô tả issue tự sinh = nguyên tin nhắn đầu, đánh dấu autoDesc', async () => {
    seedSession({ id: 'ses-a' })
    await onSessionTurnStart('ses-a', 'Fix login loop\nSteps: open /login twice')
    const [item] = await listBoardItems('proj-a')
    expect(item?.desc).toBe('Fix login loop\nSteps: open /login twice')
    expect(item?.autoDesc).toBe(true)
    // Lưu lại desc y nguyên (form editor) giữ cờ; sửa thật thì mất cờ.
    await upsertBoardItem('proj-a', { id: item?.id, desc: item?.desc })
    expect((await getBoardItem('proj-a', item?.id as string))?.autoDesc).toBe(true)
    await upsertBoardItem('proj-a', { id: item?.id, desc: 'Rewritten' })
    expect((await getBoardItem('proj-a', item?.id as string))?.autoDesc).toBeUndefined()
  })

  it('lượt thứ hai không tạo issue trùng', async () => {
    seedSession({ id: 'ses-a' })
    await onSessionTurnStart('ses-a', 'one')
    await onSessionTurnStart('ses-a', 'two')
    expect(await listBoardItems('proj-a')).toHaveLength(1)
  })

  it.each([
    ['không project', { projectId: null }],
    ['member của team run', { teamRunId: 'ses-root' }],
    ['lead của team spec', { teamId: 'team-1' }],
    ['phiên board dispatch', { origin: 'board' as const }],
    ['đã bỏ theo dõi', { issueUntracked: true }],
  ])('%s → không tạo issue', async (_label, extra) => {
    seedSession({ id: 'ses-a', ...extra })
    await onSessionTurnStart('ses-a', 'hello')
    expect(await listBoardItems('proj-a')).toHaveLength(0)
  })

  it.each(['backlog', 'todo', 'pending', 'changes', 'in_review'] as const)(
    'issue đang %s → về in_progress + vạch system',
    async (status) => {
      const item = await upsertBoardItem('proj-a', { title: 'x', status })
      seedSession({ id: 'ses-a', issueId: item.id, title: 'Work' })
      await onSessionTurnStart('ses-a', 'continue')
      const after = await getBoardItem('proj-a', item.id)
      expect(after?.status).toBe('in_progress')
      expect(after?.assigneeSessionId).toBe('ses-a')
      expect(after?.comments.at(-1)?.text).toContain(`${status} → in_progress`)
    },
  )

  it.each(['blocked', 'done', 'cancelled'] as const)(
    'issue đang %s → giữ nguyên (quyết định có chủ đích)',
    async (status) => {
      const item = await upsertBoardItem('proj-a', { title: 'x', status })
      seedSession({ id: 'ses-a', issueId: item.id })
      await onSessionTurnStart('ses-a', 'one more question')
      expect((await getBoardItem('proj-a', item.id))?.status).toBe(status)
    },
  )

  it('issue đang được người khác cầm thì không giành assignee', async () => {
    const item = await upsertBoardItem('proj-a', { title: 'x', status: 'todo', assigneeSessionId: 'ses-team' })
    seedSession({ id: 'ses-a', issueId: item.id })
    await onSessionTurnStart('ses-a', 'go')
    expect((await getBoardItem('proj-a', item.id))?.assigneeSessionId).toBe('ses-team')
  })
})

describe('onSessionTurnStart — link hỏng', () => {
  it('issueId trỏ vào item đã biến mất → gỡ link rồi sinh issue mới', async () => {
    seedSession({ id: 'ses-a', issueId: 'bi-0000000000000000' })
    await onSessionTurnStart('ses-a', 'continue')
    const items = await listBoardItems('proj-a')
    expect(items).toHaveLength(1)
    expect(sessions.get('ses-a')?.issueId).toBe(items[0]?.id)
  })

  it('issue in_progress không ai cầm → phiên chạy lượt nhận lại', async () => {
    const item = await upsertBoardItem('proj-a', { title: 'x', status: 'in_progress' })
    seedSession({ id: 'ses-a', issueId: item.id })
    await onSessionTurnStart('ses-a', 'go')
    expect((await getBoardItem('proj-a', item.id))?.assigneeSessionId).toBe('ses-a')
  })
})

describe('syncIssueTitle', () => {
  it('issue còn autoTitle → đổi theo title phiên', async () => {
    seedSession({ id: 'ses-a' })
    await onSessionTurnStart('ses-a', 'raw prompt')
    const s = sessions.get('ses-a') as Session
    await syncIssueTitle(s, 'Fix OAuth refresh')
    const item = await getBoardItem('proj-a', s.issueId as string)
    expect(item?.title).toBe('Fix OAuth refresh')
    expect(item?.autoTitle).toBe(true)
  })

  it('người dùng đã sửa title issue → không đè', async () => {
    seedSession({ id: 'ses-a' })
    await onSessionTurnStart('ses-a', 'raw prompt')
    const s = sessions.get('ses-a') as Session
    await upsertBoardItem('proj-a', { id: s.issueId, title: 'My own name' })
    await syncIssueTitle(s, 'Auto title')
    expect((await getBoardItem('proj-a', s.issueId as string))?.title).toBe('My own name')
  })

  it('lưu lại title y nguyên (form editor) không làm mất autoTitle', async () => {
    seedSession({ id: 'ses-a' })
    await onSessionTurnStart('ses-a', 'raw prompt')
    const s = sessions.get('ses-a') as Session
    await upsertBoardItem('proj-a', { id: s.issueId, title: 'raw prompt', status: 'pending' })
    expect((await getBoardItem('proj-a', s.issueId as string))?.autoTitle).toBe(true)
  })
})

describe('setSessionIssueByUser', () => {
  it('bỏ theo dõi issue tự sinh chưa ai đụng → xoá issue + đặt cờ', async () => {
    seedSession({ id: 'ses-a' })
    await onSessionTurnStart('ses-a', 'quick question')
    const res = await setSessionIssueByUser('ses-a', { untrack: true })
    expect(res?.deletedIssueId).toBeDefined()
    expect(await listBoardItems('proj-a')).toHaveLength(0)
    expect(sessions.get('ses-a')).toMatchObject({ issueUntracked: true })
    expect(sessions.get('ses-a')?.issueId).toBeUndefined()
    // Lượt sau không sinh lại.
    await onSessionTurnStart('ses-a', 'again')
    expect(await listBoardItems('proj-a')).toHaveLength(0)
  })

  it('bỏ theo dõi issue đã có trao đổi → giữ issue, chỉ gỡ link', async () => {
    seedSession({ id: 'ses-a' })
    await onSessionTurnStart('ses-a', 'real work')
    const issueId = sessions.get('ses-a')?.issueId as string
    await addBoardItemComment('proj-a', issueId, { from: null, fromTitle: 'user', text: 'note' })
    const res = await setSessionIssueByUser('ses-a', { untrack: true })
    expect(res?.deletedIssueId).toBeUndefined()
    expect(await getBoardItem('proj-a', issueId)).not.toBeNull()
  })

  // Hồi quy review B1: issue người dùng tự viết rồi mở phiên làm tiếp — bỏ theo dõi
  // phiên đó KHÔNG được xoá issue (nó không do phiên này sinh ra).
  it('bỏ theo dõi issue người dùng tự tạo (gắn qua issueId) → giữ issue', async () => {
    const item = await upsertBoardItem('proj-a', { title: 'Hand-written', status: 'todo' })
    seedSession({ id: 'ses-a', issueId: item.id })
    await onSessionTurnStart('ses-a', 'go')
    const res = await setSessionIssueByUser('ses-a', { untrack: true })
    expect(res?.deletedIssueId).toBeUndefined()
    expect(await getBoardItem('proj-a', item.id)).not.toBeNull()
  })

  // Hồi quy review #2 (Should-fix 2): issue giữ lại phải được NHẢ — không còn
  // assignee là phiên đã rời (nếu không comment/kéo cột sau này sẽ wake nó).
  it('bỏ theo dõi mà issue được giữ → gỡ assignee + lùi về pending', async () => {
    seedSession({ id: 'ses-a' })
    await onSessionTurnStart('ses-a', 'work')
    const issueId = sessions.get('ses-a')?.issueId as string
    await addBoardItemComment('proj-a', issueId, { from: null, fromTitle: 'You', text: 'paused here' })
    await setSessionIssueByUser('ses-a', { untrack: true })
    const item = await getBoardItem('proj-a', issueId)
    expect(item?.assigneeSessionId).toBeUndefined()
    expect(item?.status).toBe('pending')
  })

  it('comment của một PHIÊN tên "system" vẫn tính là trao đổi → giữ issue', async () => {
    seedSession({ id: 'ses-a' })
    await onSessionTurnStart('ses-a', 'work')
    const issueId = sessions.get('ses-a')?.issueId as string
    await addBoardItemComment('proj-a', issueId, { from: 'ses-x', fromTitle: 'system', text: 'hi' })
    const res = await setSessionIssueByUser('ses-a', { untrack: true })
    expect(res?.deletedIssueId).toBeUndefined()
  })

  it('bỏ theo dõi issue tự sinh nhưng đã có mô tả → giữ issue', async () => {
    seedSession({ id: 'ses-a' })
    await onSessionTurnStart('ses-a', 'work')
    const issueId = sessions.get('ses-a')?.issueId as string
    await upsertBoardItem('proj-a', { id: issueId, desc: 'notes the user wrote' })
    const res = await setSessionIssueByUser('ses-a', { untrack: true })
    expect(res?.deletedIssueId).toBeUndefined()
    expect(await getBoardItem('proj-a', issueId)).not.toBeNull()
  })

  it('gắn vào issue có sẵn → gỡ cờ bỏ theo dõi', async () => {
    const item = await upsertBoardItem('proj-a', { title: 'existing', status: 'pending' })
    seedSession({ id: 'ses-b', issueUntracked: true })
    const res = await setSessionIssueByUser('ses-b', { issueId: item.id })
    expect(res).toEqual({ issueId: item.id, untracked: false })
    expect(sessions.get('ses-b')?.issueUntracked).toBeUndefined()
  })

  it('gắn vào issue không tồn tại → BoardError unknown-item', async () => {
    seedSession({ id: 'ses-b' })
    await expect(setSessionIssueByUser('ses-b', { issueId: 'bi-0000000000000000' })).rejects.toMatchObject({
      code: 'unknown-item',
    })
  })
})

describe('unlinkIssueSessions', () => {
  it('xoá issue → mọi phiên trỏ vào nó mất link + bỏ theo dõi', async () => {
    const item = await upsertBoardItem('proj-a', { title: 'x' })
    seedSession({ id: 'ses-a', issueId: item.id })
    seedSession({ id: 'ses-b', issueId: item.id })
    seedSession({ id: 'ses-c' })
    const unlinked = await unlinkIssueSessions('proj-a', item.id)
    expect(unlinked.sort()).toEqual(['ses-a', 'ses-b'])
    expect(sessions.get('ses-a')).toMatchObject({ issueUntracked: true })
    expect(sessions.get('ses-c')?.issueUntracked).toBeUndefined()
  })
})

describe('detachSessionFromIssue', () => {
  it('xoá phiên có issue tự sinh còn trắng → issue bị xoá theo', async () => {
    seedSession({ id: 'ses-a', title: 'Quick' })
    await onSessionTurnStart('ses-a', 'quick')
    const s = sessions.get('ses-a') as Session
    await detachSessionFromIssue(s, 'deleted')
    expect(await getBoardItem('proj-a', s.issueId as string)).toBeNull()
  })

  it('xoá phiên duy nhất đang làm issue có trao đổi → gỡ assignee, in_progress lùi về pending', async () => {
    seedSession({ id: 'ses-a', title: 'Quick' })
    await onSessionTurnStart('ses-a', 'quick')
    const s = sessions.get('ses-a') as Session
    await addBoardItemComment('proj-a', s.issueId as string, { from: null, fromTitle: 'You', text: 'note' })
    await detachSessionFromIssue(s, 'deleted')
    const item = await getBoardItem('proj-a', s.issueId as string)
    expect(item?.assigneeSessionId).toBeUndefined()
    expect(item?.status).toBe('pending')
    expect(item?.comments.at(-1)?.text).toContain('deleted')
  })

  it('còn phiên khác làm cùng issue → giữ in_progress', async () => {
    seedSession({ id: 'ses-a' })
    await onSessionTurnStart('ses-a', 'work')
    const s = sessions.get('ses-a') as Session
    seedSession({ id: 'ses-b', issueId: s.issueId })
    await detachSessionFromIssue(s, 'deleted')
    expect((await getBoardItem('proj-a', s.issueId as string))?.status).toBe('in_progress')
  })

  it('đổi project → phiên mất link (lượt sau sinh issue mới ở project mới)', async () => {
    seedSession({ id: 'ses-a' })
    await onSessionTurnStart('ses-a', 'work')
    const before = sessions.get('ses-a') as Session
    await detachSessionFromIssue(before, 'moved')
    expect(sessions.get('ses-a')?.issueId).toBeUndefined()
    expect(sessions.get('ses-a')?.issueUntracked).toBeUndefined()
  })
})

describe('tracksIssue', () => {
  it('chỉ đúng khi phiên trỏ issueId vào chính item', () => {
    expect(tracksIssue({ issueId: 'bi-1' }, 'bi-1')).toBe(true)
    expect(tracksIssue({ issueId: 'bi-2' }, 'bi-1')).toBe(false)
    expect(tracksIssue({}, 'bi-1')).toBe(false)
    expect(tracksIssue(undefined, 'bi-1')).toBe(false)
  })
})
