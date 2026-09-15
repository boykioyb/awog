// Danh mục MẪU cho bản chạy trên trình duyệt — khi không có engine.
//
// VÌ SAO CẦN. Mở `localhost:3031` bằng trình duyệt thường thì không có
// `window.awog`, mà danh mục dịch vụ nằm ở sidecar, nên màn Dịch vụ trống trơn:
// không ai review được giao diện bằng web. Người dùng: *"ủa trên web thì cũng phải
// hiện chứ? bản mock cũng được chứ"*.
//
// VÌ SAO KHÔNG IMPORT THẲNG `sidecar/src/infra/resources/services-catalog.ts`. File
// đó kéo theo `aws-views.ts` — tức toàn bộ argv của CLI — vào bundle của renderer,
// đúng thứ mà `registry.ts` cố ý chặn ("renderer không cần biết lệnh CLI nào đứng
// sau một cột"). Bản mẫu này là dữ liệu THUẦN: không lệnh, không hàm chạy được.
//
// ĐÂY LÀ BẢN SAO, KHÔNG PHẢI NGUỒN SỰ THẬT. Engine vẫn là nguồn thật; file này chỉ
// để nhìn thấy màn hình khi không có engine. Nó giữ ĐÚNG hình dạng của
// `SERVICE_CATALOG` + `catalogFor()` (cùng thứ tự, cùng cách viết) để ai cần thì
// diff được hai file bằng mắt. Vì là bản sao nên UI phải NÓI RÕ đang dùng bản mẫu
// (cờ `mock` trong `useInfraExplorerCatalog` → băng cảnh báo ở màn Dịch vụ), không
// được để người đọc tưởng đây là tài khoản thật của họ.

import type {
  InfraCatalogService,
  InfraExplorerCatalog,
  InfraViewDescriptor,
} from '~/composables/useInfraResourcesApi'

type Level = 'full' | 'list' | 'console'
type Target = InfraCatalogService['target']

/** Cùng khuôn `S()` của sidecar: nhãn/mô tả là KHOÁ i18n, không phải chữ. */
const S = (id: string, group: string, level: Level, target: Target): InfraCatalogService => ({
  id,
  group,
  label: `infra.explorer.svc.${id}`,
  about: `infra.explorer.about.${id}`,
  level,
  target,
  consoleUrl: null,
})

/** Chép từ `SERVICE_CATALOG`; `url` để trống rồi bơm ở dưới như sidecar làm. */
const CATALOG: readonly InfraCatalogService[] = [
  S('ec2', 'compute', 'full', { kind: 'view', viewId: 'ec2.instances' }),
  S('ecs', 'compute', 'list', { kind: 'view', viewId: 'ecs.clusters' }),
  S('lambda', 'compute', 'list', { kind: 'view', viewId: 'lambda.functions' }),
  S('eks', 'compute', 'console', { kind: 'console', url: '' }),
  S('batch', 'compute', 'console', { kind: 'console', url: '' }),
  S('apprunner', 'compute', 'console', { kind: 'console', url: '' }),
  S('lightsail', 'compute', 'console', { kind: 'console', url: '' }),
  S('elasticbeanstalk', 'compute', 'console', { kind: 'console', url: '' }),
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
  S('vpc', 'network', 'console', { kind: 'console', url: '' }),
  S('elbv2', 'network', 'console', { kind: 'console', url: '' }),
  S('cloudfront', 'network', 'console', { kind: 'console', url: '' }),
  S('apigateway', 'network', 'console', { kind: 'console', url: '' }),
  S('natgateway', 'network', 'console', { kind: 'console', url: '' }),
  S('appsync', 'network', 'console', { kind: 'console', url: '' }),
  S('globalaccelerator', 'network', 'console', { kind: 'console', url: '' }),
  S('route53resolver', 'network', 'console', { kind: 'console', url: '' }),
  S('networkmanager', 'network', 'console', { kind: 'console', url: '' }),
  S('cloudmap', 'network', 'console', { kind: 'console', url: '' }),
  S('appmesh', 'network', 'console', { kind: 'console', url: '' }),
  S('route53', 'domain', 'list', { kind: 'view', viewId: 'route53.zones' }),
  S('acm', 'domain', 'console', { kind: 'console', url: '' }),
  S('acm-pca', 'domain', 'console', { kind: 'console', url: '' }),
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
  S('iam', 'security', 'console', { kind: 'console', url: '' }),
  S('secretsmanager', 'security', 'list', { kind: 'view', viewId: 'secretsmanager.secrets' }),
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
  S('sqs', 'queue', 'list', { kind: 'view', viewId: 'sqs.queues' }),
  S('sns', 'queue', 'list', { kind: 'view', viewId: 'sns.topics' }),
  S('eventbridge', 'queue', 'console', { kind: 'console', url: '' }),
  S('stepfunctions', 'queue', 'console', { kind: 'console', url: '' }),
  S('kinesis', 'queue', 'console', { kind: 'console', url: '' }),
  S('scheduler', 'queue', 'console', { kind: 'console', url: '' }),
  S('firehose', 'queue', 'console', { kind: 'console', url: '' }),
  S('appflow', 'queue', 'console', { kind: 'console', url: '' }),
  S('appconfig', 'queue', 'console', { kind: 'console', url: '' }),
  S('ce', 'cost', 'console', { kind: 'console', url: '' }),
  S('budgets', 'cost', 'console', { kind: 'console', url: '' }),
  S('trustedadvisor', 'cost', 'console', { kind: 'console', url: '' }),
  S('compute-optimizer', 'cost', 'console', { kind: 'console', url: '' }),
  S('terraform', 'iac', 'full', { kind: 'tab', tab: 'overview' }),
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

export const FALLBACK_GROUPS: readonly string[] = [
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
  'data',
]

/** Chép từ `DEFAULT_PINNED` của sidecar. */
export const FALLBACK_PINNED: readonly string[] = [
  'ec2',
  's3',
  'cloudwatch',
  'lambda',
  'ecs',
  'rds',
]

/** Chép từ bảng `svcConsole` trong `catalogFor()` của sidecar. */
const CONSOLE: Record<string, { path: string; hash: string; global?: boolean }> = {
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
  cloudfront: { path: 'cloudfront', hash: '#/distributions', global: true },
  apigateway: { path: 'apigateway', hash: '#/apis' },
  natgateway: { path: 'vpc', hash: '#NatGateways' },
  appsync: { path: 'appsync', hash: '#/apis' },
  globalaccelerator: { path: 'globalaccelerator', hash: '#/accelerators', global: true },
  route53resolver: { path: 'route53resolver', hash: '' },
  networkmanager: { path: 'networkmanager', hash: '' },
  cloudmap: { path: 'cloudmap', hash: '#/namespaces' },
  appmesh: { path: 'appmesh', hash: '#/meshes' },
  acm: { path: 'acm', hash: '#/certificates' },
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

/**
 * Deep link Console. Giống `console-url.ts` của sidecar, kể cả luật "dịch vụ toàn
 * cầu KHÔNG nhận region" — thêm `?region=` vào một dịch vụ toàn cầu cho ra URL mà
 * Console tự bỏ qua hoặc trả về trang trắng.
 */
function consoleUrl(service: string, hash: string, region: string, global = false): string {
  const r = global ? '' : region || 'us-east-1'
  const host = global ? 'console.aws.amazon.com' : `${r}.console.aws.amazon.com`
  const q = global ? '' : `?region=${encodeURIComponent(r)}`
  return `https://${host}/${service}/home${q}${hash}`
}

/**
 * Mô tả view TỐI THIỂU: chỉ đủ để sidebar "Dịch vụ đã ghim" và tiêu đề bảng hiện
 * đúng tên. Cột/hành động để rỗng vì bản mẫu không có engine nên không nạp được
 * dòng nào — khai một bộ cột rồi không nạp được còn khó hiểu hơn.
 */
function viewStub(service: string, viewId: string, support: 'full' | 'list'): InfraViewDescriptor {
  return {
    id: viewId,
    service,
    label: `infra.explorer.view.${viewId}`,
    // `about` là khoá theo DỊCH VỤ chứ không theo view — đúng như `aws-views.ts`
    // khai (`about: 'infra.explorer.about.s3'` cho cả `s3.buckets` lẫn
    // `s3.objects`), nếu không thì tiêu đề bảng in ra một khoá i18n thô. View
    // `cfn.stacks` từng là ngoại lệ (`about.cfn`); 2026-09-14 đã đổi khoá đó
    // thành `about.cloudformation` để khớp service id, nên giờ suy thẳng được.
    about: `infra.explorer.about.${service}`,
    // Bản mẫu không nạp được dòng nào nên không có gì để cảnh báo.
    notice: null,
    support,
    columns: { simple: [], full: [] },
    required: [],
    hasDetail: false,
    hasConsole: false,
    canProbe: false,
    actions: [],
    forms: [],
  }
}

/** Danh mục thay thế khi không nối được engine. Cùng hình dạng với RPC trả về. */
export function infraCatalogFallback(region: string): InfraExplorerCatalog {
  const services: InfraCatalogService[] = CATALOG.map((s) => {
    const c = CONSOLE[s.id]
    return { ...s, consoleUrl: c ? consoleUrl(c.path, c.hash, region, c.global === true) : null }
  })
  // Kubernetes không phải dịch vụ AWS — nó là màn riêng của AWOG — nhưng vẫn nằm
  // trong danh mục, y như sidecar ghép `KUBERNETES_ENTRY` vào cuối.
  services.push(S('kubernetes', 'compute', 'full', { kind: 'tab', tab: 'kubernetes' }))

  const views = services
    .filter((s) => s.target.kind === 'view')
    .map((s) =>
      viewStub(s.id, (s.target as { viewId: string }).viewId, s.level === 'full' ? 'full' : 'list'),
    )

  return { views, groups: [...FALLBACK_GROUPS], services, defaultPinned: [...FALLBACK_PINNED] }
}
