import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../util/logger.js', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))

const {
  SlackApiError,
  callSlackApi,
  contentUrlAccess,
  downloadSlackFile,
  fetchSlackBytes,
  isAllowedHost,
} =
  await import('../client.js')

const TOKEN = 'xoxp-test-token-should-never-leak'

type Call = { url: string; headers: Record<string, string>; redirect: string | undefined }

function mockFetch(responses: Response[]): Call[] {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL | string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        headers: (init?.headers ?? {}) as Record<string, string>,
        redirect: init?.redirect,
      })
      const next = responses.shift()
      if (!next) throw new Error('unexpected fetch')
      return next
    }),
  )
  return calls
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isAllowedHost', () => {
  it.each([
    // Web API chỉ qua callSlackApi — URL từ payload không được trỏ tới slack.com.
    ['slack.com', false],
    ['files.slack.com', true],
    ['avatars.slack-edge.com', true],
    ['a.slack-edge.com', true],
    ['slack-edge.com.evil.com', false],
    ['evil.com', false],
    ['malme.slack.com', false],
  ])('%s → %s', (host, ok) => {
    expect(isAllowedHost(host)).toBe(ok)
  })
})

describe('callSlackApi', () => {
  it('gửi Bearer, đọc scope từ header, redirect manual', async () => {
    const calls = mockFetch([json({ ok: true, user_id: 'U1' }, { headers: { 'x-oauth-scopes': 'a:b, c:d' } })])
    const res = await callSlackApi(TOKEN, 'auth.test', {})
    expect(res.scopes).toEqual(['a:b', 'c:d'])
    expect(calls[0]?.url).toBe('https://slack.com/api/auth.test')
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(calls[0]?.redirect).toBe('manual')
  })

  it('ok:false ⇒ SlackApiError có code, message không chứa token', async () => {
    mockFetch([json({ ok: false, error: 'missing_scope', needed: 'files:read' })])
    const err = await callSlackApi(TOKEN, 'files.info', { file: 'F1' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SlackApiError)
    expect((err as InstanceType<typeof SlackApiError>).code).toBe('missing_scope')
    expect((err as InstanceType<typeof SlackApiError>).needed).toBe('files:read')
    expect(String((err as Error).message)).not.toContain(TOKEN)
  })

  it('429 ở method đọc ⇒ chờ Retry-After rồi thử lại', async () => {
    const calls = mockFetch([
      new Response('', { status: 429, headers: { 'retry-after': '1' } }),
      json({ ok: true }),
    ])
    await callSlackApi(TOKEN, 'conversations.replies', { channel: 'C1', ts: '1.1' })
    expect(calls).toHaveLength(2)
  })

  it('429 ở method ghi ⇒ KHÔNG thử lại', async () => {
    const calls = mockFetch([new Response('', { status: 429, headers: { 'retry-after': '1' } })])
    const err = await callSlackApi(TOKEN, 'chat.postMessage', { text: 'x' }, { write: true }).catch(
      (e: unknown) => e,
    )
    expect((err as InstanceType<typeof SlackApiError>).code).toBe('ratelimited')
    expect(calls).toHaveLength(1)
  })

  it('Retry-After quá dài ⇒ bỏ cuộc ngay', async () => {
    const calls = mockFetch([new Response('', { status: 429, headers: { 'retry-after': '120' } })])
    await expect(callSlackApi(TOKEN, 'users.list', {})).rejects.toMatchObject({ code: 'ratelimited' })
    expect(calls).toHaveLength(1)
  })
})

describe('fetchSlackBytes — redirect', () => {
  it('theo redirect trong allowlist; token chỉ gửi tới slack.com/files.slack.com', async () => {
    const calls = mockFetch([
      new Response(null, { status: 302, headers: { location: 'https://a.slack-edge.com/x.png' } }),
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } }),
    ])
    const out = await fetchSlackBytes('https://files.slack.com/files-tmb/T0-F0-abc/x.png', TOKEN, 1000)
    expect(out.bytes.byteLength).toBe(3)
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(calls[1]?.headers.Authorization).toBeUndefined()
  })

  it('redirect ra ngoài allowlist ⇒ dừng, không gọi host đó', async () => {
    const calls = mockFetch([
      new Response(null, { status: 302, headers: { location: 'https://evil.com/steal' } }),
    ])
    await expect(fetchSlackBytes('https://files.slack.com/x', TOKEN, 1000)).rejects.toMatchObject({
      code: 'blocked_host',
    })
    expect(calls).toHaveLength(1)
  })

  it('URL ngoài allowlist ⇒ từ chối trước khi gọi mạng', async () => {
    const calls = mockFetch([])
    await expect(fetchSlackBytes('https://evil.com/x.png', TOKEN, 1000)).rejects.toMatchObject({
      code: 'blocked_host',
    })
    expect(calls).toHaveLength(0)
  })

  it('vượt trần byte ⇒ too_large', async () => {
    mockFetch([new Response(new Uint8Array(2000), { status: 200, headers: { 'content-type': 'image/png' } })])
    await expect(fetchSlackBytes('https://a.slack-edge.com/x.png', null, 1000)).rejects.toMatchObject({
      code: 'too_large',
    })
  })
})

describe('token chỉ gắn cho file riêng tư trên files.slack.com (F1)', () => {
  it('url_private trỏ vào Web API ⇒ chặn, không có request nào mang token', async () => {
    const calls = mockFetch([])
    const evil = 'https://slack.com/api/conversations.invite?channel=C0123ABCD&users=U0EVIL001'
    await expect(fetchSlackBytes(evil, TOKEN, 1000)).rejects.toMatchObject({ code: 'blocked_host' })
    await expect(downloadSlackFile(evil, TOKEN, '/nonexistent/x.part', 1000)).rejects.toMatchObject(
      { code: 'blocked_host' },
    )
    expect(calls).toHaveLength(0)
  })

  it('files.slack.com/files-pri/... ⇒ có Bearer', async () => {
    const calls = mockFetch([
      new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/png' } }),
    ])
    await fetchSlackBytes('https://files.slack.com/files-pri/T0-F0/x.png', TOKEN, 1000)
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('files.slack.com path khác ⇒ gọi được nhưng KHÔNG token', async () => {
    const calls = mockFetch([
      new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/png' } }),
    ])
    await fetchSlackBytes('https://files.slack.com/other/x.png', TOKEN, 1000)
    expect(calls[0]?.headers.Authorization).toBeUndefined()
  })

  it('path traversal về ngoài /files-pri/ ⇒ không token', async () => {
    const calls = mockFetch([
      new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/png' } }),
    ])
    await fetchSlackBytes('https://files.slack.com/files-pri/%2e%2e/api/x', TOKEN, 1000)
    expect(calls[0]?.headers.Authorization).toBeUndefined()
  })

  it('contentUrlAccess: token chỉ cho segment `T…-F…` thật, không cho dấu phân cách mã hoá', () => {
    const access = (u: string) => contentUrlAccess(new URL(u))
    expect(access('https://files.slack.com/files-pri/T0123ABC-F0456DEF/report.pdf')).toBe('token')
    expect(access('https://files.slack.com/files-pri/T0123ABC-F0456DEF/download/report.pdf')).toBe(
      'token',
    )
    expect(access('https://files.slack.com/files-tmb/T0123ABC-F0456DEF-d2c1a0b3e4/x_360.png')).toBe(
      'token',
    )
    for (const bad of [
      'https://files.slack.com/files-pri/whatever/x.png',
      'https://files.slack.com/files-pri/T0123ABC-F0456DEF',
      'https://files.slack.com/files-pri/t0123abc-f0456def/x.png',
      'https://files.slack.com/files-pri/T0123ABC-F0456DEF/a%2Fb.png',
      'https://files.slack.com/files-pri/T0123ABC-F0456DEF/a%5cb.png',
      'https://files.slack.com/files-pri/T0123ABC-F0456DEF/%2E%2E%2fapi',
      'https://files.slack.com/files-tmb/T0123ABC-F0456DEF-d2c1/a%2e%2e/x',
    ]) {
      expect(access(bad), bad).toBe('anonymous')
    }
  })

  it('*.slack-edge.com ⇒ không token', async () => {
    const calls = mockFetch([
      new Response(new Uint8Array([1]), { status: 200, headers: { 'content-type': 'image/png' } }),
    ])
    await fetchSlackBytes('https://avatars.slack-edge.com/a.png', TOKEN, 1000)
    expect(calls[0]?.headers.Authorization).toBeUndefined()
  })

  it('redirect từ file riêng tư sang slack.com/api ⇒ chặn', async () => {
    const calls = mockFetch([
      new Response(null, {
        status: 302,
        headers: { location: 'https://slack.com/api/chat.postMessage?channel=C0123ABCD&text=x' },
      }),
    ])
    await expect(
      fetchSlackBytes('https://files.slack.com/files-pri/T0-F0/x.png', TOKEN, 1000),
    ).rejects.toMatchObject({ code: 'blocked_host' })
    expect(calls).toHaveLength(1)
  })

  it('redirect từ Web API sang CDN ⇒ theo nhưng bỏ token', async () => {
    const calls = mockFetch([
      new Response(null, {
        status: 302,
        headers: { location: 'https://a.slack-edge.com/x.json' },
      }),
      json({ ok: true }),
    ])
    await callSlackApi(TOKEN, 'auth.test', {})
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(calls[1]?.headers.Authorization).toBeUndefined()
  })
})
