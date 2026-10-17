import { afterEach, describe, expect, it, vi } from 'vitest'
import { refreshOAuthTokenAt } from '../oauth.js'

function mockTokenResponse(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('token bundle expiry', () => {
  it('giữ hạn thật khi server trả expires_in', async () => {
    mockTokenResponse({ access_token: 'a', refresh_token: 'r', expires_in: 120 })
    const before = Date.now()
    const b = await refreshOAuthTokenAt('https://example.com/token', 'r0', 'cid')
    expect(b.expiresAt).toBeGreaterThanOrEqual(before + 120_000)
    expect(b.expiresAt).toBeLessThan(before + 130_000)
  })

  it('có refresh token mà thiếu expires_in ⇒ mặc định 3600s', async () => {
    mockTokenResponse({ access_token: 'a', refresh_token: 'r' })
    const before = Date.now()
    const b = await refreshOAuthTokenAt('https://example.com/token', 'r0', 'cid')
    expect(b.expiresAt).toBeGreaterThanOrEqual(before + 3_600_000)
  })

  it('Slack user token không rotation (không expires_in, không refresh) ⇒ không đặt hạn', async () => {
    mockTokenResponse({ ok: true, authed_user: { access_token: 'xoxp-1', token_type: 'user' } })
    // refreshOAuthTokenAt mang refresh token cũ sang; dùng chuỗi rỗng để mô phỏng
    // lần exchange đầu không có refresh token nào.
    const b = await refreshOAuthTokenAt('https://slack.com/api/oauth.v2.user.access', '', 'cid')
    expect(b.accessToken).toBe('xoxp-1')
    expect(b.expiresAt).toBeUndefined()
    expect(b.refreshToken).toBeUndefined()
  })
})
