// `parseWorkspaceList` — đầu ra `terraform workspace list` là văn bản có đánh dấu,
// không phải JSON (việc 12 / P1).
//
// Ca đáng giá: dòng `* default` (workspace đang chọn) phải được nhận ra, và
// KHÔNG được lẫn với một workspace tên `*` hay dòng trống ở cuối output.
import { describe, expect, it } from 'vitest'
import { parseWorkspaceList } from '../infra.tf-workspaces.js'

describe('parseWorkspaceList', () => {
  it('reads names and marks the current one', () => {
    expect(parseWorkspaceList('  default\n* staging\n  prod\n')).toEqual({
      workspaces: ['default', 'staging', 'prod'],
      current: 'staging',
    })
  })

  it('handles the single-workspace case and trailing newlines', () => {
    expect(parseWorkspaceList('* default\n\n')).toEqual({
      workspaces: ['default'],
      current: 'default',
    })
  })

  it('returns empty structures for empty output', () => {
    expect(parseWorkspaceList('')).toEqual({ workspaces: [], current: '' })
  })
})
