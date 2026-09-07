// Tests cho schema.ts — biên L1 của lịch (file trên đĩa + payload từ UI).
// Chạy: `npx vitest@2 run src/schedules/__tests__/schema.test.ts`.
import { describe, expect, it } from 'vitest'
import { ScheduleJobSchema, ScheduleTriggerSchema, SCHEDULE_ID_RE } from '../schema.js'

describe('SCHEDULE_ID_RE', () => {
  it('accepts slug ids', () => {
    for (const ok of ['a', 'daily-standup', 'sch_1', '2026-nightly']) {
      expect(SCHEDULE_ID_RE.test(ok)).toBe(true)
    }
  })

  it('rejects anything that could escape the schedules dir', () => {
    for (const bad of ['../etc', 'a/b', 'a\\b', '.', '..', '', 'A', 'has space', '-leading']) {
      expect(SCHEDULE_ID_RE.test(bad)).toBe(false)
    }
  })
})

describe('ScheduleTriggerSchema', () => {
  it('accepts the three supported shapes', () => {
    expect(ScheduleTriggerSchema.safeParse({ kind: 'interval', everyMinutes: 30 }).success).toBe(true)
    expect(ScheduleTriggerSchema.safeParse({ kind: 'daily', time: '07:45' }).success).toBe(true)
    expect(
      ScheduleTriggerSchema.safeParse({ kind: 'weekly', weekdays: [1, 5], time: '18:00' }).success,
    ).toBe(true)
  })

  it('rejects out-of-range intervals, bad times and bad weekdays', () => {
    expect(ScheduleTriggerSchema.safeParse({ kind: 'interval', everyMinutes: 0 }).success).toBe(false)
    expect(
      ScheduleTriggerSchema.safeParse({ kind: 'interval', everyMinutes: 10_081 }).success,
    ).toBe(false)
    expect(ScheduleTriggerSchema.safeParse({ kind: 'daily', time: '7:45' }).success).toBe(false)
    expect(
      ScheduleTriggerSchema.safeParse({ kind: 'weekly', weekdays: [7], time: '18:00' }).success,
    ).toBe(false)
    expect(
      ScheduleTriggerSchema.safeParse({ kind: 'weekly', weekdays: [], time: '18:00' }).success,
    ).toBe(false)
    expect(ScheduleTriggerSchema.safeParse({ kind: 'cron', expr: '* * * * *' }).success).toBe(false)
  })
})

describe('ScheduleJobSchema', () => {
  const settings = { provider: 'anthropic', modelId: 'claude-x', level: 'medium', mode: 'ask' }

  it('accepts a session prompt job', () => {
    const res = ScheduleJobSchema.safeParse({ kind: 'session-prompt', prompt: 'hi', settings })
    expect(res.success).toBe(true)
  })

  it('rejects an empty prompt and an unknown provider', () => {
    expect(
      ScheduleJobSchema.safeParse({ kind: 'session-prompt', prompt: '', settings }).success,
    ).toBe(false)
    expect(
      ScheduleJobSchema.safeParse({
        kind: 'session-prompt',
        prompt: 'hi',
        settings: { ...settings, provider: 'evil' },
      }).success,
    ).toBe(false)
  })

  it('defaults a workflow job description to empty', () => {
    const res = ScheduleJobSchema.safeParse({
      kind: 'workflow-task',
      workflowId: 'wf-1',
      projectId: 'p-1',
      title: 'Nightly',
    })
    expect(res.success).toBe(true)
    expect(res.success && res.data.kind === 'workflow-task' && res.data.description).toBe('')
  })

  it('has no field that could carry a filesystem path to spawn from', () => {
    const res = ScheduleJobSchema.safeParse({
      kind: 'workflow-task',
      workflowId: 'wf-1',
      projectId: 'p-1',
      title: 'Nightly',
      cwd: '/etc',
      command: 'rm -rf /',
    })
    // zod strip mode: các khoá lạ bị GỠ chứ không đi tiếp vào runtime.
    expect(res.success).toBe(true)
    expect(res.success && Object.keys(res.data).sort()).toEqual([
      'description',
      'kind',
      'projectId',
      'title',
      'workflowId',
    ])
  })
})
