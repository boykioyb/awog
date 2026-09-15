// Thang trạng thái dùng chung của màn Triển khai (Mốc 4).
//
// Bốn nguồn nói bốn thứ tiếng; bảng, bộ lọc và thông báo chỉ hiểu MỘT thang. Nếu
// một ánh xạ ở đây sai thì chỗ sai không nằm ở bảng chữ — nó nằm ở câu "ổn hay
// không ổn" mà người dùng đọc, nên bảng dưới đây là hợp đồng, không phải chi tiết.
import { describe, expect, it } from 'vitest'
import {
  CICD_LIVE,
  amplifyStatus,
  codebuildStatus,
  githubStatus,
  pipelineStatus,
  spanMs,
} from '../types.js'

describe('githubStatus — cặp (status, conclusion)', () => {
  it('chưa xong: queued/running/waiting không bao giờ là success', () => {
    expect(githubStatus('queued', null)).toBe('queued')
    expect(githubStatus('requested', null)).toBe('queued')
    expect(githubStatus('pending', null)).toBe('queued')
    expect(githubStatus('in_progress', null)).toBe('running')
  })

  it('đã xong: conclusion quyết định', () => {
    expect(githubStatus('completed', 'success')).toBe('success')
    expect(githubStatus('completed', 'failure')).toBe('failed')
    expect(githubStatus('completed', 'timed_out')).toBe('failed')
    expect(githubStatus('completed', 'startup_failure')).toBe('failed')
    expect(githubStatus('completed', 'cancelled')).toBe('cancelled')
    expect(githubStatus('completed', 'skipped')).toBe('skipped')
    // `action_required` là CỔNG DUYỆT đang chờ — không phải "hỏng", không phải
    // "đang chạy": người dùng phải bấm thì nó mới tiến tiếp.
    expect(githubStatus('completed', 'action_required')).toBe('waiting')
  })

  it('conclusion lạ hoặc thiếu ⇒ unknown (không đoán là thành công)', () => {
    expect(githubStatus('completed', null)).toBe('unknown')
    expect(githubStatus('completed', 'neutral')).toBe('unknown')
    expect(githubStatus('weird', null)).toBe('unknown')
  })
})

describe('pipelineStatus — CodePipeline', () => {
  it('ánh xạ đủ sáu trạng thái có nghĩa', () => {
    expect(pipelineStatus('Succeeded')).toBe('success')
    expect(pipelineStatus('Failed')).toBe('failed')
    expect(pipelineStatus('Stopped')).toBe('cancelled')
    expect(pipelineStatus('Superseded')).toBe('cancelled')
    expect(pipelineStatus('InProgress')).toBe('running')
    expect(pipelineStatus('Stopping')).toBe('running')
    expect(pipelineStatus('')).toBe('unknown')
  })
})

describe('codebuildStatus — CodeBuild', () => {
  it('FAULT/TIMED_OUT là hỏng, STOPPED là huỷ (không phải hỏng)', () => {
    expect(codebuildStatus('SUCCEEDED')).toBe('success')
    expect(codebuildStatus('FAILED')).toBe('failed')
    expect(codebuildStatus('FAULT')).toBe('failed')
    expect(codebuildStatus('TIMED_OUT')).toBe('failed')
    expect(codebuildStatus('STOPPED')).toBe('cancelled')
    expect(codebuildStatus('IN_PROGRESS')).toBe('running')
    expect(codebuildStatus('QUEUED')).toBe('queued')
    expect(codebuildStatus('WHATEVER')).toBe('unknown')
  })
})

describe('amplifyStatus — Amplify Hosting', () => {
  it('SUCCEED (không có chữ ED) là thành công', () => {
    expect(amplifyStatus('SUCCEED')).toBe('success')
    expect(amplifyStatus('FAILED')).toBe('failed')
    expect(amplifyStatus('CANCELLED')).toBe('cancelled')
    expect(amplifyStatus('RUNNING')).toBe('running')
    expect(amplifyStatus('PENDING')).toBe('queued')
  })
})

describe('spanMs', () => {
  it('trả khoảng thời gian, null khi thiếu/âm/không hợp lệ', () => {
    expect(spanMs('2026-09-14T00:00:00Z', '2026-09-14T00:02:05Z')).toBe(125_000)
    expect(spanMs('', '2026-09-14T00:00:00Z')).toBeNull()
    expect(spanMs('2026-09-14T00:00:00Z', null)).toBeNull()
    // Nguồn có đồng hồ lệch: mốc kết thúc TRƯỚC mốc bắt đầu là dữ liệu hỏng, không
    // phải "âm hai giây" để rồi UI in ra số vô nghĩa.
    expect(spanMs('2026-09-14T00:02:00Z', '2026-09-14T00:00:00Z')).toBeNull()
    expect(spanMs('không phải ngày', '2026-09-14T00:00:00Z')).toBeNull()
  })
})

describe('CICD_LIVE', () => {
  it('chỉ ba trạng thái còn tiến tiếp — `waiting` KHÔNG tự chạy', () => {
    expect([...CICD_LIVE].sort()).toEqual(['queued', 'running', 'waiting'])
    expect(CICD_LIVE.has('success')).toBe(false)
    expect(CICD_LIVE.has('failed')).toBe(false)
  })
})
