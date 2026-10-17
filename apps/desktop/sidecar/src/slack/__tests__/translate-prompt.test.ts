import { describe, expect, it } from 'vitest'
import { buildSlackTranslatePrompt } from '../translate-prompt.js'

describe('buildSlackTranslatePrompt — phong cách + thuật ngữ', () => {
  it('mặc định = precise + giữ chữ Nhật trong ngoặc (hành vi trước khi có cài đặt)', () => {
    const p = buildSlackTranslatePrompt('Vietnamese', 'incoming', '')
    expect(p).toContain('STYLE — precise')
    expect(p).toContain('keep the original Japanese term in parentheses')
  })

  it('mỗi phong cách một chỉ dẫn riêng, cả ba vẫn cấm thêm/bớt ý', () => {
    for (const style of ['precise', 'balanced', 'natural'] as const) {
      const p = buildSlackTranslatePrompt('Vietnamese', 'incoming', '', {
        style,
        keepJapaneseTerms: true,
      })
      expect(p).toContain(`STYLE — ${style}`)
      expect(p).toContain('No additions, omissions')
    }
  })

  it('keepJapaneseTerms=false ⇒ chỉ dịch nghĩa, tên riêng vẫn giữ chữ gốc', () => {
    const p = buildSlackTranslatePrompt('Vietnamese', 'incoming', '', {
      style: 'precise',
      keepJapaneseTerms: false,
    })
    expect(p).toContain('do NOT add the original Japanese term')
    expect(p).not.toContain('keep the original Japanese term in parentheses')
    expect(p).toContain('Names stay in their ORIGINAL script')
  })

  it('chiều gửi sang tiếng Nhật: phong cách áp vào, kính ngữ thương mại luôn giữ', () => {
    for (const style of ['precise', 'balanced', 'natural'] as const) {
      const p = buildSlackTranslatePrompt('Japanese', 'outgoing', '', {
        style,
        keepJapaneseTerms: true,
      })
      expect(p).toContain(`STYLE — ${style}`)
      expect(p).toContain('敬語')
    }
  })

  it('chiều gửi sang ngôn ngữ khác tiếng Nhật dùng prompt chiều đọc với cùng cài đặt', () => {
    const p = buildSlackTranslatePrompt('English', 'outgoing', '', {
      style: 'balanced',
      keepJapaneseTerms: false,
    })
    expect(p).toContain('STYLE — balanced')
    expect(p).toContain('do NOT add the original Japanese term')
  })

  it('bảng thuật ngữ được chèn khi có', () => {
    const p = buildSlackTranslatePrompt('Vietnamese', 'incoming', '採番 = đánh số')
    expect(p).toContain('<glossary>\n採番 = đánh số\n</glossary>')
  })
})
