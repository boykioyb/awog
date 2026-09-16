// Phép cắt ARN cho dimension `LoadBalancer` của CloudWatch.
//
// Đây là LÝ DO cả tính năng picker tồn tại: CloudWatch không nhận tên load
// balancer, nó nhận `app/<tên>/<mã>` — phần đuôi ARN. Cắt sai thì picker đưa vào
// một giá trị trông hợp lý mà biểu đồ luôn rỗng, và người dùng sẽ đi tìm lỗi ở
// CloudWatch chứ không ở đây.
//
// Run: `npx vitest run src/infra/__tests__/monitor-targets.test.ts`
import { describe, expect, it } from 'vitest'
import { albDimensionValue, shortAwsError } from '../monitor-targets.js'

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

describe('shortAwsError', () => {
  it('bỏ phần khuôn, giữ MÃ và câu cuối', () => {
    // Nguyên văn stderr người dùng gặp 2026-09-16 — cả dòng dài gấp ba chỗ UI có,
    // và chính nó làm vỡ thanh công cụ của màn Giám sát.
    const raw =
      'aws: [ERROR]: An error occurred (ExpiredToken) when calling the DescribeLoadBalancers operation: The security token included in the request is expired'
    expect(shortAwsError(raw)).toBe(
      'ExpiredToken: The security token included in the request is expired',
    )
  })

  it('ca thứ hai của cùng lượt đó', () => {
    const raw =
      'An error occurred (RequestExpired) when calling the DescribeInstances operation: Request has expired.'
    expect(shortAwsError(raw)).toBe('RequestExpired: Request has expired.')
  })

  it('không khớp khuôn ⇒ giữ dòng đầu, KHÔNG nuốt lỗi', () => {
    // Khuôn kia là của AWS CLI, không phải hợp đồng — nó đổi được.
    expect(shortAwsError('Unable to locate credentials')).toBe('Unable to locate credentials')
  })

  it('bỏ dòng trống đầu, lấy dòng có chữ đầu tiên', () => {
    expect(shortAwsError('\n\n  Could not connect to the endpoint URL  \n')).toBe(
      'Could not connect to the endpoint URL',
    )
  })

  it('stderr rỗng ⇒ chuỗi rỗng, để chỗ gọi tự quyết câu thay thế', () => {
    expect(shortAwsError('')).toBe('')
  })
})
