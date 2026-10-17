import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../credentials/keychain.js', () => ({
  getKeychainValue: vi.fn(),
  setKeychainValue: vi.fn(),
  deleteKeychainValue: vi.fn(),
}))
vi.mock('../../util/logger.js', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))

const { tokenNeedsRefresh } = await import('../oauth-store.js')

afterEach(() => {
  vi.useRealTimers()
})

describe('tokenNeedsRefresh', () => {
  it('không hạn + không refresh token (Slack user token không rotation) ⇒ không refresh', () => {
    expect(tokenNeedsRefresh({ accessToken: 'xoxp-1' })).toBe(false)
  })

  it('không hạn nhưng có refresh token ⇒ refresh để ghi hạn thật', () => {
    expect(tokenNeedsRefresh({ accessToken: 'a', refreshToken: 'r' })).toBe(true)
  })

  it('còn xa hạn ⇒ không refresh; trong cửa sổ 5 phút ⇒ refresh', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000_000)
    expect(tokenNeedsRefresh({ accessToken: 'a', expiresAt: 1_000_000_000 + 60 * 60_000 })).toBe(
      false,
    )
    expect(tokenNeedsRefresh({ accessToken: 'a', expiresAt: 1_000_000_000 + 60_000 })).toBe(true)
  })
})
