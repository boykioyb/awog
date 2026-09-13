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
  findForbiddenFlag,
} from '../classify.js'
import type { InfraTool } from '../types.js'

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
