// Bảng ca cho bộ DỰNG bản xuất (mốc 6.5): Markdown + HTML một file.
//
// BA LỜI HỨA CỦA SPEC ĐƯỢC KHOÁ Ở ĐÂY, không phải bằng văn xuôi mà bằng phép kiểm
// trên chính chuỗi sắp được ghi ra đĩa:
//   1. HTML một file **không script, không tài nguyên ngoài** (`playbooks.md:109`).
//      "Một file" là điều kiện để bản xuất mở được ở máy người nhận không có AWOG;
//      một thẻ `<script>` hay một `<link>` là cả hai điều đó cùng lúc mất.
//   2. Markdown có sơ đồ **Mermaid** để GitHub/GitLab và `MermaidView` render thẳng.
//   3. Chân trang **bắt buộc**: sinh lúc nào · nguồn nào · trạng thái nào, cộng câu
//      nói rõ đây là ảnh chụp (`playbooks.md:130`).
// Thêm nhóm thứ tư: che/khử phải chạy TRÊN CẤU TRÚC, trước khi render — nếu chạy
// sau thì placeholder `<endpoint nội bộ>` chèn vào markup đã render và tạo ra một
// lỗ XSS do chính mình dựng.
import { describe, expect, it } from 'vitest'
import {
  applyMask,
  applyRedact,
  renderDoc,
  renderHtml,
  renderMarkdown,
  shareFilename,
} from '../kit.js'
import type { ShareDoc } from '../kit.js'

const FOOTER = {
  generatedAt: '2026-09-15T08:50:42.000Z',
  sourceLabel: 'checkout-scale',
  sourceVersion: 'pg-checkout · 2026-09-01T00:00:00.000Z',
  status: 'awaiting-approval',
}

function doc(over: Partial<ShareDoc> = {}): ShareDoc {
  return {
    title: 'Deployment plan: checkout',
    subtitle: 'Scale the checkout service',
    sections: [
      {
        title: 'Summary',
        blocks: [
          { kind: 'paragraph', text: 'Endpoint 10.0.0.5:5432 and role arn:aws:iam::229:role/Admin' },
          { kind: 'list', items: ['first', 'second'] },
          {
            kind: 'table',
            columns: ['Step', 'Task'],
            rows: [['1', 'Scale | the service']],
          },
          { kind: 'code', language: 'bash', text: 'aws ecs update-service --desired-count 4' },
          { kind: 'callout', tone: 'warn', text: 'Rollback takes about a minute.' },
        ],
      },
    ],
    diagram: { title: 'Diagram', mermaid: 'flowchart TD\n  s1["1. Scale"]' },
    footer: FOOTER,
    lang: 'en',
    ...over,
  }
}

/**
 * LUẬT "KHÔNG TÀI NGUYÊN NGOÀI" KIỂM THEO KHẢ NĂNG TẢI, KHÔNG THEO TỪ KHOÁ.
 *
 * `src=` một mình không nói lên điều gì: văn bản đã bị thoát của một khối `raw`
 * (`&lt;img src=x&gt;`) chứa đúng chuỗi đó mà hoàn toàn vô hại — nó là chữ, không
 * phải thẻ. Thứ cần chặn là **thẻ có thể kéo tài nguyên về** và **CSS gọi ra
 * ngoài**, nên phép kiểm soi đúng hai nhóm đó.
 */
function assertSelfContained(html: string): void {
  for (const tag of ['script', 'link', 'img', 'iframe', 'object', 'embed', 'source', 'video', 'audio', 'base', 'form']) {
    expect(html, `thẻ <${tag}> không được có mặt`).not.toMatch(new RegExp(`<${tag}\\b`, 'i'))
  }
  expect(html).not.toMatch(/@import/i)
  expect(html).not.toMatch(/url\(/i)
  // Mọi lần "http" xuất hiện phải là thuộc tính `http-equiv` của thẻ CSP. Một URL
  // thật ở bất kỳ đâu khác nghĩa là tệp đang trỏ ra ngoài.
  const http = html.match(/http/gi) ?? []
  const httpEquiv = html.match(/http-equiv/gi) ?? []
  expect(http).toHaveLength(httpEquiv.length)
}

describe('renderMarkdown', () => {
  it('mở bằng tiêu đề và có Mermaid cho sơ đồ', () => {
    const md = renderMarkdown(doc())
    expect(md.startsWith('# Deployment plan: checkout\n')).toBe(true)
    expect(md).toContain('```mermaid')
    expect(md).toContain('flowchart TD')
  })

  it('dựng bảng và khối lệnh', () => {
    const md = renderMarkdown(doc())
    expect(md).toContain('| Step | Task |')
    expect(md).toContain('| 1 | Scale \\| the service |')
    expect(md).toContain('```bash\naws ecs update-service --desired-count 4\n```')
  })

  it('chân trang ghi đủ ngày · nguồn · trạng thái, và nói đây là ảnh chụp', () => {
    const md = renderMarkdown(doc())
    expect(md).toContain(FOOTER.generatedAt)
    expect(md).toContain(FOOTER.sourceVersion)
    expect(md).toContain('status: awaiting-approval')
    expect(md).toContain('snapshot')
  })

  it('dịch chân trang theo `lang`, KHÔNG dịch dữ liệu chèn vào', () => {
    const md = renderMarkdown(doc({ lang: 'vi' }))
    expect(md).toContain('AWOG sinh lúc')
    expect(md).toContain('trạng thái: awaiting-approval')
    expect(md).toContain(FOOTER.generatedAt)
  })

  it('hàng rào dài hơn dãy backtick bên trong khối lệnh', () => {
    const md = renderMarkdown(
      doc({
        sections: [{ title: 'S', blocks: [{ kind: 'code', text: 'a ``` b' }] }],
      }),
    )
    expect(md).toContain('````\na ``` b\n````')
  })
})

describe('renderHtml — tệp một file, không script, không tài nguyên ngoài', () => {
  it('thoả mọi điều kiện tự-đứng-một-mình', () => {
    assertSelfContained(renderHtml(doc()))
  })

  it('khai CSP như lưới an toàn thứ hai', () => {
    const html = renderHtml(doc())
    expect(html).toContain('http-equiv="Content-Security-Policy"')
    expect(html).toContain("default-src 'none'")
  })

  it('có print stylesheet để Ctrl+P ra PDF (không thêm thư viện PDF)', () => {
    const html = renderHtml(doc())
    expect(html).toMatch(/@media print/)
    expect(html).toMatch(/@page/)
  })

  it('không nhúng mã trong bất kỳ khối nội dung nào', () => {
    const html = renderHtml(
      doc({
        sections: [
          {
            title: 'S',
            blocks: [
              { kind: 'raw', text: '<script>alert(1)</script>' },
              { kind: 'paragraph', text: '<img src=x onerror=alert(1)>' },
            ],
          },
        ],
      }),
    )
    assertSelfContained(html)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('khi chỉ có nguồn Mermaid thì rơi về khối chữ, không nhúng SVG rỗng', () => {
    const html = renderHtml(doc())
    expect(html).toContain('diagram-src')
    expect(html).toContain('flowchart TD')
  })
})

describe('sanitizeSvg (SVG đi vào từ bên gọi = dữ liệu L1)', () => {
  it('cắt script, thuộc tính on*, javascript: và foreignObject', () => {
    const html = renderHtml(
      doc({
        diagram: {
          svg:
            '<svg viewBox="0 0 10 10"><script>alert(1)</script>' +
            '<rect onload="alert(1)" width="1" height="1"/>' +
            '<a xlink:href="javascript:alert(1)"><text>x</text></a>' +
            '<foreignObject><body xmlns="http://www.w3.org/1999/xhtml">hi</body></foreignObject>' +
            '</svg>',
        },
      }),
    )
    assertSelfContained(html)
    expect(html).toContain('<svg viewBox="0 0 10 10">')
    expect(html).not.toContain('onload')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('foreignObject')
  })

  it('giữ nguyên phần vẽ hợp lệ', () => {
    const html = renderHtml(
      doc({ diagram: { svg: '<svg><path d="M0 0 L5 5"></path></svg>', title: 'Flow' } }),
    )
    expect(html).toContain('<path d="M0 0 L5 5"></path>')
    expect(html).toContain('<figcaption>Flow</figcaption>')
  })
})

describe('applyMask / applyRedact — chạy trên CẤU TRÚC, trước khi render', () => {
  it('che mọi ô của mọi khối, kể cả ô bảng và chân trang', () => {
    const masked = applyMask(
      doc({
        sections: [
          {
            title: 'S',
            blocks: [
              { kind: 'paragraph', text: 'db at 10.0.0.5' },
              { kind: 'table', columns: ['A'], rows: [['host 192.168.1.7']] },
            ],
          },
        ],
      }),
      { enabled: true },
    )
    const blocks = masked.sections[0]?.blocks ?? []
    expect(blocks[0]).toEqual({ kind: 'paragraph', text: 'db at <endpoint nội bộ>' })
    expect(blocks[1]).toEqual({ kind: 'table', columns: ['A'], rows: [['host <endpoint nội bộ>']] })
  })

  it('placeholder HTML được THOÁT, không vỡ thẻ', () => {
    const html = renderHtml(applyMask(doc(), { enabled: true }))
    expect(html).toContain('&lt;endpoint nội bộ&gt;')
    expect(html).not.toContain('<endpoint nội bộ>')
    assertSelfContained(html)
  })

  it('khử bí mật chạy SAU lớp che và bắt được token trong ghi chú', () => {
    const token = 'sk-abcdefghijklmnopqrstuvwxyz0123'
    const redacted = applyRedact(
      doc({
        sections: [
          {
            title: 'Notes',
            blocks: [
              { kind: 'paragraph', text: `token ${token} at 10.0.0.5` },
              { kind: 'list', items: [token] },
            ],
          },
        ],
      }),
    )
    const blocks = redacted.sections[0]?.blocks ?? []
    expect(JSON.stringify(blocks)).not.toContain(token)
    expect(JSON.stringify(blocks)).toContain('10.0.0.5')
  })

  it('giữ nguyên `lang` để chân trang vẫn đúng thứ tiếng', () => {
    expect(applyMask(doc({ lang: 'vi' })).lang).toBe('vi')
  })
})

describe('shareFilename — mỗi lần xuất một tệp MỚI', () => {
  it('đặt tên theo chủ đề + mốc tới giây', () => {
    expect(shareFilename('checkout-scale', 'markdown', new Date('2026-09-15T08:50:42Z'))).toBe(
      'checkout-scale-20260915-085042.md',
    )
    expect(shareFilename('checkout-scale', 'html', new Date('2026-09-15T08:50:42Z'))).toBe(
      'checkout-scale-20260915-085042.html',
    )
  })

  it('hai lần xuất trong cùng một giây KHÁC tên là điều kiện của "không ghi đè"', () => {
    const a = shareFilename('plan', 'markdown', new Date('2026-09-15T08:50:42Z'))
    const b = shareFilename('plan', 'markdown', new Date('2026-09-15T08:50:43Z'))
    expect(a).not.toBe(b)
  })

  it('bỏ dấu và ký tự lạ khỏi tên tệp', () => {
    expect(shareFilename('Kế hoạch triển khai', 'markdown', new Date('2026-09-15T08:50:42Z'))).toBe(
      'ke-hoach-trien-khai-20260915-085042.md',
    )
  })

  it('chủ đề rỗng vẫn ra một tên hợp lệ', () => {
    expect(shareFilename('###', 'markdown', new Date('2026-09-15T08:50:42Z'))).toBe(
      'export-20260915-085042.md',
    )
  })
})

describe('renderDoc', () => {
  it('đi đúng nhánh theo định dạng', () => {
    expect(renderDoc(doc(), 'markdown')).toBe(renderMarkdown(doc()))
    expect(renderDoc(doc(), 'html')).toBe(renderHtml(doc()))
  })
})
