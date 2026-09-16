// G4 — từ node sang nhóm log.
//
// Luật duy nhất đáng đo: KHÔNG ĐOÁN. Một tên nhóm log sai không ném lỗi, nó chỉ mở
// màn Logs ra trống — và người đang chữa cháy sẽ đọc cái trống đó thành "chặng này
// không ghi gì". Vì vậy phần lớn test dưới đây kiểm chuyện trả `null`.
import { describe, expect, it } from 'vitest'

import { logGroupForNode } from '../log-groups.js'

describe('logGroupForNode', () => {
  it('Lambda có khuôn cố định của AWS', () => {
    expect(logGroupForNode({ service: 'lambda', id: 'lambda:ap-southeast-1:checkout' })).toEqual({
      kind: 'exact',
      value: '/aws/lambda/checkout',
    })
  })

  it('Lambda lỡ mang nguyên ARN thì cắt lấy tên hàm', () => {
    expect(
      logGroupForNode({
        service: 'lambda',
        id: 'lambda:ap-southeast-1:arn:aws:lambda:ap-southeast-1:123456789012:function:checkout',
      }),
    ).toEqual({ kind: 'exact', value: '/aws/lambda/checkout' })
  })

  it('API Gateway chỉ ra được TIỀN TỐ vì node không mang stage', () => {
    expect(logGroupForNode({ service: 'apigateway', id: 'apigateway:us-east-1:ab12cd34ef' })).toEqual({
      kind: 'prefix',
      value: 'API-Gateway-Execution-Logs_ab12cd34ef/',
    })
  })

  it('cấu hình thật thắng mọi phép suy', () => {
    expect(
      logGroupForNode({ service: 'ecs', id: 'ecs:us-east-1:web', detail: { logGroup: '/app/web-prod' } }),
    ).toEqual({ kind: 'exact', value: '/app/web-prod' })
  })

  it.each([
    ['ECS không có cấu hình — AWS không ép khuôn nào', { service: 'ecs', id: 'ecs:us-east-1:web/prod' }],
    ['RDS không ghi log ứng dụng theo node', { service: 'rds', id: 'rds:us-east-1:db-1' }],
    ['SQS không có nhóm log', { service: 'sqs', id: 'sqs:us-east-1:orders' }],
    ['node ngoài phạm vi', { service: 'external', id: 'external::stripe.com' }],
    ['tên rỗng', { service: 'lambda', id: 'lambda:us-east-1:   ' }],
    // `id` không đủ hai dấu phân cách thì không có tên để suy.
    ['id méo', { service: 'lambda', id: 'lambda' }],
    // Id API Gateway luôn là chữ-số; thứ khác nghĩa là node không phải thứ ta tưởng.
    ['id API Gateway có ký tự lạ', { service: 'apigateway', id: 'apigateway:us-east-1:a/b' }],
  ])('%s → null', (_name, node) => {
    expect(logGroupForNode(node)).toBeNull()
  })

  it('detail.logGroup rỗng không được coi là có', () => {
    expect(
      logGroupForNode({ service: 'ecs', id: 'ecs:us-east-1:web', detail: { logGroup: '  ' } }),
    ).toBeNull()
  })
})
