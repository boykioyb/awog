// Tests cho tracker checklist của nhánh Claude SDK: replay CRUD của task tool
// (`TaskCreate`/`TaskUpdate`/`TaskList`) thành `TodoItem[]`.
//
// Payload trong file này là payload THẬT, lấy từ transcript SDK ở
// `~/.claude/projects` (`tool_use_result` của CLI 2.1.260) — không phải shape tự
// nghĩ ra, vì cả lỗi cũ nằm ở chỗ đoán sai tool surface của CLI.
//
// Run với vitest: `npx vitest run src/runtime/claude-sdk/__tests__/task-checklist.test.ts`
// (vitest chưa nằm trong devDeps của sidecar — xem runtime/__tests__/subagents.test.ts).
import { describe, expect, it } from 'vitest'
import { createTaskChecklist } from '../task-checklist.js'
import type { TodoItem } from '../../../types/shared.js'

const created = (id: string, subject: string): unknown => ({ task: { id, subject } })
const updated = (taskId: string): unknown => ({ success: true, taskId, updatedFields: ['status'] })

describe('createTaskChecklist', () => {
  it('dựng list theo thứ tự tạo và giữ id để địa chỉ hoá', () => {
    const c = createTaskChecklist(undefined)
    expect(c.applyCreate(created('1', 'Design structure'))).toBe(true)
    c.applyCreate(created('2', 'Write scaffolding'))
    expect(c.applyUpdate({ taskId: '1', status: 'in_progress' }, updated('1'))).toBe(true)
    expect(c.items()).toEqual([
      { content: 'Design structure', status: 'in_progress', taskId: '1' },
      { content: 'Write scaffolding', status: 'pending', taskId: '2' },
    ])
  })

  it('seed từ list đã persist nên update của turn sau vẫn resolve', () => {
    const turn1: TodoItem[] = [
      { content: 'Design structure', status: 'completed', taskId: '1' },
      { content: 'Write scaffolding', status: 'pending', taskId: '2' },
    ]
    const c = createTaskChecklist(turn1)
    expect(c.applyUpdate({ taskId: '2', status: 'completed' }, updated('2'))).toBe(true)
    expect(c.items()).toEqual([
      { content: 'Design structure', status: 'completed', taskId: '1' },
      { content: 'Write scaffolding', status: 'completed', taskId: '2' },
    ])
  })

  it('id lạ ⇒ không apply gì: list cũ giữ nguyên chứ không bị một item ghi đè', () => {
    const c = createTaskChecklist([{ content: 'Design structure', status: 'pending', taskId: '1' }])
    expect(c.applyUpdate({ taskId: '99', status: 'completed' }, updated('99'))).toBe(false)
    expect(c.items()).toEqual([{ content: 'Design structure', status: 'pending', taskId: '1' }])
  })

  it('CLI báo success:false ⇒ không ghi nhận thay đổi task store không hề làm', () => {
    const c = createTaskChecklist([{ content: 'A', status: 'pending', taskId: '1' }])
    expect(
      c.applyUpdate({ taskId: '1', status: 'completed' }, { success: false, error: 'not found' }),
    ).toBe(false)
    expect(c.items()[0]?.status).toBe('pending')
  })

  it("status 'deleted' xoá item khỏi list", () => {
    const c = createTaskChecklist([
      { content: 'A', status: 'pending', taskId: '1' },
      { content: 'B', status: 'pending', taskId: '2' },
    ])
    expect(c.applyUpdate({ taskId: '1', status: 'deleted' }, updated('1'))).toBe(true)
    expect(c.items()).toEqual([{ content: 'B', status: 'pending', taskId: '2' }])
  })

  it('TaskList là snapshot authoritative: thay cả list, seed included', () => {
    const c = createTaskChecklist([{ content: 'stale', status: 'pending', taskId: '9' }])
    expect(
      c.applyList({
        tasks: [
          { id: '1', subject: 'A', status: 'completed', blockedBy: [] },
          { id: '2', subject: 'B', status: 'in_progress', blockedBy: [] },
        ],
      }),
    ).toBe(true)
    expect(c.items()).toEqual([
      { content: 'A', status: 'completed', taskId: '1' },
      { content: 'B', status: 'in_progress', taskId: '2' },
    ])
  })

  it('payload rác ⇒ false, không throw (tool result là L1)', () => {
    const c = createTaskChecklist(undefined)
    // Câu người-đọc mà model nhận, chứ không phải structured output.
    expect(c.applyCreate('Task #1 created successfully: A')).toBe(false)
    expect(c.applyCreate({ task: { id: '', subject: 'A' } })).toBe(false)
    expect(c.applyList({})).toBe(false)
    expect(c.applyList({ tasks: 'nope' })).toBe(false)
    expect(c.applyUpdate({}, updated('1'))).toBe(false)
    expect(c.items()).toEqual([])
  })

  it('item cũ không có taskId (session trước bản vá / user thêm) vẫn ở trong list', () => {
    const c = createTaskChecklist([{ content: 'legacy', status: 'pending' }])
    // Không địa chỉ hoá được bằng id, nên update rơi vào false — nhưng item không mất.
    expect(c.applyUpdate({ taskId: '1', status: 'completed' }, updated('1'))).toBe(false)
    expect(c.applyCreate(created('1', 'new'))).toBe(true)
    expect(c.items()).toEqual([
      { content: 'legacy', status: 'pending' },
      { content: 'new', status: 'pending', taskId: '1' },
    ])
  })
})
