// Phân loại lệnh hạ tầng thành 4 LỚP — ADR 0088 §5 (task 0.2).
//
// Lớp là TRỤC, không phải kết luận: quyền (Tự động · Hỏi · Chặn) do ma trận cài
// đặt quyết định, còn file này chỉ trả lời "lệnh này thuộc loại nào". Vì thế ở
// đây không có khái niệm allow/deny, và không có cờ nào tắt được nó.
//
// Luật fail-safe: động từ KHÔNG nhận ra rơi vào `write`, không rơi vào `read`.
// Chi phí đoán sai khi đó là một lần hỏi thừa; đoán sai chiều ngược lại là chạy
// một lệnh ghi mà không ai kịp nhìn. Danh sách dưới đây phải bảo trì khi CLI
// thêm subcommand (trade-off đã ghi ở ADR 0088 §Hệ quả).
//
// Cố ý KHÔNG parse cờ: giá trị của một cờ rời (`--cli-read-timeout 10`) trông
// giống một positional, nên nó chỉ đẩy lệnh sang `write` — sai về phía an toàn.
// Mọi cờ đổi ngữ cảnh đã bị `findForbiddenFlag()` chặn từ trước ở `infra.run`.

import type { InfraCommandClass, InfraTool } from './types.js'

/**
 * Lớp dành cho lời gọi đổi ngữ cảnh NỘI BỘ của AWOG (tool `infra_context`).
 * Không suy được từ argv — CLI không có động từ nào mang nghĩa "đổi account đang
 * ghim của phiên" — nên nó là hằng số mà call site tự khai, không phải kết quả
 * của `classify()`.
 */
export const CONTEXT_SWITCH_CLASS: InfraCommandClass = 'context-switch'

/**
 * Cờ tự mang ngữ cảnh: chúng thoát khỏi account/cluster mà phiên đã ghim
 * (`--profile`/`--region`/`--context`/`--namespace`) hoặc trỏ CLI sang endpoint
 * khác (`--endpoint-url`/`--kubeconfig`) và tắt kiểm tra TLS (`--no-verify-ssl`/
 * `--ca-bundle`) — bề mặt SSRF, invariant #7. `infra.run` từ chối thẳng thay vì
 * lọc bỏ: im lặng gỡ cờ của model là im lặng đổi nghĩa lệnh nó vừa xin duyệt.
 *
 * CHƯA phủ hết theo ADR 0088 §4: `--server` của kubectl và dạng viết tắt `-n`
 * (namespace) vẫn lọt. Task 0.3 (`infra/run.ts`) phải xử nốt khi ghép cờ ngữ
 * cảnh, ở đó mới biết cờ nào thuộc công cụ nào.
 */
export const FORBIDDEN_FLAGS: readonly string[] = [
  '--profile',
  '--region',
  '--endpoint-url',
  '--kubeconfig',
  '--context',
  '--namespace',
  '--no-verify-ssl',
  '--ca-bundle',
]

/**
 * Binary mà nút "Always allow" của ADR 0080 KHÔNG được phủ khi agent gọi qua
 * `Bash` (ADR 0088 §6, dùng ở task 0.14): có hai nguồn sự thật về quyền hạ tầng
 * thì người dùng sẽ tin nhầm cái yếu hơn. Rộng hơn `InfraTool` vì `helm`/
 * `gcloud`/`az` chưa có adapter nhưng vẫn chạm hạ tầng thật.
 */
export const CONTEXT_BLOCKED_BINARIES: readonly string[] = [
  'aws',
  'terraform',
  'kubectl',
  'helm',
  'gcloud',
  'az',
]

// ─── aws ────────────────────────────────────────────────────────────────────
// argv của aws là `<service> <operation> [params]` (`s3api list-buckets`), riêng
// `s3` dùng động từ kiểu shell (`ls`/`rm`/`rb`/`cp`).
//
// ⚠ ĐẢO CHIỀU sau infosec audit #1 (2026-09-13). Bản đầu cho `read` theo TIỀN TỐ
// động từ (`get-`/`list-`/`describe-`…). Ba lỗ critical đều sinh ra từ đó:
//   · `aws configure get aws_secret_access_key` → khớp `get-`? không, nhưng
//     `sts assume-role`, `secretsmanager get-secret-value`, `ecr get-login-password`
//     thì khớp — tức lệnh PHÁT credential chạy tự động, kể cả trên production.
//   · `s3api get-object <bucket> <key> <outfile>` khớp `get-` nhưng positional
//     cuối là ĐƯỜNG GHI FILE tuỳ ý ngoài workspace.
//   · động từ mới của AWS tự động rơi vào `read` mà không ai duyệt.
// Tiền tố là danh sách CẤM trá hình: nó cho phép mọi thứ chưa kịp nghĩ tới.
//
// Nay `read` là ALLOWLIST CẶP (service, operation) chính xác. Op không có trong
// bảng ⇒ `write` (hỏi). Thêm một op vào đây là một quyết định có chủ đích, và
// điều kiện để thêm là: KHÔNG phát credential, KHÔNG ghi file, KHÔNG nhận
// positional là đường dẫn.
const AWS_READ_ALLOWLIST: Record<string, ReadonlySet<string>> = {
  ec2: new Set([
    'describe-instances',
    'describe-images',
    'describe-security-groups',
    'describe-subnets',
    'describe-vpcs',
    'describe-volumes',
    'describe-route-tables',
    'describe-addresses',
    'describe-snapshots',
    'describe-regions',
    'describe-availability-zones',
  ]),
  s3api: new Set([
    'list-buckets',
    'list-objects-v2',
    'get-bucket-location',
    'head-bucket',
    // `head-object` chỉ trả metadata; KHÔNG có `get-object` ở đây vì nó nhận
    // positional `outfile` và ghi file ra đường dẫn tuỳ ý (audit #1, critical).
    'head-object',
  ]),
  s3: new Set(['ls']),
  ecs: new Set([
    'list-clusters',
    'list-services',
    'list-tasks',
    'list-task-definitions',
    'describe-clusters',
    'describe-services',
    'describe-tasks',
    'describe-task-definition',
  ]),
  eks: new Set(['list-clusters', 'describe-cluster', 'list-nodegroups', 'describe-nodegroup']),
  lambda: new Set(['list-functions', 'get-function-configuration']),
  rds: new Set(['describe-db-instances', 'describe-db-snapshots', 'describe-db-clusters']),
  cloudfront: new Set(['list-distributions', 'get-distribution', 'list-invalidations']),
  apigatewayv2: new Set(['get-apis', 'get-routes', 'get-integrations', 'get-stages']),
  apigateway: new Set(['get-rest-apis', 'get-resources', 'get-stages']),
  route53: new Set(['list-hosted-zones', 'list-hosted-zones-by-name', 'list-resource-record-sets']),
  acm: new Set(['list-certificates', 'describe-certificate']),
  cloudformation: new Set([
    'describe-stacks',
    'list-stacks',
    'list-stack-resources',
    'describe-stack-events',
  ]),
  logs: new Set([
    'describe-log-groups',
    'describe-log-streams',
    'get-query-results',
    'get-log-events',
    'filter-log-events',
  ]),
  cloudwatch: new Set(['describe-alarms', 'list-metrics']),
  elbv2: new Set(['describe-load-balancers', 'describe-target-groups', 'describe-target-health']),
  sqs: new Set(['list-queues', 'get-queue-attributes']),
  sns: new Set(['list-topics', 'list-subscriptions']),
  dynamodb: new Set(['list-tables', 'describe-table']),
  amplify: new Set(['list-apps', 'list-branches', 'list-jobs', 'get-job']),
  // `sts get-caller-identity` là lệnh "tôi đang là ai" — không phát credential.
  // `assume-role`/`get-session-token` TRẢ VỀ KHOÁ nên KHÔNG có mặt ở đây.
  sts: new Set(['get-caller-identity']),
}

const AWS_DESTRUCTIVE_PREFIXES = ['delete-', 'terminate-', 'remove-', 'purge-']
const AWS_DESTRUCTIVE_EXACT = new Set(['rb', 'rm'])

// `aws configure` ghi/đọc thẳng `~/.aws`. `configure set credential_process …` là
// một đường thực thi lệnh tuỳ ý mỗi lần CLI cần credential ⇒ phá huỷ, không phải
// ghi thường. `configure get` đọc ra giá trị secret ⇒ cũng không bao giờ là `read`.
const AWS_CONFIGURE_DESTRUCTIVE = new Set(['set', 'import'])

// ─── terraform ──────────────────────────────────────────────────────────────
// `plan` và `init` KHÔNG phải read: `plan` giữ state lock, `init` ghi backend.
const TF_READ = new Set(['validate', 'output', 'show', 'version'])
const TF_DESTRUCTIVE = new Set(['destroy', 'apply', 'import'])
const TF_STATE_READ = new Set(['list', 'show'])
const TF_STATE_DESTRUCTIVE = new Set(['rm'])

// ─── kubectl ────────────────────────────────────────────────────────────────
const K8S_READ = new Set([
  'get',
  'describe',
  'logs',
  'events',
  'top',
  'explain',
  'api-resources',
  'version',
])
const K8S_DESTRUCTIVE = new Set(['delete', 'drain'])

/**
 * Positional theo nghĩa HẸP: chỉ những token đứng TRƯỚC token có dấu `-` đầu tiên.
 *
 * ⚠ Sửa sau infosec audit #1: bản cũ lọc mọi token không bắt đầu bằng `-`, nên
 * GIÁ TRỊ của một cờ rời bị đếm như positional. `aws --cli-read-timeout 10 ec2
 * terminate-instances …` cho `positionals()[1] === 'ec2'` ⇒ động từ phá huỷ tụt
 * xuống `write`, thậm chí `read`. Muốn đếm đúng thì phải biết cờ nào ăn giá trị,
 * tức viết lại parser của AWS CLI — việc ta chắc chắn làm sai.
 *
 * Nên đổi câu hỏi: chỉ dạng CHÍNH TẮC `aws <service> <operation> [cờ…]` mới đủ
 * điều kiện xét `read`. Có cờ chen vào trước động từ ⇒ không đọc được cấu trúc ⇒
 * rơi về `write` (hỏi). Chi phí là một lần hỏi thừa cho lệnh viết lạ kiểu; đổi
 * lại không còn đường hạ lớp bằng cách chèn cờ.
 */
function positionals(args: readonly string[]): string[] {
  const out: string[] = []
  for (const a of args) {
    if (a.length === 0) continue
    if (a.startsWith('-')) break
    out.push(a)
  }
  return out
}

/**
 * AWS CLI mở rộng `file://…` và `fileb://…` thành NỘI DUNG file trên máy, ở bất
 * kỳ tham số nào. Một lệnh nằm trong allowlist `read` vì thế vẫn trở thành
 * nguyên thuỷ đọc file tuỳ ý rồi gửi đi (invariant #1 + #2). Không có cách nào
 * lọc an toàn từng tham số, nên sự CÓ MẶT của chúng tự nó nâng lớp lệnh.
 */
const FILE_URI_RE = /(^|[=,\s])fileb?:\/\//i

export function hasFileUriArg(args: readonly string[]): boolean {
  return args.some((a) => FILE_URI_RE.test(a))
}

/**
 * Hai chiều KHÔNG đối xứng, và đó là chủ đích (audit #1).
 *
 * Nhận diện PHÁ HUỶ phải **tham lam**: quét MỌI token không phải cờ. Nếu chỉ soi
 * `positionals()[1]` thì `aws --cli-read-timeout 10 ec2 terminate-instances` rơi
 * xuống `write` — trên tài khoản production, đó là đổi từ *chặn* thành *hỏi*, tức
 * một cú leo thang chỉ bằng cách chèn một cờ vô hại.
 *
 * Nhận diện ĐỌC thì ngược lại, phải **chặt**: đúng dạng chính tắc + đúng cặp
 * trong allowlist. Nhầm ở chiều này là cho chạy tự động thứ đáng lẽ phải hỏi.
 *
 * Giá của sự tham lam là dương tính giả — một tham số tên `delete-me.txt` sẽ bị
 * xếp phá huỷ. Chi phí là một lần hỏi thừa; chiều ngược lại thì không.
 */
function looksDestructive(args: readonly string[], exact: ReadonlySet<string>, prefixes: readonly string[]): boolean {
  return args.some((a) => {
    if (a.length === 0 || a.startsWith('-')) return false
    return exact.has(a) || prefixes.some((p) => a.startsWith(p))
  })
}

function classifyAws(args: readonly string[]): InfraCommandClass {
  // Tham lam trước: một động từ phá huỷ ở BẤT KỲ vị trí nào cũng là phá huỷ.
  if (looksDestructive(args, AWS_DESTRUCTIVE_EXACT, AWS_DESTRUCTIVE_PREFIXES)) return 'destructive'

  const words = positionals(args)
  const service = words[0]
  const op = words[1]
  if (!service || !op) return 'write'

  // `configure` đứng riêng: nó ghi/đọc `~/.aws`, là nhà của credential.
  if (service === 'configure') {
    return AWS_CONFIGURE_DESTRUCTIVE.has(op) ? 'destructive' : 'write'
  }

  // Allowlist, không phải tiền tố. Op lạ ⇒ `write` ⇒ có người duyệt.
  if (AWS_READ_ALLOWLIST[service]?.has(op)) return 'read'
  return 'write'
}

function classifyTerraform(args: readonly string[]): InfraCommandClass {
  if (looksDestructive(args, TF_DESTRUCTIVE, [])) return 'destructive'
  // Cờ toàn cục đứng TRƯỚC subcommand và luôn có dạng `-chdir=…` (một token), nên
  // positional đầu tiên vẫn là subcommand.
  const words = positionals(args)
  const sub = words[0]
  if (!sub) return 'write'
  if (sub === 'state') {
    const verb = words[1]
    if (!verb) return 'write'
    if (TF_STATE_DESTRUCTIVE.has(verb)) return 'destructive'
    return TF_STATE_READ.has(verb) ? 'read' : 'write'
  }
  if (TF_DESTRUCTIVE.has(sub)) return 'destructive'
  return TF_READ.has(sub) ? 'read' : 'write'
}

function classifyKubectl(args: readonly string[]): InfraCommandClass {
  if (looksDestructive(args, K8S_DESTRUCTIVE, [])) return 'destructive'
  const sub = positionals(args)[0]
  if (!sub) return 'write'
  if (K8S_DESTRUCTIVE.has(sub)) return 'destructive'
  return K8S_READ.has(sub) ? 'read' : 'write'
}


/**
 * Lệnh mà **output CHÍNH LÀ credential**. Không phải chuyện phân lớp — chuyện là
 * AWOG không bao giờ được bơm những chuỗi này vào context model và vào JSONL.
 *
 * Vì sao không dựa vào redaction (infosec audit #1, F1): lớp che sống nhờ TÊN KHOÁ
 * đứng cạnh giá trị trong JSON. `--output text` và `--query` vứt tên khoá đi, còn
 * lại chuỗi trần — và `sessions/redact.ts` CỐ Ý không bắt chuỗi entropy cao trần
 * (bắt thì sẽ che nhầm mọi hash, mọi id). Đo thật:
 *   sts assume-role                    → {"AccessKeyId":"[redacted]"}   ← che được
 *   sts assume-role --output text      → ASIAY34FZKBOKMUTVV7A  wJalrX…  ← KHÔNG che được
 * Không pattern nào vá được chuyện đó, nên phải chặn ở tầng lệnh.
 *
 * Vì sao không hạ xuống `destructive` mà chặn hẳn: `destructive` trên tài khoản
 * thường vẫn là `ask`, mà bypass tạm thời nâng `ask → auto` — đúng lúc "đang xử lý
 * sự cố" thì một agent bị dẫn dụ lấy được khoá static không ai hỏi.
 *
 * Người dùng vẫn chạy được chúng: mở terminal và tự gõ. AWOG chỉ từ chối làm
 * đường ống đưa credential vào model.
 */
const CREDENTIAL_OPS: Record<string, ReadonlySet<string>> = {
  configure: new Set(['get']),
  sts: new Set(['assume-role', 'assume-role-with-saml', 'assume-role-with-web-identity', 'get-session-token', 'get-federation-token']),
  ecr: new Set(['get-login-password']),
  'ecr-public': new Set(['get-login-password']),
  secretsmanager: new Set(['get-secret-value']),
  ssm: new Set(['get-parameter', 'get-parameters', 'get-parameters-by-path']),
  iam: new Set(['create-access-key', 'update-access-key']),
  kms: new Set(['decrypt', 'generate-data-key']),
  eks: new Set(['get-token']),
  'sso-oidc': new Set(['create-token']),
  sso: new Set(['get-role-credentials']),
  signer: new Set(['get-revocation-status']),
}

/** Tên lệnh phát credential nếu có, để chỗ gọi nói đúng lý do khi từ chối. */
export function findCredentialOp(tool: InfraTool, args: readonly string[]): string | null {
  if (tool !== 'aws') return null
  const words = positionals(args)
  const service = words[0]
  const op = words[1]
  if (!service || !op) return null
  return CREDENTIAL_OPS[service]?.has(op) ? `${service} ${op}` : null
}

/** Lớp của một lời gọi CLI. Động từ lạ ⇒ `write` (fail-safe, ADR 0088 §5). */
export function classify(tool: InfraTool, args: readonly string[]): InfraCommandClass {
  // `file://` biến bất kỳ lệnh nào thành đường đọc file tuỳ ý ⇒ không bao giờ
  // được xếp `read` (tức không bao giờ chạy tự động), dù op nằm trong allowlist.
  if (hasFileUriArg(args)) {
    const base = classifyInner(tool, args)
    return base === 'read' ? 'write' : base
  }
  return classifyInner(tool, args)
}

function classifyInner(tool: InfraTool, args: readonly string[]): InfraCommandClass {
  switch (tool) {
    case 'aws':
      return classifyAws(args)
    case 'terraform':
      return classifyTerraform(args)
    case 'kubectl':
      return classifyKubectl(args)
  }
}

/**
 * Cờ ngữ cảnh đầu tiên tìm thấy trong `args`, hoặc null. Trả về TÊN chuẩn hoá
 * (`--profile`) cho cả `--profile x` lẫn `--profile=x` để thông báo lỗi nói đúng
 * một thứ dù người gọi viết kiểu nào.
 */
/**
 * Cờ cấm, so khớp theo TIỀN TỐ chứ không theo tên đầy đủ.
 *
 * ⚠ Sửa sau infosec audit #1: AWS CLI (argparse) chấp nhận **viết tắt cờ dài** khi
 * còn phân biệt được — `--endpoint-u`, thậm chí `--e`, đều là `--endpoint-url`.
 * Bản cũ so `includes(name)` nên mọi dạng viết tắt lọt thẳng qua guard SSRF, và
 * ba chiều rà soát độc lập cùng chỉ ra lỗ này.
 *
 * Nay: một token `--x` bị từ chối nếu `--x` là tiền tố của bất kỳ cờ cấm nào
 * (hoặc ngược lại). Có over-reject — `--reg` vô hại cũng bị chặn — nhưng đó là
 * chiều an toàn: người dùng thấy một lần hỏi thừa, thay vì một lần đổi endpoint
 * không ai thấy. Trả về TÊN ĐẦY ĐỦ của cờ bị khớp để thông điệp lỗi nói đúng thứ
 * người dùng cần hiểu, chứ không lặp lại dạng viết tắt của model.
 */
export function findForbiddenFlag(args: readonly string[]): string | null {
  for (const raw of args) {
    if (!raw.startsWith('--') || raw === '--') continue
    const eq = raw.indexOf('=')
    const name = eq === -1 ? raw : raw.slice(0, eq)
    if (name.length < 3) continue // `--` trần, không phải tên cờ
    const hit = FORBIDDEN_FLAGS.find((f) => f.startsWith(name) || name.startsWith(f))
    if (hit) return hit
  }
  return null
}

/**
 * `--debug` của AWS CLI in TOÀN BỘ request đã ký ra stderr, gồm cả session token
 * của profile đang ghim; stderr thì đi vào nhật ký và vào context model. Không
 * nằm trong `FORBIDDEN_FLAGS` vì nó không đổi ngữ cảnh — nó rò credential, một
 * loại khác, nên có hàm riêng để chỗ gọi nói đúng lý do khi từ chối.
 */
const LEAKY_FLAGS: readonly string[] = ['--debug']

export function findLeakyFlag(args: readonly string[]): string | null {
  for (const raw of args) {
    if (!raw.startsWith('--')) continue
    const eq = raw.indexOf('=')
    const name = eq === -1 ? raw : raw.slice(0, eq)
    if (name.length < 3) continue
    const hit = LEAKY_FLAGS.find((f) => f.startsWith(name) || name.startsWith(f))
    if (hit) return hit
  }
  return null
}
