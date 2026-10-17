import { describe, expect, it } from 'vitest'
import { EMOJI_RE, THREAD_ID_RE, splitThreadId } from '../params.js'
import { maxTs, tsAfter } from '../store.js'

describe('params', () => {
  it('threadId ghép 3 phần', () => {
    expect(splitThreadId('T01JC3E81SB:C01JSS5K6SE:1790567573.862209')).toEqual({
      teamId: 'T01JC3E81SB',
      channelId: 'C01JSS5K6SE',
      threadTs: '1790567573.862209',
    })
    expect(THREAD_ID_RE.test('T01JC3E81SB:C01JSS5K6SE:../../etc')).toBe(false)
  })

  it('tên emoji: chữ Nhật + tông da hợp lệ; ký tự đường dẫn thì không', () => {
    expect(EMOJI_RE.test('了解')).toBe(true)
    expect(EMOJI_RE.test('+1::skin-tone-3')).toBe(true)
    expect(EMOJI_RE.test('a/b')).toBe(false)
    expect(EMOJI_RE.test('..')).toBe(false)
    expect(EMOJI_RE.test('Tada')).toBe(false)
  })

  it('so ts chính xác tới micro-giây', () => {
    expect(tsAfter('1790567573.862210', '1790567573.862209')).toBe(true)
    expect(tsAfter('1790567573.862209', '1790567573.862209')).toBe(false)
    expect(maxTs('1790567573.000001', '1790567572.999999')).toBe('1790567573.000001')
  })
})
