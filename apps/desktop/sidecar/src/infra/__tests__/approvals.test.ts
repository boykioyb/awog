// Vé duyệt một-lần (infosec audit #1) — bốn tính chất, mỗi cái chặn một đường lách.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  _resetApprovals,
  callFingerprint,
  consumeApproval,
  issueApproval,
} from '../approvals.js'

const FP = () => callFingerprint('aws', ['ec2', 'terminate-instances'], { profile: 'p' })
const OTHER = () => callFingerprint('aws', ['ec2', 'describe-instances'], { profile: 'p' })

describe('vé duyệt', () => {
  beforeEach(() => _resetApprovals())

  it('vé hợp lệ cho đúng lời gọi thì tiêu được', () => {
    const t = issueApproval(FP())
    expect(consumeApproval(t, FP())).toBe(true)
  })

  it('KHÔNG dùng được vé của lệnh khác', () => {
    const t = issueApproval(OTHER())
    expect(consumeApproval(t, FP())).toBe(false)
  })

  it('chỉ dùng được MỘT lần — duyệt một lần không thành giấy phép chạy mãi', () => {
    const t = issueApproval(FP())
    expect(consumeApproval(t, FP())).toBe(true)
    expect(consumeApproval(t, FP())).toBe(false)
  })

  it('hết hạn thì không dùng được', () => {
    const t0 = 1_000_000
    const t = issueApproval(FP(), t0)
    expect(consumeApproval(t, FP(), t0 + 6 * 60_000)).toBe(false)
  })

  it('vé bịa hoặc thiếu đều bị từ chối, không ném', () => {
    expect(consumeApproval(undefined, FP())).toBe(false)
    expect(consumeApproval('không-phải-vé', FP())).toBe(false)
  })

  it('một vé đem thử SAI chỗ thì cháy luôn, không dò được', () => {
    const t = issueApproval(FP())
    expect(consumeApproval(t, OTHER())).toBe(false)
    expect(consumeApproval(t, FP())).toBe(false)
  })
})
