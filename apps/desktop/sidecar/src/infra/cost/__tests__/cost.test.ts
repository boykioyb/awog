// Phần THUẦN của màn Chi phí + bảng giá (mốc 7, 7.1 · 7.2).
//
// Bốn tính chất được khoá ở đây là hàng rào, không phải tiện ích:
//   · khoảng của `ce` là NỬA MỞ `[start, end)` �⇒ `end` phải là NGÀY MAI, nếu không chi
//     phí của chính hôm nay rơi ra ngoài và con số thấp hơn hoá đơn mà không ai hiểu vì sao,
//   · mọi phép quy đổi giờ → tháng đi qua MỘT hàm, nên hai phát hiện không thể dùng hai
//     số giờ khác nhau cho cùng một tháng,
//   · instance type lạ trả `null` chứ KHÔNG trả một con số đoán,
//   · loại EBS lạ rơi về `gp3` — ước lượng THẤP, không thổi lên.
//
// Run với vitest: `npx vitest run src/infra/cost/__tests__/cost.test.ts`
import { describe, expect, it } from 'vitest'
import { costPeriods } from '../cost.js'
import {
  EC2_USD_PER_HOUR,
  EIP_IDLE_USD_PER_HOUR,
  PRICING_AS_OF,
  ebsMonthlyUsd,
  ec2MonthlyUsd,
  monthlyFromHourly,
} from '../pricing.js'

describe('costPeriods', () => {
  it('kỳ này là đầu tháng → NGÀY MAI, vì `ce` dùng khoảng nửa mở', () => {
    const p = costPeriods(new Date('2026-09-15T10:00:00Z'))
    expect(p.start).toBe('2026-09-01')
    // 16, không phải 15: lấy hôm nay làm `end` là bỏ chi phí của hôm nay ra ngoài.
    expect(p.end).toBe('2026-09-16')
  })

  it('kỳ trước là trọn tháng trước', () => {
    const p = costPeriods(new Date('2026-09-15T10:00:00Z'))
    expect(p.prevStart).toBe('2026-08-01')
    expect(p.prevEnd).toBe('2026-09-01')
  })

  it('bắc qua ranh giới năm', () => {
    const p = costPeriods(new Date('2026-01-03T00:00:00Z'))
    expect(p.start).toBe('2026-01-01')
    expect(p.end).toBe('2026-01-04')
    expect(p.prevStart).toBe('2025-12-01')
    expect(p.prevEnd).toBe('2026-01-01')
  })

  it('ngày cuối tháng: `end` tràn sang tháng sau chứ không bị kẹp lại', () => {
    // 30/9 ⇒ end = 1/10. Kẹp về 30/9 là mất trọn ngày cuối của kỳ.
    const p = costPeriods(new Date('2026-09-30T23:00:00Z'))
    expect(p.end).toBe('2026-10-01')
  })

  it('dùng UTC, không dùng giờ máy', () => {
    // 01/09 lúc 00:30 UTC. Máy ở UTC-7 sẽ coi đây là 31/08 và trả kỳ của tháng 8.
    const p = costPeriods(new Date('2026-09-01T00:30:00Z'))
    expect(p.start).toBe('2026-09-01')
    expect(p.prevStart).toBe('2026-08-01')
  })
})

describe('bảng giá', () => {
  it('quy đổi giờ → tháng dùng 730 giờ, một hàm cho mọi phát hiện', () => {
    expect(monthlyFromHourly(EIP_IDLE_USD_PER_HOUR)).toBe(3.65)
    expect(monthlyFromHourly(1)).toBe(730)
  })

  it('instance type KHÔNG có trong bảng trả `null`, không trả số đoán', () => {
    expect(ec2MonthlyUsd('m7i.48xlarge')).toBeNull()
    expect(ec2MonthlyUsd('')).toBeNull()
    const known = ec2MonthlyUsd('t3.micro')
    expect(known).not.toBeNull()
    expect(known).toBeCloseTo(monthlyFromHourly(EC2_USD_PER_HOUR['t3.micro'] ?? 0), 2)
  })

  it('EBS loại lạ rơi về gp3 — ước lượng THẤP, không thổi lên', () => {
    const gp3 = ebsMonthlyUsd('gp3', 100)
    const gp2 = ebsMonthlyUsd('gp2', 100)
    expect(gp3).toBe(8)
    expect(gp2).toBe(10)
    // io2 đắt hơn gp3; một loại không biết mà rơi về io2 sẽ thổi con số lên.
    expect(ebsMonthlyUsd('gp4-khong-ton-tai', 100)).toBe(gp3)
    expect(gp3).toBeLessThan(ebsMonthlyUsd('io2', 100))
  })

  it('volume rỗng ra 0, không ra NaN', () => {
    expect(ebsMonthlyUsd('gp3', 0)).toBe(0)
  })

  it('bảng giá tự khai ngày — một bảng giá không có ngày thì không ai kiểm được', () => {
    expect(PRICING_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
