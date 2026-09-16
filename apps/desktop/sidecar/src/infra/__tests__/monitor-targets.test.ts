// Phép cắt ARN cho dimension `LoadBalancer` của CloudWatch.
//
// Đây là LÝ DO cả tính năng picker tồn tại: CloudWatch không nhận tên load
// balancer, nó nhận `app/<tên>/<mã>` — phần đuôi ARN. Cắt sai thì picker đưa vào
// một giá trị trông hợp lý mà biểu đồ luôn rỗng, và người dùng sẽ đi tìm lỗi ở
// CloudWatch chứ không ở đây.
//
// Run: `npx vitest run src/infra/__tests__/monitor-targets.test.ts`
import { describe, expect, it } from 'vitest'
import { albDimensionValue } from '../monitor-targets.js'

describe('albDimensionValue', () => {
  it('cắt đúng phần đuôi của ARN một ALB', () => {
    expect(
      albDimensionValue(
        'arn:aws:elasticloadbalancing:ap-southeast-1:123456789012:loadbalancer/app/my-alb/50dc6c495c0c9188',
      ),
    ).toBe('app/my-alb/50dc6c495c0c9188')
  })

  it('NLB và GWLB đi cùng một luật — tiền tố giữ nguyên để phân biệt được', () => {
    expect(
      albDimensionValue(
        'arn:aws:elasticloadbalancing:us-east-1:1:loadbalancer/net/my-nlb/abc123def456',
      ),
    ).toBe('net/my-nlb/abc123def456')
  })

  it('ELB cổ điển (không có đoạn app/net/gwy) ⇒ rỗng, bị loại khỏi picker', () => {
    // Thà bỏ một dòng còn hơn đưa vào picker một giá trị CloudWatch không hiểu.
    expect(albDimensionValue('arn:aws:elasticloadbalancing:us-east-1:1:loadbalancer/my-classic-lb')).toBe('')
  })

  it('chuỗi không phải ARN load balancer ⇒ rỗng', () => {
    expect(albDimensionValue('arn:aws:ec2:us-east-1:1:instance/i-0abc')).toBe('')
    expect(albDimensionValue('my-alb')).toBe('')
    expect(albDimensionValue('')).toBe('')
  })

  it('KHÔNG nhận mỗi cái tên — đó chính là cái bẫy picker sinh ra để gỡ', () => {
    expect(albDimensionValue('my-alb')).not.toBe('my-alb')
  })
})
