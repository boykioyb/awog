// Bất biến: MỖI đính kèm phải để lại dấu vết trong prompt — hoặc nội dung, hoặc ít
// nhất một dòng nói rằng file tồn tại và ở đâu.
//
// Bất biến này đã VỠ (gói #12): `toClaudeDocBlock` từ chối PDF vượt trần kích
// thước, trong khi `toClaudeFileTextBlock` bỏ qua MỌI PDF bất kể block kia có được
// tạo hay không. Kết quả: một PDF lớn biến mất hoàn toàn — không block, không cả
// một dòng tham chiếu — nên model không biết là có file đó mà đi đọc bằng `Read`.
import { describe, expect, it } from 'vitest'
import { attachmentPromptBlocks } from '../run-stream.js'
import type { SessionAttachment } from '../../../types/shared.js'

// Trần là 12 MiB base64 (MAX_IMAGE_BASE64_LENGTH). Dựng đúng hai phía của nó.
const SMALL_PDF = 'JVBERi0xLjQK' + 'A'.repeat(1000)
const HUGE_PDF = 'JVBERi0xLjQK' + 'A'.repeat(12 * 1024 * 1024)

function pdf(data: string): SessionAttachment {
  return {
    type: 'file',
    name: 'spec.pdf',
    path: '/repo/docs/spec.pdf',
    url: `data:application/pdf;base64,${data}`,
  } as SessionAttachment
}

const textOf = (b: { type: string }): string =>
  b.type === 'text' ? (b as { text: string }).text : ''

describe('đính kèm PDF luôn để lại dấu vết', () => {
  it('PDF vừa cỡ → document block, KHÔNG kèm dòng tham chiếu (tránh nhân đôi)', () => {
    const blocks = attachmentPromptBlocks([pdf(SMALL_PDF)])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('document')
  })

  it('PDF QUÁ CỠ → không biến mất, rơi về dòng tham chiếu đọc theo trang', () => {
    const blocks = attachmentPromptBlocks([pdf(HUGE_PDF)])
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('text')
    const t = textOf(blocks[0] as { type: string })
    // Phải nêu đường dẫn để model đi đọc được…
    expect(t).toContain('/repo/docs/spec.pdf')
    // …và nói CÁCH đọc: câu chung chung "dùng Read" khiến model đòi cả tài liệu
    // 300 trang rồi mới biết là quá lớn.
    expect(t).toContain('page range')
  })

  it('không đính kèm ⇒ không block nào', () => {
    expect(attachmentPromptBlocks(undefined)).toEqual([])
    expect(attachmentPromptBlocks([])).toEqual([])
  })
})
