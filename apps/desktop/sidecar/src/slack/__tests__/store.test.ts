import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SlackThread } from '../types.js'

vi.mock('../../util/logger.js', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))

const store = await import('../store.js')

let home = ''
let originalHome: string | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-slack-store-'))
  originalHome = process.env.HOME
  process.env.HOME = home
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  await rm(home, { recursive: true, force: true })
})

function thread(over: Partial<SlackThread> = {}): SlackThread {
  return {
    id: 'T01JC3E81SB:C01JSS5K6SE:1790567573.862209',
    sourceId: 'slack_e37f3a78',
    teamId: 'T01JC3E81SB',
    teamName: 'Malme',
    teamUrl: 'https://malme.slack.com/',
    channelId: 'C01JSS5K6SE',
    channelName: 'general',
    threadTs: '1790567573.862209',
    title: null,
    firstLine: 'hello',
    projectId: null,
    sessionId: null,
    sessionSyncedTs: null,
    lastReplyTs: '1790575899.237659',
    lastSeenTs: '1790575899.237659',
    replyCount: 3,
    addedAt: 1,
    error: null,
    ...over,
  }
}

const file = (): string => join(home, '.awog', 'slack', 'threads.json')

describe('slack store', () => {
  it('file chưa có ⇒ rỗng', async () => {
    expect(await store.listThreads()).toEqual([])
  })

  it('insert, trùng id trả bản cũ nguyên vẹn', async () => {
    const a = await store.insertThread(thread({ title: 'gốc' }))
    expect(a.created).toBe(true)
    const b = await store.insertThread(thread({ title: 'khác' }))
    expect(b.created).toBe(false)
    expect(b.thread.title).toBe('gốc')
    const raw = JSON.parse(await readFile(file(), 'utf8')) as { version: number; threads: unknown[] }
    expect(raw.version).toBe(1)
    expect(raw.threads).toHaveLength(1)
  })

  it('mutateThread trả null ⇒ không ghi; thread vắng ⇒ ThreadNotFoundError', async () => {
    await store.insertThread(thread())
    const before = await readFile(file(), 'utf8')
    await store.mutateThread(thread().id, () => null)
    expect(await readFile(file(), 'utf8')).toBe(before)
    await expect(store.mutateThread('T01JC3E81SB:C01JSS5K6SE:1790000000.000000', (t) => t)).rejects.toBeInstanceOf(
      store.ThreadNotFoundError,
    )
  })

  it('ghi song song không mất cập nhật', async () => {
    await store.insertThread(thread({ replyCount: 0 }))
    await Promise.all(
      Array.from({ length: 10 }, () =>
        store.mutateThread(thread().id, (t) => ({ ...t, replyCount: t.replyCount + 1 })),
      ),
    )
    expect((await store.getThread(thread().id))?.replyCount).toBe(10)
  })

  it('mutateThreads trả đúng id đã đổi', async () => {
    await store.insertThread(thread())
    const other = thread({ id: 'T01JC3E81SB:C01JSS5K6SE:1790000000.000001', threadTs: '1790000000.000001' })
    await store.insertThread(other)
    const changed = await store.mutateThreads(
      new Map([
        [thread().id, (t: SlackThread) => ({ ...t, replyCount: 9 })],
        [other.id, (t: SlackThread) => t],
      ]),
    )
    expect(changed).toEqual([thread().id])
  })

  it('file hỏng ⇒ cách ly .corrupt-*, coi như rỗng, lần ghi sau không đè bản hỏng', async () => {
    await mkdir(join(home, '.awog', 'slack'), { recursive: true })
    await writeFile(file(), '{"version":1,"threads":[{"id":"bad"}]}')
    expect(await store.listThreads()).toEqual([])
    await store.insertThread(thread())
    const names = await readdir(join(home, '.awog', 'slack'))
    expect(names.some((n) => n.startsWith('threads.json.corrupt-'))).toBe(true)
    const backup = names.find((n) => n.startsWith('threads.json.corrupt-')) ?? ''
    expect(await readFile(join(home, '.awog', 'slack', backup), 'utf8')).toContain('"bad"')
  })

  it('removeThread', async () => {
    await store.insertThread(thread())
    expect(await store.removeThread(thread().id)).toBe(true)
    expect(await store.removeThread(thread().id)).toBe(false)
    expect(await store.listThreads()).toEqual([])
  })
})
