// `runInfra` — hai tham số MỐC 2 thêm vào cổng CLI duy nhất, và hàng rào của chúng.
//
//   · `cost` — CloudWatch Insights tính tiền theo GB quét; dòng nhật ký phải trả
//     lời được "lần đó tốn bao nhiêu" kể cả khi lệnh hỏng giữa đường.
//   · `audit: false` — vòng POLL của Insights gọi CLI mỗi ~1.5s do app tự sinh.
//     Bỏ ghi cho nó là điều kiện để nhật ký còn là BẰNG CHỨNG thay vì tiếng ồn —
//     nhưng chỉ lớp `read` mới được miễn, nên không có đường nào giấu một lệnh ghi.
//
// Không ca nào spawn tiến trình thật: `child_process` bị mock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { recordInfraAction, execFile } = vi.hoisted(() => ({
  recordInfraAction: vi.fn().mockResolvedValue(undefined),
  execFile: vi.fn(),
}))

vi.mock('../audit/store.js', () => ({ recordInfraAction }))
vi.mock('../binary.js', () => ({
  resolveInfraBinary: vi.fn().mockResolvedValue('/usr/bin/aws'),
  installHint: (): string => 'install aws',
}))
vi.mock('node:child_process', () => ({ execFile }))

import { runInfra } from '../run.js'

type ExecCallback = (err: Error | null, stdout: string, stderr: string) => void

function fakeExec(stdout = '', stderr = '', code = 0): void {
  execFile.mockImplementation(
    (_bin: string, _args: string[], _opts: unknown, cb: ExecCallback) => {
      const err = code === 0 ? null : Object.assign(new Error('exit'), { code })
      cb(err, stdout, stderr)
      return { stdout: null, stderr: null }
    },
  )
}

beforeEach(() => {
  recordInfraAction.mockClear()
  execFile.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

const base = {
  tool: 'aws' as const,
  context: { profile: 'dev' },
  actor: 'human',
  surface: 'logs' as const,
  toolName: 'logs_query',
  decision: 'approved' as const,
}

describe('tham số `cost` (2.6)', () => {
  it('chi phí ước lượng đi thẳng vào dòng nhật ký', async () => {
    fakeExec('{"queryId":"x"}')
    await runInfra({
      ...base,
      args: ['logs', 'start-query', '--query-string=fields @timestamp'],
      cost: { estimatedUsd: 0.125 },
    })
    const entry = recordInfraAction.mock.calls[0]?.[0] as { cost?: { estimatedUsd?: number } }
    expect(entry.cost?.estimatedUsd).toBe(0.125)
  })

  it('không có `cost` thì KHÔNG ghi trường `cost` (nhật ký cũ không đổi hình dạng)', async () => {
    fakeExec('{}')
    await runInfra({ ...base, args: ['sts', 'get-caller-identity'] })
    const entry = recordInfraAction.mock.calls[0]?.[0] as Record<string, unknown>
    expect('cost' in entry).toBe(false)
  })
})

describe('tham số `audit` — chỉ lớp `read` được miễn ghi', () => {
  it('lớp `read` + audit:false ⇒ KHÔNG có dòng nhật ký', async () => {
    fakeExec('{"status":"Complete"}')
    await runInfra({
      ...base,
      args: ['logs', 'get-query-results', '--query-id=x'],
      audit: false,
    })
    expect(recordInfraAction).not.toHaveBeenCalled()
    // Lệnh vẫn chạy thật — bỏ ghi không có nghĩa bỏ chạy.
    expect(execFile).toHaveBeenCalled()
  })

  it('lớp `write` + audit:false vẫn BỊ ÉP GHI — không đường nào giấu một lệnh ghi', async () => {
    fakeExec('{"queryId":"x"}')
    const result = await runInfra({
      ...base,
      args: ['logs', 'start-query', '--query-string=fields @timestamp'],
      audit: false,
    })
    expect(result.class).toBe('write')
    expect(recordInfraAction).toHaveBeenCalledTimes(1)
  })

  it('lớp `destructive` + audit:false cũng BỊ ÉP GHI', async () => {
    fakeExec('{}')
    await runInfra({
      ...base,
      args: ['ec2', 'terminate-instances', '--instance-ids', 'i-1'],
      audit: false,
    })
    expect(recordInfraAction).toHaveBeenCalledTimes(1)
  })

  it('mặc định (không truyền `audit`) là GHI, kể cả lớp `read`', async () => {
    fakeExec('{}')
    await runInfra({ ...base, args: ['sts', 'get-caller-identity'] })
    expect(recordInfraAction).toHaveBeenCalledTimes(1)
  })
})

// Env của tiến trình con: `aws` nhận ngữ cảnh bằng CỜ, kubectl/terraform nhận
// bằng ENV. Ca này khoá lại chiều đó — nếu ai đó "dọn cho đối xứng" mà truyền
// `awsProfile` cho cả `aws`, `--profile` và `AWS_PROFILE` sẽ nói về hai account
// khác nhau khi người dùng đã export `AWS_PROFILE` trong shell (invariant #7).
describe('env ngữ cảnh: chỉ kubectl/terraform nhận AWS_PROFILE', () => {
  type Opts = { env?: Record<string, string | undefined> }
  function lastEnv(): Record<string, string | undefined> {
    const call = execFile.mock.calls.at(-1) as [string, string[], Opts, ExecCallback] | undefined
    return call?.[2].env ?? {}
  }

  it('kubectl + profile ghim ⇒ AWS_PROFILE/region xuống tiến trình con', async () => {
    fakeExec('{}')
    await runInfra({
      ...base,
      tool: 'kubectl',
      context: { profile: 'dev', region: 'ap-southeast-1', cluster: 'readonly-context' },
      surface: 'terminal',
      toolName: 'kubectl_cli',
      args: ['get', 'namespaces'],
    })
    const env = lastEnv()
    expect(env.AWS_PROFILE).toBe('dev')
    expect(env.AWS_REGION).toBe('ap-southeast-1')
    // Region đi thành HAI biến: CLI v1 cũ chỉ đọc `AWS_DEFAULT_REGION`.
    expect(env.AWS_DEFAULT_REGION).toBe('ap-southeast-1')
  })

  it('aws + profile ghim ⇒ KHÔNG có AWS_PROFILE (ngữ cảnh đi bằng --profile)', async () => {
    fakeExec('{}')
    await runInfra({ ...base, args: ['sts', 'get-caller-identity'] })
    const env = lastEnv()
    expect(env.AWS_PROFILE).toBeUndefined()
    expect(env.AWS_REGION).toBeUndefined()
  })

  it('kubectl không ghim profile ⇒ không tự bịa AWS_PROFILE (không "lặng lẽ" đổi account)', async () => {
    fakeExec('{}')
    await runInfra({
      ...base,
      tool: 'kubectl',
      context: { cluster: 'readonly-context' },
      surface: 'terminal',
      toolName: 'kubectl_cli',
      args: ['get', 'namespaces'],
    })
    expect(lastEnv().AWS_PROFILE).toBeUndefined()
  })

  it('biến cấu hình người dùng đặt vẫn được luồn xuống (KUBECONFIG)', async () => {
    const before = process.env.KUBECONFIG
    process.env.KUBECONFIG = '/tmp/awog-test-kubeconfig'
    try {
      fakeExec('{}')
      await runInfra({
        ...base,
        tool: 'kubectl',
        context: { cluster: 'readonly-context' },
        surface: 'terminal',
        toolName: 'kubectl_cli',
        args: ['get', 'namespaces'],
      })
      expect(lastEnv().KUBECONFIG).toBe('/tmp/awog-test-kubeconfig')
    } finally {
      if (before === undefined) delete process.env.KUBECONFIG
      else process.env.KUBECONFIG = before
    }
  })
})

// Hàng rào cờ ngữ cảnh, sau khi `--namespace` chuyển từ danh sách TOÀN CỤC sang
// danh sách riêng của kubectl (2026-09-17).
//
// Hai mặt phải đúng cùng lúc, và bài test này tồn tại vì sửa một mặt rất dễ làm
// hỏng mặt kia: `aws` phải chạy được `--namespace` (nó là tham số truy vấn của
// CloudWatch), còn `kubectl` phải VẪN bị chặn (ở đó nó thật sự đổi ngữ cảnh).
describe('cờ --namespace: chặn cho kubectl, cho qua với aws', () => {
  it('aws + --namespace ⇒ CHẠY. Đây là tham số của cloudwatch, không phải ngữ cảnh', async () => {
    // Lỗi thật: để nó trong danh sách toàn cục đã chặn toàn bộ lượt dò tài nguyên
    // của màn Giám sát, kèm câu "ngữ cảnh do phiên chỉ định, không ghi đè được".
    fakeExec('{"Metrics":[]}')
    const res = await runInfra({
      ...base,
      surface: 'explorer',
      toolName: 'monitor_targets',
      decision: 'auto',
      args: ['cloudwatch', 'list-metrics', '--namespace', 'AWS/ECS'],
    })
    expect(res.rejected).toBeUndefined()
    expect(res.ok).toBe(true)
  })

  it('kubectl + --namespace ⇒ VẪN bị từ chối', async () => {
    fakeExec('{}')
    const res = await runInfra({
      ...base,
      tool: 'kubectl',
      context: { cluster: 'readonly-context' },
      surface: 'terminal',
      toolName: 'kubectl_cli',
      args: ['get', 'pods', '--namespace', 'kube-system'],
    })
    expect(res.rejected).toBe('forbidden-flag')
    expect(execFile).not.toHaveBeenCalled()
  })

  it('kubectl + --namespace=… (dạng dính dấu bằng) ⇒ VẪN bị từ chối', async () => {
    fakeExec('{}')
    const res = await runInfra({
      ...base,
      tool: 'kubectl',
      context: { cluster: 'readonly-context' },
      surface: 'terminal',
      toolName: 'kubectl_cli',
      args: ['get', 'pods', '--namespace=kube-system'],
    })
    expect(res.rejected).toBe('forbidden-flag')
    expect(execFile).not.toHaveBeenCalled()
  })

  it('aws + --profile ⇒ vẫn bị từ chối, viết tắt cũng vậy', async () => {
    // Hàng rào thật sự quan trọng với aws không hề lỏng đi.
    fakeExec('{}')
    expect((await runInfra({ ...base, args: ['s3', 'ls', '--profile', 'prod'] })).rejected).toBe(
      'forbidden-flag',
    )
    expect((await runInfra({ ...base, args: ['s3', 'ls', '--prof', 'prod'] })).rejected).toBe(
      'forbidden-flag',
    )
    expect(execFile).not.toHaveBeenCalled()
  })
})
