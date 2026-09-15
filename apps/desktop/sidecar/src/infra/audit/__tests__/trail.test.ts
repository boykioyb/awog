// Phép đối chiếu CloudTrail ↔ sổ AWOG (mốc 7, 7.6).
//
// Đây là phần SUY ĐOÁN của mốc 7, nên nó là phần đáng khoá nhất. Bốn tính chất:
//   · kebab → Pascal là phép biến đổi mà toàn bộ phép ghép dựa vào,
//   · MỘT dòng sổ chỉ khớp MỘT sự kiện — không có luật đó thì một lệnh AWOG "nuốt" mọi
//     sự kiện cùng tên và hành động thật của người khác biến mất khỏi cột `external`,
//   · ngoài cửa sổ thời gian ⇒ `external`, kể cả khi trùng tên,
//   · sự kiện `awog` luôn kèm `matchedAt` để người đọc kiểm được thay vì phải tin.
//
// Run với vitest: `npx vitest run src/infra/audit/__tests__/trail.test.ts`
import { describe, expect, it } from 'vitest'
import {
  MATCH_WINDOW_MS,
  apiNameFromCliOp,
  apiNameOfAuditArgv,
  markOrigins,
} from '../trail.js'

const T0 = Date.parse('2026-09-15T10:00:00.000Z')

function ev(name: string, atMs: number, id = name) {
  return {
    id,
    at: new Date(atMs).toISOString(),
    name,
    source: 'ec2.amazonaws.com',
    username: 'kyro',
    resources: [],
  }
}

function mark(api: string, atMs: number) {
  return { at: atMs, iso: new Date(atMs).toISOString(), api }
}

describe('apiNameFromCliOp', () => {
  it('kebab → Pascal, đúng cách AWS CLI đặt tên lệnh từ tên API', () => {
    expect(apiNameFromCliOp('stop-instances')).toBe('StopInstances')
    expect(apiNameFromCliOp('put-retention-policy')).toBe('PutRetentionPolicy')
    expect(apiNameFromCliOp('describe-budgets')).toBe('DescribeBudgets')
  })

  it('một từ vẫn ra Pascal', () => {
    expect(apiNameFromCliOp('ls')).toBe('Ls')
  })

  it('gạch thừa không sinh đoạn rỗng', () => {
    expect(apiNameFromCliOp('stop--instances')).toBe('StopInstances')
  })
})

describe('apiNameOfAuditArgv', () => {
  it('lấy operation ở vị trí 1 — argv của sổ KHÔNG mang tên binary', () => {
    expect(apiNameOfAuditArgv(['ec2', 'stop-instances', '--instance-ids', 'i-1'])).toBe(
      'StopInstances',
    )
  })

  it('dòng không đủ hai phần thì không ghép được', () => {
    expect(apiNameOfAuditArgv([])).toBeNull()
    expect(apiNameOfAuditArgv(['ec2'])).toBeNull()
    // `--version` là cờ, không phải operation.
    expect(apiNameOfAuditArgv(['ec2', '--version'])).toBeNull()
  })
})

describe('markOrigins', () => {
  it('trùng tên và trong cửa sổ ⇒ awog, kèm `matchedAt` kiểm được', () => {
    const out = markOrigins([ev('StopInstances', T0)], [mark('StopInstances', T0 + 5_000)])
    expect(out[0]?.origin).toBe('awog')
    expect(out[0]?.matchedAt).toBe(new Date(T0 + 5_000).toISOString())
  })

  it('không có dòng sổ nào khớp ⇒ external, không có `matchedAt`', () => {
    const out = markOrigins([ev('StopInstances', T0)], [])
    expect(out[0]?.origin).toBe('external')
    expect(out[0]?.matchedAt).toBeUndefined()
  })

  it('trùng tên nhưng NGOÀI cửa sổ ⇒ external', () => {
    const out = markOrigins(
      [ev('StopInstances', T0)],
      [mark('StopInstances', T0 + MATCH_WINDOW_MS + 1_000)],
    )
    expect(out[0]?.origin).toBe('external')
  })

  it('đúng rìa cửa sổ vẫn tính là khớp', () => {
    const out = markOrigins([ev('StopInstances', T0)], [mark('StopInstances', T0 + MATCH_WINDOW_MS)])
    expect(out[0]?.origin).toBe('awog')
  })

  it('cửa sổ đối xứng: dòng sổ TRƯỚC sự kiện cũng khớp', () => {
    const out = markOrigins([ev('StopInstances', T0)], [mark('StopInstances', T0 - 30_000)])
    expect(out[0]?.origin).toBe('awog')
  })

  it('MỘT dòng sổ chỉ khớp MỘT sự kiện — cái thứ hai phải là external', () => {
    // Đây là ca quan trọng nhất của file: AWOG chạy MỘT lệnh, nhưng CloudTrail có HAI
    // sự kiện cùng tên trong cửa sổ. Sự kiện thứ hai là của người khác, và nó phải hiện
    // ra — đó chính là thứ màn này tồn tại để chỉ.
    const out = markOrigins(
      [ev('StopInstances', T0, 'a'), ev('StopInstances', T0 + 1_000, 'b')],
      [mark('StopInstances', T0)],
    )
    expect(out.map((e) => e.origin)).toEqual(['awog', 'external'])
  })

  it('hai lệnh AWOG thì khớp được hai sự kiện', () => {
    const out = markOrigins(
      [ev('StopInstances', T0, 'a'), ev('StopInstances', T0 + 1_000, 'b')],
      [mark('StopInstances', T0), mark('StopInstances', T0 + 1_000)],
    )
    expect(out.map((e) => e.origin)).toEqual(['awog', 'awog'])
  })

  it('tên khác nhau thì không khớp dù cùng thời điểm', () => {
    const out = markOrigins([ev('TerminateInstances', T0)], [mark('StopInstances', T0)])
    expect(out[0]?.origin).toBe('external')
  })

  it('thời gian hỏng ⇒ external, không ném', () => {
    const broken = { ...ev('StopInstances', T0), at: 'không-phải-ngày' }
    const out = markOrigins([broken], [mark('StopInstances', T0)])
    expect(out[0]?.origin).toBe('external')
  })
})
