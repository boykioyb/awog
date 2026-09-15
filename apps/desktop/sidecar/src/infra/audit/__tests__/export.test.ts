// Bảng ca cho bản xuất nhật ký (task 3.9).
//
// Hai thứ phải khoá lại: (1) CSV injection — argv là dữ liệu do người dùng/agent
// sinh ra, và một ô bắt đầu bằng `=`/`+`/`-`/`@` là CÔNG THỨC khi mở bằng Excel;
// (2) bản xuất không bao giờ chứa thứ không có trong nhật ký (nó không thêm cũng
// không bớt trường nào).
import { describe, expect, it } from 'vitest'
import { exportFilename, renderExport, toCsv, toJsonl } from '../export.js'
import type { InfraAuditEntry } from '../store.js'

function entry(over: Partial<InfraAuditEntry> = {}): InfraAuditEntry {
  return {
    at: '2026-09-14T01:00:00.000Z',
    actor: 'human',
    surface: 'explorer',
    tool: 'infra_view',
    argv: ['ec2', 'describe-instances'],
    context: { profile: 'dev', accountId: '123456789012', region: 'ap-southeast-1' },
    class: 'read',
    decision: 'auto',
    result: { exitCode: 0, durationMs: 412 },
    ...over,
  }
}

describe('toCsv', () => {
  it('có dòng tiêu đề + một dòng cho mỗi entry', () => {
    const csv = toCsv([entry(), entry()])
    const lines = csv.trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('at,actor,class,decision')
  })

  it('ghép argv thành một cột "command"', () => {
    expect(toCsv([entry()])).toContain('ec2 describe-instances')
  })

  it('bọc ô chứa dấu phẩy và nhân đôi dấu nháy kép', () => {
    const csv = toCsv([entry({ argv: ['s3api', 'put-object', '--key', 'a,b"c'] })])
    expect(csv).toContain('"s3api put-object --key a,b""c"')
  })

  // ⚠ CSV injection. Excel chỉ hiểu một ô là CÔNG THỨC khi KÝ TỰ ĐẦU TIÊN là
  // `=`, `+`, `-` hoặc `@` — nên payload phải rơi vào ĐẦU ô để ca này kiểm đúng
  // thứ nó định kiểm. `profile` là trường tự do, đúng chỗ một cái tên như vậy lọt vào.
  it.each(['=cmd|calc', '+1+1', '-2+3', '@SUM(A1)', '\tX'])(
    'vô hiệu công thức Excel khi payload đứng đầu ô: %j',
    (payload) => {
      const csv = toCsv([entry({ context: { profile: payload } })])
      const line = csv.trimEnd().split('\n')[1] ?? ''
      const cells = line.split(',')
      // Ô `profile` là ô thứ 8 (0-based) theo CSV_COLUMNS.
      expect(cells[7]).toContain("'")
      // Không ô nào bắt đầu bằng ký tự mở công thức.
      for (const c of cells) expect(/^[=+@]/.test(c.replace(/^"|"$/g, ''))).toBe(false)
    },
  )

  it('payload ở GIỮA ô không cần chống (Excel không hiểu là công thức)', () => {
    const csv = toCsv([entry({ argv: ['s3api', 'put-object', '--key', '=cmd'] })])
    expect(csv).toContain('s3api put-object --key =cmd')
  })

  it('ô rỗng khi thiếu trường tuỳ chọn', () => {
    const line = toCsv([entry({ context: {} })]).trimEnd().split('\n')[1] ?? ''
    // profile/accountId/region rỗng ⇒ hai dấu phẩy liền nhau, không phải "undefined".
    expect(line).not.toContain('undefined')
  })
})

describe('toJsonl', () => {
  it('mỗi dòng là một entry JSON nguyên vẹn', () => {
    const text = toJsonl([entry(), entry({ actor: 'agent:reviewer' })])
    const parsed = text.trimEnd().split('\n').map((l) => JSON.parse(l) as InfraAuditEntry)
    expect(parsed).toHaveLength(2)
    expect(parsed[1]?.actor).toBe('agent:reviewer')
  })

  it('rỗng ⇒ chuỗi rỗng', () => {
    expect(toJsonl([])).toBe('')
  })
})

describe('renderExport / exportFilename', () => {
  it('chọn đúng định dạng', () => {
    expect(renderExport([entry()], 'csv')).toContain('at,actor')
    expect(renderExport([entry()], 'jsonl')).toContain('"at":"2026-09-14T01:00:00.000Z"')
  })

  it('tên file ổn định, không dấu hai chấm', () => {
    const name = exportFilename('csv', new Date('2026-09-14T01:17:56Z'))
    expect(name).toBe('infra-audit-2026-09-14-01-17.csv')
  })
})
