// `runner.ts` — vòng đời một lượt chạy playbook.
//
// MÁY DEV KHÔNG CÓ CREDENTIAL AWS THẬT, nên mọi lời gọi CLI bị chặn ở tầng thấp
// nhất: `runInfra` (spawn) và `recordInfraAction` (ghi nhật ký) bị thay. CÒN
// `runGated` được chạy THẬT — đó là chỗ chứng minh `actor` thật sự đi vào cả
// `runInfra` lẫn dòng nhật ký, chứ không chỉ được truyền vào một hàm đã bị mock.
//
// Lớp của từng lệnh KHÔNG bị mock, và test bám theo đúng bảng thật của
// `classify.ts`: `head-bucket`/`get-bucket-location` là `read` (có trong allowlist
// nên preflight chạy thẳng), `create-bucket`/`put-bucket-acl` là `write` (hỏi),
// `delete-bucket` là `destructive` (hỏi). Đó chính là hình dạng một playbook thật
// gặp phải, nên không dựng ma trận giả cho đường đi bình thường.
//
// Bốn hàng rào được khoá ở đây:
//   1. một bước `do` thiếu bước quay lui ⇒ `submit` từ chối, KHÔNG chạy lệnh nào,
//   2. preflight chạy HẾT mọi `check` TRƯỚC mọi `do`, và một `check` hỏng thì
//      dừng cả playbook kèm tên bước,
//   3. kế hoạch quay lui đi NGƯỢC thứ tự đã chạy,
//   4. hồ sơ sau khi chạy là BẤT BIẾN — đóng băng vào Wiki rồi không sửa được nữa.
//
// Run với vitest: `npx vitest run src/infra/playbook/__tests__/runner.test.ts`
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { recordInfraAction, runInfra, saveWikiPage, loadInfraPolicy } = vi.hoisted(() => ({
  recordInfraAction: vi.fn().mockResolvedValue(undefined),
  runInfra: vi.fn(),
  saveWikiPage: vi.fn(),
  loadInfraPolicy: vi.fn(),
}))

// `importOriginal` giữ nguyên phần thật của hai module này. Với `audit/store.js`
// là để `InfraAuditEntrySchema` còn thật — một bản chép lại regex `actor` thì
// không chứng minh được gì; với `run.js` là để `infraAuditContext` còn thật, vì
// chính nó dựng `context` của dòng nhật ký.
vi.mock('../../audit/store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../audit/store.js')>()),
  recordInfraAction,
}))
vi.mock('../../run.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../run.js')>()),
  runInfra,
}))
vi.mock('../../policy-store.js', () => ({ loadInfraPolicy }))
vi.mock('../../../wiki/store.js', () => ({ saveWikiPage }))

import { _resetApprovals } from '../../approvals.js'
import { DEFAULT_MATRIX } from '../../policy.js'
import { ERROR_MISSING_ROLLBACK, buildPlaybook, canSubmit } from '../schema.js'
import {
  approveRun,
  loadRun,
  listRuns,
  rollbackPlaybook,
  runPlaybook,
  submitPlaybook,
} from '../runner.js'
import type { InfraMatrix } from '../../policy.js'
import type { Playbook, PlaybookDraft, PlaybookRun, PlaybookStep } from '../schema.js'

let home: string
let originalHome: string | undefined

/** Ma trận "cho chạy hết" — chỉ dùng khi test cần `do`/`rollback` chạy thật. */
function allAuto(): InfraMatrix {
  return {
    read: { normal: 'auto', production: 'auto' },
    write: { normal: 'auto', production: 'auto' },
    destructive: { normal: 'auto', production: 'auto' },
    'context-switch': { normal: 'auto', production: 'auto' },
  }
}

function useDefaultPolicy(): void {
  loadInfraPolicy.mockResolvedValue({ matrix: DEFAULT_MATRIX, prodAccountIds: [] })
}

function useAutoPolicy(): void {
  loadInfraPolicy.mockResolvedValue({ matrix: allAuto(), prodAccountIds: [] })
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-playbook-runs-'))
  originalHome = process.env.HOME
  process.env.HOME = home
  _resetApprovals()

  recordInfraAction.mockClear()
  runInfra.mockReset()
  runInfra.mockResolvedValue(ok('ok'))
  saveWikiPage.mockReset()
  saveWikiPage.mockResolvedValue({ path: 'playbooks/x', source: 'global' })
  loadInfraPolicy.mockReset()
  useDefaultPolicy()
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  await rm(home, { recursive: true, force: true })
})

// ─── Tiện ích ────────────────────────────────────────────────────────────────

function ok(stdout: string) {
  return {
    ok: true,
    exitCode: 0,
    stdout,
    stderr: '',
    durationMs: 5,
    truncated: false,
    class: 'read' as const,
  }
}

function failed(stderr: string) {
  return { ...ok(''), ok: false, exitCode: 1, stderr }
}

function step(verb: PlaybookStep['verb'], id: string, args: string[]): PlaybookStep {
  return { id, title: id, verb, tool: 'aws', args, note: '' }
}
const checkStep = (id: string, args: string[]): PlaybookStep => step('check', id, args)
const doStep = (id: string, args: string[]): PlaybookStep => step('do', id, args)
const verifyStep = (id: string, args: string[]): PlaybookStep => step('verify', id, args)
const rollbackStep = (id: string, args: string[]): PlaybookStep => step('rollback', id, args)

/**
 * Playbook 2 bước nghiệp vụ, ĐỦ cặp — dạng đi bình thường.
 *
 * Mỗi lệnh cố ý KHÁC NHAU để test còn nhận ra lệnh nào vừa chạy; `head-bucket` và
 * `get-bucket-location` đều nằm trong allowlist `read` của `classify.ts`, nên
 * preflight chạy thẳng mà không cần ma trận nào khác.
 */
function pairedDraft(): PlaybookDraft {
  return {
    name: 'Site',
    description: '',
    kind: 'instruction',
    variables: [{ name: 'bucket', label: 'Bucket', required: true }],
    steps: [
      checkStep('c1', ['s3api', 'head-bucket', '--bucket', '{{bucket}}']),
      doStep('d1', ['s3api', 'create-bucket', '--bucket', '{{bucket}}']),
      verifyStep('v1', ['s3api', 'head-bucket', '--bucket', '{{bucket}}']),
      rollbackStep('r1', ['s3api', 'delete-bucket', '--bucket', '{{bucket}}']),

      checkStep('c2', ['s3api', 'get-bucket-location', '--bucket', '{{bucket}}']),
      doStep('d2', ['s3api', 'put-bucket-acl', '--bucket', '{{bucket}}', '--acl', 'private']),
      verifyStep('v2', ['s3api', 'get-bucket-location', '--bucket', '{{bucket}}']),
      rollbackStep('r2', [
        's3api',
        'put-bucket-acl',
        '--bucket',
        '{{bucket}}',
        '--acl',
        'public-read',
      ]),
    ],
  }
}

function playbookOf(d: PlaybookDraft): Playbook {
  return buildPlaybook(d, { id: 'pg', tier: 'global', updatedAt: '2026-01-01T00:00:00.000Z' })
}

/** Lệnh thật đã được đưa xuống `runInfra`, theo đúng thứ tự gọi. */
function commandsRun(): string[] {
  return runInfra.mock.calls.map((c) => (c[0] as { args: readonly string[] }).args.join(' '))
}

/** `actor` của từng lời gọi `runInfra`, theo đúng thứ tự. */
function actorsRun(): string[] {
  return runInfra.mock.calls.map((c) => (c[0] as { actor: string }).actor)
}

const CONTEXT = { profile: 'dev', accountId: '123456789012', region: 'ap-southeast-1' }

async function submit(pb: Playbook, values: Record<string, string> = { bucket: 'web' }) {
  return submitPlaybook({ playbook: pb, source: 'global', values, context: CONTEXT })
}

async function submittedRun(pb: Playbook = playbookOf(pairedDraft())): Promise<PlaybookRun> {
  const res = await submit(pb)
  if (!res.ok) throw new Error(`submit failed: ${JSON.stringify(res)}`)
  return res.run
}

// ─── 1. Luật số một ──────────────────────────────────────────────────────────

describe('luật số một: `do` thiếu `rollback` ⇒ KHÔNG gửi duyệt được', () => {
  it('`submit` từ chối và KHÔNG chạy một lệnh nào', async () => {
    const pb = playbookOf({
      ...pairedDraft(),
      steps: [
        checkStep('c1', ['s3api', 'head-bucket', '--bucket', '{{bucket}}']),
        doStep('d1', ['s3api', 'create-bucket', '--bucket', '{{bucket}}']),
        doStep('d2', ['s3api', 'put-bucket-acl', '--bucket', '{{bucket}}', '--acl', 'private']),
        rollbackStep('r1', ['s3api', 'delete-bucket', '--bucket', '{{bucket}}']),
      ],
    })

    expect(canSubmit(pb)).toBe(false)

    const res = await submit(pb)
    if (res.ok || res.blocked) throw new Error('unreachable')
    expect(res.error).toBe(ERROR_MISSING_ROLLBACK)
    expect(res.missingRollback).toEqual(['d2'])

    // Cả `check` cũng không chạy: luật đứng TRƯỚC preflight, nên trả lời "không
    // được gửi duyệt" không tốn một lượt gọi AWS nào.
    expect(runInfra).not.toHaveBeenCalled()
    expect(recordInfraAction).not.toHaveBeenCalled()
    expect(await listRuns()).toEqual([])
  })
})

// ─── 2. Preflight trước mọi `do` ─────────────────────────────────────────────

describe('preflight chạy HẾT `check` trước khi chạy bất kỳ `do` nào', () => {
  it('`submit` chạy đủ hai bước `check` theo thứ tự khai báo, và chưa chạm bước `do`', async () => {
    const run = await submittedRun()

    expect(commandsRun()).toEqual([
      's3api head-bucket --bucket web',
      's3api get-bucket-location --bucket web',
    ])
    // Chưa duyệt thì chưa `do`.
    expect(commandsRun()).not.toContain('s3api create-bucket --bucket web')

    expect(run.status).toBe('awaiting-approval')
    expect(run.steps.map((s) => s.stepId)).toEqual(['c1', 'c2'])
    expect(run.steps.every((s) => s.status === 'ok')).toBe(true)
  })

  it('một `check` hỏng ⇒ dừng CẢ playbook, nêu ĐÍCH DANH bước hỏng', async () => {
    runInfra.mockResolvedValueOnce(ok('')).mockResolvedValueOnce(failed('NoSuchBucket'))

    const res = await submit(playbookOf(pairedDraft()))
    if (res.ok || res.blocked) throw new Error('unreachable')
    expect(res.error).toBe('playbook.error.preflightFailed')
    expect(res.failedStepId).toBe('c2')

    // Đúng hai lệnh: `c1` xong, `c2` hỏng. `c2` hỏng nên KHÔNG có `do` nào chạy.
    expect(commandsRun()).toEqual([
      's3api head-bucket --bucket web',
      's3api get-bucket-location --bucket web',
    ])
    // Và không có bản ghi chạy rác nào được tạo.
    expect(await listRuns()).toEqual([])
  })
})

// ─── 3. `actor` trong nhật ký ────────────────────────────────────────────────

describe('`actor` phân biệt playbook với người dùng bấm', () => {
  it('bước `do` mang CÙNG số với `check` của nó — số đi theo NHÓM verb', async () => {
    useAutoPolicy()
    const run = await submittedRun()
    // Hai bước `check` của preflight.
    expect(actorsRun()).toEqual(['playbook:pg#1', 'playbook:pg#2'])

    await approveRun(run.id)
    runInfra.mockClear()
    const done = await runPlaybook(run.id)
    if (!done.ok || done.blocked) throw new Error('unreachable')
    expect(done.run.status).toBe('done')

    // `do`/`verify` của bước 2 là `#2` — cùng con số với `check` số 2, KHÔNG phải
    // `#3`/`#4` (số đếm theo nhóm verb, không theo tổng số lệnh).
    expect(actorsRun()).toEqual([
      'playbook:pg#1',
      'playbook:pg#1',
      'playbook:pg#2',
      'playbook:pg#2',
    ])
  })

  it('bước bị chặn: `actor` đi vào DÒNG NHẬT KÝ qua chính `runGated` thật', async () => {
    const run = await submittedRun()
    await approveRun(run.id)
    recordInfraAction.mockClear()

    const res = await runPlaybook(run.id)
    if (!res.blocked) throw new Error('expected the write step to need approval')

    expect(recordInfraAction).toHaveBeenCalledTimes(1)
    const entry = recordInfraAction.mock.calls[0]?.[0] as {
      actor: string
      decision: string
      surface: string
      tool: string
    }
    expect(entry.surface).toBe('playbook')
    expect(entry.tool).toBe('infra_playbook')
    expect(entry.decision).toBe('denied')
    // `#1` chứ không phải `#0`: số bước là 1-based.
    expect(entry.actor).toBe('playbook:pg#1')
  })
})

// ─── 4. Duyệt rồi chạy, vé duyệt dùng một lần ────────────────────────────────

describe('duyệt rồi chạy', () => {
  it('bước ghi bị HỎI, vé chạy được đúng bước đó, rồi bước sau lại hỏi', async () => {
    const run = await submittedRun()
    await approveRun(run.id)

    const first = await runPlaybook(run.id)
    if (!first.blocked) throw new Error('unreachable')
    expect(first.requiresApproval).toBe(true)
    expect(first.stepId).toBe('d1')
    expect(first.stepNumber).toBe(1)
    expect(first.approvalTicket).toBeTruthy()

    // Bản ghi không bị kẹt ở `running` — lượt gọi sau còn chạy tiếp được.
    expect((await loadRun(run.id))?.status).toBe('approved')

    const second = await runPlaybook(run.id, first.approvalTicket)
    if (!second.blocked) throw new Error('unreachable')
    // `d1` chạy xong (kèm `verify`), rồi `d2` lại phải hỏi ⇒ dừng ở đó.
    expect(second.stepId).toBe('d2')
    expect(commandsRun()).toContain('s3api create-bucket --bucket web')
    expect((await loadRun(run.id))?.status).toBe('approved')
  })

  it('KHÔNG chạy được khi chưa duyệt', async () => {
    const run = await submittedRun()
    const res = await runPlaybook(run.id)
    if (res.ok || res.blocked) throw new Error('unreachable')
    expect(res.error).toBe('playbook.error.wrongStatus')
    expect(commandsRun()).not.toContain('s3api create-bucket --bucket web')
  })

  it('duyệt là một GHI CÓ NHẬT KÝ, và `approve` lần hai bị từ chối', async () => {
    const run = await submittedRun()
    recordInfraAction.mockClear()
    await approveRun(run.id, 'kyro')

    expect(recordInfraAction).toHaveBeenCalledTimes(1)
    expect(recordInfraAction.mock.calls[0]?.[0]).toMatchObject({
      actor: 'human',
      surface: 'playbook',
      tool: 'infra_playbook',
      class: 'write',
      decision: 'approved',
    })

    const again = await approveRun(run.id)
    if (again.ok) throw new Error('unreachable')
    expect(again.error).toBe('playbook.error.wrongStatus')
    expect((await loadRun(run.id))?.approvedBy).toBe('kyro')
  })
})

// ─── 5. Quay lui dựng ngược ──────────────────────────────────────────────────

describe('quay lui dựng NGƯỢC từ các bước `do` đã chạy xong', () => {
  it('chỉ hoàn tác bước ĐÃ XONG: `d2` hỏng thì chỉ `r1` chạy', async () => {
    useAutoPolicy()
    const run = await submittedRun()
    await approveRun(run.id)

    // `d2` hỏng ⇒ playbook dừng ở bước 2.
    runInfra.mockImplementation(async (req: { args: readonly string[] }) =>
      req.args.includes('put-bucket-acl') && req.args.includes('private')
        ? failed('AccessDenied')
        : ok('ok'),
    )

    const runResult = await runPlaybook(run.id)
    if (!runResult.ok || runResult.blocked) throw new Error('unreachable')
    expect(runResult.run.status).toBe('failed')
    expect(runResult.run.failedStepId).toBe('d2')
    // Hỏng giữa đường thì CHƯA đóng băng — `rollback` còn phải ghi vào bản ghi này.
    expect(runResult.run.frozen).toBe(false)

    runInfra.mockClear()
    const rolled = await rollbackPlaybook(run.id)
    if (!rolled.ok || rolled.blocked) throw new Error(`unreachable: ${JSON.stringify(rolled)}`)

    expect(commandsRun()).toEqual(['s3api delete-bucket --bucket web'])
    expect(actorsRun()).toEqual(['playbook:pg#1'])
    expect(rolled.run.status).toBe('rolled-back')
  })

  it('cả hai bước cùng xong mới hỏng ở `verify` ⇒ hoàn tác #2 TRƯỚC #1', async () => {
    useAutoPolicy()
    const run = await submittedRun()
    await approveRun(run.id)

    // Đổi hành vi SAU preflight: `verify` của bước 2 hỏng, còn `do` thì xong hết.
    runInfra.mockImplementation(async (req: { args: readonly string[] }) =>
      req.args.includes('get-bucket-location') ? failed('AccessDenied') : ok('ok'),
    )

    const runResult = await runPlaybook(run.id)
    if (!runResult.ok || runResult.blocked) throw new Error('unreachable')
    expect(runResult.run.status).toBe('failed')
    // `do` số 2 chạy xong nhưng kết quả CHƯA đạt, nên đây mới là bước hỏng.
    expect(runResult.run.failedStepId).toBe('v2')

    runInfra.mockClear()
    const rolled = await rollbackPlaybook(run.id)
    if (!rolled.ok || rolled.blocked) throw new Error(`unreachable: ${JSON.stringify(rolled)}`)

    expect(commandsRun()).toEqual([
      's3api put-bucket-acl --bucket web --acl public-read',
      's3api delete-bucket --bucket web',
    ])
    expect(actorsRun()).toEqual(['playbook:pg#2', 'playbook:pg#1'])
    expect(rolled.run.status).toBe('rolled-back')
  })

  it('không có bước `do` nào xong ⇒ nói thẳng là không có gì để hoàn tác', async () => {
    useAutoPolicy()
    const run = await submittedRun()
    await approveRun(run.id)

    // `d1` hỏng ngay từ lệnh đầu tiên.
    runInfra.mockImplementation(async (req: { args: readonly string[] }) =>
      req.args.includes('create-bucket') ? failed('BucketAlreadyExists') : ok('ok'),
    )
    const runResult = await runPlaybook(run.id)
    if (!runResult.ok || runResult.blocked) throw new Error('unreachable')
    expect(runResult.run.status).toBe('failed')

    const rolled = await rollbackPlaybook(run.id)
    if (rolled.ok || rolled.blocked) throw new Error('unreachable')
    expect(rolled.error).toBe('playbook.error.nothingToRollback')
    expect(runInfra).toHaveBeenCalledTimes(3)
  })
})

// ─── 6. Hồ sơ bất biến ───────────────────────────────────────────────────────

describe('hồ sơ sau khi chạy là BẤT BIẾN', () => {
  it('chạy xong ⇒ đóng băng vào Wiki bằng `mode: create`, và ghi thêm bị từ chối', async () => {
    useAutoPolicy()
    const run = await submittedRun()
    await approveRun(run.id)
    const done = await runPlaybook(run.id)
    if (!done.ok || done.blocked) throw new Error('unreachable')

    expect(saveWikiPage).toHaveBeenCalledTimes(1)
    const page = saveWikiPage.mock.calls[0]?.[0] as {
      mode: string
      tags: string[]
      path: string
    }
    // `create` chính là hàng rào: trùng đường dẫn là LỖI, nên không lượt nào lặng
    // lẽ đè lên hồ sơ đã đóng băng của lượt trước.
    expect(page.mode).toBe('create')
    expect(page.tags).toContain('playbook')
    expect(page.path.startsWith('playbooks/pg-')).toBe(true)
    expect(page.path.endsWith(run.id)).toBe(true)

    expect(done.run.frozen).toBe(true)
    expect(done.run.wikiPage).toBe(page.path)
    expect(done.run.freezeError).toBeUndefined()
    // Trên đĩa cũng đã đóng băng, không chỉ trong object trả về.
    expect((await loadRun(run.id))?.frozen).toBe(true)

    // Và mọi lần ghi sau đó đều bị chặn.
    await expect(runPlaybook(run.id)).rejects.toThrow(/frozen/)
    await expect(approveRun(run.id)).rejects.toThrow(/frozen/)
  })

  it('Wiki hỏng KHÔNG nuốt lỗi: bản ghi vẫn xong, và nói được vì sao chưa vào Wiki', async () => {
    useAutoPolicy()
    saveWikiPage.mockRejectedValue(new Error('Wiki page already exists: playbooks/pg-1'))
    const run = await submittedRun()
    await approveRun(run.id)
    const done = await runPlaybook(run.id)
    if (!done.ok || done.blocked) throw new Error('unreachable')

    expect(done.run.status).toBe('done')
    expect(done.run.frozen).toBe(true)
    expect(done.run.freezeError).toContain('already exists')
  })
})

// ─── 7. Bản ghi chạy là dữ liệu L1 khi đọc lại ───────────────────────────────

describe('bản ghi chạy bị sửa tay', () => {
  it('file méo ⇒ "run not found", không phải một TypeError giữa vòng lặp spawn', async () => {
    const dir = join(home, '.awog', 'playbook-runs')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'broken.json'), '{"id":"broken","steps":"không phải mảng"}', 'utf8')

    expect(await loadRun('broken')).toBeNull()
    const res = await runPlaybook('broken')
    if (res.ok || res.blocked) throw new Error('unreachable')
    expect(res.error).toBe('playbook.error.runNotFound')
    expect(runInfra).not.toHaveBeenCalled()
  })
})
