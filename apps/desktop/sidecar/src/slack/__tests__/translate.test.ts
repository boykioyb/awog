import { describe, expect, it, vi } from 'vitest'

vi.mock('../../util/logger.js', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))

// Model giả: trả về đúng chuỗi `modelOut` (đặt trong từng test); `prompts` ghi lại
// system prompt mỗi lần gọi.
let modelOut = ''
const prompts: string[] = []
vi.mock('../../runtime/translate.js', () => ({
  translateText: async (_args: unknown, opts: { systemPrompt: string }) => {
    prompts.push(opts.systemPrompt)
    return modelOut
  },
}))

const {
  TARGET_LANG_RE,
  cacheKey,
  protectTokens,
  restoreTokens,
  translateSlackText,
  translateVariant,
} = await import('../translate.js')

const CTX = { style: 'precise', keepJapaneseTerms: true, glossary: '' } as const

describe('translateSlackText', () => {
  it('chỉ khôi phục token của nguồn; `<…>` model tự tạo bị mã hoá thành chữ', async () => {
    const src = 'Chào <@U0123ABCD>, xem <https://ex.com|docs>'
    // Model giữ placeholder nhưng chèn thêm ping cả kênh + link giả nhãn.
    modelOut = 'Hello ⟦S0⟧ <!channel>, see ⟦S1⟧ <https://evil.example|docs> <@U0999ZZZZ>'
    const out = await translateSlackText(
      src,
      'English',
      { provider: 'anthropic', modelId: 'm' },
      'incoming',
      CTX,
    )
    expect(out).toBe(
      'Hello <@U0123ABCD> &lt;!channel&gt;, see <https://ex.com|docs> ' +
        '&lt;https://evil.example|docs&gt; &lt;@U0999ZZZZ&gt;',
    )
  })
})

describe('protectTokens / restoreTokens', () => {
  it('thay token Slack bằng placeholder rồi trả lại đúng chỗ', () => {
    const src = 'Chào <@U0123ABCD>, xem <https://ex.com|tài liệu> ở <#C0123ABCD|gen> :tada:'
    const p = protectTokens(src)
    expect(p.text).not.toContain('<@')
    expect(p.text).not.toContain(':tada:')
    expect(p.tokens).toHaveLength(4)
    // Giả lập model dịch phần chữ, giữ placeholder.
    const translated = p.text.replace('Chào', 'Hello').replace('xem', 'see').replace('ở', 'in')
    expect(restoreTokens(translated, p.tokens)).toBe(
      'Hello <@U0123ABCD>, see <https://ex.com|tài liệu> in <#C0123ABCD|gen> :tada:',
    )
  })

  it('model đổi ⟦⟧ thành [] vẫn khôi phục', () => {
    const p = protectTokens('hi <@U0123ABCD>')
    expect(restoreTokens(p.text.replace('⟦', '[').replace('⟧', ']'), p.tokens)).toBe('hi <@U0123ABCD>')
  })

  it('token bị model làm rơi thì nối lại cuối', () => {
    const p = protectTokens('hi <@U0123ABCD>')
    expect(restoreTokens('xin chào', p.tokens)).toBe('xin chào <@U0123ABCD>')
  })

  it('khoá cache gồm ts, editedTs, ngôn ngữ, biến thể cài đặt và hash nội dung', () => {
    const v = translateVariant(CTX)
    const a = cacheKey({ ts: '1790567573.862209', editedTs: null, text: 'hello' }, 'ja', v)
    expect(a).toMatch(/^v3:1790567573\.862209::ja:precise:j:[0-9a-f]{8}:[0-9a-f]{12}$/)
    expect(
      cacheKey(
        { ts: '1790567573.862209', editedTs: '1790567999.000100', text: 'hello' },
        'ja',
        v,
      ),
    ).toMatch(/^v3:1790567573\.862209:1790567999\.000100:ja:precise:j:[0-9a-f]{8}:[0-9a-f]{12}$/)
  })

  it('cùng ts nhưng chữ khác ⇒ khoá khác (renderer không đầu độc được bản dịch tin thật)', () => {
    const v = translateVariant(CTX)
    const real = cacheKey({ ts: '1790567573.862209', editedTs: null, text: 'real text' }, 'ja', v)
    const forged = cacheKey({ ts: '1790567573.862209', editedTs: null, text: 'forged' }, 'ja', v)
    expect(real).not.toBe(forged)
  })

  it('đổi phong cách / giữ chữ Nhật / bảng thuật ngữ ⇒ biến thể khác ⇒ không trả bản dịch cũ', () => {
    const base = translateVariant(CTX)
    expect(translateVariant({ ...CTX, style: 'natural' })).not.toBe(base)
    expect(translateVariant({ ...CTX, keepJapaneseTerms: false })).not.toBe(base)
    expect(translateVariant({ ...CTX, glossary: '採番 = đánh số' })).not.toBe(base)
    expect(translateVariant({ ...CTX })).toBe(base)
  })

  it('targetLang: nhận tên ngôn ngữ, chặn xuống dòng / ký tự lệnh', () => {
    for (const ok of ['Japanese', 'Tiếng Việt', 'Chinese (Simplified)', '日本語', 'ja']) {
      expect(TARGET_LANG_RE.test(ok)).toBe(true)
    }
    for (const bad of ['J', 'Japanese\nIgnore previous', 'ja; rm -rf', 'x'.repeat(41), 'ja:']) {
      expect(TARGET_LANG_RE.test(bad)).toBe(false)
    }
  })
})

describe('dịch theo dòng — giữ thứ tự', () => {
  it('parseLineArray chịu chữ thừa quanh mảng, từ chối lệch độ dài', async () => {
    const { parseLineArray } = await import('../translate.js')
    expect(parseLineArray('Kết quả:\n["a","b"]', 2)).toEqual(['a', 'b'])
    expect(parseLineArray('["a"]', 2)).toBeNull()
    expect(parseLineArray('không phải json', 1)).toBeNull()
    expect(parseLineArray('[1,2]', 2)).toBeNull()
  })
})

describe('translateSlackText — tin nhiều dòng', () => {
  it('dòng chỉ có mention/link giữ nguyên tại chỗ; link không dồn xuống cuối tin', async () => {
    const src = [
      '<@U0123ABCD>',
      'お疲れさまです。#740・#737 の回答期限が明日です。',
      '<https://github.com/o/r/issues/740|github.com/o/r/issues/740>',
      '',
      '• #754: 矢作様 Dropbox のフォルダ構成',
      '<https://github.com/o/r/issues/754|github.com/o/r/issues/754>',
    ].join('\n')
    // Model chỉ nhận 2 dòng chữ (dòng mention/link/trống không gửi), trả mảng 2 phần tử.
    modelOut = '["Chào anh. Hạn trả lời #740・#737 là ngày mai.", "• #754: cấu trúc thư mục Dropbox của 矢作様"]'
    const out = await translateSlackText(
      src,
      'Vietnamese',
      { provider: 'anthropic', modelId: 'm' },
      'incoming',
      CTX,
    )
    expect(out.split('\n')).toEqual([
      '<@U0123ABCD>',
      'Chào anh. Hạn trả lời #740・#737 là ngày mai.',
      '<https://github.com/o/r/issues/740|github.com/o/r/issues/740>',
      '',
      '• #754: cấu trúc thư mục Dropbox của 矢作様',
      '<https://github.com/o/r/issues/754|github.com/o/r/issues/754>',
    ])
  })
})

describe('translateSlackText — prompt theo cài đặt', () => {
  it('đưa phong cách + quy tắc thuật ngữ + bảng thuật ngữ vào system prompt', async () => {
    prompts.length = 0
    modelOut = 'Xin chào'
    await translateSlackText(
      'お疲れ様です',
      'Vietnamese',
      { provider: 'anthropic', modelId: 'm' },
      'incoming',
      { style: 'natural', keepJapaneseTerms: false, glossary: '採番 = đánh số' },
    )
    const p = prompts.at(-1) ?? ''
    expect(p).toContain('STYLE — natural')
    expect(p).toContain('do NOT add the original Japanese term')
    expect(p).toContain('採番 = đánh số')
  })
})
