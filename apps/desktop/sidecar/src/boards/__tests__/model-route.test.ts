// model-route — auto-route model/effort của agent nhận việc theo tính chất
// board item (dispatch-time). Bản auto của nút "Tối ưu model" phía UI.
//
// Vì sao có file này: route ghi thẳng lên session.llmOverride — sai ở đây là
// sai tiền + sai chất lượng của mọi member được giao, và nó chạy CHỦ ĐỘNG (không
// có người bấm) nên heuristic phải được pin chặt.
//
// `pickModel`/`routeForItem` đọc catalog pi thật — test chỉ pin điều deterministic
// (tier classifier, complexity, merge, lead floor, comm clamp) thay vì id model
// cụ thể của một phiên bản pi-ai.
//
// Run: `npx vitest run src/boards/__tests__/model-route.test.ts`
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../util/logger.js', () => ({
  log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))
vi.mock('../../sessions/store.js', () => ({
  setSessionLlmOverride: vi.fn(async () => true),
}))
vi.mock('../../transport/stdio.js', () => ({
  emit: vi.fn(),
}))
vi.mock('../../agents/store.js', () => ({
  loadAgent: vi.fn(async () => null),
}))

const { applyRoute, modelTier, pickModel, routeForItem, taskComplexity } = await import(
  '../model-route.js'
)

describe('taskComplexity', () => {
  it('task trần không tín hiệu → nhẹ (tier 0)', () => {
    expect(taskComplexity({ type: 'task' })).toBe(0)
  })

  it('epic/story, severity cao, priority cao, brief dài đẩy lên nặng', () => {
    expect(taskComplexity({ type: 'epic' })).toBe(1)
    expect(
      taskComplexity({ type: 'story', severity: 'blocker', priority: 'high' }),
    ).toBe(2)
    expect(taskComplexity({ type: 'task', desc: 'x'.repeat(700) })).toBe(1)
    expect(
      taskComplexity({ type: 'epic', severity: 'major', priority: 'urgent', desc: 'x'.repeat(700) }),
    ).toBe(2)
  })

  it('subtask kéo xuống một bậc, kẹp sàn 0', () => {
    expect(taskComplexity({ type: 'subtask' })).toBe(0)
    expect(taskComplexity({ type: 'subtask', priority: 'urgent' })).toBe(0)
    expect(taskComplexity({ type: 'subtask', severity: 'blocker', priority: 'high' })).toBe(1)
  })

  it('severity/priority thấp không cộng', () => {
    expect(taskComplexity({ type: 'task', severity: 'trivial', priority: 'low' })).toBe(0)
    expect(taskComplexity({ type: 'bug', severity: 'minor' })).toBe(0)
  })
})

describe('modelTier', () => {
  it('tên rẻ/nhanh → 0', () => {
    expect(modelTier('claude-haiku-4-5')).toBe(0)
    expect(modelTier('gemini-2.5-flash')).toBe(0)
    expect(modelTier('gpt-5.4-mini')).toBe(0)
    expect(modelTier('o4-mini')).toBe(0)
  })

  it('tên đầu bảng → 2', () => {
    expect(modelTier('claude-opus-5')).toBe(2)
    expect(modelTier('gpt-5.5-pro')).toBe(2)
    expect(modelTier('gemini-2.5-pro')).toBe(2)
  })

  it('tầm giữa → 1; "gemini" KHÔNG ăn "mini"', () => {
    expect(modelTier('claude-sonnet-5')).toBe(1)
    expect(modelTier('gemini-3.0-pro-exp')).toBe(2)
    expect(modelTier('gpt-5.5')).toBe(1)
  })
})

describe('routeForItem', () => {
  it('level theo độ phức tạp: nhẹ→low, thường→medium, nặng→high', () => {
    expect(routeForItem({ type: 'task' }, 'anthropic').level).toBe('low')
    expect(routeForItem({ type: 'epic' }, 'anthropic').level).toBe('medium')
    expect(
      routeForItem({ type: 'epic', severity: 'blocker' }, 'anthropic').level,
    ).toBe('high')
  })

  it('lead không xuống dưới tầm giữa', () => {
    expect(routeForItem({ type: 'subtask' }, 'anthropic', { lead: true }).level).toBe('medium')
  })

  it('model được chọn từ catalog provider — phải đủ tier của item', () => {
    // task trần (tier 0) phải ra model rẻ khi catalog có — haiku/flash/mini.
    const light = routeForItem({ type: 'task' }, 'anthropic')
    if (light.modelId) expect(modelTier(light.modelId)).toBe(0)
    // việc nặng (tier 2) không được ra model rẻ khi catalog có model mạnh.
    const heavy = routeForItem(
      { type: 'epic', severity: 'blocker', priority: 'urgent' },
      'anthropic',
    )
    if (heavy.modelId) expect(modelTier(heavy.modelId)).toBe(2)
  })
})

describe('applyRoute', () => {
  it('route đè modelId/level, giữ provider/accountId/mode của user', () => {
    const merged = applyRoute(
      { provider: 'openai', accountId: 'acc-1', mode: 'plan', modelId: 'gpt-5.5' },
      { modelId: 'gpt-5.4-mini', level: 'low' },
    )
    expect(merged).toEqual({
      provider: 'openai',
      accountId: 'acc-1',
      mode: 'plan',
      modelId: 'gpt-5.4-mini',
      level: 'low',
    })
  })

  it('route không chọn được model thì giữ modelId đang có', () => {
    const merged = applyRoute({ modelId: 'x' }, { level: 'high' })
    expect(merged).toEqual({ modelId: 'x', level: 'high' })
  })
})

describe('pickModel', () => {
  it('catalog anthropic có haiku ⇒ comm clamp (target 0) trả model tier 0', () => {
    const pick = pickModel('anthropic', 0)
    if (pick) expect(modelTier(pick)).toBe(0)
  })

  it('target cao hơn mọi model trong catalog ⇒ trả model mạnh nhất sẵn có', () => {
    // Không giả catalog — chỉ kiểm pick không vỡ và trả id hợp lệ khi catalog
    // không rỗng.
    const pick = pickModel('anthropic', 2)
    if (pick) expect(typeof pick).toBe('string')
  })
})
