// Bảng ca cho tầng DỰNG graph (Mốc 5, phần 5.1 + 5.3).
//
// `build.ts` là chỗ graph chạm CLI, nên ở đây khoá ba thứ mà resolver thuần không
// chứng minh được:
//   1. cả chuỗi Route53 → CloudFront → API Gateway → Lambda → RDS/SQS ghép thành
//      đúng node + cạnh từ JSON mẫu, và GHÉP HAI LẦN thì khử trùng;
//   2. chạm trần độ sâu ⇒ `truncated: true` + khoá i18n, node ở trần không mở tiếp;
//   3. mọi lượt đọc đi qua `runGated()` — nhánh bị ma trận chặn trả NGUYÊN hình dạng
//      §2 chứ không lặng lẽ trả graph rỗng.
//
// `runGated` được MOCK: máy dev gọi AWS thật trả `ExpiredToken`, mà thứ đang test là
// cách ghép JSON chứ không phải quyền của tài khoản. Cổng quyền tự nó đã có bảng ca
// riêng (`infra/__tests__/gated.test.ts`).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runGated } = vi.hoisted(() => ({ runGated: vi.fn() }))
vi.mock('../../gated.js', () => ({ runGated }))

import {
  GRAPH_BUILD_NOTES,
  clampGraphDepth,
  expandInfraGraph,
  listInfraGraphRoots,
  mergeGraphParts,
  resolveInfraGraph,
  type InfraGraphPart,
} from '../build.js'
import { GRAPH_NOTES } from '../resolvers.js'
import { INFRA_GRAPH_MAX_DEPTH, type InfraGraphEdge, type InfraGraphNode } from '../types.js'
import type { InfraGateInput, InfraGatedResult } from '../../gated.js'

const CTX = { region: 'ap-southeast-1', accountId: '123456789012' }

// ─── Giả lập cổng quyền ──────────────────────────────────────────────────────

/** Lệnh ĐỌC chạy được. `ok: false` mô phỏng AWS từ chối (thiếu quyền, sai region). */
function ran(command: string, stdout: string, ok = true): InfraGatedResult {
  return {
    blocked: false,
    command,
    class: 'read',
    accountKind: 'normal',
    decision: 'auto',
    result: {
      ok,
      exitCode: ok ? 0 : 1,
      stdout,
      stderr: ok ? '' : 'An error occurred (AccessDenied)',
      durationMs: 1,
      truncated: false,
      class: 'read',
    },
  }
}

function denied(command: string): InfraGatedResult {
  return {
    blocked: true,
    requiresApproval: true,
    approvalTicket: 'ticket-1',
    command,
    class: 'read',
    accountKind: 'normal',
    mode: 'ask',
    reason: 'This read command needs your approval before it can run.',
  }
}

type GateOptions = {
  /** Tài khoản có X-Ray không (Q4 của kế hoạch — cố ý KHÔNG mặc định là có). */
  xray?: boolean
  cloudwatch?: boolean
  denyOn?: (args: readonly string[]) => boolean
  failOn?: (args: readonly string[]) => boolean
}

/**
 * Cổng giả: tra JSON mẫu theo đúng argv. Hai phép dò lưu lượng nhận diện bằng
 * `args[0]` vì argv của X-Ray mang mốc thời gian đổi mỗi lượt.
 */
function installGate(
  responses: Record<string, unknown>,
  opts: GateOptions = {},
): void {
  runGated.mockImplementation(async (p: InfraGateInput): Promise<InfraGatedResult> => {
    const key = p.args.join(' ')
    if (p.args[0] === 'xray') {
      return opts.xray === true ? ran(key, '{}') : ran(key, '', false)
    }
    if (p.args[0] === 'cloudwatch') {
      const body = opts.cloudwatch === true ? { Metrics: [{ MetricName: 'Invocations' }] } : { Metrics: [] }
      return ran(key, JSON.stringify(body))
    }
    if (opts.denyOn?.(p.args)) return denied(key)
    if (opts.failOn?.(p.args)) return ran(key, '', false)
    const value = responses[key]
    return ran(key, value === undefined ? '{}' : JSON.stringify(value))
  })
}

beforeEach(() => {
  runGated.mockReset()
})

// ─── JSON mẫu ────────────────────────────────────────────────────────────────

const ZONE_ID = 'Z123ABC'
const API_ID = 'abc123'
const FUNCTION = 'api-prod'
const DIST_DOMAIN = 'd111.cloudfront.net'
const ELB = 'my-alb-1234567.ap-southeast-1.elb.amazonaws.com'
const LAMBDA_URI =
  'arn:aws:apigateway:ap-southeast-1:lambda:path/2015-03-31/functions/' +
  'arn:aws:lambda:ap-southeast-1:123456789012:function:api-prod/invocations'

const K = {
  zoneRecords: `route53 list-resource-record-sets --hosted-zone-id ${ZONE_ID} --max-items 500`,
  zoneInfo: `route53 get-hosted-zone --id ${ZONE_ID}`,
  distributions: 'cloudfront list-distributions --max-items 200',
  apiResources: `apigateway get-resources --rest-api-id ${API_ID} --embed methods --limit 500`,
  apiInfo: `apigateway get-rest-api --rest-api-id ${API_ID}`,
  lambdaConfig: `lambda get-function-configuration --function-name ${FUNCTION}`,
  lambdaMappings: `lambda list-event-source-mappings --function-name ${FUNCTION}`,
}

const zoneRecords = {
  ResourceRecordSets: [
    { Name: 'example.com.', Type: 'NS', ResourceRecords: [{ Value: 'ns-1.awsdns.com.' }] },
    {
      Name: 'www.example.com.',
      Type: 'A',
      AliasTarget: { DNSName: `${DIST_DOMAIN}.`, HostedZoneId: 'Z2FDTNDATAQYW2' },
    },
    { Name: 'api.example.com.', Type: 'A', AliasTarget: { DNSName: `${ELB}.` } },
    { Name: 'ext.example.com.', Type: 'CNAME', ResourceRecords: [{ Value: 'other.example.org.' }] },
  ],
}
const zoneInfo = { HostedZone: { Name: 'example.com.', Config: { Comment: 'prod' } } }

const distributions = {
  DistributionList: {
    Items: [
      {
        Id: 'E123',
        DomainName: DIST_DOMAIN,
        Status: 'Deployed',
        Aliases: { Quantity: 1, Items: ['shop.example.com'] },
        Origins: {
          Items: [
            { Id: 'o-s3', DomainName: 'shop-web.s3-website-ap-southeast-1.amazonaws.com' },
            { Id: 'o-api', DomainName: `${API_ID}.execute-api.ap-southeast-1.amazonaws.com` },
          ],
        },
        DefaultCacheBehavior: { PathPattern: '/', TargetOriginId: 'o-s3' },
        CacheBehaviors: { Items: [{ PathPattern: '/api/*', TargetOriginId: 'o-api' }] },
      },
    ],
  },
}

const apiResources = {
  items: [
    {
      path: '/v1/orders',
      resourceMethods: { POST: { methodIntegration: { type: 'AWS_PROXY', uri: LAMBDA_URI } } },
    },
  ],
}
// Hai route cùng trỏ MỘT lambda — dùng cho ca khử trùng.
const apiTwoRoutes = {
  items: [
    { path: '/v1/orders', resourceMethods: { POST: { methodIntegration: { uri: LAMBDA_URI } } } },
    { path: '/v1/orders/{id}', resourceMethods: { GET: { methodIntegration: { uri: LAMBDA_URI } } } },
  ],
}

const lambdaConfig = {
  FunctionName: FUNCTION,
  Environment: {
    Variables: {
      DB_HOST: 'orders-db.c9x.ap-southeast-1.rds.amazonaws.com',
      QUEUE_URL: 'https://sqs.ap-southeast-1.amazonaws.com/123456789012/orders',
      API_TOKEN: 'sk-live-abcdefghijklmnop',
    },
  },
}
const lambdaMappings = {
  EventSourceMappings: [
    { UUID: 'uuid-1', EventSourceArn: 'arn:aws:sqs:ap-southeast-1:123456789012:jobs' },
  ],
}

/** Chuỗi distribution lồng nhau — cố ý dài để chạm trần độ sâu ở đúng mức 4. */
const nestedDistributions = {
  DistributionList: {
    Items: [1, 2, 3, 4].map((n) => ({
      Id: `E${n}`,
      DomainName: `d${n}.cloudfront.net`,
      Origins: { Items: [{ Id: 'o', DomainName: `d${n + 1}.cloudfront.net` }] },
      DefaultCacheBehavior: { PathPattern: '/', TargetOriginId: 'o' },
    })),
  },
}

const ROOT_ZONE = `route53:global:${ZONE_ID}`
const CF_NODE = `cloudfront:global:${DIST_DOMAIN}`
const API_NODE = `apigateway:ap-southeast-1:${API_ID}`
const LAMBDA_NODE = `lambda:ap-southeast-1:${FUNCTION}`

const ids = (list: readonly { id: string }[]): string[] => list.map((x) => x.id)

/** Cả chuỗi resolver chính, sẵn sàng cho một root Route53. */
const chainResponses = {
  [K.zoneRecords]: zoneRecords,
  [K.zoneInfo]: zoneInfo,
  [K.distributions]: distributions,
  [K.apiResources]: apiResources,
  [K.apiInfo]: { name: 'shop-api' },
  [K.lambdaConfig]: lambdaConfig,
  [K.lambdaMappings]: lambdaMappings,
}

// ─── Ghép và khử trùng (hàm thuần) ───────────────────────────────────────────

describe('mergeGraphParts — khử trùng theo id, bản đầu thắng', () => {
  const node = (id: string): InfraGraphNode => ({
    id,
    service: 'x',
    label: id,
    region: 'r',
    kind: 'service',
    inferred: false,
    expandable: false,
    detail: {},
  })
  const edge = (id: string): InfraGraphEdge => ({
    id,
    from: 'a',
    to: 'b',
    label: 'alias',
    inferred: false,
    source: 'describe',
  })

  it('ghép CÙNG một mảnh hai lần ⇒ node/cạnh/ghi chú đều không nhân đôi', () => {
    const part: InfraGraphPart = {
      nodes: [node('n1'), node('n1')],
      edges: [edge('e1'), edge('e1')],
      notes: ['k', 'k'],
    }
    const merged = mergeGraphParts([part, part])
    expect(ids(merged.nodes)).toEqual(['n1'])
    expect(ids(merged.edges)).toEqual(['e1'])
    expect(merged.notes).toEqual(['k'])
  })

  it('hai mảnh khác nhau thì cộng lại, ghi chú trùng vẫn gộp một', () => {
    const merged = mergeGraphParts([
      { nodes: [node('n1')], edges: [edge('e1')], notes: ['a'] },
      { nodes: [node('n2')], edges: [edge('e2')], notes: ['a', 'b'] },
    ])
    expect(ids(merged.nodes)).toEqual(['n1', 'n2'])
    expect(ids(merged.edges)).toEqual(['e1', 'e2'])
    expect(merged.notes).toEqual(['a', 'b'])
  })
})

describe('clampGraphDepth', () => {
  it('mặc định là trần 4 và không vượt qua được', () => {
    expect(INFRA_GRAPH_MAX_DEPTH).toBe(4)
    expect(clampGraphDepth(undefined)).toBe(4)
    expect(clampGraphDepth(9)).toBe(4)
    expect(clampGraphDepth(-3)).toBe(0)
    expect(clampGraphDepth(2.9)).toBe(2)
  })
})

// ─── Dựng từ một điểm vào ────────────────────────────────────────────────────

describe('resolveInfraGraph — cả chuỗi resolver', () => {
  it('Route53 → CloudFront → API Gateway → Lambda → RDS/SQS', async () => {
    installGate(chainResponses, { xray: true })
    const out = await resolveInfraGraph({ context: CTX, rootId: ROOT_ZONE })
    if (!out.ok) throw new Error(`expected a graph, got ${JSON.stringify(out)}`)

    expect(ids(out.graph.nodes).sort()).toEqual(
      [
        ROOT_ZONE,
        CF_NODE,
        `elb:ap-southeast-1:${ELB}`,
        's3:ap-southeast-1:shop-web',
        API_NODE,
        LAMBDA_NODE,
        'rds:ap-southeast-1:orders-db',
        'sqs:ap-southeast-1:orders',
        'sqs:ap-southeast-1:jobs',
      ].sort(),
    )
    expect(out.graph.edges.map((e) => `${e.from}->${e.to}:${e.label}`).sort()).toEqual(
      [
        `${ROOT_ZONE}->${CF_NODE}:alias`,
        `${ROOT_ZONE}->elb:ap-southeast-1:${ELB}:alias`,
        `${CF_NODE}->s3:ap-southeast-1:shop-web:origin`,
        `${CF_NODE}->${API_NODE}:behavior`,
        `${API_NODE}->${LAMBDA_NODE}:target`,
        `${LAMBDA_NODE}->rds:ap-southeast-1:orders-db:env`,
        `${LAMBDA_NODE}->sqs:ap-southeast-1:orders:env`,
        `${LAMBDA_NODE}->sqs:ap-southeast-1:jobs:target`,
      ].sort(),
    )

    expect(out.graph.roots).toEqual([ROOT_ZONE])
    expect(out.graph.depth).toBe(INFRA_GRAPH_MAX_DEPTH)
    expect(out.graph.truncated).toBe(false)
    expect(out.graph.trafficSource).toBe('xray')
    expect(out.graph.notes).toContain(GRAPH_BUILD_NOTES.trafficXray)
    expect(out.command).not.toBe('')
  })

  it('tên học được từ describe-* vào đúng node (zone, alias, api)', async () => {
    installGate(chainResponses, { xray: true })
    const out = await resolveInfraGraph({ context: CTX, rootId: ROOT_ZONE })
    if (!out.ok) throw new Error('unreachable')
    const labelOf = (id: string) => out.graph.nodes.find((n) => n.id === id)?.label
    expect(labelOf(ROOT_ZONE)).toBe('example.com')
    expect(labelOf(CF_NODE)).toBe('shop.example.com')
    expect(labelOf(API_NODE)).toBe('shop-api')
  })

  it('cạnh suy từ env là nét đứt; cạnh đọc được là nét liền', async () => {
    installGate(chainResponses, { xray: true })
    const out = await resolveInfraGraph({ context: CTX, rootId: ROOT_ZONE })
    if (!out.ok) throw new Error('unreachable')
    const inferred = out.graph.edges.filter((e) => e.inferred)
    expect(inferred.map((e) => e.label)).toEqual(['env', 'env'])
    expect(inferred.every((e) => e.source === 'config')).toBe(true)
    expect(
      out.graph.edges.filter((e) => !e.inferred).every((e) => e.source === 'describe'),
    ).toBe(true)
  })

  it('GIÁ TRỊ env không lọt vào graph (invariant 1, test âm)', async () => {
    installGate(chainResponses, { xray: true })
    const out = await resolveInfraGraph({ context: CTX, rootId: ROOT_ZONE })
    if (!out.ok) throw new Error('unreachable')
    const text = JSON.stringify(out.graph)
    expect(text).not.toContain('orders-db.c9x.ap-southeast-1.rds.amazonaws.com')
    expect(text).not.toContain('https://sqs.ap-southeast-1.amazonaws.com/123456789012/orders')
    // TÊN biến thì ĐƯỢC giữ (UI hiện được "nối qua DB_HOST"), giá trị thì không.
    expect(text).toContain('DB_HOST')
    expect(text).not.toContain('sk-live-abcdefghijklmnop')
  })

  it('nối bằng `graph-expand` rồi ghép lại vẫn khử trùng (merge hai lần)', async () => {
    installGate(chainResponses, { xray: true })
    const first = await resolveInfraGraph({ context: CTX, rootId: ROOT_ZONE })
    if (!first.ok) throw new Error('unreachable')
    const again = await expandInfraGraph({ context: CTX, nodeId: CF_NODE })
    if (!again.ok) throw new Error('unreachable')

    const before = first.graph.nodes.length
    const merged = mergeGraphParts([first.graph, again.graph])
    expect(merged.nodes.length).toBe(before)
    expect(ids(merged.nodes).filter((id) => id === CF_NODE)).toHaveLength(1)
  })

  it('hai route cùng trỏ một lambda ⇒ một node, hai cạnh', async () => {
    installGate(
      { ...chainResponses, [K.apiResources]: apiTwoRoutes },
      { xray: true },
    )
    const out = await resolveInfraGraph({ context: CTX, rootId: API_NODE, depth: 2 })
    if (!out.ok) throw new Error('unreachable')
    expect(ids(out.graph.nodes).filter((id) => id === LAMBDA_NODE)).toHaveLength(1)
    expect(out.graph.edges.filter((e) => e.to === LAMBDA_NODE)).toHaveLength(2)
    expect(new Set(out.graph.edges.map((e) => e.id)).size).toBe(out.graph.edges.length)
  })

  it('cổng chặn ⇒ trả nguyên hình dạng §2, không trả graph rỗng', async () => {
    installGate(chainResponses, { xray: true, denyOn: (args) => args[0] === 'route53' })
    const out = await resolveInfraGraph({ context: CTX, rootId: ROOT_ZONE })
    expect(out.ok).toBe(false)
    if (out.ok || !out.blocked) throw new Error('expected a blocked outcome')
    expect(out.requiresApproval).toBe(true)
    expect(out.approvalTicket).toBe('ticket-1')
  })

  it('điểm vào sai khuôn ⇒ lỗi tường minh, không gọi CLI lần nào', async () => {
    installGate(chainResponses, { xray: true })
    const out = await resolveInfraGraph({ context: CTX, rootId: 'khong-phai-id' })
    expect(out.ok).toBe(false)
    if (out.ok || out.blocked) throw new Error('expected a plain error')
    expect(runGated).not.toHaveBeenCalled()
  })
})

// ─── Trần độ sâu ─────────────────────────────────────────────────────────────

describe('trần độ sâu', () => {
  it('chạm trần 4 ⇒ truncated + node ở trần không mở tiếp', async () => {
    installGate({ [K.distributions]: nestedDistributions }, { xray: true })
    const out = await resolveInfraGraph({
      context: CTX,
      rootId: 'cloudfront:global:d1.cloudfront.net',
    })
    if (!out.ok) throw new Error('unreachable')

    // d1(0) → d2(1) → d3(2) → d4(3) → d5(4 = trần): nhánh d5 phải bị cắt.
    expect(out.graph.truncated).toBe(true)
    expect(out.graph.notes).toContain(GRAPH_NOTES.depthTruncated)
    expect(out.graph.nodes.find((n) => n.id === 'cloudfront:global:d5.cloudfront.net')?.expandable).toBe(
      false,
    )
    // Không mở tiếp sang d6 — nhánh đã cắt thì không chạy thêm lệnh.
    expect(ids(out.graph.nodes)).not.toContain('cloudfront:global:d6.cloudfront.net')
  })

  it('trần thấp hơn ⇒ cắt sớm hơn, và node bị cắt không sinh con', async () => {
    installGate(chainResponses, { xray: true })
    const out = await resolveInfraGraph({ context: CTX, rootId: ROOT_ZONE, depth: 2 })
    if (!out.ok) throw new Error('unreachable')
    expect(out.graph.depth).toBe(2)
    expect(out.graph.truncated).toBe(true)
    expect(out.graph.nodes.find((n) => n.id === API_NODE)?.expandable).toBe(false)
    expect(ids(out.graph.nodes)).not.toContain(LAMBDA_NODE)
  })
})

// ─── Dựng tiếp từ một node ───────────────────────────────────────────────────

describe('expandInfraGraph', () => {
  it('chỉ trả PHẦN MỚI: không có node bắt đầu, một hop, depth 1', async () => {
    installGate(chainResponses, { xray: true })
    const out = await expandInfraGraph({ context: CTX, nodeId: CF_NODE })
    if (!out.ok) throw new Error('unreachable')
    expect(ids(out.graph.nodes).sort()).toEqual(
      ['apigateway:ap-southeast-1:abc123', 's3:ap-southeast-1:shop-web'].sort(),
    )
    expect(ids(out.graph.nodes)).not.toContain(CF_NODE)
    expect(out.graph.edges).toHaveLength(2)
    expect(out.graph.depth).toBe(1)
    expect(out.graph.roots).toEqual([CF_NODE])
    // Mở tay một node thì node mới vẫn còn mở tiếp được, và không tính là bị cắt.
    expect(out.graph.truncated).toBe(false)
    expect(out.graph.nodes.find((n) => n.id === API_NODE)?.expandable).toBe(true)
  })

  it('node lá không có resolver ⇒ graph rỗng, không gọi CLI', async () => {
    installGate({})
    const out = await expandInfraGraph({
      context: CTX,
      nodeId: 'sqs:ap-southeast-1:orders',
    })
    if (!out.ok) throw new Error('unreachable')
    expect(out.graph.nodes).toEqual([])
    expect(out.graph.edges).toEqual([])
    // Chỉ hai phép dò lưu lượng, không có lượt đọc nào cho node lá.
    expect(runGated.mock.calls.filter((c) => (c[0] as InfraGateInput).args[0] !== 'xray')).toHaveLength(1)
  })
})

// ─── Nguồn lưu lượng (Q4 còn treo) ───────────────────────────────────────────

describe('nguồn lưu lượng', () => {
  const build = async (opts: GateOptions) => {
    installGate(chainResponses, opts)
    const out = await resolveInfraGraph({ context: CTX, rootId: ROOT_ZONE })
    if (!out.ok) throw new Error('unreachable')
    return out.graph
  }

  it('có X-Ray ⇒ dùng X-Ray và NÓI RA là đang dùng X-Ray', async () => {
    const graph = await build({ xray: true })
    expect(graph.trafficSource).toBe('xray')
    expect(graph.notes).toContain(GRAPH_BUILD_NOTES.trafficXray)
  })

  it('không X-Ray nhưng có CloudWatch ⇒ hạ xuống CloudWatch', async () => {
    const graph = await build({ cloudwatch: true })
    expect(graph.trafficSource).toBe('cloudwatch')
    expect(graph.notes).toContain(GRAPH_BUILD_NOTES.trafficCloudwatch)
    expect(graph.notes).not.toContain(GRAPH_BUILD_NOTES.trafficXray)
  })

  it('không có nguồn nào ⇒ none, vẫn nói ra nguồn đang dùng', async () => {
    const graph = await build({})
    expect(graph.trafficSource).toBe('none')
    expect(graph.notes).toContain(GRAPH_BUILD_NOTES.trafficNone)
  })
})

// ─── Điểm vào ────────────────────────────────────────────────────────────────

describe('listInfraGraphRoots', () => {
  it('ba lượt đọc, gộp điểm vào của cả ba loại', async () => {
    installGate({
      'route53 list-hosted-zones --max-items 200': {
        HostedZones: [{ Id: '/hostedzone/Z123ABC', Name: 'example.com.' }],
      },
      'cloudfront list-distributions --max-items 200': distributions,
      'apigateway get-rest-apis --limit 200': { items: [{ id: API_ID, name: 'shop-api' }] },
    })
    const out = await listInfraGraphRoots({ context: CTX })
    if (!out.ok) throw new Error('unreachable')
    expect(ids(out.roots)).toEqual([
      ROOT_ZONE,
      CF_NODE,
      API_NODE,
    ])
    expect(out.notes).not.toContain(GRAPH_BUILD_NOTES.noRootFound)
    expect(runGated).toHaveBeenCalledTimes(3)
  })

  it('một loại hỏng ⇒ ghi chú RIÊNG cho loại đó, hai loại kia vẫn dùng được', async () => {
    installGate(
      {
        'cloudfront list-distributions --max-items 200': distributions,
        'apigateway get-rest-apis --limit 200': { items: [{ id: API_ID, name: 'shop-api' }] },
      },
      { failOn: (args) => args[0] === 'route53' },
    )
    const out = await listInfraGraphRoots({ context: CTX })
    if (!out.ok) throw new Error('unreachable')
    expect(out.notes).toContain(`${GRAPH_BUILD_NOTES.rootsFailedPrefix}.route53`)
    expect(ids(out.roots)).toEqual([CF_NODE, API_NODE])
  })

  it('không loại nào trả gì ⇒ nói ra là không tìm thấy', async () => {
    installGate({})
    const out = await listInfraGraphRoots({ context: CTX })
    if (!out.ok) throw new Error('unreachable')
    expect(out.roots).toEqual([])
    expect(out.notes).toContain(GRAPH_BUILD_NOTES.noRootFound)
  })

  it('cổng chặn ngay lượt đọc đầu ⇒ trả Blocked, không trả danh sách rỗng', async () => {
    installGate({}, { denyOn: () => true })
    const out = await listInfraGraphRoots({ context: CTX })
    expect(out.ok).toBe(false)
    if (out.ok || !out.blocked) throw new Error('expected blocked')
    expect(out.requiresApproval).toBe(true)
  })
})
