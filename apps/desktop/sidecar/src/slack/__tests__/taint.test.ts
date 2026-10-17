import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../util/logger.js', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))

let home = ''
vi.mock('../../util/path.js', () => ({ awogHome: () => home }))

let threads: Array<{ sessionId: string | null }> = []
let threadsFail = false
vi.mock('../store.js', () => ({
  listThreads: async () => {
    if (threadsFail) throw new Error('EACCES')
    return threads
  },
}))

const { inheritSlackTaint, isSessionSlackTainted, markSessionSlackTainted } = await import('../taint.js')

const file = (): string => join(home, 'slack', 'tainted-sessions.json')

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-slack-taint-'))
  threads = []
  threadsFail = false
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('slack taint', () => {
  it('chưa có file ⇒ không nhiễm; đánh dấu rồi thì nhiễm mãi (ghi bền)', async () => {
    expect(await isSessionSlackTainted('ses-a')).toBe(false)
    await Promise.all([markSessionSlackTainted('ses-a'), markSessionSlackTainted('ses-b')])
    await markSessionSlackTainted('ses-a')
    expect(await isSessionSlackTainted('ses-a')).toBe(true)
    expect(await isSessionSlackTainted('ses-b')).toBe(true)
    expect(await isSessionSlackTainted('ses-c')).toBe(false)
    const disk = JSON.parse(await readFile(file(), 'utf8')) as { sessionIds: string[] }
    expect(disk.sessionIds.sort()).toEqual(['ses-a', 'ses-b'])
  })

  it('phiên đang gắn thread cũng coi là nhiễm (phiên tạo trước khi có cờ)', async () => {
    threads = [{ sessionId: 'ses-old' }]
    expect(await isSessionSlackTainted('ses-old')).toBe(true)
  })

  it('file hỏng ⇒ fail closed: mọi phiên coi là nhiễm, file KHÔNG bị cách ly', async () => {
    await mkdir(join(home, 'slack'), { recursive: true })
    await writeFile(file(), '{not json', 'utf8')
    expect(await isSessionSlackTainted('ses-any')).toBe(true)
    expect(await readFile(file(), 'utf8')).toBe('{not json')
    await writeFile(file(), JSON.stringify({ version: 1, sessionIds: ['../x'] }), 'utf8')
    expect(await isSessionSlackTainted('ses-any')).toBe(true)
  })

  it('đọc danh sách thread lỗi ⇒ fail closed', async () => {
    threadsFail = true
    expect(await isSessionSlackTainted('ses-any')).toBe(true)
  })

  it('fork thừa kế cờ của phiên cha', async () => {
    await markSessionSlackTainted('ses-parent')
    await inheritSlackTaint('ses-child', 'ses-parent')
    await inheritSlackTaint('ses-other', 'ses-clean')
    expect(await isSessionSlackTainted('ses-child')).toBe(true)
    expect(await isSessionSlackTainted('ses-other')).toBe(false)
  })

  it('từ chối id phiên lạ', async () => {
    await expect(markSessionSlackTainted('../etc')).rejects.toThrow(/invalid session id/)
  })
})
