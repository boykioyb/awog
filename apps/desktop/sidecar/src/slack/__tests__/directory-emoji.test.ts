import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SlackSession } from '../session.js'

vi.mock('../../util/logger.js', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))

let home = ''
vi.mock('../../util/path.js', () => ({ awogHome: () => home }))

const { emojiImages, listCustomEmoji, resolveCustomEmoji } = await import('../directory.js')

// emoji.list: một emoji tuỳ chỉnh tên `__proto__` (tên hợp lệ trên Slack) là alias tới emoji
// chuẩn, cộng một emoji thường. Khoá tính toán ⇒ thuộc tính RIÊNG như JSON.parse tạo ra.
const EMOJI: Record<string, string> = { ['__proto__']: 'alias:thumbsup', party: 'alias:tada' }

let teamCounter = 0
function fakeSession(): SlackSession {
  teamCounter += 1
  return {
    teamId: `T00000${teamCounter}`,
    hasScope: () => true,
    api: async () => ({ ok: true, emoji: EMOJI }),
  } as unknown as SlackSession
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-slack-emoji-'))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('emoji tuỳ chỉnh — tên trùng thuộc tính của Object', () => {
  it('tên `constructor` / `toString` / `hasOwnProperty` không làm nổ, coi như không có', async () => {
    const s = fakeSession()
    const names = ['constructor', 'toString', 'hasOwnProperty', 'valueOf']
    expect(await resolveCustomEmoji(s, names)).toEqual({})
    expect(await emojiImages(s, names)).toEqual({})
  })

  it('emoji tên `__proto__` vẫn tra được như mọi emoji khác', async () => {
    const s = fakeSession()
    const got = await resolveCustomEmoji(s, ['__proto__', 'party'])
    expect(Object.hasOwn(got, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(got, '__proto__')?.value).toEqual({
      name: '__proto__',
      url: null,
      alias: 'thumbsup',
    })
    const list = await listCustomEmoji(s)
    expect(list.map((e) => e.name).sort()).toEqual(['__proto__', 'party'])
  })
})
