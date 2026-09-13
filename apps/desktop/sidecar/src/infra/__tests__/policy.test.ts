// Bảng ca cho `decide()` — ADR 0088 §5, §5b (task 0.7).
//
// `classify()` trả lời "lệnh này thuộc loại nào"; file này khoá lại câu sau đó:
// loại đó, trên loại tài khoản đó, thì chạy thẳng · hỏi người · hay chặn. Ba bất
// biến quan trọng hơn cả bảng mặc định, vì chúng là thứ ngăn cổng quyền tự mở
// khoá cho chính nó:
//   1. bypass tạm thời chỉ nâng `ask → auto`, KHÔNG BAO GIỜ gỡ `block`;
//   2. bypass hết hạn thì quay về ma trận, không cần ai dọn;
//   3. phiên chỉ SIẾT được, không nới được (Settings là trần).
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MATRIX,
  accountKindOf,
  decide,
  defaultPolicy,
  strictest,
} from '../policy.js'
import type { InfraAccountKind, InfraMode, InfraPolicy } from '../policy.js'
import type { InfraCommandClass } from '../types.js'

const NOW = Date.parse('2026-09-12T10:00:00.000Z')

function policy(patch: Partial<InfraPolicy> = {}): InfraPolicy {
  return { ...defaultPolicy(), ...patch }
}

/** Mốc bypass cách `NOW` đúng `minutes` phút (âm = đã hết hạn). */
function bypassUntil(minutes: number): string {
  return new Date(NOW + minutes * 60_000).toISOString()
}

describe('ma trận mặc định', () => {
  // Bốn lớp × hai cột, viết tường minh thay vì đọc lại `DEFAULT_MATRIX`: đổi một
  // ô mặc định là đổi quyền trên tài khoản thật, nên nó phải làm đỏ một test.
  it.each<[InfraCommandClass, InfraAccountKind, InfraMode]>([
    ['read', 'normal', 'auto'],
    ['read', 'production', 'auto'],
    ['write', 'normal', 'ask'],
    ['write', 'production', 'ask'],
    ['destructive', 'normal', 'ask'],
    ['destructive', 'production', 'block'],
    ['context-switch', 'normal', 'auto'],
    ['context-switch', 'production', 'ask'],
  ])('%s trên tài khoản %s → %s', (cls, kind, expected) => {
    const p = policy(kind === 'production' ? { prodAccountIds: ['111122223333'] } : {})
    const result = decide({
      policy: p,
      class: cls,
      accountId: kind === 'production' ? '111122223333' : '999988887777',
      now: NOW,
    })
    expect(result.mode).toBe(expected)
    expect(result.accountKind).toBe(kind)
    expect(result.reason).toBe('matrix')
  })

  // ⚠ Đảo sau infosec audit #1 (F6). Ca này TRƯỚC ĐÂY khẳng định "không biết
  // account ⇒ cột thường" — tức fail-open theo mặc định: `infra.contexts` không
  // biết account id của profile static, nên ô `destructive/production = block`
  // gần như không bao giờ được áp. Không biết mình đang ở đâu thì phải coi là
  // đang ở chỗ nguy hiểm nhất.
  it('không biết accountId thì coi như production (fail-safe)', () => {
    const p = defaultPolicy()
    expect(accountKindOf(p, undefined)).toBe('production')
    expect(accountKindOf(p, '')).toBe('production')
    expect(decide({ policy: p, class: 'destructive' }).mode).toBe('block')
  })

  it('accountKindOf đọc đúng danh sách production', () => {
    const p = { ...defaultPolicy(), prodAccountIds: ['111122223333'] }
    expect(accountKindOf(p, '111122223333')).toBe('production')
    // Account ĐÃ BIẾT mà không nằm trong danh sách ⇒ thường. Khác hẳn ca "không
    // biết là account nào" ở trên.
    expect(accountKindOf(p, '999988887777')).toBe('normal')
  })
})

describe('account đánh dấu production', () => {
  it('cùng một lệnh phá huỷ: hỏi ở tài khoản thường, CHẶN ở production', () => {
    const p = policy({ prodAccountIds: ['111122223333'] })
    expect(decide({ policy: p, class: 'destructive', accountId: '999988887777', now: NOW }).mode).toBe(
      'ask',
    )
    expect(decide({ policy: p, class: 'destructive', accountId: '111122223333', now: NOW }).mode).toBe(
      'block',
    )
  })
})

describe('bypass tạm thời', () => {
  it('nâng ask → auto và nói còn bao nhiêu giây', () => {
    const result = decide({
      policy: policy({ bypassUntil: bypassUntil(30) }),
      class: 'write',
      now: NOW,
    })
    expect(result.mode).toBe('auto')
    expect(result.reason).toBe('bypass')
    expect(result.bypassSecondsLeft).toBe(30 * 60)
  })

  // Bất biến quan trọng nhất của cả file: van xả cho lúc xử lý sự cố không được
  // biến thành đường mở cho lệnh phá huỷ trên production.
  it('KHÔNG gỡ được block', () => {
    const result = decide({
      policy: policy({ prodAccountIds: ['111122223333'], bypassUntil: bypassUntil(60) }),
      class: 'destructive',
      accountId: '111122223333',
      now: NOW,
    })
    expect(result.mode).toBe('block')
    expect(result.reason).toBe('matrix')
    expect(result.bypassSecondsLeft).toBeUndefined()
  })

  it('không đụng tới ô vốn đã auto', () => {
    const result = decide({
      policy: policy({ bypassUntil: bypassUntil(15) }),
      class: 'read',
      now: NOW,
    })
    expect(result.mode).toBe('auto')
    expect(result.reason).toBe('matrix')
  })

  it('hết hạn thì quay về ma trận, không cần ai dọn', () => {
    const p = policy({ bypassUntil: bypassUntil(-1) })
    const result = decide({ policy: p, class: 'write', now: NOW })
    expect(result.mode).toBe('ask')
    expect(result.reason).toBe('matrix')
  })

  it('mốc bypass rác bị bỏ qua thay vì mở khoá', () => {
    const result = decide({ policy: policy({ bypassUntil: 'không-phải-ngày' }), class: 'write', now: NOW })
    expect(result.mode).toBe('ask')
  })
})

describe('phiên chỉ siết, không nới (§5b)', () => {
  it('siết được: ma trận auto + phiên ask ⇒ ask', () => {
    const result = decide({ policy: policy(), class: 'read', sessionFloor: 'ask', now: NOW })
    expect(result.mode).toBe('ask')
    expect(result.reason).toBe('session-narrowed')
  })

  it('siết được tới tận block', () => {
    const result = decide({ policy: policy(), class: 'write', sessionFloor: 'block', now: NOW })
    expect(result.mode).toBe('block')
    expect(result.reason).toBe('session-narrowed')
  })

  it('KHÔNG nới được: ma trận ask + phiên auto ⇒ vẫn ask', () => {
    const result = decide({ policy: policy(), class: 'write', sessionFloor: 'auto', now: NOW })
    expect(result.mode).toBe('ask')
    expect(result.reason).toBe('matrix')
  })

  it('KHÔNG nới được ô block, kể cả khi phiên xin auto', () => {
    const result = decide({
      policy: policy({ prodAccountIds: ['111122223333'] }),
      class: 'destructive',
      accountId: '111122223333',
      sessionFloor: 'auto',
      now: NOW,
    })
    expect(result.mode).toBe('block')
  })

  it('phiên siết được cả thứ bypass vừa nới', () => {
    const result = decide({
      policy: policy({ bypassUntil: bypassUntil(30) }),
      class: 'write',
      sessionFloor: 'ask',
      now: NOW,
    })
    expect(result.mode).toBe('ask')
    expect(result.reason).toBe('session-narrowed')
  })
})

describe('strictest', () => {
  it.each<[InfraMode, InfraMode, InfraMode]>([
    ['auto', 'ask', 'ask'],
    ['ask', 'auto', 'ask'],
    ['ask', 'block', 'block'],
    ['block', 'auto', 'block'],
    ['auto', 'auto', 'auto'],
  ])('strictest(%s, %s) = %s', (a, b, expected) => {
    expect(strictest(a, b)).toBe(expected)
  })
})

describe('chính sách rỗng an toàn', () => {
  it('defaultPolicy dùng đúng ma trận xuất xưởng và không có bypass', () => {
    const p = defaultPolicy()
    expect(p.matrix).toEqual(DEFAULT_MATRIX)
    expect(p.prodAccountIds).toEqual([])
    expect(p.bypassUntil).toBeUndefined()
  })
})
