// Tests cho phần THUẦN của eval.ts: đọc lựa chọn của model, chấm điểm, ước
// lượng chi phí, khoá lưu trữ. Vòng lặp `runSkillEval` gọi model thật nên không
// nằm trong suite này.
//
// Chạy: `npx vitest@2 run src/skills/__tests__/eval.test.ts`.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EVAL_BUDGET,
  buildCatalogue,
  estimateCallCostUsd,
  evalKey,
  parseChoice,
  scoreCase,
} from '../eval.js'
import type { Skill } from '../../types/shared.js'

const KNOWN = ['pdf-filler', 'commit-writer']

describe('parseChoice', () => {
  it('đọc JSON trần', () => {
    expect(parseChoice('{"skill":"pdf-filler","reason":"form"}', KNOWN)).toEqual({
      chosen: 'pdf-filler',
      reason: 'form',
    })
  })

  it('chịu được fence ```json model hay tự thêm', () => {
    const raw = '```json\n{"skill": "commit-writer", "reason": "git"}\n```'
    expect(parseChoice(raw, KNOWN).chosen).toBe('commit-writer')
  })

  it('null / "none" đều là không chọn skill nào', () => {
    expect(parseChoice('{"skill":null,"reason":"n/a"}', KNOWN).chosen).toBeNull()
    expect(parseChoice('{"skill":"none"}', KNOWN).chosen).toBeNull()
  })

  it('id bịa không nằm trong danh mục bị quy về null', () => {
    expect(parseChoice('{"skill":"made-up","reason":"x"}', KNOWN).chosen).toBeNull()
  })

  it('không phải JSON thì trả null thay vì ném', () => {
    expect(parseChoice('I would use the pdf-filler skill.', KNOWN)).toEqual({
      chosen: null,
      reason: '',
    })
  })
})

describe('scoreCase', () => {
  it('kỳ vọng kích hoạt: đúng skill mới đạt', () => {
    expect(scoreCase('activate', 'pdf-filler', 'pdf-filler')).toBe(true)
    expect(scoreCase('activate', 'commit-writer', 'pdf-filler')).toBe(false)
    expect(scoreCase('activate', null, 'pdf-filler')).toBe(false)
  })

  it('kỳ vọng KHÔNG kích hoạt: chọn skill khác vẫn đạt', () => {
    expect(scoreCase('skip', null, 'pdf-filler')).toBe(true)
    expect(scoreCase('skip', 'commit-writer', 'pdf-filler')).toBe(true)
    expect(scoreCase('skip', 'pdf-filler', 'pdf-filler')).toBe(false)
  })
})

describe('buildCatalogue', () => {
  const skill = (id: string, name: string, description: string): Skill => ({
    id,
    source: 'global',
    name,
    description,
    body: '',
  })

  it('một dòng một skill, có id để model trả về', () => {
    const text = buildCatalogue([skill('pdf-filler', 'Pdf Filler', 'Use when filling PDFs.')])
    expect(text).toBe('- pdf-filler — Pdf Filler: Use when filling PDFs.')
  })

  it('mô tả dài bị cắt để input token không phình', () => {
    const text = buildCatalogue([skill('x', 'X', 'y'.repeat(1000))])
    expect(text.length).toBeLessThan(400)
  })
})

describe('estimateCallCostUsd', () => {
  it('model có trong bảng giá thì ra số dương và tăng theo độ dài prompt', () => {
    const small = estimateCallCostUsd('claude-haiku-4-5', 1_000)
    const big = estimateCallCostUsd('claude-haiku-4-5', 100_000)
    expect(small).toBeGreaterThan(0)
    expect(big ?? 0).toBeGreaterThan(small ?? 0)
  })

  it('một lượt eval rẻ hơn nhiều so với trần mặc định', () => {
    expect(estimateCallCostUsd('claude-haiku-4-5', 8_000) ?? 1).toBeLessThan(
      DEFAULT_EVAL_BUDGET.maxCostUsd,
    )
  })

  it('model lạ trả null ⇒ chiều cost bị vô hiệu, calls/wallclock đỡ', () => {
    expect(estimateCallCostUsd('no-such-model-9000', 1_000)).toBeNull()
  })
})

describe('evalKey', () => {
  it('gộp cả ba thành phần nên hai tier không đè file của nhau', () => {
    expect(evalKey('pdf-filler', 'global')).not.toBe(evalKey('pdf-filler', 'project', 'p1'))
  })

  it('khử ký tự đường dẫn trong projectId', () => {
    expect(evalKey('pdf-filler', 'project', '../../etc')).not.toContain('/')
  })
})
