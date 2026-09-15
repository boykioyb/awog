// Bảng ca cho `classify()` — ADR 0088 §5 (task 0.2).
//
// Đây là nơi duy nhất kiểm được luật fail-safe: một động từ mới của CLI phải rơi
// vào `write` (hỏi thừa) chứ không rơi vào `read` (chạy nhầm). Xếp `read` sai
// thành `write` chỉ tốn một lần bấm; xếp `destructive` sai thành `read` là xoá
// tài nguyên thật mà không ai kịp nhìn.
import { describe, expect, it } from 'vitest'
import {
  CONTEXT_BLOCKED_BINARIES,
  CONTEXT_SWITCH_CLASS,
  FORBIDDEN_FLAGS,
  classify,
  findCredentialOp,
  findForbiddenFlag,
  sensitiveReadOf,
} from '../classify.js'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { infraCachePath } from '../cache.js'
import type { InfraTool } from '../types.js'

const CACHE_OUT = infraCachePath('b', 'k')

describe('read', () => {
  it.each<[InfraTool, string[]]>([
    ['aws', ['ec2', 'describe-instances']],
    ['aws', ['s3api', 'list-buckets']],
    ['aws', ['s3', 'ls', 's3://bucket']],
    ['aws', ['s3api', 'head-object', '--bucket', 'b', '--key', 'k']],
    ['aws', ['logs', 'get-log-events', '--log-group-name', 'g']],
    ['terraform', ['validate']],
    ['terraform', ['output', '-json']],
    ['terraform', ['show']],
    ['terraform', ['state', 'list']],
    ['terraform', ['state', 'show', 'aws_s3_bucket.web']],
    ['kubectl', ['get', 'pods']],
    ['kubectl', ['describe', 'deploy', 'api']],
    ['kubectl', ['logs', 'pod/api-0']],
    ['kubectl', ['top', 'nodes']],
    ['kubectl', ['api-resources']],
  ])('%s %j → read', (tool, args) => {
    expect(classify(tool, args)).toBe('read')
  })
})

describe('destructive', () => {
  it.each<[InfraTool, string[]]>([
    ['aws', ['ec2', 'terminate-instances', '--instance-ids', 'i-1']],
    ['aws', ['iam', 'delete-role', '--role-name', 'r']],
    ['aws', ['s3', 'rm', 's3://bucket/key']],
    ['aws', ['s3', 'rb', 's3://bucket']],
    ['aws', ['ec2', 'remove-tags']],
    ['terraform', ['destroy', '-auto-approve']],
    // `apply` và `import` ghi thẳng vào hạ tầng thật ⇒ cùng lớp với `destroy`.
    ['terraform', ['apply']],
    ['terraform', ['import', 'aws_s3_bucket.web', 'my-bucket']],
    ['terraform', ['state', 'rm', 'aws_s3_bucket.web']],
    ['kubectl', ['delete', 'pod', 'api-0']],
    // `drain` đuổi hết pod khỏi node — phá huỷ dù không xoá đối tượng nào.
    ['kubectl', ['drain', 'node-1']],
  ])('%s %j → destructive', (tool, args) => {
    expect(classify(tool, args)).toBe('destructive')
  })
})

describe('write — gồm cả mọi thứ không nhận ra', () => {
  it.each<[InfraTool, string[]]>([
    ['aws', ['ec2', 'create-tags']],
    ['aws', ['s3', 'cp', 'a', 's3://bucket/a']],
    ['aws', ['eks', 'update-kubeconfig', '--name', 'c']],
    ['kubectl', ['apply', '-f', 'deploy.yaml']],
    ['kubectl', ['scale', 'deploy/api', '--replicas=3']],
    ['kubectl', ['rollout', 'restart', 'deploy/api']],
    // `plan` giữ state lock, `init` ghi backend ⇒ KHÔNG phải read (ADR 0088 §5).
    ['terraform', ['plan']],
    ['terraform', ['plan', '-out=tfplan']],
    ['terraform', ['init']],
    // Động từ lạ / thiếu động từ: fail-safe về write, không bao giờ về read.
    ['aws', ['ec2', 'frobnicate-widgets']],
    ['aws', ['s3api']],
    ['aws', []],
    ['terraform', ['frobnicate']],
    ['terraform', ['state']],
    ['terraform', ['state', 'push', 'tfstate']],
    ['kubectl', ['frobnicate']],
    ['kubectl', []],
  ])('%s %j → write', (tool, args) => {
    expect(classify(tool, args)).toBe('write')
  })
})

describe('context-switch', () => {
  // Lớp này mô tả lời gọi nội bộ của AWOG, không có động từ CLI nào tương ứng.
  it('is a constant the caller declares, never inferred from argv', () => {
    expect(CONTEXT_SWITCH_CLASS).toBe('context-switch')
    const probes: [InfraTool, string[]][] = [
      ['aws', ['configure', 'set', 'region', 'ap-southeast-1']],
      ['aws', ['sso', 'login']],
      ['kubectl', ['config', 'use-context', 'prod']],
      ['terraform', ['workspace', 'select', 'prod']],
    ]
    for (const [tool, args] of probes) {
      expect(classify(tool, args)).not.toBe('context-switch')
    }
  })
})

describe('findForbiddenFlag', () => {
  it.each([
    [['s3api', 'list-buckets', '--profile', 'prod'], '--profile'],
    [['s3api', 'list-buckets', '--profile=prod'], '--profile'],
    [['ec2', 'describe-instances', '--region=us-east-1'], '--region'],
    [['s3', 'ls', '--endpoint-url', 'http://169.254.169.254'], '--endpoint-url'],
    [['get', 'pods', '--kubeconfig=/tmp/evil.yaml'], '--kubeconfig'],
    [['get', 'pods', '--context', 'prod'], '--context'],
    [['get', 'pods', '--namespace=kube-system'], '--namespace'],
    [['s3', 'ls', '--no-verify-ssl'], '--no-verify-ssl'],
    [['s3', 'ls', '--ca-bundle', '/tmp/ca.pem'], '--ca-bundle'],
  ])('%j → %s', (args, expected) => {
    expect(findForbiddenFlag(args as string[])).toBe(expected)
  })

  it('leaves a clean command alone', () => {
    expect(findForbiddenFlag(['ec2', 'describe-instances', '--max-items', '10'])).toBeNull()
    expect(findForbiddenFlag([])).toBeNull()
  })

  // ⚠ Đảo sau infosec audit #1. Ca này TRƯỚC ĐÂY khẳng định `--prof` KHÔNG bị bắt —
  // tức nó khoá lại đúng lỗ hổng: AWS CLI (argparse) chấp nhận viết tắt cờ dài, nên
  // `--prof`, `--e` vẫn là `--profile`, `--endpoint-url`. Nay khớp theo tiền tố.
  it('bắt cả dạng viết tắt của cờ dài (argparse cho phép rút gọn)', () => {
    expect(findForbiddenFlag(['--prof', 'prod'])).toBe('--profile')
    expect(findForbiddenFlag(['--e', 'http://evil'])).toBe('--endpoint-url')
    expect(findForbiddenFlag(['--endpoint-u=http://evil'])).toBe('--endpoint-url')
    // Cờ không liên quan vẫn đi qua.
    expect(findForbiddenFlag(['--output', 'json'])).toBe(null)
    expect(findForbiddenFlag(['--filters', 'Name=tag:x'])).toBe(null)
  })
})

describe('hard lists', () => {
  it('keeps every context flag long-form and deduped', () => {
    expect(new Set(FORBIDDEN_FLAGS).size).toBe(FORBIDDEN_FLAGS.length)
    for (const flag of FORBIDDEN_FLAGS) expect(flag.startsWith('--')).toBe(true)
  })

  // ADR 0088 §6: "Always allow" của ADR 0080 không được phủ các binary này.
  it('covers the tools without an adapter yet', () => {
    for (const bin of ['aws', 'terraform', 'kubectl', 'helm', 'gcloud', 'az']) {
      expect(CONTEXT_BLOCKED_BINARIES).toContain(bin)
    }
  })
})

// ─── A5: liệt kê account/role của SSO ────────────────────────────────────────
//
// Hai lệnh này được THÊM vào allowlist `read` ở Mốc 1. Bài test dưới khoá lại cả
// hai nửa của quyết định: nửa được mở, và nửa KHÔNG được mở cùng nó.
describe('sso — liệt kê là read, phát credential thì không', () => {
  it.each([['list-accounts'], ['list-account-roles']])('aws sso %s → read', (op) => {
    expect(classify('aws', ['sso', op, '--output', 'json'])).toBe('read')
  })

  // `sso login` mở trình duyệt và ghi `~/.aws/sso/cache` — không phải đọc.
  it('aws sso login vẫn là write', () => {
    expect(classify('aws', ['sso', 'login', '--sso-session', 'corp'])).toBe('write')
  })

  // Đây là lệnh mà OUTPUT CHÍNH LÀ credential. Nó phải ở nguyên trong danh sách
  // chặn cứng, không được "đi ké" vì hai anh em của nó vừa vào allowlist read.
  it('aws sso get-role-credentials vẫn bị chặn cứng, không bao giờ là read', () => {
    expect(findCredentialOp('aws', ['sso', 'get-role-credentials'])).toBe(
      'sso get-role-credentials',
    )
    expect(classify('aws', ['sso', 'get-role-credentials'])).not.toBe('read')
  })

  // `--access-token` là credential đi qua argv (xem đầu `infra/aws/sso.ts`).
  // Nó KHÔNG được rơi vào guard cờ ngữ cảnh — rơi vào thì `runInfra` từ chối
  // thẳng và cả luồng A5 chết, mà nó không phải cờ ngữ cảnh.
  it('--access-token không bị nhầm thành cờ ngữ cảnh', () => {
    expect(findForbiddenFlag(['sso', 'list-accounts', '--access-token', 'x'])).toBe(null)
    expect(findForbiddenFlag(['sso', 'list-account-roles', '--account-id', '229015218011'])).toBe(
      null,
    )
  })
})

// Mốc 2 — "Quyết định còn treo": CloudWatch là nơi credential/PII hay nằm nhất
// trong allowlist `read`, và Mốc 2 mở rộng đúng bề mặt đó. `sensitiveReadOf()` là
// tên miền cho luật "đọc nội dung log thì phải hỏi ở production"; nó phải nhận
// ĐÚNG bốn op trả nội dung, không nhận `describe-*` (metadata), và không bao giờ
// tự nhận một op không tồn tại.
describe('sensitiveReadOf — đọc NỘI DUNG log (Mốc 2)', () => {
  it.each([
    [['logs', 'filter-log-events'], 'logs filter-log-events'],
    [['logs', 'get-log-events'], 'logs get-log-events'],
    [['logs', 'get-query-results'], 'logs get-query-results'],
    [['logs', 'start-query'], 'logs start-query'],
  ])('%s ⇒ %s', (argv, expected) => {
    expect(sensitiveReadOf('aws', argv)).toBe(expected)
  })

  it('metadata và op lạ KHÔNG bị coi là nhạy cảm', () => {
    // `describe-log-groups` là thứ vẽ danh sách chọn group — chặn nó sẽ biến màn
    // Logs thành chuỗi hộp duyệt vô nghĩa mà không mua được an toàn nào.
    expect(sensitiveReadOf('aws', ['logs', 'describe-log-groups'])).toBe(null)
    expect(sensitiveReadOf('aws', ['logs', 'describe-log-streams'])).toBe(null)
    expect(sensitiveReadOf('aws', ['logs', 'stop-query'])).toBe(null)
    expect(sensitiveReadOf('aws', ['ec2', 'describe-instances'])).toBe(null)
    // Sai công cụ ⇒ không bao giờ nhận: `describe-instances` là op AWS, không
    // phải động từ kubectl nào.
    expect(sensitiveReadOf('kubectl', ['describe-instances'])).toBe(null)
  })
})

// ─── Terraform/kubectl: các cặp (động từ, cờ) mà allowlist theo động từ không
// diễn tả được — việc 13/20 của P1/P2.
describe('terraform fmt / workspace', () => {
  it.each<[string[]]>([
    [['fmt', '-check']],
    [['fmt', '-check=true']],
    [['workspace', 'list']],
    [['workspace', 'show']],
  ])('%j → read', (args) => {
    expect(classify('terraform', args)).toBe('read')
  })

  it.each<[string[]]>([
    // `fmt` trần SỬA file .tf tại chỗ.
    [['fmt']],
    [['fmt', '-recursive']],
    // `select` ĐỔI workspace ⇒ không bao giờ được chạy tự động.
    [['workspace', 'select', 'staging']],
    [['workspace', 'new', 'x']],
    [['workspace', 'delete', 'x']],
  ])('%j → write', (args) => {
    expect(classify('terraform', args)).toBe('write')
  })
})

describe('kubectl secret reading', () => {
  it.each<[string[]]>([
    [['get', 'secret', 'app', '-o', 'yaml']],
    [['get', 'secrets', '-oyaml']],
    [['get', 'secret/app', '-o=json']],
    [['get', '--namespace', 'x', 'secret', 'app', '--output', 'yaml']],
    // `custom-columns` in ra đúng field được chọn — cùng sức mạnh với `jsonpath`,
    // nên nó phải nằm cùng nhóm bị chặn. Thiếu ca này thì đường vòng này im lặng.
    [['get', 'secret', 'app', '-o', 'custom-columns=D:.data.password']],
    [['get', 'secret', 'app', '-o', 'custom-columns-file=cols.txt']],
  ])('findCredentialOp %j → blocked', (args) => {
    expect(findCredentialOp('kubectl', args)).not.toBeNull()
  })

  it.each<[string[]]>([
    // Bảng tên: không có giá trị nào của secret.
    [['get', 'secrets']],
    [['get', 'secret', 'app']],
    // `describe` chỉ in tên khoá + số byte, không in giá trị.
    [['describe', 'secret', 'app']],
    // `-o wide` là bảng, không phải nội dung object.
    [['get', 'pods', '-o', 'wide']],
  ])('findCredentialOp %j → null', (args) => {
    expect(findCredentialOp('kubectl', args)).toBeNull()
  })
})

describe('sensitiveReadOf', () => {
  it.each<[InfraTool, string[]]>([
    ['kubectl', ['logs', 'pod/api-0']],
    ['kubectl', ['get', 'configmap', 'x', '-o', 'yaml']],
    ['kubectl', ['get', 'pods', '-o', 'custom-columns=NAME:.metadata.name']],
    ['terraform', ['output']],
    ['terraform', ['state', 'show', 'aws_s3_bucket.web']],
    ['terraform', ['show']],
  ])('%s %j → sensitive', (tool, args) => {
    expect(sensitiveReadOf(tool, args)).not.toBeNull()
  })

  it.each<[InfraTool, string[]]>([
    ['kubectl', ['get', 'pods']],
    ['kubectl', ['top', 'nodes']],
    ['kubectl', ['events', '-A']],
    // Metadata thuần — vẫn chạy tự động.
    ['terraform', ['validate']],
    ['terraform', ['fmt', '-check']],
    ['terraform', ['state', 'list']],
    ['terraform', ['version']],
  ])('%s %j → not sensitive', (tool, args) => {
    expect(sensitiveReadOf(tool, args)).toBeNull()
  })
})

// ─── Mốc 3: những op mới của Explorer ────────────────────────────────────────
//
// Ba nhóm, ba lý do khác nhau:
//   · `presign` — sinh URL có hạn, KHÔNG đổi gì trên AWS ⇒ `read`;
//   · `ecr describe-repositories` / `secretsmanager list-secrets` — metadata
//     thuần, phục vụ mức "Danh sách" ⇒ `read`;
//   · `s3api get-object` — lệnh ĐỌC nhưng GHI RA FILE. Nó chỉ là `read` khi đích
//     nằm trong cache do sidecar sở hữu; một đường dẫn bất kỳ vẫn phải là `write`.
//     Đây là ca quan trọng nhất của cả nhóm: nếu nó lọt thành `read`, một "lệnh
//     đọc" trở thành nguyên thuỷ ghi file tuỳ ý.
describe('Mốc 3 — op mới của Explorer', () => {
  it.each<[string, string[]]>([
    ['presign S3', ['s3', 'presign', 's3://bucket/key', '--expires-in', '900']],
    ['ecr describe-repositories', ['ecr', 'describe-repositories']],
    ['secretsmanager list-secrets', ['secretsmanager', 'list-secrets']],
    ['iam simulate-principal-policy', ['iam', 'simulate-principal-policy', '--action-names', 'x']],
    ['s3api get-object vào cache', ['s3api', 'get-object', '--bucket', 'b', '--key', 'k', CACHE_OUT]],
  ])('%s → read', (_label, args) => {
    expect(classify('aws', args)).toBe('read')
  })

  it('s3api get-object ra đường dẫn bất kỳ → write (KHÔNG phải read)', () => {
    expect(
      classify('aws', ['s3api', 'get-object', '--bucket', 'b', '--key', 'k', '/tmp/out.bin']),
    ).toBe('write')
  })

  it('s3api get-object ra ~/.ssh → write', () => {
    expect(
      classify('aws', [
        's3api',
        'get-object',
        '--bucket',
        'b',
        '--key',
        'k',
        join(homedir(), '.ssh', 'authorized_keys'),
      ]),
    ).toBe('write')
  })

  it('`..` trong đường dẫn không lách qua được hàng rào cache', () => {
    const escaped = join(CACHE_OUT, '..', '..', '..', 'etc', 'passwd')
    expect(classify('aws', ['s3api', 'get-object', '--bucket', 'b', '--key', 'k', escaped])).toBe(
      'write',
    )
  })

  it('op ghi mới vẫn là write, không lọt qua cùng đường', () => {
    expect(classify('aws', ['s3api', 'put-object', '--bucket', 'b', '--key', 'k'])).toBe('write')
    expect(classify('aws', ['iam', 'attach-role-policy'])).toBe('write')
  })
})
