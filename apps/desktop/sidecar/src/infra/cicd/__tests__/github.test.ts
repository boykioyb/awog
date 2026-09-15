// Nguồn GitHub Actions của màn Triển khai (Mốc 4, task 4.2–4.4).
//
// Ba thứ ở đây là loại lỗi phải khoá bằng test vì chúng KHÔNG hiện ra khi nhìn UI:
//   · `gh run list` không trả `actor` — nếu ai đó thêm lại trường đó, lệnh sẽ hỏng
//     ở production chứ không hỏng ở máy dev đã đăng nhập;
//   · log của `gh run view --log` là ba cột TAB, và dòng ngoài mọi bước mang nhãn
//     `UNKNOWN STEP` — lọc sai thì "log của bước Kiểm thử" là log của cả job;
//   · `redactString` phải chạy TRƯỚC khi clamp: token bị cắt đôi thì không còn khớp
//     mẫu nào để mà che.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runGh } = vi.hoisted(() => ({ runGh: vi.fn() }))
vi.mock('../../../github/runner.js', () => ({ runGh }))

import {
  githubApprove,
  githubCancel,
  githubDispatch,
  githubRerun,
  githubRunDetail,
  githubStepLog,
  inputKeyOk,
  listGithubRuns,
  listWorkflows,
  workflowRefOk,
} from '../github.js'

const cwd = '/tmp/project'

function gh(stdout: unknown): void {
  runGh.mockResolvedValueOnce(typeof stdout === 'string' ? stdout : JSON.stringify(stdout))
}

beforeEach(() => {
  runGh.mockReset()
})

describe('listGithubRuns', () => {
  it('hỏi đúng trường `gh` CÓ (không có `actor`) và mang theo con trỏ mở repo', async () => {
    gh([
      {
        databaseId: 42,
        displayTitle: 'Deploy production',
        event: 'push',
        headBranch: 'main',
        headSha: 'a3f91c0deadbeef1234',
        name: 'deploy',
        status: 'completed',
        conclusion: 'failure',
        createdAt: '2026-09-14T00:00:00Z',
        startedAt: '2026-09-14T00:00:05Z',
        updatedAt: '2026-09-14T00:04:17Z',
        url: 'https://github.com/acme/shop-api/actions/runs/42',
        workflowName: 'Deploy production',
      },
    ])

    const runs = await listGithubRuns({
      cwd,
      key: 'shop-api',
      projectId: 'p1',
      repoPath: 'services/api',
      account: 'octocat',
      limit: 20,
    })

    const args = runGh.mock.calls[0]?.[0] as string[]
    expect(args.slice(0, 2)).toEqual(['run', 'list'])
    expect(args).toContain('--json')
    expect(args[args.indexOf('--json') + 1]).not.toContain('actor')

    expect(runs).toHaveLength(1)
    expect(runs[0]?.id).toBe('github:p1-aware:42'.replace('p1-aware', 'shop-api'))
    expect(runs[0]?.status).toBe('failed')
    expect(runs[0]?.commit).toBe('a3f91c0')
    expect(runs[0]?.durationMs).toBe(252_000)
    expect(runs[0]?.ref).toEqual({
      runId: '42',
      key: 'shop-api',
      projectId: 'p1',
      repoPath: 'services/api',
      account: 'octocat',
      event: 'push',
      sha: 'a3f91c0deadbeef1234',
    })
  })

  it('lọc nhánh đi qua `--branch` (bộ lọc ở phía `gh`, không lọc client-side)', async () => {
    gh([])
    await listGithubRuns({ cwd, key: 'k', projectId: 'p1', limit: 5, branch: 'release/2.1' })
    const args = runGh.mock.calls[0]?.[0] as string[]
    expect(args[args.indexOf('--branch') + 1]).toBe('release/2.1')
  })

  it('JSON méo ⇒ NÉM (để tầng gọi biến thành `error`), không im lặng trả rỗng', async () => {
    gh('không phải JSON')
    await expect(listGithubRuns({ cwd, key: 'k', projectId: 'p1', limit: 5 })).rejects.toThrow(
      'cicd.badJson',
    )
  })

  it('JSON đúng nhưng sai hình dạng cũng NÉM, không trả rỗng', async () => {
    gh({ run: 'không phải mảng' })
    await expect(listGithubRuns({ cwd, key: 'k', projectId: 'p1', limit: 5 })).rejects.toThrow(
      'cicd.badJson',
    )
  })
})

describe('githubStepLog', () => {
  const LOG = [
    'build\tSet up job\t2026-09-14T00:00:00.0000000Z Bắt đầu',
    'build\tRun tests\t2026-09-14T00:00:01.0000000Z ok 1 - auth',
    'build\tRun tests\t2026-09-14T00:00:02.0000000Z FAIL 2 - auth',
    'build\tUNKNOWN STEP\t2026-09-14T00:00:03.0000000Z dọn dẹp',
    '\uFEFFbuild\tRun tests\t2026-09-14T00:00:04.0000000Z token sk-abcdefghijklmnopqrstuvwxyz01',
  ].join('\n')

  it('cắt theo cột thứ hai (tên bước) và bỏ mốc thời gian của runner', async () => {
    gh(LOG)
    const res = await githubStepLog({ cwd, runId: 42, jobId: 7, step: 'Run tests' })
    expect(res.lines).toEqual(['ok 1 - auth', 'FAIL 2 - auth', 'token [redacted]'])
    expect(res.truncated).toBe(false)
    expect(res.totalLines).toBe(3)
    // Lệnh được nêu ra cho người dùng chép tay, không kèm token nào.
    expect(res.command).toBe('gh run view 42 --log --job 7')
  })

  it('không truyền bước ⇒ lấy cả job, kể cả dòng `UNKNOWN STEP`', async () => {
    gh(LOG)
    const res = await githubStepLog({ cwd, runId: 42, jobId: 7 })
    expect(res.lines).toContain('dọn dẹp')
    // 5 dòng của job: Set up job · Run tests ×2 · UNKNOWN STEP · dòng có BOM.
    expect(res.lines).toHaveLength(5)
  })

  it('REDACT TRƯỚC KHI CLAMP: token nằm sát trần dòng vẫn bị che', async () => {
    // Dòng dài quá `maxLineChars` (4000) và token nằm ở cuối — nếu clamp chạy
    // trước thì token bị cắt đôi và mẫu `sk-…` không còn khớp.
    const long = `${'x'.repeat(3990)} sk-abcdefghijklmnopqrstuvwxyz01`
    gh(`build\tRun tests\t2026-09-14T00:00:01.0000000Z ${long}`)
    const res = await githubStepLog({ cwd, runId: 42, jobId: 7, step: 'Run tests' })
    const text = res.lines.join('\n')
    expect(text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz01')
    // clamp cắt dòng ở 4000 ký tự nên dấu đóng của marker có thể mất — điều phải
    // chứng minh là `[redacted` CÓ MẶT, tức redact đã chạy trước clamp.
    expect(text).toContain('[redacted')
  })

  it('cửa sổ log tải lâu hơn 30s mặc định — nó phải nới trần thời gian', async () => {
    gh(LOG)
    await githubStepLog({ cwd, runId: 42, jobId: 7, step: 'Run tests' })
    expect(runGh.mock.calls[0]?.[3]).toEqual({ timeoutMs: 180_000 })
  })
})

describe('hành động GitHub', () => {
  beforeEach(() => {
    runGh.mockResolvedValue('')
  })

  it('chạy lại chỉ bước hỏng thêm `--failed`; huỷ dùng `run cancel`', async () => {
    await githubRerun({ cwd, runId: 42, failedOnly: true })
    expect(runGh.mock.calls[0]?.[0]).toEqual(['run', 'rerun', '42', '--failed'])

    runGh.mockClear()
    await githubCancel({ cwd, runId: 42 })
    expect(runGh.mock.calls[0]?.[0]).toEqual(['run', 'cancel', '42'])
  })

  it('kích hoạt: mỗi input là MỘT token `-f k=v` (không shell nên `=` không tách được)', async () => {
    await githubDispatch({
      cwd,
      workflow: 'deploy.yml',
      ref: 'main',
      inputs: [{ key: 'env', value: 'a b=c' }],
    })
    const args = runGh.mock.calls[0]?.[0] as string[]
    expect(args).toEqual(['workflow', 'run', 'deploy.yml', '--ref', 'main', '-f', 'env=a b=c'])
  })

  it('workflow/ref/input hợp lệ về hình dạng mới qua được hàng rào', () => {
    expect(workflowRefOk('deploy.yml', 'main')).toBe(true)
    expect(workflowRefOk('release/2.1.yml', 'release/2.1')).toBe(true)
    expect(workflowRefOk('deploy.yml', '--force')).toBe(false)
    expect(workflowRefOk('', 'main')).toBe(false)
    expect(workflowRefOk('deploy.yml; rm -rf /', 'main')).toBe(false)
    expect(inputKeyOk('env')).toBe(true)
    expect(inputKeyOk('2env')).toBe(false)
    expect(inputKeyOk('a-b')).toBe(false)
  })

  it('duyệt: thân JSON đi bằng STDIN, không có giá trị nào lọt vào argv', async () => {
    await githubApprove({
      cwd,
      runId: 42,
      environmentIds: [7, 9],
      approve: true,
      comment: 'xong "review" nhé',
    })
    const args = runGh.mock.calls[0]?.[0] as string[]
    const opts = runGh.mock.calls[0]?.[3] as { stdin?: string }
    expect(args).toEqual([
      'api',
      '--method',
      'POST',
      'repos/{owner}/{repo}/actions/runs/42/pending_deployments',
      '--input',
      '-',
    ])
    expect(JSON.parse(opts.stdin as string)).toEqual({
      environment_ids: [7, 9],
      state: 'approved',
      comment: 'xong "review" nhé',
    })
  })
})

describe('githubRunDetail', () => {
  it('bước = job × step; artifact + tên biến lấy từ REST; thiếu REST vẫn có bước', async () => {
    gh({
      databaseId: 42,
      name: 'deploy',
      status: 'completed',
      conclusion: 'failure',
      headBranch: 'main',
      headSha: 'a3f91c0deadbeef',
      startedAt: '2026-09-14T00:00:00Z',
      updatedAt: '2026-09-14T00:01:00Z',
      url: 'https://github.com/acme/shop-api/actions/runs/42',
      jobs: [
        {
          databaseId: 7,
          name: 'build',
          steps: [{ name: 'Run tests', number: 3, status: 'completed', conclusion: 'failure' }],
        },
      ],
    })
    // Bốn lời gọi REST (run meta · artifacts · variables · secrets) + pending deployments.
    gh({ actor: { login: 'octocat' }, repository: { full_name: 'acme/shop-api' } })
    gh({ artifacts: [{ name: 'bundle', size_in_bytes: 12 }] })
    gh({ variables: [{ name: 'REGION' }] })
    gh({ secrets: [{ name: 'DEPLOY_KEY' }] })
    gh([])

    const detail = await githubRunDetail({ cwd, runId: 42, key: 'shop-api', where: { projectId: 'p1' } })

    expect(detail.run.actor).toBe('octocat')
    expect(detail.run.project).toBe('shop-api')
    expect(detail.run.stepName).toBeNull()
    expect(detail.steps).toEqual([
      {
        id: '7:3',
        name: 'Run tests',
        status: 'failed',
        startedAt: null,
        durationMs: null,
        group: 'build',
        logRef: null,
        logUrl: null,
      },
    ])
    expect(detail.artifacts).toEqual([
      { name: 'bundle', url: 'https://github.com/acme/shop-api/actions/runs/42#artifacts', sizeBytes: 12 },
    ])
    // CHỈ TÊN — secret được đánh dấu, và không có giá trị nào ở đây cả.
    expect(detail.envNames).toEqual(['REGION', 'DEPLOY_KEY (secret)'])
    expect(detail.pr).toBeNull()
    expect(detail.approvals).toEqual([])
  })

  it('môi trường đang chờ duyệt ⇒ `approvals` có id môi trường', async () => {
    gh({
      databaseId: 42,
      name: 'deploy',
      status: 'in_progress',
      headBranch: 'main',
      headSha: 'aaa',
      jobs: [],
    })
    gh({ actor: { login: 'octocat' }, repository: { full_name: 'acme/shop-api' } })
    gh({ artifacts: [] })
    gh({ variables: [] })
    gh({ secrets: [] })
    gh([{ environment: { id: 7, name: 'production' } }])

    const detail = await githubRunDetail({ cwd, runId: 42 })
    expect(detail.approvals).toEqual([{ id: '7', label: 'production' }])
  })
})

describe('listWorkflows', () => {
  it('trả name/path/state cho dropdown, không trả argv', async () => {
    gh([
      { name: 'Deploy', path: '.github/workflows/deploy.yml', state: 'active' },
      { name: 'CI', path: '.github/workflows/ci.yml', state: 'disabled_manually' },
    ])
    const out = await listWorkflows({ cwd })
    expect(out).toEqual([
      { name: 'Deploy', path: '.github/workflows/deploy.yml', state: 'active' },
      { name: 'CI', path: '.github/workflows/ci.yml', state: 'disabled_manually' },
    ])
  })
})
