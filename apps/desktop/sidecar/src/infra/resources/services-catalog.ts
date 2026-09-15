// Danh mục Dịch vụ của Explorer (task 3.8).
//
// VÌ SAO CẦN MỘT DANH MỤC RIÊNG THAY VÌ CHỈ ĐỌC REGISTRY VIEW. AWS có hơn 200
// dịch vụ; AWOG sẽ không bao giờ có màn riêng cho từng cái. `infra-explorer.md`
// chốt cách nói thật: **ba mức hỗ trợ hiện thẳng trên thẻ** — "Đầy đủ", "Danh
// sách", "Mở Console" — để người dùng biết trước khi bấm, thay vì bấm vào rồi
// mới phát hiện không có gì.
//
// Tên `full` / `list` / `console` ở file này là tên NỘI BỘ, không bao giờ hiện ra
// màn hình: nhãn hiển thị nằm ở i18n `infra.explorer.support.*` (kèm `*.hint` cho
// tooltip) và đã được đổi thành "Xem và thao tác" / "Chỉ xem danh sách" / "Mở
// trong Console AWS" ngày 2026-09-14. Đổi nhãn là việc của i18n — nhưng nhãn mới
// vẫn phải đúng ba nghĩa dưới đây, nếu không thẻ sẽ hứa một việc mà registry
// không làm.
//
// Hệ quả thiết kế: danh mục phải bao gồm cả những dịch vụ KHÔNG có view. Một thẻ
// mức `console` không phải ngõ cụt — nó vẫn có nút Hỏi agent, và agent có
// `aws_cli` đầy đủ, nên câu "liệt kê các hàng đợi SQS" vẫn trả lời được ngay cả
// khi mức hỗ trợ là `console`.
//
// Đây cũng là cách chọn dịch vụ nào nâng cấp tiếp: cái nào bị HỎI nhiều. Vì vậy
// mỗi lần bấm "Hỏi agent" từ một thẻ đều đi qua nhật ký với `surface: 'explorer'`.

import { allViews } from './registry.js'

export type ServiceLevel = 'full' | 'list' | 'console'

/**
 * Cách vào màn của dịch vụ. `tab` trỏ tới một mục đã có của `/infra` (Logs,
 * Kubernetes, Tài khoản) — những màn đó không phải một `ResourceView` vì chúng
 * sâu hơn một bảng (spec riêng của chúng dài hơn nhiều).
 */
export type ServiceTarget =
  | { kind: 'view'; viewId: string }
  | { kind: 'tab'; tab: 'logs' | 'kubernetes' | 'accounts' | 'overview' }
  | { kind: 'console'; url: string }

export type CatalogService = {
  id: string
  group: string
  label: string
  about: string
  level: ServiceLevel
  target: ServiceTarget
}

/**
 * Deep link Console. Dịch vụ toàn cầu (IAM, Route53, CloudFront, S3 gốc) KHÔNG
 * nhận region trong URL — task 3.4 nói rõ điều này, vì thêm `?region=` vào một
 * dịch vụ toàn cầu cho ra một URL mà Console tự bỏ qua hoặc trả về trang trắng.
 */
function consoleUrl(service: string, hash: string, region: string, global = false): string {
  const r = global ? '' : region || 'us-east-1'
  const host = global ? 'console.aws.amazon.com' : `${r}.console.aws.amazon.com`
  const q = global ? '' : `?region=${encodeURIComponent(r)}`
  return `https://${host}/${service}/home${q}${hash}`
}

const S = (
  id: string,
  group: string,
  level: ServiceLevel,
  target: ServiceTarget,
): CatalogService => ({
  id,
  group,
  label: `infra.explorer.svc.${id}`,
  about: `infra.explorer.about.${id}`,
  level,
  target,
})

/**
 * Danh mục. Thứ tự trong nhóm = thứ tự hiện trên màn; nhóm đặt tên theo VIỆC
 * ("Máy chủ & tính toán") chứ không theo bảng chữ cái, đúng spec.
 */
export const SERVICE_GROUPS: readonly string[] = [
  'compute',
  'storage',
  'network',
  'domain',
  'deploy',
  'observe',
  'security',
  'queue',
  'cost',
  'iac',
  // Nhóm thứ 11 (2026-09-14). Trước đây dữ liệu & AI không có nhà: Athena/Glue
  // nằm chung "Lưu trữ & cơ sở dữ liệu" còn Bedrock/SageMaker thì không có chỗ
  // nào — mà "lưu dữ liệu ở đâu" và "xử lý/học từ dữ liệu đó" là hai việc khác
  // nhau, đúng cách đặt tên nhóm theo VIỆC của spec.
  'data',
]

export const SERVICE_CATALOG: readonly CatalogService[] = [
  // Máy chủ & tính toán
  S('ec2', 'compute', 'full', { kind: 'view', viewId: 'ec2.instances' }),
  S('ecs', 'compute', 'list', { kind: 'view', viewId: 'ecs.clusters' }),
  S('lambda', 'compute', 'list', { kind: 'view', viewId: 'lambda.functions' }),
  S('eks', 'compute', 'console', { kind: 'console', url: '' }),
  S('batch', 'compute', 'console', { kind: 'console', url: '' }),
  S('apprunner', 'compute', 'console', { kind: 'console', url: '' }),
  S('lightsail', 'compute', 'console', { kind: 'console', url: '' }),
  S('elasticbeanstalk', 'compute', 'console', { kind: 'console', url: '' }),
  // Lưu trữ & cơ sở dữ liệu
  S('s3', 'storage', 'full', { kind: 'view', viewId: 's3.buckets' }),
  S('rds', 'storage', 'list', { kind: 'view', viewId: 'rds.instances' }),
  S('dynamodb', 'storage', 'list', { kind: 'view', viewId: 'dynamodb.tables' }),
  S('efs', 'storage', 'console', { kind: 'console', url: '' }),
  S('elasticache', 'storage', 'console', { kind: 'console', url: '' }),
  S('memorydb', 'storage', 'console', { kind: 'console', url: '' }),
  S('docdb', 'storage', 'console', { kind: 'console', url: '' }),
  S('neptune', 'storage', 'console', { kind: 'console', url: '' }),
  S('keyspaces', 'storage', 'console', { kind: 'console', url: '' }),
  S('timestream', 'storage', 'console', { kind: 'console', url: '' }),
  S('backup', 'storage', 'console', { kind: 'console', url: '' }),
  S('fsx', 'storage', 'console', { kind: 'console', url: '' }),
  S('storagegateway', 'storage', 'console', { kind: 'console', url: '' }),
  S('datasync', 'storage', 'console', { kind: 'console', url: '' }),
  S('transfer', 'storage', 'console', { kind: 'console', url: '' }),
  S('dms', 'storage', 'console', { kind: 'console', url: '' }),
  // Mạng & phân phối
  S('vpc', 'network', 'console', { kind: 'console', url: '' }),
  S('elbv2', 'network', 'console', { kind: 'console', url: '' }),
  S('cloudfront', 'network', 'full', { kind: 'view', viewId: 'cloudfront.distributions' }),
  S('apigateway', 'network', 'list', { kind: 'view', viewId: 'apigateway.restApis' }),
  S('natgateway', 'network', 'console', { kind: 'console', url: '' }),
  S('appsync', 'network', 'console', { kind: 'console', url: '' }),
  S('globalaccelerator', 'network', 'console', { kind: 'console', url: '' }),
  S('route53resolver', 'network', 'console', { kind: 'console', url: '' }),
  S('networkmanager', 'network', 'console', { kind: 'console', url: '' }),
  S('cloudmap', 'network', 'console', { kind: 'console', url: '' }),
  S('appmesh', 'network', 'console', { kind: 'console', url: '' }),
  // Tên miền & chứng chỉ (toàn cầu)
  S('route53', 'domain', 'list', { kind: 'view', viewId: 'route53.zones' }),
  S('acm', 'domain', 'list', { kind: 'view', viewId: 'acm.certificates' }),
  S('acm-pca', 'domain', 'console', { kind: 'console', url: '' }),
  // Triển khai & CI/CD
  S('cloudformation', 'deploy', 'list', { kind: 'view', viewId: 'cfn.stacks' }),
  S('codepipeline', 'deploy', 'console', { kind: 'console', url: '' }),
  S('codebuild', 'deploy', 'console', { kind: 'console', url: '' }),
  S('amplify', 'deploy', 'console', { kind: 'console', url: '' }),
  S('ecr', 'deploy', 'list', { kind: 'view', viewId: 'ecr.repositories' }),
  S('codecommit', 'deploy', 'console', { kind: 'console', url: '' }),
  S('codedeploy', 'deploy', 'console', { kind: 'console', url: '' }),
  S('codeartifact', 'deploy', 'console', { kind: 'console', url: '' }),
  S('cloud9', 'deploy', 'console', { kind: 'console', url: '' }),
  S('cloudshell', 'deploy', 'console', { kind: 'console', url: '' }),
  S('servicecatalog', 'deploy', 'console', { kind: 'console', url: '' }),
  // Theo dõi & nhật ký
  S('cloudwatch', 'observe', 'full', { kind: 'tab', tab: 'logs' }),
  S('cloudtrail', 'observe', 'console', { kind: 'console', url: '' }),
  S('xray', 'observe', 'console', { kind: 'console', url: '' }),
  S('sns-alerts', 'observe', 'console', { kind: 'console', url: '' }),
  S('grafana', 'observe', 'console', { kind: 'console', url: '' }),
  S('prometheus', 'observe', 'console', { kind: 'console', url: '' }),
  S('devops-guru', 'observe', 'console', { kind: 'console', url: '' }),
  S('health', 'observe', 'console', { kind: 'console', url: '' }),
  S('chatbot', 'observe', 'console', { kind: 'console', url: '' }),
  S('resource-explorer', 'observe', 'console', { kind: 'console', url: '' }),
  // Bảo mật & quyền
  S('iam', 'security', 'console', { kind: 'console', url: '' }),
  S('secretsmanager', 'security', 'list', {
    kind: 'view',
    viewId: 'secretsmanager.secrets',
  }),
  S('kms', 'security', 'console', { kind: 'console', url: '' }),
  S('waf', 'security', 'console', { kind: 'console', url: '' }),
  S('singlesignon', 'security', 'console', { kind: 'console', url: '' }),
  S('organizations', 'security', 'console', { kind: 'console', url: '' }),
  S('controltower', 'security', 'console', { kind: 'console', url: '' }),
  S('config', 'security', 'console', { kind: 'console', url: '' }),
  S('guardduty', 'security', 'console', { kind: 'console', url: '' }),
  S('securityhub', 'security', 'console', { kind: 'console', url: '' }),
  S('detective', 'security', 'console', { kind: 'console', url: '' }),
  S('macie', 'security', 'console', { kind: 'console', url: '' }),
  S('auditmanager', 'security', 'console', { kind: 'console', url: '' }),
  S('access-analyzer', 'security', 'console', { kind: 'console', url: '' }),
  S('ram', 'security', 'console', { kind: 'console', url: '' }),
  S('artifact', 'security', 'console', { kind: 'console', url: '' }),
  S('servicequotas', 'security', 'console', { kind: 'console', url: '' }),
  // Hàng đợi & sự kiện
  S('sqs', 'queue', 'list', { kind: 'view', viewId: 'sqs.queues' }),
  S('sns', 'queue', 'list', { kind: 'view', viewId: 'sns.topics' }),
  S('eventbridge', 'queue', 'console', { kind: 'console', url: '' }),
  S('stepfunctions', 'queue', 'console', { kind: 'console', url: '' }),
  S('kinesis', 'queue', 'console', { kind: 'console', url: '' }),
  S('scheduler', 'queue', 'console', { kind: 'console', url: '' }),
  S('firehose', 'queue', 'console', { kind: 'console', url: '' }),
  S('appflow', 'queue', 'console', { kind: 'console', url: '' }),
  S('appconfig', 'queue', 'console', { kind: 'console', url: '' }),
  // Chi phí & hoá đơn
  S('ce', 'cost', 'console', { kind: 'console', url: '' }),
  S('budgets', 'cost', 'console', { kind: 'console', url: '' }),
  S('trustedadvisor', 'cost', 'console', { kind: 'console', url: '' }),
  S('compute-optimizer', 'cost', 'console', { kind: 'console', url: '' }),
  // Hạ tầng dạng mã
  S('terraform', 'iac', 'full', { kind: 'tab', tab: 'overview' }),
  // Dữ liệu & AI
  S('athena', 'data', 'console', { kind: 'console', url: '' }),
  S('glue', 'data', 'console', { kind: 'console', url: '' }),
  S('emr', 'data', 'console', { kind: 'console', url: '' }),
  S('redshift', 'data', 'console', { kind: 'console', url: '' }),
  S('opensearch', 'data', 'console', { kind: 'console', url: '' }),
  S('lakeformation', 'data', 'console', { kind: 'console', url: '' }),
  S('bedrock', 'data', 'console', { kind: 'console', url: '' }),
  S('sagemaker', 'data', 'console', { kind: 'console', url: '' }),
  S('textract', 'data', 'console', { kind: 'console', url: '' }),
  S('transcribe', 'data', 'console', { kind: 'console', url: '' }),
  S('comprehend', 'data', 'console', { kind: 'console', url: '' }),
  S('rekognition', 'data', 'console', { kind: 'console', url: '' }),
]

/** Kubernetes không phải dịch vụ AWS — nó là màn riêng của AWOG. */
export const KUBERNETES_ENTRY = S('kubernetes', 'compute', 'full', {
  kind: 'tab',
  tab: 'kubernetes',
})

/** Ghim sẵn sáu dịch vụ hay dùng nhất (spec: "sidebar là của bạn"). */
export const DEFAULT_PINNED: readonly string[] = [
  'ec2',
  's3',
  'cloudwatch',
  'lambda',
  'ecs',
  'rds',
]

const VIEW_BY_SERVICE = new Map<string, string>(
  allViews().map((v) => [v.service, v.id]),
)

export type CatalogEntry = CatalogService & { consoleUrl: string | null }

/**
 * Danh mục đã bơm deep link theo region hiện hành. Dịch vụ không có màn riêng
 * nhận `consoleUrl`; dịch vụ có view/tab nhận `null` — UI mở thẳng trong app.
 */
export function catalogFor(region: string): readonly CatalogEntry[] {
  const svcConsole: Record<string, { path: string; hash: string; global?: boolean }> = {
    eks: { path: 'eks', hash: '#/clusters' },
    batch: { path: 'batch', hash: '#/jobs' },
    apprunner: { path: 'apprunner', hash: '#/services' },
    lightsail: { path: 'lightsail', hash: '' },
    elasticbeanstalk: { path: 'elasticbeanstalk', hash: '#/applications' },
    efs: { path: 'efs', hash: '#/file-systems' },
    elasticache: { path: 'elasticache', hash: '#/redis' },
    memorydb: { path: 'memorydb', hash: '#/clusters' },
    docdb: { path: 'docdb', hash: '#/clusters' },
    neptune: { path: 'neptune', hash: '#/clusters' },
    keyspaces: { path: 'keyspaces', hash: '' },
    timestream: { path: 'timestream', hash: '#/databases' },
    backup: { path: 'backup', hash: '#/vaults' },
    fsx: { path: 'fsx', hash: '#/file-systems' },
    storagegateway: { path: 'storagegateway', hash: '#/gateways' },
    datasync: { path: 'datasync', hash: '' },
    transfer: { path: 'transfer', hash: '#/servers' },
    dms: { path: 'dms/v2', hash: '#/tasks' },
    vpc: { path: 'vpc', hash: '#/vpcs' },
    elbv2: { path: 'ec2', hash: '#LoadBalancers' },
    // `cloudfront` / `apigateway` / `acm` KHÔNG còn ở đây (Mốc 4, task 4.1): chúng
    // đã có view trong app, mà bất biến của danh mục là "có view thì không có deep
    // link" — nút ↗ trên thẻ chỉ dành cho dịch vụ AWOG chưa có màn riêng.
    natgateway: { path: 'vpc', hash: '#NatGateways' },
    appsync: { path: 'appsync', hash: '#/apis' },
    globalaccelerator: { path: 'globalaccelerator', hash: '#/accelerators', global: true },
    route53resolver: { path: 'route53resolver', hash: '' },
    networkmanager: { path: 'networkmanager', hash: '' },
    cloudmap: { path: 'cloudmap', hash: '#/namespaces' },
    appmesh: { path: 'appmesh', hash: '#/meshes' },
    'acm-pca': { path: 'acm-pca', hash: '#/certificateAuthorities' },
    codepipeline: { path: 'codesuite/codepipeline', hash: '#/pipelines' },
    codebuild: { path: 'codesuite/codebuild', hash: '#/projects/' },
    amplify: { path: 'amplify', hash: '#/apps' },
    codecommit: { path: 'codesuite/codecommit', hash: '#/repositories' },
    codedeploy: { path: 'codedeploy', hash: '#/applications' },
    codeartifact: { path: 'codesuite/codeartifact', hash: '#/repositories' },
    cloud9: { path: 'cloud9', hash: '' },
    cloudshell: { path: 'cloudshell', hash: '' },
    servicecatalog: { path: 'servicecatalog', hash: '#/products' },
    cloudtrail: { path: 'cloudtrail', hash: '#/trails' },
    xray: { path: 'xray', hash: '#/traces' },
    'sns-alerts': { path: 'cloudwatch', hash: '#alarms' },
    grafana: { path: 'grafana', hash: '#/workspaces' },
    prometheus: { path: 'prometheus', hash: '#/workspaces' },
    'devops-guru': { path: 'devops-guru', hash: '' },
    health: { path: 'health', hash: '#/dashboard' },
    chatbot: { path: 'chatbot', hash: '' },
    'resource-explorer': { path: 'resource-explorer', hash: '' },
    iam: { path: 'iam', hash: '#/users', global: true },
    kms: { path: 'kms', hash: '#/list' },
    waf: { path: 'wafv2', hash: '#/webacls' },
    singlesignon: { path: 'singlesignon', hash: '' },
    organizations: { path: 'organizations/v2', hash: '', global: true },
    controltower: { path: 'controltower', hash: '' },
    config: { path: 'config', hash: '' },
    guardduty: { path: 'guardduty', hash: '' },
    securityhub: { path: 'securityhub', hash: '' },
    detective: { path: 'detective', hash: '' },
    macie: { path: 'macie', hash: '' },
    auditmanager: { path: 'auditmanager', hash: '' },
    'access-analyzer': { path: 'access-analyzer', hash: '' },
    ram: { path: 'ram', hash: '' },
    artifact: { path: 'artifact', hash: '', global: true },
    servicequotas: { path: 'servicequotas', hash: '' },
    eventbridge: { path: 'events', hash: '#/eventbuses' },
    stepfunctions: { path: 'states', hash: '#/statemachines' },
    kinesis: { path: 'kinesis', hash: '#/streams' },
    scheduler: { path: 'scheduler', hash: '' },
    firehose: { path: 'firehose', hash: '' },
    appflow: { path: 'appflow', hash: '' },
    appconfig: { path: 'appconfig', hash: '' },
    ce: { path: 'billing/home', hash: '#/bills', global: true },
    budgets: { path: 'billing/home', hash: '#/budgets', global: true },
    trustedadvisor: { path: 'trustedadvisor', hash: '' },
    'compute-optimizer': { path: 'compute-optimizer', hash: '' },
    athena: { path: 'athena', hash: '#/workgroups' },
    glue: { path: 'glue', hash: '#/jobs' },
    emr: { path: 'emr', hash: '' },
    redshift: { path: 'redshift', hash: '' },
    opensearch: { path: 'aos', hash: '' },
    lakeformation: { path: 'lakeformation', hash: '' },
    bedrock: { path: 'bedrock', hash: '' },
    sagemaker: { path: 'sagemaker', hash: '' },
    textract: { path: 'textract', hash: '' },
    transcribe: { path: 'transcribe', hash: '' },
    comprehend: { path: 'comprehend', hash: '' },
    rekognition: { path: 'rekognition', hash: '' },
  }
  return SERVICE_CATALOG.map((s) => {
    const c = svcConsole[s.id]
    return {
      ...s,
      consoleUrl: c ? consoleUrl(c.path, c.hash, region, c.global === true) : null,
    }
  })
}

/** View id của một service, nếu service đó có màn riêng. */
export function viewIdOfService(service: string): string | null {
  return VIEW_BY_SERVICE.get(service) ?? null
}
