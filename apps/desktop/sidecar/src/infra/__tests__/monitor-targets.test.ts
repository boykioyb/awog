// Phép cắt định danh + phân loại dimension cho ô chọn tài nguyên của màn Giám sát.
//
// `dimensionsMatch` là bài test QUAN TRỌNG NHẤT ở đây: CloudWatch phát cùng một
// metric ở nhiều mức tổng hợp với các tập dimension khác nhau, và nhận bừa sẽ đổ
// vào ô chọn hàng chục mục vô nghĩa cho cùng một tài nguyên.
//
// Run: `npx vitest run src/infra/__tests__/monitor-targets.test.ts`
import { describe, expect, it, vi } from 'vitest'
import {
  albLabel,
  deniedAction,
  dimensionsMatch,
  logGroupLabel,
  shortAwsError,
} from '../monitor-targets.js'

const dim = (name: string, value = 'x') => ({ name, value })

describe('dimensionsMatch', () => {
  it('nhận đúng tập ECS service (cluster + service)', () => {
    expect(
      dimensionsMatch([dim('ClusterName'), dim('ServiceName')], ['ClusterName', 'ServiceName']),
    ).toBe(true)
  })

  it('thứ tự khác vẫn khớp — AWS không bảo đảm thứ tự dimension', () => {
    expect(
      dimensionsMatch([dim('ServiceName'), dim('ClusterName')], ['ClusterName', 'ServiceName']),
    ).toBe(true)
  })

  it('LOẠI metric mức cluster: chỉ có ClusterName thì KHÔNG phải một service', () => {
    // "Có chứa ClusterName" sẽ nhận nó vào làm một service không tồn tại.
    expect(dimensionsMatch([dim('ClusterName')], ['ClusterName', 'ServiceName'])).toBe(false)
  })

  it('LOẠI bản tổng hợp theo TargetGroup — nếu không mỗi ALB hiện hàng chục lần', () => {
    expect(dimensionsMatch([dim('LoadBalancer'), dim('TargetGroup')], ['LoadBalancer'])).toBe(false)
    expect(dimensionsMatch([dim('LoadBalancer'), dim('AvailabilityZone')], ['LoadBalancer'])).toBe(
      false,
    )
  })

  it('LOẠI bản EC2 theo AutoScalingGroup / ImageId — không cái nào là một máy cụ thể', () => {
    expect(dimensionsMatch([dim('AutoScalingGroupName')], ['InstanceId'])).toBe(false)
    expect(dimensionsMatch([dim('ImageId')], ['InstanceId'])).toBe(false)
    expect(dimensionsMatch([dim('InstanceId')], ['InstanceId'])).toBe(true)
  })

  it('metric không có dimension nào ⇒ không phải tài nguyên nào cả', () => {
    expect(dimensionsMatch([], ['QueueName'])).toBe(false)
  })
})

describe('albLabel', () => {
  it('tách tên khỏi phần đuôi ARN, giữ tiền tố làm gợi ý', () => {
    expect(albLabel('app/pwpf-dev-apne1-alb/50dc6c495c0c9188')).toEqual({
      label: 'pwpf-dev-apne1-alb',
      hint: 'app',
    })
  })

  it('NLB giữ tiền tố riêng — ba loại dùng ba namespace khác nhau', () => {
    expect(albLabel('net/my-nlb/abc123')).toEqual({ label: 'my-nlb', hint: 'net' })
  })

  it('hình dạng lạ ⇒ hiện nguyên văn, không đoán', () => {
    expect(albLabel('my-alb')).toEqual({ label: 'my-alb', hint: '' })
    expect(albLabel('')).toEqual({ label: '', hint: '' })
  })
})

describe('logGroupLabel', () => {
  it('bỏ tiền tố dài ra gợi ý — danh sách thật có mươi nhóm cùng tiền tố', () => {
    expect(logGroupLabel('/aws/ecs/pwpf-dev-apne1-api')).toEqual({
      label: 'pwpf-dev-apne1-api',
      hint: '/aws/ecs',
    })
  })

  it('không có dấu / ⇒ giữ nguyên', () => {
    expect(logGroupLabel('my-log-group')).toEqual({ label: 'my-log-group', hint: '' })
  })

  it('kết thúc bằng / ⇒ giữ nguyên, không cắt ra chuỗi rỗng', () => {
    expect(logGroupLabel('/aws/ecs/')).toEqual({ label: '/aws/ecs/', hint: '' })
  })
})

describe('deniedAction', () => {
  it('rút tên action khỏi câu AccessDenied — thứ DUY NHẤT khác nhau giữa bốn câu', () => {
    // Nguyên văn người dùng gặp 2026-09-17 trên role Offshore-Developer.
    expect(
      deniedAction(
        'AccessDeniedException: User: arn:aws:sts::229015218011:assumed-role/AWSReservedSSO_Offshore-Developer_4a2f87bd06a4001d/tran.quang.hoa is not authorized to perform: ecs:ListClusters on resource: * because no identity-based policy allows the ecs:ListClusters action',
      ),
    ).toBe('ecs:ListClusters')
  })

  it('biến thể không có khoảng trắng sau dấu hai chấm', () => {
    expect(deniedAction('is not authorized to perform:sqs:listqueues on resource')).toBe(
      'sqs:listqueues',
    )
  })

  it('biến thể UnauthorizedOperation của EC2', () => {
    expect(
      deniedAction(
        'UnauthorizedOperation: You are not authorized to perform: ec2:DescribeInstances because no identity-based policy allows',
      ),
    ).toBe('ec2:DescribeInstances')
  })

  it('KHÔNG phải lỗi quyền ⇒ rỗng, vì token hết hạn cần lời khuyên khác hẳn', () => {
    expect(deniedAction('ExpiredToken: The security token included in the request is expired')).toBe(
      '',
    )
    expect(deniedAction('')).toBe('')
  })
})

describe('shortAwsError', () => {
  it('bỏ phần khuôn, giữ MÃ và câu cuối', () => {
    const raw =
      'aws: [ERROR]: An error occurred (ExpiredToken) when calling the DescribeLoadBalancers operation: The security token included in the request is expired'
    expect(shortAwsError(raw)).toBe(
      'ExpiredToken: The security token included in the request is expired',
    )
  })

  it('không khớp khuôn ⇒ giữ dòng đầu, KHÔNG nuốt lỗi', () => {
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

// ─── Đường lùi: dựng tài nguyên từ cảnh báo ─────────────────────────────────
//
// Ca này là lý do đường lùi tồn tại, và nó đến từ một tài khoản THẬT: role
// `Offshore-Developer` bị từ chối cả `cloudwatch:ListMetrics`, trong khi
// `DescribeAlarms` vẫn chạy và trả về ~30 cảnh báo của đúng những service người
// dùng muốn xem. Không có đường lùi thì ô chọn rỗng và cả màn vô dụng.
describe('listMonitorTargets — đường lùi qua describe-alarms', () => {
  it('ListMetrics bị chặn ⇒ dựng tài nguyên từ cảnh báo, GIỮ lỗi và cờ truncated', async () => {
    vi.resetModules()
    const runInfra = vi.fn(async (req: { args: readonly string[] }) => {
      const sub = `${req.args[0] ?? ''} ${req.args[1] ?? ''}`
      if (sub === 'cloudwatch list-metrics') {
        return {
          ok: false,
          stderr:
            'An error occurred (AccessDenied) when calling the ListMetrics operation: User is not authorized to perform: cloudwatch:ListMetrics',
          stdout: '',
        }
      }
      if (sub === 'cloudwatch describe-alarms') {
        return {
          ok: true,
          stdout: JSON.stringify({
            MetricAlarms: [
              {
                Namespace: 'AWS/ECS',
                Dimensions: [
                  { Name: 'ServiceName', Value: 'pwpf-dev-apne1-api' },
                  { Name: 'ClusterName', Value: 'pwpf-dev-apne1-cluster' },
                ],
              },
              {
                Namespace: 'AWS/ECS',
                Dimensions: [
                  { Name: 'ClusterName', Value: 'pwpf-dev-apne1-cluster' },
                  { Name: 'ServiceName', Value: 'pwpf-dev-apne1-api' },
                ],
              },
              { Namespace: 'AWS/SQS', Dimensions: [{ Name: 'QueueName', Value: 'noti-dlq' }] },
              {
                Namespace: 'AWS/ECS',
                Dimensions: [{ Name: 'ClusterName', Value: 'pwpf-dev-apne1-cluster' }],
              },
            ],
          }),
          stderr: '',
        }
      }
      return { ok: true, stdout: JSON.stringify({ logGroups: [] }), stderr: '' }
    })
    vi.doMock('../run.js', () => ({ runInfra }))
    const { listMonitorTargets } = await import('../monitor-targets.js')

    const out = await listMonitorTargets({ surface: 'explorer' })
    const ecs = out.groups.find((g) => g.kind === 'ecs-service')
    const sqs = out.groups.find((g) => g.kind === 'sqs')

    expect(ecs?.items.map((i) => i.id)).toEqual([
      'ecs-service:pwpf-dev-apne1-cluster/pwpf-dev-apne1-api',
    ])
    expect(ecs?.items[0]?.label).toBe('pwpf-dev-apne1-api')
    expect(ecs?.items[0]?.hint).toBe('pwpf-dev-apne1-cluster')
    expect(sqs?.items.map((i) => i.label)).toEqual(['noti-dlq'])
    expect(sqs?.items[0]?.hint).toBe('DLQ')

    expect(ecs?.error).toContain('cloudwatch:ListMetrics')
    expect(ecs?.truncated).toBe(true)

    const alarmCalls = runInfra.mock.calls.filter(
      (c) => (c[0] as { args: string[] }).args[1] === 'describe-alarms',
    )
    expect(alarmCalls).toHaveLength(1)
    vi.doUnmock('../run.js')
  })

  it('mọi probe chạy được ⇒ KHÔNG gọi describe-alarms', async () => {
    vi.resetModules()
    const runInfra = vi.fn(async (req: { args: readonly string[] }) => {
      if (req.args[1] === 'list-metrics') {
        return { ok: true, stdout: JSON.stringify({ Metrics: [] }), stderr: '' }
      }
      return { ok: true, stdout: JSON.stringify({ logGroups: [] }), stderr: '' }
    })
    vi.doMock('../run.js', () => ({ runInfra }))
    const { listMonitorTargets } = await import('../monitor-targets.js')

    await listMonitorTargets({ surface: 'explorer' })
    const alarmCalls = runInfra.mock.calls.filter(
      (c) => (c[0] as { args: string[] }).args[1] === 'describe-alarms',
    )
    expect(alarmCalls).toHaveLength(0)
    vi.doUnmock('../run.js')
  })
})
