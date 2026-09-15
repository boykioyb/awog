// Mức suy luận gửi cho nhánh Claude SDK, và bậc "Ultracode" (ADR 0089).
//
// Cái đáng khoá ở đây không phải bảng ánh xạ 1:1 — mà là luật "ultracode thắng
// `level`": nó LÀ một bậc của cùng cái picker `/effort` trong Claude Code, nên
// không bao giờ được để một phiên gửi `--effort low` cạnh cờ tự nhận là xhigh.
//
// Run với vitest: `npx vitest run src/runtime/claude-sdk/__tests__/effort.test.ts`
import { describe, expect, it } from 'vitest'
import { effortFromSettings, sdkSettings, thinkingFromSettings } from '../shared.js'
import type { ThinkingLevel } from '../../../types/shared.js'

const LEVELS: ThinkingLevel[] = ['low', 'medium', 'high', 'extra-high', 'max']

describe('effortFromSettings', () => {
  it('ánh xạ 1:1 năm bậc khi ultracode tắt', () => {
    expect(LEVELS.map((level) => effortFromSettings({ level }))).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
  })

  it('ultracode bật ⇒ xhigh, bất kể level còn sót lại giá trị nào', () => {
    for (const level of LEVELS) {
      expect(effortFromSettings({ level, ultracode: true })).toBe('xhigh')
    }
  })
})

describe('thinkingFromSettings', () => {
  it("chỉ 'low' tắt extended thinking; các bậc trên dùng adaptive + summarized", () => {
    expect(thinkingFromSettings({ level: 'low' })).toEqual({ type: 'disabled' })
    for (const level of LEVELS.slice(1)) {
      expect(thinkingFromSettings({ level })).toEqual({ type: 'adaptive', display: 'summarized' })
    }
  })

  it("ultracode bật ⇒ thinking luôn bật, kể cả khi level là 'low'", () => {
    expect(thinkingFromSettings({ level: 'low', ultracode: true })).toEqual({
      type: 'adaptive',
      display: 'summarized',
    })
  })
})

describe('sdkSettings', () => {
  it('không bật thì KHÔNG ghi key ultracode (tránh đè settings.json của người dùng)', () => {
    const settings = sdkSettings({ commitCoAuthor: true })
    expect('ultracode' in settings).toBe(false)
    expect(sdkSettings({ commitCoAuthor: true, ultracode: false })).not.toHaveProperty('ultracode')
  })

  it('bật thì ghi cờ, và attribution vẫn đi cùng chuyến', () => {
    const settings = sdkSettings({ commitCoAuthor: false, ultracode: true })
    expect(settings.ultracode).toBe(true)
    expect(settings.attribution).toEqual({ commit: '', pr: '' })
  })
})
