// Tests cho cron.ts — parser biểu thức lịch + tính mốc chạy kế tiếp.
//
// Chạy: `npx vitest@2 run src/schedules/__tests__/cron.test.ts` (vitest chưa nằm
// trong devDeps của sidecar — xem git/__tests__/discover.test.ts).
//
// Múi giờ được ghim về America/New_York cho toàn bộ file: các ca DST cần một
// vùng CÓ đổi giờ mới kiểm được, và cron.ts đọc giờ địa phương của tiến trình.
// Node đọc lại TZ ở lần dùng Date kế tiếp, nên gán trước mọi test là đủ.
process.env.TZ = 'America/New_York'

import { describe, expect, it } from 'vitest'
import {
  CATCH_UP_THRESHOLD_MS,
  computeNextRun,
  isDue,
  parseTimeOfDay,
  reanchorAfterRun,
} from '../cron.js'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

// Mốc local → epoch ms, dùng để dựng dữ liệu vào cho dễ đọc.
const local = (y: number, mo: number, d: number, h = 0, mi = 0): number =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

// Bộ ba (ngày, giờ, phút) theo giờ địa phương của một mốc epoch.
const parts = (ms: number) => {
  const d = new Date(ms)
  return { date: d.getDate(), month: d.getMonth() + 1, hours: d.getHours(), minutes: d.getMinutes() }
}

describe('parseTimeOfDay', () => {
  it('accepts a 24h HH:MM', () => {
    expect(parseTimeOfDay('00:00')).toEqual({ hours: 0, minutes: 0 })
    expect(parseTimeOfDay('09:05')).toEqual({ hours: 9, minutes: 5 })
    expect(parseTimeOfDay('23:59')).toEqual({ hours: 23, minutes: 59 })
  })

  it('rejects out-of-range and malformed input', () => {
    for (const bad of ['24:00', '9:05', '09:60', '0905', '', 'ab:cd', '09:05:00']) {
      expect(parseTimeOfDay(bad)).toBeNull()
    }
  })
})

describe('computeNextRun — interval', () => {
  it('adds the interval in real milliseconds', () => {
    const from = local(2026, 6, 10, 8, 0)
    expect(computeNextRun({ kind: 'interval', everyMinutes: 30 }, from)).toBe(from + 30 * MINUTE)
    expect(computeNextRun({ kind: 'interval', everyMinutes: 120 }, from)).toBe(from + 2 * HOUR)
  })

  it('is immune to the DST jump — "every hour" stays one real hour', () => {
    // 2026-03-08 01:30 EST + 1h = 03:30 EDT: đồng hồ tường nhảy 2 tiếng, nhưng
    // thời gian trôi đúng một tiếng. Đó chính là ý nghĩa của "mỗi N phút".
    const from = local(2026, 3, 8, 1, 30)
    const next = computeNextRun({ kind: 'interval', everyMinutes: 60 }, from)
    expect(next).toBe(from + HOUR)
    expect(parts(next as number)).toMatchObject({ month: 3, date: 8, hours: 3, minutes: 30 })
  })

  it('rejects a non-finite anchor', () => {
    expect(computeNextRun({ kind: 'interval', everyMinutes: 5 }, Number.NaN)).toBeNull()
  })
})

describe('computeNextRun — daily', () => {
  it('picks today when the time is still ahead', () => {
    const from = local(2026, 6, 10, 7, 0)
    const next = computeNextRun({ kind: 'daily', time: '09:30' }, from)
    expect(next).toBe(local(2026, 6, 10, 9, 30))
  })

  it('rolls to tomorrow when the time has passed', () => {
    const from = local(2026, 6, 10, 10, 0)
    expect(computeNextRun({ kind: 'daily', time: '09:30' }, from)).toBe(local(2026, 6, 11, 9, 30))
  })

  it('never returns the anchor itself (exactly-on-time rolls forward)', () => {
    const from = local(2026, 6, 10, 9, 30)
    const next = computeNextRun({ kind: 'daily', time: '09:30' }, from)
    expect(next).toBeGreaterThan(from)
    expect(next).toBe(local(2026, 6, 11, 9, 30))
  })

  it('crosses a month boundary', () => {
    const from = local(2026, 6, 30, 23, 0)
    expect(computeNextRun({ kind: 'daily', time: '08:00' }, from)).toBe(local(2026, 7, 1, 8, 0))
  })

  it('DST spring-forward: a wall time that does not exist runs late, not never', () => {
    // 2026-03-08 lúc 02:00 EST đồng hồ nhảy thẳng lên 03:00 EDT → 02:30 không
    // tồn tại. Kết quả phải rơi vào ĐÚNG NGÀY ĐÓ lúc 03:30, chứ không nhảy cóc
    // sang hôm sau (mất một lần chạy).
    const from = local(2026, 3, 7, 12, 0)
    const next = computeNextRun({ kind: 'daily', time: '02:30' }, from)
    expect(next).not.toBeNull()
    expect(parts(next as number)).toMatchObject({ month: 3, date: 8, hours: 3, minutes: 30 })
    expect(next).toBeGreaterThan(from)
  })

  it('DST fall-back: the repeated wall time fires once, not twice', () => {
    // 2026-11-01 lúc 02:00 EDT đồng hồ lùi về 01:00 EST → 01:30 xảy ra hai lần.
    const from = local(2026, 10, 31, 12, 0)
    const first = computeNextRun({ kind: 'daily', time: '01:30' }, from) as number
    expect(parts(first)).toMatchObject({ month: 11, date: 1, hours: 1, minutes: 30 })

    // Neo lại từ lần chạy đó: mốc kế tiếp phải là NGÀY HÔM SAU, không phải lần
    // 01:30 thứ hai (cách đúng 1 tiếng) của cùng ngày.
    const second = computeNextRun({ kind: 'daily', time: '01:30' }, first) as number
    expect(parts(second)).toMatchObject({ month: 11, date: 2, hours: 1, minutes: 30 })
    expect(second - first).toBeGreaterThan(24 * HOUR)
  })

  it('DST fall-back: an anchor between the two 01:30s still skips the second', () => {
    const between = local(2026, 11, 1, 1, 30) + 15 * MINUTE
    const next = computeNextRun({ kind: 'daily', time: '01:30' }, between) as number
    expect(parts(next)).toMatchObject({ month: 11, date: 2, hours: 1, minutes: 30 })
  })

  it('the day the clocks go back is 25 hours long and daily still means daily', () => {
    const from = local(2026, 10, 31, 12, 0)
    const a = computeNextRun({ kind: 'daily', time: '12:00' }, from) as number
    const b = computeNextRun({ kind: 'daily', time: '12:00' }, a) as number
    // Chặng 31/10 12:00 → 01/11 12:00 vắt qua mốc lùi giờ (02:00 EDT → 01:00
    // EST) nên dài 25 tiếng thật; chặng sau đó trở lại 24 tiếng. Cả hai vẫn là
    // "12:00 hôm sau" — đó là điều người dùng đặt lịch mong đợi.
    expect(a - from).toBe(25 * HOUR)
    expect(b - a).toBe(24 * HOUR)
    expect(parts(b)).toMatchObject({ month: 11, date: 2, hours: 12, minutes: 0 })
  })

  it('rejects a malformed time', () => {
    expect(computeNextRun({ kind: 'daily', time: '25:00' }, local(2026, 6, 10))).toBeNull()
  })
})

describe('computeNextRun — weekly', () => {
  // 2026-06-10 là thứ Tư (getDay() === 3).
  const wednesday = local(2026, 6, 10, 12, 0)

  it('finds the next matching weekday', () => {
    expect(new Date(wednesday).getDay()).toBe(3)
    const next = computeNextRun({ kind: 'weekly', weekdays: [1], time: '09:00' }, wednesday)
    expect(next).toBe(local(2026, 6, 15, 9, 0)) // thứ Hai kế tiếp
    expect(new Date(next as number).getDay()).toBe(1)
  })

  it('uses today when today matches and the time is still ahead', () => {
    const from = local(2026, 6, 10, 8, 0)
    const next = computeNextRun({ kind: 'weekly', weekdays: [3], time: '09:00' }, from)
    expect(next).toBe(local(2026, 6, 10, 9, 0))
  })

  it('rolls a full week when today matches but the time has passed', () => {
    const next = computeNextRun({ kind: 'weekly', weekdays: [3], time: '09:00' }, wednesday)
    expect(next).toBe(local(2026, 6, 17, 9, 0))
  })

  it('takes the nearest of several weekdays', () => {
    const trigger = { kind: 'weekly', weekdays: [1, 3, 5], time: '09:00' } as const
    // Thứ Tư 12:00 → thứ Sáu 09:00.
    expect(computeNextRun(trigger, wednesday)).toBe(local(2026, 6, 12, 9, 0))
    // Thứ Sáu 12:00 → thứ Hai 09:00 (vắt qua cuối tuần).
    expect(computeNextRun(trigger, local(2026, 6, 12, 12, 0))).toBe(local(2026, 6, 15, 9, 0))
  })

  it('handles Sunday (weekday 0) without treating it as falsy', () => {
    const next = computeNextRun({ kind: 'weekly', weekdays: [0], time: '07:00' }, wednesday)
    expect(new Date(next as number).getDay()).toBe(0)
    expect(next).toBe(local(2026, 6, 14, 7, 0))
  })

  it('returns null for an empty weekday set instead of scanning forever', () => {
    expect(computeNextRun({ kind: 'weekly', weekdays: [], time: '09:00' }, wednesday)).toBeNull()
  })
})

describe('isDue', () => {
  const now = local(2026, 6, 10, 12, 0)

  it('is true at and after the mark, false before', () => {
    expect(isDue(now - 1, now)).toBe(true)
    expect(isDue(now, now)).toBe(true)
    expect(isDue(now + 1, now)).toBe(false)
  })

  it('is false without a mark', () => {
    expect(isDue(null, now)).toBe(false)
  })
})

describe('reanchorAfterRun — chính sách chạy bù', () => {
  it('re-anchors an interval from NOW, so a slept machine runs once, not N times', () => {
    // Lịch 15 phút, máy ngủ 3 tiếng: đúng một lần chạy bù rồi trở lại nhịp cũ
    // tính từ bây giờ — chứ không phải 12 lần dồn toa.
    const missedAt = local(2026, 6, 10, 8, 0)
    const now = missedAt + 3 * HOUR
    expect(reanchorAfterRun({ kind: 'interval', everyMinutes: 15 }, now)).toBe(now + 15 * MINUTE)
  })

  it('re-anchors a daily schedule to the next occurrence after NOW', () => {
    // Lỡ mốc 03:00 của hôm 10/6, máy mở lúc 11:00 ngày 12/6 → chạy bù một lần,
    // mốc kế tiếp là 03:00 ngày 13/6 (không phải 03:00 ngày 11/6 đã trôi qua).
    const now = local(2026, 6, 12, 11, 0)
    expect(reanchorAfterRun({ kind: 'daily', time: '03:00' }, now)).toBe(local(2026, 6, 13, 3, 0))
  })

  it('flags a real catch-up but not an ordinary tick delay', () => {
    const due = local(2026, 6, 10, 8, 0)
    expect(due + 30_000 - due > CATCH_UP_THRESHOLD_MS).toBe(false) // trễ 1 nhịp tick
    expect(due + 6 * HOUR - due > CATCH_UP_THRESHOLD_MS).toBe(true) // vừa ngủ dậy
  })
})
