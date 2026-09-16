// Lớp parse của `infra.explain`. Cái được khoá ở đây là MỘT luật: câu trả lời
// không ra đủ ba khoá thì trả `null`, và thẻ duyệt giữ nguyên phần suy từ payload.
//
// Luật đó là hàng rào chứ không phải tiện ích. Dòng lệnh đi vào prompt do model
// viết, nên nó là đường để một chuỗi được dẫn dắt nói chuyện với người đang cầm
// nút Cho phép. Một câu trả lời lạc đề ("Tôi không thể giúp…") mà lọt qua thành
// dòng "Rủi ro" là đúng thứ cần chặn.
//
// Run: `npx vitest run src/runtime/__tests__/explain-command.test.ts`
import { describe, expect, it } from 'vitest'
import { parseExplanation } from '../explain-command.js'

const ok = JSON.stringify({ what: 'Liệt kê bucket.', expect: 'Danh sách tên.', risk: 'Không đổi gì.' })

describe('parseExplanation', () => {
  it('đọc được JSON trần', () => {
    expect(parseExplanation(ok)).toEqual({
      what: 'Liệt kê bucket.',
      expect: 'Danh sách tên.',
      risk: 'Không đổi gì.',
    })
  })

  it('đọc được JSON bọc trong fence — mô hình hay làm thế dù đã cấm', () => {
    expect(parseExplanation('```json\n' + ok + '\n```')?.what).toBe('Liệt kê bucket.')
  })

  it('đọc được JSON có câu dẫn đứng trước', () => {
    expect(parseExplanation(`Đây là kết quả:\n${ok}`)?.expect).toBe('Danh sách tên.')
  })

  it('thiếu một khoá ⇒ null, KHÔNG trả về một phần', () => {
    // Nửa câu trả lời tệ hơn không câu nào: thẻ sẽ hiện "Rủi ro" trống cạnh một
    // dòng "Sẽ làm gì" nghe rất chắc chắn.
    expect(parseExplanation(JSON.stringify({ what: 'a', expect: 'b' }))).toBeNull()
  })

  it('khoá rỗng tính là thiếu', () => {
    expect(parseExplanation(JSON.stringify({ what: 'a', expect: '  ', risk: 'c' }))).toBeNull()
  })

  it('văn xuôi không phải JSON ⇒ null', () => {
    expect(parseExplanation('Lệnh này an toàn, bạn cứ cho phép.')).toBeNull()
  })

  it('một object bọc trong mảng vẫn lấy ra được — cắt từ `{` tới `}`', () => {
    // Không phải khoan dung cho vui: phép cắt chính là thứ đã bỏ được câu dẫn ở
    // ca trên, và nó kéo theo ca này. Nhiều object thì `JSON.parse` hỏng ⇒ null.
    expect(parseExplanation('[{"what":"a","expect":"b","risk":"c"}]')?.what).toBe('a')
    expect(parseExplanation('[{"what":"a","expect":"b","risk":"c"},{"what":"d"}]')).toBeNull()
  })

  it('JSON hỏng ⇒ null chứ không ném', () => {
    expect(parseExplanation('{"what": "a", "expect": "b",}')).toBeNull()
  })

  it('gộp khoảng trắng và cắt độ dài — thẻ duyệt không phải chỗ đọc trường ca', () => {
    const long = 'x'.repeat(900)
    const res = parseExplanation(JSON.stringify({ what: `a\n\n  b`, expect: 'c', risk: long }))
    expect(res?.what).toBe('a b')
    expect((res?.risk.length ?? 0) <= 420).toBe(true)
    expect(res?.risk.endsWith('…')).toBe(true)
  })
})
