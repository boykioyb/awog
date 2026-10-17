import { describe, expect, it } from 'vitest'
import { hostOfTeamUrl, parsePermalink } from '../permalink.js'

describe('parsePermalink', () => {
  it('đọc link tin gốc dạng /archives/<C>/p<16 số>', () => {
    expect(parsePermalink('https://malme.slack.com/archives/C01JSS5K6SE/p1790567573862209')).toEqual({
      workspaceHost: 'malme.slack.com',
      teamId: null,
      channelId: 'C01JSS5K6SE',
      messageTs: '1790567573.862209',
      threadTs: null,
    })
  })

  it('link vào reply mang thread_ts ⇒ threadTs là tin gốc', () => {
    const r = parsePermalink(
      'https://malme.slack.com/archives/C01JSS5K6SE/p1790575188326439?thread_ts=1790567573.862209&cid=C01JSS5K6SE',
    )
    expect(r?.messageTs).toBe('1790575188.326439')
    expect(r?.threadTs).toBe('1790567573.862209')
  })

  it('thread_ts sai định dạng thì bỏ qua, không nhận bừa', () => {
    const r = parsePermalink(
      'https://malme.slack.com/archives/C01JSS5K6SE/p1790575188326439?thread_ts=abc',
    )
    expect(r?.threadTs).toBeNull()
  })

  it('kênh riêng (G) và DM (D) cũng hợp lệ; host viết hoa được chuẩn hoá', () => {
    expect(parsePermalink('https://Malme.Slack.com/archives/G0123ABCD/p1790567573862209')?.channelId).toBe(
      'G0123ABCD',
    )
    expect(parsePermalink('https://malme.slack.com/archives/D0123ABCD/p1790567573862209')?.workspaceHost).toBe(
      'malme.slack.com',
    )
  })

  it('đọc link app.slack.com/client/T/C/thread/C-ts', () => {
    expect(
      parsePermalink('https://app.slack.com/client/T01JC3E81SB/C01JSS5K6SE/thread/C01JSS5K6SE-1790567573.862209'),
    ).toEqual({
      workspaceHost: null,
      teamId: 'T01JC3E81SB',
      channelId: 'C01JSS5K6SE',
      messageTs: '1790567573.862209',
      threadTs: '1790567573.862209',
    })
  })

  it.each([
    ['host giả mạo', 'https://malme.slack.com.evil.com/archives/C01JSS5K6SE/p1790567573862209'],
    ['host lạ', 'https://evil.com/archives/C01JSS5K6SE/p1790567573862209'],
    ['http', 'http://malme.slack.com/archives/C01JSS5K6SE/p1790567573862209'],
    ['ts thiếu số', 'https://malme.slack.com/archives/C01JSS5K6SE/p179056757386220'],
    ['channel chữ thường', 'https://malme.slack.com/archives/c01jss5k6se/p1790567573862209'],
    ['đường dẫn khác', 'https://malme.slack.com/messages/C01JSS5K6SE'],
    ['không phải URL', 'hello'],
    ['client thread lệch kênh', 'https://app.slack.com/client/T01JC3E81SB/C01JSS5K6SE/thread/C09XXXXXXXX-1790567573.862209'],
  ])('trả null: %s', (_label, url) => {
    expect(parsePermalink(url)).toBeNull()
  })
})

describe('hostOfTeamUrl', () => {
  it('lấy host từ auth.test.url', () => {
    expect(hostOfTeamUrl('https://malme.slack.com/')).toBe('malme.slack.com')
    expect(hostOfTeamUrl('nope')).toBeNull()
  })
})
