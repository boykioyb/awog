// HAI PLAYBOOK DỰNG SẴN (mốc 5.7) — nội dung chạy trên chính nền tảng này.
//
// Chúng sống trong MÃ, không nằm trên đĩa: người dùng không sửa được bản gốc,
// chỉ FORK ra một playbook của mình (lưu vào `~/.awog/playbooks` hoặc
// `{project}/.awog/playbooks`). Đó là lý do chúng không có `tier` trên đĩa mà
// được trả về ở danh sách riêng (`source: 'builtin'`) — đúng mục "HƯỚNG DẪN"
// trong sidebar của `playbooks.md`.
//
// MỌI bước ở đây theo đúng luật của `schema.ts`: `do` nào cũng có `rollback`
// cùng chỉ số, và mọi lệnh `check`/`verify` ưu tiên op NẰM TRONG allowlist
// `read` của `classify.ts` (nếu không, một bước đọc bị xếp lớp `write` và
// preflight sẽ đòi người dùng duyệt cho việc chỉ-đọc).
//
// ⚠ HAI CHỖ LUẬT HIỆN TẠI CHƯA ĐỦ, ghi lại ở đây để không ai tưởng là đã xong:
//   1. `--region` nằm trong `FORBIDDEN_FLAGS` (invariant 7), nên KHÔNG bước nào
//      ghim được region riêng. Bước ACM của CloudFront *bắt buộc* ở `us-east-1`
//      — nay chỉ nói được bằng `note`, không cưỡng chế được.
//   2. Không có cách buộc tham số rollback vào KẾT QUẢ của bước `do` (id hosted
//      zone, ARN của cert). Nên `zoneId`/`certArn` là biến người dùng tự điền;
//      xem `docs/features/playbooks.md` (PB4) — phần "agent điền impact/rollback"
//      là chỗ sẽ lấp khoảng này.

import type { InfraTool } from '../types.js'
import type { Playbook, PlaybookStep, PlaybookVariable, PlaybookVerb } from './schema.js'

// Playbook dựng sẵn đi kèm bản app, không có lần sửa nào để đóng dấu — hằng số
// này chỉ để `updatedAt` là ISO hợp lệ và ổn định giữa các máy.
const BUILTIN_UPDATED_AT = '2026-09-15T00:00:00.000Z'

function step(
  verb: PlaybookVerb,
  id: string,
  title: string,
  tool: InfraTool,
  args: readonly string[],
  note: string,
): PlaybookStep {
  return { id, title, verb, tool, args, note }
}

function variable(
  name: string,
  label: string,
  required: boolean,
  fallback?: string,
): PlaybookVariable {
  return fallback === undefined
    ? { name, label, required }
    : { name, label, required, default: fallback }
}

// ─── A. Website tĩnh + CDN ───────────────────────────────────────────────────

const STATIC_SITE_VARIABLES: readonly PlaybookVariable[] = [
  variable('domain', 'Tên miền', true),
  variable('bucket', 'Tên bucket S3', true),
  variable('nonce', 'Caller reference (duy nhất mỗi lần tạo zone)', true),
  variable('zoneId', 'Hosted zone id (cho bước quay lui)', false),
  variable('certArn', 'ARN chứng chỉ ACM (cho bước quay lui)', false),
]

const STATIC_SITE_STEPS: readonly PlaybookStep[] = [
  // Bước 1 — hosted zone.
  step(
    'check',
    'zone-check',
    'Đã có hosted zone cho tên miền chưa',
    'aws',
    ['route53', 'list-hosted-zones-by-name', '--dns-name', '{{domain}}'],
    'Route53 phải quản DNS thì mới trỏ được ALIAS sang CloudFront và tự xác thực chứng chỉ.',
  ),
  step(
    'do',
    'zone-create',
    'Tạo hosted zone',
    'aws',
    ['route53', 'create-hosted-zone', '--name', '{{domain}}', '--caller-reference', '{{nonce}}'],
    'Lệnh in ra 4 nameserver — nếu tên miền mua ở nơi khác thì phải đổi nameserver sang đó rồi đợi lan truyền.',
  ),
  step(
    'verify',
    'zone-verify',
    'Hosted zone đã tồn tại',
    'aws',
    ['route53', 'list-hosted-zones-by-name', '--dns-name', '{{domain}}'],
    'Không tin exit code: lệnh tạo zone thành công vẫn có thể không hiện trong danh sách nếu chạy nhầm account.',
  ),
  step(
    'rollback',
    'zone-delete',
    'Xoá hosted zone',
    'aws',
    ['route53', 'delete-hosted-zone', '--id', '{{zoneId}}'],
    'Chỉ xoá được zone rỗng — phải xoá bản ghi (trừ NS/SOA mặc định) trước. Cần id do bước tạo in ra.',
  ),

  // Bước 2 — chứng chỉ ACM.
  step(
    'check',
    'cert-check',
    'Đã có chứng chỉ cho tên miền chưa',
    'aws',
    ['acm', 'list-certificates'],
    'Chứng chỉ dùng cho CloudFront BẮT BUỘC nằm ở us-east-1, bất kể site ở region nào.',
  ),
  step(
    'do',
    'cert-request',
    'Yêu cầu chứng chỉ ACM (xác thực DNS)',
    'aws',
    ['acm', 'request-certificate', '--domain-name', '{{domain}}', '--validation-method', 'DNS'],
    'Phải chạy với ngữ cảnh region us-east-1. Sau đó thêm bản ghi CNAME xác thực và đợi trạng thái ISSUED.',
  ),
  step(
    'verify',
    'cert-verify',
    'Chứng chỉ đã ở trạng thái ISSUED',
    'aws',
    ['acm', 'list-certificates'],
    'Chứng chỉ kẹt PENDING_VALIDATION gần như luôn là chưa thêm CNAME hoặc thêm vào sai hosted zone.',
  ),
  step(
    'rollback',
    'cert-delete',
    'Xoá chứng chỉ ACM',
    'aws',
    ['acm', 'delete-certificate', '--certificate-arn', '{{certArn}}'],
    'Chỉ xoá được chứng chỉ không còn distribution nào dùng. Cần ARN do bước yêu cầu in ra.',
  ),

  // Bước 3 — bucket S3.
  step(
    'check',
    'bucket-check',
    'Bucket đã tồn tại chưa',
    'aws',
    ['s3api', 'head-bucket', '--bucket', '{{bucket}}'],
    'Tên bucket là duy nhất toàn cầu; đặt trùng tên người khác sẽ hỏng ngay ở bước này.',
  ),
  step(
    'do',
    'bucket-create',
    'Tạo bucket S3',
    'aws',
    ['s3api', 'create-bucket', '--bucket', '{{bucket}}'],
    'Tạo ở region của ngữ cảnh đang ghim. Bucket KHÔNG cần public vì CloudFront đọc qua OAC.',
  ),
  step(
    'verify',
    'bucket-verify',
    'Bucket đã sẵn sàng',
    'aws',
    ['s3api', 'head-bucket', '--bucket', '{{bucket}}'],
    'Tên bucket mới có thể mất vài giây mới nhất quán toàn cầu.',
  ),
  step(
    'rollback',
    'bucket-delete',
    'Xoá bucket S3',
    'aws',
    ['s3api', 'delete-bucket', '--bucket', '{{bucket}}'],
    'S3 chỉ xoá được bucket RỖNG — phải xoá hết object (và version) trước.',
  ),

  // Bước 4 — chặn public access.
  step(
    'check',
    'block-check',
    'Đã chặn public access chưa',
    'aws',
    ['s3api', 'get-public-access-block', '--bucket', '{{bucket}}'],
    'Với OAC thì bucket không cần public; chặn public là mặc định an toàn và là lỗi cấu hình phổ biến nhất.',
  ),
  step(
    'do',
    'block-put',
    'Chặn toàn bộ public access của bucket',
    'aws',
    [
      's3api',
      'put-public-access-block',
      '--bucket',
      '{{bucket}}',
      '--public-access-block-configuration',
      'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true',
    ],
    'Bốn cờ cùng bật: thiếu một cái là bucket vẫn hở qua đường khác (ACL, policy, hoặc object mới).',
  ),
  step(
    'verify',
    'block-verify',
    'Public access đã bị chặn',
    'aws',
    ['s3api', 'get-public-access-block', '--bucket', '{{bucket}}'],
    'Kiểm chứng bằng lệnh đọc chứ không tin exit code của lệnh ghi.',
  ),
  step(
    'rollback',
    'block-delete',
    'Bỏ cấu hình chặn public access',
    'aws',
    ['s3api', 'delete-public-access-block', '--bucket', '{{bucket}}'],
    'Đưa bucket về trạng thái mặc định (không chặn) — chỉ để hoàn tác khi cấu hình sai.',
  ),
]

export const STATIC_SITE_PLAYBOOK: Playbook = {
  id: 'static-site',
  name: 'Website tĩnh + CDN',
  description:
    'Dựng một website tĩnh trên AWS: hosted zone, chứng chỉ ACM, bucket S3 và chặn public access.',
  kind: 'instruction',
  tier: 'global',
  variables: STATIC_SITE_VARIABLES,
  steps: STATIC_SITE_STEPS,
  updatedAt: BUILTIN_UPDATED_AT,
}

// ─── B. Dọn dẹp (teardown) ───────────────────────────────────────────────────
//
// Thứ tự ngược với playbook dựng. Mỗi bước quay lui ở đây là lệnh DỰNG LẠI —
// với một playbook dọn dẹp thì đó là định nghĩa đúng của "hoàn tác", và nó là
// điều kiện để playbook này qua được luật rollback như mọi playbook khác.

const TEARDOWN_VARIABLES: readonly PlaybookVariable[] = [
  variable('domain', 'Tên miền', true),
  variable('bucket', 'Tên bucket S3', true),
  variable('zoneId', 'Hosted zone id', true),
  variable('certArn', 'ARN chứng chỉ ACM', true),
  variable('nonce', 'Caller reference (dùng lại khi dựng lại zone)', true),
]

const TEARDOWN_STEPS: readonly PlaybookStep[] = [
  step(
    'check',
    'teardown-block-check',
    'Bucket còn cấu hình chặn public access không',
    'aws',
    ['s3api', 'get-public-access-block', '--bucket', '{{bucket}}'],
    'Đọc trước khi ghi để không phải đoán mình đang ở trạng thái nào.',
  ),
  step(
    'do',
    'teardown-block-delete',
    'Bỏ cấu hình chặn public access',
    'aws',
    ['s3api', 'delete-public-access-block', '--bucket', '{{bucket}}'],
    'Phải bỏ chặn trước khi xoá bucket, nếu không bước sau sẽ hỏng ở giữa đường.',
  ),
  step(
    'verify',
    'teardown-block-verify',
    'Cấu hình chặn đã bị bỏ',
    'aws',
    ['s3api', 'get-public-access-block', '--bucket', '{{bucket}}'],
    'Lệnh trả về lỗi NoSuchPublicAccessBlockConfiguration chính là dấu hiệu đã bỏ xong.',
  ),
  step(
    'rollback',
    'teardown-block-undo',
    'Chặn lại public access',
    'aws',
    [
      's3api',
      'put-public-access-block',
      '--bucket',
      '{{bucket}}',
      '--public-access-block-configuration',
      'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true',
    ],
    'Dựng lại đúng cấu hình an toàn mà playbook static-site đặt vào.',
  ),

  step(
    'check',
    'teardown-bucket-check',
    'Bucket còn tồn tại không',
    'aws',
    ['s3api', 'head-bucket', '--bucket', '{{bucket}}'],
    'Xoá một bucket không tồn tại là việc vô nghĩa — bước này để bỏ qua thay vì báo lỗi.',
  ),
  step(
    'do',
    'teardown-bucket-delete',
    'Xoá bucket S3',
    'aws',
    ['s3api', 'delete-bucket', '--bucket', '{{bucket}}'],
    'PHÁ HUỶ: S3 chỉ xoá được bucket rỗng. Xoá sạch object (và version) trước, hoặc dùng vòng đời.',
  ),
  step(
    'verify',
    'teardown-bucket-verify',
    'Bucket đã bị xoá',
    'aws',
    ['s3api', 'head-bucket', '--bucket', '{{bucket}}'],
    'head-bucket trả 404 là kết quả mong đợi ở bước này.',
  ),
  step(
    'rollback',
    'teardown-bucket-undo',
    'Dựng lại bucket S3',
    'aws',
    ['s3api', 'create-bucket', '--bucket', '{{bucket}}'],
    'Bucket rỗng được dựng lại; NỘI DUNG đã xoá thì không lấy lại được — đó là giới hạn thật của teardown.',
  ),

  step(
    'check',
    'teardown-cert-check',
    'Chứng chỉ còn tồn tại không',
    'aws',
    ['acm', 'list-certificates'],
    'Chứng chỉ chỉ xoá được khi không còn distribution nào dùng.',
  ),
  step(
    'do',
    'teardown-cert-delete',
    'Xoá chứng chỉ ACM',
    'aws',
    ['acm', 'delete-certificate', '--certificate-arn', '{{certArn}}'],
    'PHÁ HUỶ: xoá chứng chỉ đang phục vụ một distribution sẽ làm HTTPS hỏng ngay.',
  ),
  step(
    'verify',
    'teardown-cert-verify',
    'Chứng chỉ đã bị xoá',
    'aws',
    ['acm', 'list-certificates'],
    'Không còn thấy ARN trong danh sách là kết quả mong đợi.',
  ),
  step(
    'rollback',
    'teardown-cert-undo',
    'Yêu cầu lại chứng chỉ ACM',
    'aws',
    ['acm', 'request-certificate', '--domain-name', '{{domain}}', '--validation-method', 'DNS'],
    'Chứng chỉ mới phải xác thực lại từ đầu — teardown không hoàn tác được ngay.',
  ),

  step(
    'check',
    'teardown-zone-check',
    'Hosted zone còn tồn tại không',
    'aws',
    ['route53', 'list-hosted-zones-by-name', '--dns-name', '{{domain}}'],
    'Zone chỉ xoá được khi đã rỗng.',
  ),
  step(
    'do',
    'teardown-zone-delete',
    'Xoá hosted zone',
    'aws',
    ['route53', 'delete-hosted-zone', '--id', '{{zoneId}}'],
    'PHÁ HUỶ: tên miền sẽ ngừng phân giải. Chỉ làm khi chắc chắn không còn ai dùng zone này.',
  ),
  step(
    'verify',
    'teardown-zone-verify',
    'Hosted zone đã bị xoá',
    'aws',
    ['route53', 'list-hosted-zones-by-name', '--dns-name', '{{domain}}'],
    'Không còn zone trong danh sách là kết quả mong đợi.',
  ),
  step(
    'rollback',
    'teardown-zone-undo',
    'Dựng lại hosted zone',
    'aws',
    ['route53', 'create-hosted-zone', '--name', '{{domain}}', '--caller-reference', '{{nonce}}'],
    'Zone mới sẽ có 4 nameserver KHÁC — phải trỏ lại registrar, và bản ghi cũ phải dựng lại tay.',
  ),
]

export const TEARDOWN_PLAYBOOK: Playbook = {
  id: 'teardown',
  name: 'Dọn dẹp môi trường thử',
  description:
    'Dỡ bỏ theo thứ tự ngược thứ mà playbook dựng đã tạo: cấu hình bucket, bucket, chứng chỉ, hosted zone.',
  kind: 'instruction',
  tier: 'global',
  variables: TEARDOWN_VARIABLES,
  steps: TEARDOWN_STEPS,
  updatedAt: BUILTIN_UPDATED_AT,
}

export const BUILTIN_PLAYBOOKS: readonly Playbook[] = [STATIC_SITE_PLAYBOOK, TEARDOWN_PLAYBOOK]

export function builtinPlaybook(id: string): Playbook | undefined {
  return BUILTIN_PLAYBOOKS.find((p) => p.id === id)
}
