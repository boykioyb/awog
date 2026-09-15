// Bảng ca cho tầng resolver (Mốc 5, phần 5.2).
//
// VÌ SAO TEST BẰNG JSON MẪU: resolver đọc JSON của `describe-*`, và AWS đổi một
// trường là cả nhánh graph biến mất im lặng — không lỗi, không cảnh báo, chỉ là một
// hệ thống vẽ thiếu. Máy dev trả `ExpiredToken` nên không thể test bằng tài khoản
// thật; mẫu ở đây chép theo hình dạng thật của từng API.
//
// CA QUAN TRỌNG NHẤT LÀ CA ÂM: giá trị biến môi trường không được lọt vào node/cạnh
// (invariant 1). Nó là lý do `targetFromEnvValue()` tồn tại, nên nó phải có test.
import { describe, expect, it } from 'vitest'
import {
  GRAPH_NOTES,
  GRAPH_ROOT_COMMANDS,
  graphNodeId,
  hasGraphResolver,
  resolveGraphStep,
  resolverArgvFor,
  rootsFromResult,
  targetFromNodeId,
  type InfraResolveContext,
} from '../resolvers.js'

const ctx = (over: Partial<InfraResolveContext> = {}): InfraResolveContext => ({
  region: 'ap-southeast-1',
  accountId: '123456789012',
  depth: 0,
  maxDepth: 4,
  ...over,
})

const ids = (r: { nodes: readonly { id: string }[] }): string[] => r.nodes.map((n) => n.id)
const nodeById = (r: { nodes: readonly { id: string }[] }, id: string) =>
  r.nodes.find((n) => n.id === id)
const serialize = (r: { nodes: unknown; edges: unknown }): string =>
  JSON.stringify([r.nodes, r.edges])

// ─── Mẫu JSON (hình dạng thật của từng API) ──────────────────────────────────

const zoneId = 'Z123ABC'
const route53Records = {
  ResourceRecordSets: [
    { Name: 'example.com.', Type: 'NS', ResourceRecords: [{ Value: 'ns-1.awsdns.com.' }] },
    {
      Name: 'www.example.com.',
      Type: 'A',
      AliasTarget: { DNSName: 'd111.cloudfront.net.', HostedZoneId: 'Z2FDTNDATAQYW2' },
    },
    {
      Name: 'api.example.com.',
      Type: 'A',
      AliasTarget: { DNSName: 'my-alb-1234567.ap-southeast-1.elb.amazonaws.com.' },
    },
    { Name: 'mail.example.com.', Type: 'A', ResourceRecords: [{ Value: '1.2.3.4' }] },
    { Name: 'ext.example.com.', Type: 'CNAME', ResourceRecords: [{ Value: 'other.example.org.' }] },
  ],
}
const route53Zone = { HostedZone: { Name: 'example.com.', Config: { Comment: 'prod zone' } } }

const distributionDomain = 'd111.cloudfront.net'
const cloudfrontList = {
  DistributionList: {
    Items: [
      {
        Id: 'E123',
        DomainName: distributionDomain,
        Status: 'Deployed',
        Aliases: { Quantity: 1, Items: ['shop.example.com'] },
        Origins: {
          Items: [
            { Id: 'o-s3', DomainName: 'shop-web.s3-website-ap-southeast-1.amazonaws.com' },
            { Id: 'o-api', DomainName: 'abc123.execute-api.ap-southeast-1.amazonaws.com' },
          ],
        },
        DefaultCacheBehavior: { PathPattern: '/', TargetOriginId: 'o-s3' },
        CacheBehaviors: { Items: [{ PathPattern: '/api/*', TargetOriginId: 'o-api' }] },
      },
    ],
  },
}

const apiId = 'abc123'
const apiResources = {
  items: [
    {
      path: '/v1/orders',
      resourceMethods: {
        POST: {
          methodIntegration: {
            type: 'AWS_PROXY',
            uri:
              'arn:aws:apigateway:ap-southeast-1:lambda:path/2015-03-31/functions/' +
              'arn:aws:lambda:ap-southeast-1:123456789012:function:api-prod/invocations',
          },
        },
        // Phương thức không có integration (MOCK) — không có gì để nối.
        OPTIONS: {},
      },
    },
  ],
}

const lambdaConfig = {
  FunctionName: 'api-prod',
  Environment: {
    Variables: {
      DB_HOST: 'orders-db.c9x.ap-southeast-1.rds.amazonaws.com',
      QUEUE_URL: 'https://sqs.ap-southeast-1.amazonaws.com/123456789012/orders',
      API_TOKEN: 'sk-live-abcdefghijklmnop',
      APP_REGION: 'ap-southeast-1',
    },
  },
}
const lambdaMappings = {
  EventSourceMappings: [
    {
      UUID: 'uuid-1',
      EventSourceArn: 'arn:aws:sqs:ap-southeast-1:123456789012:jobs',
      State: 'Enabled',
    },
    { UUID: 'uuid-2', EventSourceArn: 'arn:aws:dynamodb:ap-southeast-1:123456789012:table/t' },
  ],
}

const taskDefinitionArn =
  'arn:aws:ecs:ap-southeast-1:123456789012:task-definition/prod-api:12'
const ecsServices = {
  services: [{ serviceName: 'prod-api', taskDefinition: taskDefinitionArn }],
}
const ecsTaskDefinition = {
  taskDefinition: {
    taskDefinitionArn,
    containerDefinitions: [
      {
        name: 'app',
        image: '123456789012.dkr.ecr.ap-southeast-1.amazonaws.com/prod-api:1',
        environment: [
          {
            name: 'QUEUE_URL',
            value: 'https://sqs.ap-southeast-1.amazonaws.com/123456789012/orders',
          },
        ],
        secrets: [{ name: 'DB_PASS', valueFrom: 'arn:aws:secretsmanager:ap-southeast-1:1:secret:x' }],
      },
    ],
  },
}

// ─── Id của node ─────────────────────────────────────────────────────────────

describe('id của node', () => {
  it('dựng rồi đọc lại được, kể cả khi tên chứa dấu hai chấm', () => {
    const id = graphNodeId({ service: 'ecs', region: 'ap-southeast-1', name: taskDefinitionArn })
    expect(targetFromNodeId(id)).toEqual({
      service: 'ecs',
      region: 'ap-southeast-1',
      name: taskDefinitionArn,
    })
  })

  it('chuỗi không đúng khuôn ⇒ null (không dựng argv từ rác)', () => {
    expect(targetFromNodeId('khong-co-dau-hai-cham')).toBeNull()
    expect(targetFromNodeId('lambda:sai')).toBeNull()
    expect(targetFromNodeId('lambda:ap-southeast-1:')).toBeNull()
  })

  it('chỉ dịch vụ CÓ resolver mới có argv; rds/sqs/s3 là lá', () => {
    expect(hasGraphResolver('lambda')).toBe(true)
    expect(hasGraphResolver('rds')).toBe(false)
    expect(resolverArgvFor({ service: 'sqs', region: 'ap-southeast-1', name: 'orders' })).toEqual([])
  })
})

// ─── Route53 ─────────────────────────────────────────────────────────────────

describe('route53: hosted zone → bản ghi', () => {
  const resolve = (over: Partial<InfraResolveContext> = {}) =>
    resolveGraphStep(
      { service: 'route53', region: 'global', name: zoneId },
      [route53Records, route53Zone],
      ctx(over),
    )

  it('alias CloudFront + ALB thành cạnh nét LIỀN; bỏ NS và bản ghi A thường', () => {
    const r = resolve()
    expect(ids(r)).toEqual([
      `cloudfront:global:${distributionDomain}`,
      'elb:ap-southeast-1:my-alb-1234567.ap-southeast-1.elb.amazonaws.com',
    ])
    expect(r.edges.map((e) => e.label)).toEqual(['alias', 'alias'])
    expect(r.edges.every((e) => e.inferred === false && e.source === 'describe')).toBe(true)
    // Miền không nhận ra (CNAME ra ngoài AWS) bị BỎ QUA kèm ghi chú, không bịa node.
    expect(r.notes).toContain(GRAPH_NOTES.dnsTargetUnsupported)
    // Node global KHÔNG bị coi là cross-region dù phiên ghim region cụ thể.
    expect(nodeById(r, `cloudfront:global:${distributionDomain}`)?.kind).toBe('service')
  })

  it('học tên zone cho node đang mở (self) và giữ trong trần độ sâu', () => {
    const r = resolve()
    expect(r.self?.label).toBe('example.com')
    expect(r.truncated).toBe(false)
  })

  it('chạm trần độ sâu ⇒ node con KHÔNG mở tiếp + truncated', () => {
    const r = resolve({ depth: 3, maxDepth: 4 })
    const cf = nodeById(r, `cloudfront:global:${distributionDomain}`)
    expect(cf?.expandable).toBe(false)
    expect(r.truncated).toBe(true)
    expect(r.notes).toContain(GRAPH_NOTES.depthTruncated)
  })
})

// ─── CloudFront ──────────────────────────────────────────────────────────────

describe('cloudfront: distribution → behavior → origin', () => {
  const r = resolveGraphStep(
    { service: 'cloudfront', region: 'global', name: distributionDomain },
    [cloudfrontList],
    ctx(),
  )

  it('origin mặc định là `origin`, đường dẫn riêng là `behavior`', () => {
    expect(r.edges.map((e) => e.label)).toEqual(['origin', 'behavior'])
    expect(r.edges.map((e) => e.to)).toEqual([
      's3:ap-southeast-1:shop-web',
      `apigateway:ap-southeast-1:${apiId}`,
    ])
  })

  it('đường dẫn của behavior theo node con, và edge id phân biệt hai cạnh', () => {
    expect(nodeById(r, `apigateway:ap-southeast-1:${apiId}`)?.detail['pattern']).toBe('/api/*')
    expect(new Set(r.edges.map((e) => e.id)).size).toBe(r.edges.length)
  })

  it('distribution không có trong trang đầu ⇒ ghi chú, không ném', () => {
    const miss = resolveGraphStep(
      { service: 'cloudfront', region: 'global', name: 'd999.cloudfront.net' },
      [cloudfrontList],
      ctx(),
    )
    expect(miss.nodes).toEqual([])
    expect(miss.notes).toContain(GRAPH_NOTES.distributionNotFound)
  })
})

// ─── API Gateway ─────────────────────────────────────────────────────────────

describe('apigateway: api → route → integration', () => {
  const r = resolveGraphStep(
    { service: 'apigateway', region: 'ap-southeast-1', name: apiId },
    [apiResources, { name: 'shop-api' }],
    ctx({ depth: 2 }),
  )

  it('route AWS_PROXY thành cạnh tới lambda, kèm tên route', () => {
    expect(ids(r)).toEqual(['lambda:ap-southeast-1:api-prod'])
    expect(r.nodes[0]?.detail['route']).toBe('POST /v1/orders')
    expect(r.nodes[0]?.detail['arn']).toBe(
      'arn:aws:lambda:ap-southeast-1:123456789012:function:api-prod',
    )
    expect(r.edges[0]).toMatchObject({ label: 'target', inferred: false, source: 'describe' })
    expect(r.edges[0]?.id).toContain('POST /v1/orders')
  })

  it('route MOCK (không integration) bị bỏ qua im lặng', () => {
    expect(r.notes).not.toContain(GRAPH_NOTES.integrationUnsupported)
  })

  it('ARN ở tài khoản KHÁC ⇒ node external, không mở tiếp', () => {
    const other = resolveGraphStep(
      { service: 'apigateway', region: 'ap-southeast-1', name: apiId },
      [apiResources, {}],
      ctx({ accountId: '999999999999' }),
    )
    expect(other.nodes[0]?.kind).toBe('external')
    expect(other.nodes[0]?.expandable).toBe(false)
    expect(other.notes).toContain(GRAPH_NOTES.crossAccount)
  })
})

// ─── Lambda ──────────────────────────────────────────────────────────────────

describe('lambda: env (suy luận) + event source mapping (đọc được)', () => {
  const r = resolveGraphStep(
    { service: 'lambda', region: 'ap-southeast-1', name: 'api-prod' },
    [lambdaConfig, lambdaMappings],
    ctx(),
  )

  it('cạnh suy từ env có inferred: true + source config (UI vẽ nét đứt)', () => {
    const env = r.edges.filter((e) => e.label === 'env')
    expect(env.map((e) => e.to).sort()).toEqual([
      'rds:ap-southeast-1:orders-db',
      'sqs:ap-southeast-1:orders',
    ])
    expect(env.every((e) => e.inferred === true && e.source === 'config')).toBe(true)
    expect(r.nodes.find((n) => n.id === 'rds:ap-southeast-1:orders-db')?.detail['env']).toBe(
      'DB_HOST',
    )
  })

  it('event source mapping là liên kết AWS kể ra được ⇒ nét liền', () => {
    const target = r.edges.filter((e) => e.label === 'target')
    expect(target.map((e) => e.to)).toEqual(['sqs:ap-southeast-1:jobs'])
    expect(target[0]).toMatchObject({ inferred: false, source: 'describe' })
    // DynamoDB không có resolver hôm nay ⇒ ghi chú, không bịa node.
    expect(r.notes).toContain(GRAPH_NOTES.eventSourceUnsupported)
  })

  it('GIÁ TRỊ biến môi trường KHÔNG lọt vào node/cạnh (invariant 1)', () => {
    const text = serialize(r)
    expect(text).not.toContain('orders-db.c9x.ap-southeast-1.rds.amazonaws.com')
    expect(text).not.toContain('https://sqs.ap-southeast-1.amazonaws.com/123456789012/orders')
    expect(text).not.toContain('123456789012/orders')
    expect(text).not.toContain('sk-live-abcdefghijklmnop')
    // Biến không khớp tài nguyên nào thì không sinh node — kể cả TÊN của nó.
    expect(text).not.toContain('API_TOKEN')
    expect(text).not.toContain('APP_REGION')
  })

  it('env trỏ tài nguyên ở region khác ⇒ node external', () => {
    const other = resolveGraphStep(
      { service: 'lambda', region: 'ap-southeast-1', name: 'api-prod' },
      [
        { Environment: { Variables: { Q: 'https://sqs.us-east-1.amazonaws.com/123456789012/orders' } } },
        {},
      ],
      ctx({ accountId: undefined }),
    )
    expect(other.nodes[0]?.id).toBe('sqs:us-east-1:orders')
    expect(other.nodes[0]?.kind).toBe('external')
    expect(other.notes).toContain(GRAPH_NOTES.crossRegion)
  })
})

// ─── ECS ─────────────────────────────────────────────────────────────────────

describe('ecs: service → task definition → env', () => {
  it('node task definition giữ ARN trong id để mở tiếp được', () => {
    const r = resolveGraphStep(
      { service: 'ecs', region: 'ap-southeast-1', name: 'prod-cluster/prod-api' },
      [ecsServices],
      ctx({ depth: 1 }),
    )
    expect(ids(r)).toEqual([`ecs:ap-southeast-1:${taskDefinitionArn}`])
    expect(r.nodes[0]?.expandable).toBe(true)
    expect(r.nodes[0]?.detail['service']).toBe('prod-api')
  })

  it('task definition → cạnh env, CHỈ tên biến đi tiếp', () => {
    const r = resolveGraphStep(
      { service: 'ecs', region: 'ap-southeast-1', name: taskDefinitionArn },
      [ecsTaskDefinition],
      ctx({ depth: 2 }),
    )
    expect(ids(r)).toEqual(['sqs:ap-southeast-1:orders'])
    expect(r.edges[0]).toMatchObject({ label: 'env', inferred: true, source: 'config' })
    expect(r.nodes[0]?.detail['container']).toBe('app')
    expect(serialize(r)).not.toContain('123456789012/orders')
    expect(r.notes).toContain(GRAPH_NOTES.secretRefOnly)
  })

  it('node không có task definition ⇒ ghi chú thay vì node rỗng', () => {
    const r = resolveGraphStep(
      { service: 'ecs', region: 'ap-southeast-1', name: 'cluster/service' },
      [{ services: [] }],
      ctx(),
    )
    expect(r.nodes).toEqual([])
    expect(r.notes).toContain(GRAPH_NOTES.ecsServiceNotFound)
  })
})

// ─── Điểm vào ────────────────────────────────────────────────────────────────

describe('điểm vào của graph', () => {
  it('route53: bỏ tiền tố /hostedzone/ và dấu chấm cuối tên miền', () => {
    const r = rootsFromResult(
      'route53',
      { HostedZones: [{ Id: '/hostedzone/Z9', Name: 'example.com.', ResourceRecordSetCount: 3 }] },
      'ap-southeast-1',
    )
    expect(r.roots).toEqual([
      { id: 'route53:global:Z9', service: 'route53', label: 'example.com', region: 'global' },
    ])
    expect(r.truncated).toBe(false)
  })

  it('cloudfront/route53 là dịch vụ TOÀN CẦU, apigateway theo region đang ghim', () => {
    expect(
      rootsFromResult('cloudfront', cloudfrontList, 'ap-southeast-1').roots[0],
    ).toMatchObject({ id: `cloudfront:global:${distributionDomain}`, label: 'shop.example.com' })
    expect(rootsFromResult('apigateway', { items: [{ id: 'a1', name: 'shop-api' }] }, 'us-east-1').roots[0]).toEqual(
      { id: 'apigateway:us-east-1:a1', service: 'apigateway', label: 'shop-api', region: 'us-east-1' },
    )
  })

  it('còn trang nữa (NextToken/position) ⇒ nói ra là đã cắt', () => {
    expect(rootsFromResult('route53', { HostedZones: [], NextToken: 'x' }, '').truncated).toBe(true)
    expect(rootsFromResult('apigateway', { items: [], position: 'p' }, '').truncated).toBe(true)
  })

  it('ba loại điểm vào, mỗi loại một lượt đọc', () => {
    expect(GRAPH_ROOT_COMMANDS.map((c) => c.service)).toEqual([
      'route53',
      'cloudfront',
      'apigateway',
    ])
    for (const c of GRAPH_ROOT_COMMANDS) expect(c.args.every((a) => a.length > 0)).toBe(true)
  })
})
