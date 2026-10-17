import { describe, expect, it } from 'vitest'
import {
  baseEmojiName,
  emojiNames,
  firstLine,
  mentionedChannels,
  mentionedUserIds,
  neutralizeDraftTokens,
  toPlainText,
} from '../mrkdwn.js'

describe('neutralizeDraftTokens', () => {
  it('đổi broadcast / usergroup / link có nhãn thành chữ, giữ mention user + kênh + URL trần', () => {
    expect(
      neutralizeDraftTokens(
        '<@U0123ABCD> <!channel> <!here|here> <!everyone> <!subteam^S0123|@devs> ' +
          '<!date^1392734382^{date}|Feb 18> <https://evil.example/x|tài liệu> ' +
          '<mailto:a@b.co|a@b.co> <#C0123ABCD|gen> <https://ok.example>',
      ),
    ).toBe(
      '<@U0123ABCD> @channel @here @everyone @devs Feb 18 tài liệu (https://evil.example/x) ' +
        'a@b.co (mailto:a@b.co) <#C0123ABCD|gen> <https://ok.example>',
    )
  })
})

describe('firstLine', () => {
  it('bỏ định dạng và lấy dòng đầu không rỗng', () => {
    expect(firstLine('\n\n*Báo cáo* _tiến độ_ ~cũ~ `x`\ndòng hai')).toBe('Báo cáo tiến độ cũ x')
  })

  it('mention dùng tên từ resolver, không có thì để id', () => {
    const resolve = (id: string) => (id === 'U0123ABCD' ? 'Fujine' : null)
    expect(firstLine('<@U0123ABCD> <@U9999ZZZZ> xin chào', resolve)).toBe('@Fujine @U9999ZZZZ xin chào')
  })

  it('kênh, link, broadcast, nhóm và entity', () => {
    expect(
      firstLine('<!here> xem <#C0123ABCD|general> và <https://ex.com|tài liệu> &lt;ok&gt; <!subteam^S1|@dev>'),
    ).toBe('@here xem #general và tài liệu <ok> @dev')
  })

  it('bỏ dấu trích dẫn đầu dòng', () => {
    expect(firstLine('&gt; trích dẫn')).toBe('trích dẫn')
  })

  it('cắt ≤120 ký tự kèm dấu …', () => {
    const out = firstLine('a'.repeat(300))
    expect(out.length).toBe(120)
    expect(out.endsWith('…')).toBe(true)
  })

  it('không ăn dấu * đứng lẻ', () => {
    expect(toPlainText('2 * 3 = 6')).toBe('2 * 3 = 6')
  })
})

describe('gom thực thể', () => {
  it('mention user, kênh (có/không tên), emoji', () => {
    const text = '<@U0123ABCD|x> <@W0123ABCD> <#C0123ABCD> <#C0123ABCD|gen> :tada: :了解: :+1::skin-tone-2:'
    expect(mentionedUserIds(text)).toEqual(['U0123ABCD', 'W0123ABCD'])
    expect(mentionedChannels(text)).toEqual([{ id: 'C0123ABCD', name: 'gen' }])
    expect(emojiNames(text)).toEqual(expect.arrayContaining(['tada', '了解', '+1']))
    expect(emojiNames(text)).not.toContain('skin-tone-2')
    expect(baseEmojiName('+1::skin-tone-2')).toBe('+1')
  })
})
