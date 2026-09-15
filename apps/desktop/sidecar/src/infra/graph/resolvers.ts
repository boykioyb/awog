// Tầng RESOLVER của Graph kiến trúc (Mốc 5, phần 5.2 của `infra.tasks.md`).
//
// File này THUẦN: không spawn CLI, không đọc đĩa, không chạm `runGated`. Việc chạy
// lệnh nằm ở `build.ts`; ở đây chỉ có hai thứ:
//   1. dựng ARGV cho một node (`resolverArgvFor`),
//   2. ghép JSON của CLI thành node + cạnh (`resolveGraphStep`).
// Nhờ tách như vậy, cả chuỗi resolver — Route53 → CloudFront → API Gateway →
// Lambda/ECS → RDS/SQS — test được bằng JSON mẫu, không cần một tài khoản AWS nào.
//
// BA LUẬT KHÔNG ĐƯỢC PHÁ Ở TẦNG NÀY
//   1. GIÁ TRỊ biến môi trường KHÔNG BAO GIỜ vào node/cạnh/cache/chat. Giá trị được
//      soi trong bộ nhớ để đoán tài nguyên đích, rồi BỊ BỎ — chỉ TÊN biến và ARN đi
//      tiếp. `targetFromEnvValue()` là đúng ranh giới đó: mọi thứ sau nó chỉ nhận
//      tên tài nguyên, không bao giờ nhận chuỗi env.
//   2. Cạnh suy từ env/config có `inferred: true` + `source: 'config'` (UI vẽ nét
//      đứt); cạnh đọc được từ `describe-*` có `inferred: false`.
//   3. Cross-account / cross-region ⇒ node `kind: 'external'`, KHÔNG mở tiếp.
//
// `id` của node là `${service}:${region}:${tên}` và phải ĐỦ để dựng lại argv: SÁU
// resolver dưới đây chỉ nhận một `InfraResolveTarget` (service + region + tên) — vì
// `infra.graph-expand` chỉ có đúng một `nodeId`, không có node.

import { asArray, asObj, arnTail, at, str } from '../resources/spec.js'
import { redactString } from '../../sessions/redact.js'
import type {
  InfraGraphEdge,
  InfraGraphEdgeLabel,
  InfraGraphEdgeSource,
  InfraGraphNode,
  InfraGraphRoot,
} from './types.js'

// ─── Kiểu ─────────────────────────────────────────────────────────────────────

/** Đích của một bước resolve — đúng ba thứ `id` của node mang theo. */
export type InfraResolveTarget = {
  service: string
  region: string
  /** Phần đuôi của id; ý nghĩa tuỳ service (zone id, api id, tên function…). */
  name: string
}

export type InfraResolveContext = {
  /** Region ĐANG GHIM ('' = chưa ghim, tức không kết luận được cross-region). */
  region: string
  accountId?: string | undefined
  /** Độ sâu của CHÍNH node đang mở; node con của nó ở `depth + 1`. */
  depth: number
  /** Trần độ sâu; `Number.POSITIVE_INFINITY` khi mở rộng thủ công một node. */
  maxDepth: number
}

/**
 * Thông tin resolver học được về CHÍNH node đang mở (tên người đọc được, vài khoá
 * chi tiết). Cố ý không nằm trong kết quả trả lên UI: `build.ts` trộn nó vào node
 * đã có trong graph, nên hình dạng IPC không đổi.
 */
export type InfraResolverSelf = {
  label?: string | undefined
  detail?: Record<string, string> | undefined
}

export type InfraResolverResult = {
  nodes: InfraGraphNode[]
  edges: InfraGraphEdge[]
  /** Khoá i18n cho những thứ bị bỏ qua. */
  notes: string[]
  /** Có node con PHẢI cắt vì chạm trần độ sâu. */
  truncated: boolean
  self?: InfraResolverSelf | undefined
}

/**
 * Khoá i18n của ghi chú do tầng resolver phát ra. Đặt thành hằng để workstream UI
 * không phải chép lại chuỗi (một khoá sai chính tả là một dòng `[missing]` trên UI).
 */
export const GRAPH_NOTES = {
  depthTruncated: 'infra.graph.note.depthTruncated',
  crossAccount: 'infra.graph.note.crossAccount',
  crossRegion: 'infra.graph.note.crossRegion',
  dnsTargetUnsupported: 'infra.graph.note.dnsTargetUnsupported',
  distributionNotFound: 'infra.graph.note.distributionNotFound',
  originNotFound: 'infra.graph.note.originNotFound',
  integrationUnsupported: 'infra.graph.note.integrationUnsupported',
  eventSourceUnsupported: 'infra.graph.note.eventSourceUnsupported',
  ecsServiceNotFound: 'infra.graph.note.ecsServiceNotFound',
  secretRefOnly: 'infra.graph.note.secretRefOnly',
} as const

// ─── Id của node ──────────────────────────────────────────────────────────────

export function graphNodeId(t: { service: string; region: string; name: string }): string {
  return `${t.service}:${t.region}:${t.name}`
}

/**
 * Dựng lại đích từ `nodeId`. Tên tài nguyên ĐƯỢC PHÉP chứa `:` (ARN của ECS task
 * definition), nên chỉ hai dấu `:` đầu là dấu phân cách.
 */
export function targetFromNodeId(id: string): InfraResolveTarget | null {
  const first = id.indexOf(':')
  if (first <= 0) return null
  const second = id.indexOf(':', first + 1)
  if (second < 0) return null
  const service = id.slice(0, first)
  const region = id.slice(first + 1, second)
  const name = id.slice(second + 1)
  if (name === '') return null
  return { service, region, name }
}

// ─── Phân loại tài nguyên: miền, ARN, giá trị env ─────────────────────────────

type ChildTarget = {
  service: string
  region: string
  name: string
  label: string
  /** Chỉ có khi biết chắc (ARN) — dùng để phát hiện cross-account. */
  accountId?: string | undefined
  detail?: Record<string, string> | undefined
}

/** `arn:aws:lambda:ap-southeast-1:123456789012:function:api` → `{ region, accountId }`. */
function arnParts(arn: string): { region: string; accountId: string } {
  const parts = arn.split(':')
  return { region: str(parts[3]), accountId: str(parts[4]) }
}

/** Phần tử ngay SAU `marker` trong một miền: `abc.execute-api.ap-southeast-1.…` → region. */
function segmentAfter(domain: string, marker: string): string {
  const parts = domain.split('.')
  const i = parts.indexOf(marker)
  return i >= 0 ? str(parts[i + 1]) : ''
}

/**
 * Miền AWS → tài nguyên. Dùng chung cho alias của Route53 và origin của CloudFront
 * (cùng một miền được trỏ tới từ hai phía, nên phân loại phải là MỘT hàm).
 */
function targetFromDomain(domainIn: string): ChildTarget | null {
  const domain = domainIn.trim().toLowerCase().replace(/\.$/, '')
  if (domain === '') return null

  if (domain.endsWith('.cloudfront.net')) {
    return { service: 'cloudfront', region: 'global', name: domain, label: domain }
  }

  if (domain.includes('.execute-api.')) {
    const apiId = str(domain.split('.')[0])
    const region = segmentAfter(domain, 'execute-api')
    if (apiId && region) return { service: 'apigateway', region, name: apiId, label: apiId }
    return null
  }

  if (domain.endsWith('.elb.amazonaws.com')) {
    // my-alb-1234567.ap-southeast-1.elb.amazonaws.com
    const region = str(domain.split('.').slice(-4)[0])
    return { service: 'elb', region, name: domain, label: domain }
  }

  // S3: REST endpoint (bucket.s3[.region].amazonaws.com) và website endpoint
  // (bucket.s3-website[-.]region.amazonaws.com) — CloudFront trỏ tới cả hai kiểu.
  const s3 = /^([^./]+)\.s3(?:-website)?[.-]([a-z0-9-]+)\.amazonaws\.com$/.exec(domain)
  if (s3) {
    const bucket = str(s3[1])
    return { service: 's3', region: str(s3[2]), name: bucket, label: bucket }
  }
  const s3Default = /^([^./]+)\.s3\.amazonaws\.com$/.exec(domain)
  if (s3Default) {
    const bucket = str(s3Default[1])
    return { service: 's3', region: 'us-east-1', name: bucket, label: bucket }
  }

  return null
}

/** ARN của SQS → node. Dùng chung cho env của Lambda/ECS và event source mapping. */
function targetFromSqsArn(arnIn: string): ChildTarget | null {
  const arn = arnIn.trim()
  const m = /^arn:aws[a-z-]*:sqs:([a-z0-9-]+):(\d{12}):(.+)$/.exec(arn)
  if (!m) return null
  const name = str(m[3])
  return { service: 'sqs', region: str(m[1]), name, label: name, accountId: str(m[2]) }
}

/**
 * GIÁ TRỊ một biến môi trường → tài nguyên nó trỏ tới, hoặc `null`.
 *
 * ĐÂY LÀ RANH GIỚI BẢO MẬT CỦA CẢ FILE (invariant 1). Chuỗi đầu vào là giá trị L1
 * của người dùng (DB_HOST, QUEUE_URL…) và có thể chứa mật khẩu nhúng
 * (`postgres://user:pass@host`). Hàm này chỉ ĐỌC nó để rút ra định danh tài nguyên
 * (tên queue, tên DB, region) — giá trị gốc không được trả về, không được ghi vào
 * node/cạnh/detail. Test âm trong `__tests__/resolvers.test.ts` khoá đúng luật này.
 */
function targetFromEnvValue(valueIn: string): ChildTarget | null {
  const value = valueIn.trim()
  if (value === '') return null

  const sqsArn = targetFromSqsArn(value)
  if (sqsArn) return sqsArn

  const sqsUrl = /^https?:\/\/sqs\.([a-z0-9-]+)\.amazonaws\.com\/(\d{12})\/(.+)$/.exec(value)
  if (sqsUrl) {
    const name = str(sqsUrl[3])
    return { service: 'sqs', region: str(sqsUrl[1]), name, label: name, accountId: str(sqsUrl[2]) }
  }

  // RDS (kể cả cluster endpoint): `orders-db[.cluster-id].<region>.rds.amazonaws.com`.
  const rds = /^([a-z0-9][a-z0-9-]*)\.(?:[a-z0-9-]+\.)?([a-z]{2}-[a-z]+-\d)\.rds\.amazonaws\.com$/.exec(
    value,
  )
  if (rds) {
    const name = str(rds[1])
    // Chỉ TÊN DB đi tiếp — phần hostname còn lại của giá trị env bị bỏ tại đây.
    return { service: 'rds', region: str(rds[2]), name, label: name }
  }

  return null
}

/** URI integration của API Gateway → tài nguyên đích. */
function targetFromIntegrationUri(uriIn: string): ChildTarget | null {
  const uri = uriIn.trim()
  if (uri === '') return null

  // AWS_PROXY Lambda: `arn:aws:apigateway:<r>:lambda:path/2015-03-31/functions/<ARN lambda>/invocations`
  const lambda = /arn:aws[a-z-]*:lambda:([a-z0-9-]+):(\d{12}):function:([^/]+)/.exec(uri)
  if (lambda) {
    const name = str(lambda[3])
    return {
      service: 'lambda',
      region: str(lambda[1]),
      name,
      label: name,
      accountId: str(lambda[2]),
      detail: { arn: `arn:aws:lambda:${str(lambda[1])}:${str(lambda[2])}:function:${name}` },
    }
  }

  // Private integration: `arn:aws:ecs:<r>:<acct>:service/<cluster>/<service>`.
  const ecs = /arn:aws[a-z-]*:ecs:([a-z0-9-]+):(\d{12}):service\/([^/]+)\/([^/]+)/.exec(uri)
  if (ecs) {
    const name = `${str(ecs[3])}/${str(ecs[4])}`
    return { service: 'ecs', region: str(ecs[1]), name, label: name, accountId: str(ecs[2]) }
  }

  // HTTP proxy ra ngoài AWS: chỉ giữ HOST (URI có thể mang credential nhúng).
  const http = /^https?:\/\/([^/?#]+)/.exec(uri)
  if (http) {
    const host = str(http[1])
    return { service: 'external', region: '', name: host, label: host }
  }

  return null
}

// ─── Ghép node + cạnh ─────────────────────────────────────────────────────────

type Acc = {
  nodes: InfraGraphNode[]
  edges: InfraGraphEdge[]
  notes: Set<string>
  truncated: boolean
}

function newAcc(): Acc {
  return { nodes: [], edges: [], notes: new Set(), truncated: false }
}

function note(acc: Acc, key: string): void {
  acc.notes.add(key)
}

function done(acc: Acc, self?: InfraResolverSelf): InfraResolverResult {
  // Thông tin về CHÍNH node cũng đi qua `redactString` như mọi chuỗi khác — nó có
  // thể là alias của distribution hoặc comment của zone (nội dung người dùng gõ).
  const clean = self
    ? {
        ...(self.label !== undefined ? { label: redactString(self.label) } : {}),
        ...(self.detail !== undefined ? { detail: redactDetail(self.detail) } : {}),
      }
    : undefined
  return {
    nodes: acc.nodes,
    edges: acc.edges,
    notes: [...acc.notes],
    truncated: acc.truncated,
    ...(clean ? { self: clean } : {}),
  }
}

function redactDetail(detail: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(detail ?? {})) {
    const text = redactString(value).slice(0, 200)
    if (text !== '') out[key] = text
  }
  return out
}

/**
 * Node nằm ngoài phạm vi đang ghim. `region` rỗng nghĩa là chưa biết, nên KHÔNG
 * kết luận cross-region từ chỗ chưa biết (`'' === ''` không phải bằng chứng).
 */
function externalReason(child: ChildTarget, ctx: InfraResolveContext): 'account' | 'region' | null {
  if (child.accountId && ctx.accountId && child.accountId !== ctx.accountId) return 'account'
  const a = child.region
  const b = ctx.region
  if (a && b && a !== 'global' && b !== 'global' && a !== b) return 'region'
  return null
}

type LinkSpec = {
  parentId: string
  label: InfraGraphEdgeLabel
  source: InfraGraphEdgeSource
  inferred: boolean
  /** Phân biệt nhiều cạnh giữa CÙNG một cặp node (route, behavior, tên biến env). */
  key?: string | undefined
}

/**
 * ĐIỂM DUY NHẤT sinh ra node + cạnh của một bước resolve. Mọi resolver dưới đây đi
 * qua hàm này, nên ba luật ở đầu file chỉ được cài đúng một lần: nhãn/chi tiết đi
 * qua `redactString`, `expandable` tính theo trần độ sâu, và node ngoài phạm vi
 * thành `external` + không mở tiếp.
 */
function link(acc: Acc, child: ChildTarget, ctx: InfraResolveContext, l: LinkSpec): void {
  const id = graphNodeId(child)
  const childDepth = ctx.depth + 1
  const reason = externalReason(child, ctx)
  const external = reason !== null
  const canExpand = !external && hasGraphResolver(child.service)
  const capped = canExpand && childDepth >= ctx.maxDepth

  if (reason === 'account') note(acc, GRAPH_NOTES.crossAccount)
  if (reason === 'region') note(acc, GRAPH_NOTES.crossRegion)
  if (capped) {
    acc.truncated = true
    note(acc, GRAPH_NOTES.depthTruncated)
  }

  acc.nodes.push({
    id,
    service: child.service,
    label: redactString(child.label),
    region: child.region,
    kind: external ? 'external' : 'service',
    inferred: l.inferred,
    expandable: canExpand && !capped,
    detail: redactDetail(child.detail),
  })
  acc.edges.push({
    id: [l.parentId, id, l.label, l.key ?? ''].join('|'),
    from: l.parentId,
    to: id,
    label: l.label,
    inferred: l.inferred,
    source: l.source,
  })
}

// ─── Resolver từng dịch vụ ────────────────────────────────────────────────────

type InfraGraphResolver = {
  /** Lệnh ĐỌC cần cho node này, theo thứ tự. Rỗng ⇒ node là lá. */
  argv: (target: InfraResolveTarget) => readonly (readonly string[])[]
  /** Ghép JSON của từng lệnh (theo đúng thứ tự `argv`; `null` = lệnh đó hỏng). */
  parse: (
    target: InfraResolveTarget,
    jsons: readonly unknown[],
    ctx: InfraResolveContext,
  ) => InfraResolverResult
}

/** Route53: hosted zone → bản ghi alias/CNAME → điểm vào thật của hệ thống. */
const route53Resolver: InfraGraphResolver = {
  argv: (t) => [
    ['route53', 'list-resource-record-sets', '--hosted-zone-id', t.name, '--max-items', '500'],
    ['route53', 'get-hosted-zone', '--id', t.name],
  ],
  parse: (t, jsons, ctx) => {
    const acc = newAcc()
    const parentId = graphNodeId(t)

    for (const raw of asArray(at(jsons[0], 'ResourceRecordSets'))) {
      const rec = asObj(raw)
      const type = str(rec['Type'])
      const record = str(rec['Name']).replace(/\.$/, '')
      const alias = str(at(rec, 'AliasTarget.DNSName')).replace(/\.$/, '')
      // Chỉ hai dạng này trỏ tới một TÀI NGUYÊN. `A` không alias là IP (không có
      // gì để mở tiếp), `NS`/`SOA` là hạ tầng của chính zone.
      const targets = alias
        ? [alias]
        : type === 'CNAME'
          ? asArray(rec['ResourceRecords']).map((v) => str(asObj(v)['Value']).replace(/\.$/, ''))
          : []
      for (const dns of targets) {
        const child = targetFromDomain(dns)
        if (!child) {
          note(acc, GRAPH_NOTES.dnsTargetUnsupported)
          continue
        }
        link(acc, child, ctx, {
          parentId,
          label: 'alias',
          source: 'describe',
          inferred: false,
          key: `${record}|${type}`,
        })
      }
    }

    const zoneName = str(at(jsons[1], 'HostedZone.Name')).replace(/\.$/, '')
    return done(
      acc,
      zoneName === ''
        ? undefined
        : {
            label: zoneName,
            detail: { comment: str(at(jsons[1], 'HostedZone.Config.Comment')) },
          },
    )
  },
}

/** CloudFront: distribution → behavior (đường dẫn) → origin. */
const cloudfrontResolver: InfraGraphResolver = {
  argv: () => [['cloudfront', 'list-distributions', '--max-items', '200']],
  parse: (t, jsons, ctx) => {
    const acc = newAcc()
    const parentId = graphNodeId(t)
    const dist = asArray(at(jsons[0], 'DistributionList.Items'))
      .map(asObj)
      .find((d) => str(d['DomainName']).toLowerCase() === t.name)
    if (!dist) {
      note(acc, GRAPH_NOTES.distributionNotFound)
      return done(acc)
    }

    const origins = new Map<string, Record<string, unknown>>()
    for (const raw of asArray(at(dist, 'Origins.Items'))) {
      const o = asObj(raw)
      origins.set(str(o['Id']), o)
    }

    // DefaultCacheBehavior luôn tồn tại; CacheBehaviors là các đường dẫn thêm.
    const behaviors: { pattern: string; originId: string }[] = []
    const def = asObj(dist['DefaultCacheBehavior'])
    if (str(def['TargetOriginId'])) {
      behaviors.push({ pattern: str(def['PathPattern']) || '/', originId: str(def['TargetOriginId']) })
    }
    for (const raw of asArray(at(dist, 'CacheBehaviors.Items'))) {
      const b = asObj(raw)
      if (str(b['TargetOriginId'])) {
        behaviors.push({ pattern: str(b['PathPattern']) || '/', originId: str(b['TargetOriginId']) })
      }
    }

    for (const behavior of behaviors) {
      const origin = origins.get(behavior.originId)
      const domain = str(origin?.['DomainName']).replace(/\.$/, '')
      if (domain === '') {
        note(acc, GRAPH_NOTES.originNotFound)
        continue
      }
      // Origin không nhận ra (miền của người dùng, endpoint ngoài AWS) vẫn phải
      // hiện trên graph — bỏ nó đi là vẽ một hệ thống thiếu mất một nhánh.
      const child = targetFromDomain(domain) ?? {
        service: 'external',
        region: t.region,
        name: domain,
        label: domain,
      }
      link(acc, { ...child, detail: { ...child.detail, pattern: behavior.pattern } }, ctx, {
        parentId,
        label: behavior.pattern === '/' ? 'origin' : 'behavior',
        source: 'describe',
        inferred: false,
        key: behavior.pattern,
      })
    }

    const alias = str(asArray(at(dist, 'Aliases.Items'))[0])
    return done(acc, {
      label: alias || t.name,
      detail: {
        status: str(dist['Status']),
        aliases: asArray(at(dist, 'Aliases.Items')).map((a) => str(a)).join(', '),
      },
    })
  },
}

/** API Gateway (REST, v1): api → resource/method → integration. */
const apigatewayResolver: InfraGraphResolver = {
  argv: (t) => [
    ['apigateway', 'get-resources', '--rest-api-id', t.name, '--embed', 'methods', '--limit', '500'],
    ['apigateway', 'get-rest-api', '--rest-api-id', t.name],
  ],
  parse: (t, jsons, ctx) => {
    const acc = newAcc()
    const parentId = graphNodeId(t)

    for (const raw of asArray(at(jsons[0], 'items'))) {
      const resource = asObj(raw)
      const path = str(resource['path']) || '/'
      for (const [method, rawMethod] of Object.entries(asObj(resource['resourceMethods']))) {
        const uri = str(at(asObj(rawMethod), 'methodIntegration.uri'))
        // `MOCK` không có backend — không có gì để nối, và đó không phải lỗi.
        if (uri === '') continue
        const route = `${method} ${path}`
        const child = targetFromIntegrationUri(uri)
        if (!child) {
          note(acc, GRAPH_NOTES.integrationUnsupported)
          continue
        }
        link(acc, { ...child, detail: { ...child.detail, route } }, ctx, {
          parentId,
          label: 'target',
          source: 'describe',
          inferred: false,
          key: route,
        })
      }
    }

    const name = str(at(jsons[1], 'name'))
    return done(acc, name === '' ? undefined : { label: name })
  },
}

/** Lambda: biến môi trường (suy luận) + event source mapping (AWS kể ra được). */
const lambdaResolver: InfraGraphResolver = {
  argv: (t) => [
    ['lambda', 'get-function-configuration', '--function-name', t.name],
    ['lambda', 'list-event-source-mappings', '--function-name', t.name],
  ],
  parse: (t, jsons, ctx) => {
    const acc = newAcc()
    const parentId = graphNodeId(t)

    // (1) Biến môi trường: CHỈ TÊN biến đi tiếp (xem `targetFromEnvValue`).
    for (const [key, value] of Object.entries(asObj(at(jsons[0], 'Environment.Variables')))) {
      const child = targetFromEnvValue(str(value))
      if (!child) continue
      link(acc, { ...child, detail: { ...child.detail, env: key } }, ctx, {
        parentId,
        label: 'env',
        source: 'config',
        inferred: true,
        key,
      })
    }

    // (2) Event source mapping: liên kết AWS TỰ KỂ RA ⇒ nét liền, không suy luận.
    for (const raw of asArray(at(jsons[1], 'EventSourceMappings'))) {
      const mapping = asObj(raw)
      const arn = str(mapping['EventSourceArn'])
      const child = targetFromSqsArn(arn)
      if (!child) {
        if (arn !== '') note(acc, GRAPH_NOTES.eventSourceUnsupported)
        continue
      }
      link(acc, { ...child, detail: { ...child.detail, via: 'event-source' } }, ctx, {
        parentId,
        label: 'target',
        source: 'describe',
        inferred: false,
        key: str(mapping['UUID']) || arn,
      })
    }

    return done(acc)
  },
}

/**
 * ECS. Hai chế độ, phân biệt bằng chính `name`:
 *   · `<cluster>/<service>` → `describe-services` → node task definition;
 *   · `arn:…:task-definition/<family>:<rev>` → `describe-task-definition`.
 *
 * Chế độ thứ hai KHÔNG nhận `name` bắt đầu bằng `arn:` một cách mù quáng: nó đòi
 * đúng chuỗi `:task-definition/`, nếu không thì một node con của chính nó (ARN +
 * hậu tố) sẽ gọi lại chính nó mãi.
 */
const ecsResolver: InfraGraphResolver = {
  argv: (t) => {
    if (t.name.includes(':task-definition/')) {
      return [['ecs', 'describe-task-definition', '--task-definition', t.name]]
    }
    const [cluster, service] = t.name.split('/')
    if (!cluster || !service) return []
    return [['ecs', 'describe-services', '--cluster', cluster, '--services', service]]
  },
  parse: (t, jsons, ctx) => {
    const acc = newAcc()
    const parentId = graphNodeId(t)

    if (t.name.includes(':task-definition/')) {
      for (const raw of asArray(at(jsons[0], 'taskDefinition.containerDefinitions'))) {
        const container = asObj(raw)
        const containerName = str(container['name'])
        for (const rawEnv of asArray(container['environment'])) {
          const env = asObj(rawEnv)
          const key = str(env['name'])
          if (key === '') continue
          const child = targetFromEnvValue(str(env['value']))
          if (!child) continue
          link(acc, { ...child, detail: { ...child.detail, env: key, container: containerName } }, ctx, {
            parentId,
            label: 'env',
            source: 'config',
            inferred: true,
            key: `${containerName}.${key}`,
          })
        }
        // `secrets[].valueFrom` là ARN của Secrets Manager/SSM: chỉ TÊN tham chiếu
        // được phép lộ ra, và việc đọc giá trị không thuộc graph.
        if (asArray(container['secrets']).length > 0) note(acc, GRAPH_NOTES.secretRefOnly)
      }
      return done(acc)
    }

    const service = asObj(asArray(at(jsons[0], 'services'))[0])
    const taskDefinition = str(service['taskDefinition'])
    if (taskDefinition === '') {
      note(acc, GRAPH_NOTES.ecsServiceNotFound)
      return done(acc)
    }
    const { region, accountId } = arnParts(taskDefinition)
    link(
      acc,
      {
        service: 'ecs',
        region: region || t.region,
        name: taskDefinition,
        label: arnTail(taskDefinition, '/'),
        accountId,
        detail: { service: str(service['serviceName']) },
      },
      ctx,
      { parentId, label: 'target', source: 'describe', inferred: false },
    )
    return done(acc)
  },
}

const RESOLVERS = new Map<string, InfraGraphResolver>([
  ['route53', route53Resolver],
  ['cloudfront', cloudfrontResolver],
  ['apigateway', apigatewayResolver],
  ['lambda', lambdaResolver],
  ['ecs', ecsResolver],
])

/** `rds`/`sqs`/`s3`/`elb` cố ý KHÔNG có resolver: chúng là lá của graph hôm nay. */
export function hasGraphResolver(service: string): boolean {
  return RESOLVERS.has(service)
}

export function resolverArgvFor(target: InfraResolveTarget): readonly (readonly string[])[] {
  return RESOLVERS.get(target.service)?.argv(target) ?? []
}

export function resolveGraphStep(
  target: InfraResolveTarget,
  jsons: readonly unknown[],
  ctx: InfraResolveContext,
): InfraResolverResult {
  const resolver = RESOLVERS.get(target.service)
  if (!resolver) {
    return { nodes: [], edges: [], notes: [], truncated: false }
  }
  return resolver.parse(target, jsons, ctx)
}

// ─── Điểm vào: điểm gốc của graph ─────────────────────────────────────────────

export type InfraRootSource = 'route53' | 'cloudfront' | 'apigateway'

/** Một lượt đọc cho mỗi loại điểm vào; đây cũng là ba lệnh của `graph-roots`. */
export const GRAPH_ROOT_COMMANDS: readonly { service: InfraRootSource; args: readonly string[] }[] =
  [
    { service: 'route53', args: ['route53', 'list-hosted-zones', '--max-items', '200'] },
    { service: 'cloudfront', args: ['cloudfront', 'list-distributions', '--max-items', '200'] },
    { service: 'apigateway', args: ['apigateway', 'get-rest-apis', '--limit', '200'] },
  ]

/**
 * JSON của một lượt liệt kê → điểm vào. `region` là region ĐANG GHIM (Route53 và
 * CloudFront là dịch vụ toàn cầu nên luôn `global`).
 */
export function rootsFromResult(
  service: InfraRootSource,
  json: unknown,
  region: string,
): { roots: InfraGraphRoot[]; truncated: boolean } {
  const roots: InfraGraphRoot[] = []

  if (service === 'route53') {
    for (const raw of asArray(at(json, 'HostedZones'))) {
      const zone = asObj(raw)
      const id = str(zone['Id']).replace(/^\/hostedzone\//, '')
      if (id === '') continue
      roots.push({
        id: graphNodeId({ service: 'route53', region: 'global', name: id }),
        service: 'route53',
        label: str(zone['Name']).replace(/\.$/, '') || id,
        region: 'global',
      })
    }
    return { roots, truncated: str(at(json, 'NextToken')) !== '' }
  }

  if (service === 'cloudfront') {
    for (const raw of asArray(at(json, 'DistributionList.Items'))) {
      const dist = asObj(raw)
      const domain = str(dist['DomainName'])
      if (domain === '') continue
      roots.push({
        id: graphNodeId({ service: 'cloudfront', region: 'global', name: domain }),
        service: 'cloudfront',
        label: str(asArray(at(dist, 'Aliases.Items'))[0]) || domain,
        region: 'global',
      })
    }
    return { roots, truncated: str(at(json, 'DistributionList.NextMarker')) !== '' }
  }

  for (const raw of asArray(at(json, 'items'))) {
    const api = asObj(raw)
    const id = str(api['id'])
    if (id === '') continue
    roots.push({
      id: graphNodeId({ service: 'apigateway', region, name: id }),
      service: 'apigateway',
      label: str(api['name']) || id,
      region,
    })
  }
  return { roots, truncated: str(at(json, 'position')) !== '' }
}
