// `schema.ts` — định dạng playbook + LUẬT CỨNG.
//
// Bốn tính chất được khoá ở đây là hàng rào, không phải tiện ích:
//   · một bước `do` thiếu bước quay lui thì KHÔNG gửi duyệt được (`canSubmit`),
//   · cặp `do` ↔ `rollback` ghép theo CHỈ SỐ, nên thứ tự khai báo là hợp đồng,
//   · kế hoạch quay lui được DỰNG NGƯỢC từ các bước đã chạy,
//   · `{{biến}}` sai charset bị từ chối, và một giá trị không được phép mang
//     placeholder của riêng nó vào argv.
//
// Run với vitest: `npx vitest run src/infra/playbook/__tests__/schema.test.ts`
import { describe, expect, it } from 'vitest'
import { InfraAuditEntrySchema } from '../../audit/store.js'
import {
  ERROR_MISSING_ROLLBACK,
  PlaybookSchema,
  buildPlaybook,
  canSubmit,
  interpolateArgs,
  isValidPlaybookId,
  isValidValue,
  missingRollbackSteps,
  resolveVariables,
  rollbackPlan,
  scanPlaceholders,
  stepActor,
  validatePlaybook,
} from '../schema.js'
import type {
  Playbook,
  PlaybookDraft,
  PlaybookStep,
  PlaybookVariable,
  PlaybookVerb,
} from '../schema.js'

// Ký tự điều khiển dựng bằng `String.fromCharCode` chứ KHÔNG viết thẳng vào nguồn:
// một byte NUL nằm giữa file `.ts` làm mọi công cụ đọc file đó như file nhị phân,
// và `grep` im lặng không tìm thấy gì nữa.
const NUL = String.fromCharCode(0x00)
const LF = String.fromCharCode(0x0a)
const DEL = String.fromCharCode(0x7f)

function step(
  verb: PlaybookVerb,
  id: string,
  args: string[] = ['s3api', 'list-buckets'],
): PlaybookStep {
  return { id, title: id, verb, tool: 'aws', args, note: '' }
}

function draft(steps: PlaybookStep[], variables: PlaybookVariable[] = []): PlaybookDraft {
  return { name: 'PB', description: '', kind: 'instruction', variables, steps }
}

function playbook(steps: PlaybookStep[], variables: PlaybookVariable[] = []): Playbook {
  return buildPlaybook(draft(steps, variables), {
    id: 'pg',
    tier: 'global',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })
}

/** Một playbook hợp lệ, đủ cặp: 2 bước nghiệp vụ × 4 verb. */
function paired(): Playbook {
  const steps: PlaybookStep[] = []
  for (const n of [1, 2]) {
    for (const verb of ['check', 'do', 'verify', 'rollback'] as const) {
      steps.push(step(verb, `${verb}-${String(n)}`))
    }
  }
  return playbook(steps)
}

describe('luật số một — thiếu bước quay lui thì không gửi duyệt được', () => {
  it('nêu ĐÍCH DANH bước `do` còn thiếu bước quay lui', () => {
    const pb = playbook([step('do', 'do-1'), step('rollback', 'rb-1'), step('do', 'do-2')])
    expect(missingRollbackSteps(pb).map((s) => s.id)).toEqual(['do-2'])
    expect(canSubmit(pb)).toBe(false)
  })

  it('đủ cặp thì qua, và `ERROR_MISSING_ROLLBACK` là khoá i18n ổn định', () => {
    expect(missingRollbackSteps(paired())).toEqual([])
    expect(canSubmit(paired())).toBe(true)
    expect(ERROR_MISSING_ROLLBACK).toBe('playbook.error.missingRollback')
  })

  it('bản NHÁP thiếu rollback vẫn hợp lệ về cấu trúc — chỉ bị chặn lúc gửi duyệt', () => {
    const pb = playbook([step('do', 'do-1')])
    // Không có issue cấu trúc nào: lưu được để còn sửa, gửi duyệt thì không.
    expect(validatePlaybook(pb)).toEqual([])
    expect(canSubmit(pb)).toBe(false)
  })
})

describe('ghép cặp theo chỉ số và dựng ngược kế hoạch quay lui', () => {
  it('kế hoạch quay lui đi NGƯỢC thứ tự đã chạy', () => {
    const { plan, unpaired } = rollbackPlan(paired(), ['do-1', 'do-2'])
    expect(plan.map((s) => s.id)).toEqual(['rollback-2', 'rollback-1'])
    expect(unpaired).toEqual([])
  })

  it('chỉ quay lui những bước ĐÃ chạy xong, không phải cả playbook', () => {
    const { plan } = rollbackPlan(paired(), ['do-1'])
    expect(plan.map((s) => s.id)).toEqual(['rollback-1'])
  })

  it('bước `do` không có cặp thì rơi vào `unpaired` thay vì biến mất im lặng', () => {
    const pb = playbook([step('do', 'do-1'), step('rollback', 'rb-1'), step('do', 'do-2')])
    const { plan, unpaired } = rollbackPlan(pb, ['do-1', 'do-2'])
    expect(plan.map((s) => s.id)).toEqual(['rb-1'])
    expect(unpaired).toEqual(['do-2'])
  })
})

describe('placeholder `{{biến}}`', () => {
  it('tên sai charset là MÉO, không phải tên lạ', () => {
    expect(scanPlaceholders('--name {{bad-name}}')).toEqual({ names: [], malformed: true })
    expect(scanPlaceholders('--name {{a b}}')).toEqual({ names: [], malformed: true })
    expect(scanPlaceholders('--name {{unclosed').malformed).toBe(true)
    expect(scanPlaceholders('--name orphan}}').malformed).toBe(true)
    expect(scanPlaceholders('--name {{ok}}').names).toEqual(['ok'])
  })

  it('một placeholder méo trong `args` chặn cả cấu trúc (nên chặn cả `save`)', () => {
    const pb = playbook([
      step('do', 'do-1', ['s3api', 'head-bucket', '--bucket', '{{bad-name}}']),
    ])
    expect(validatePlaybook(pb).map((i) => i.code)).toContain('playbook.error.badPlaceholder')
  })

  it('biến chưa khai báo bị từ chối', () => {
    const pb = playbook([step('do', 'do-1', ['--bucket', '{{nope}}'])])
    expect(validatePlaybook(pb).map((i) => i.code)).toContain('playbook.error.unknownVariable')
  })

  it('GIÁ TRỊ không được mang placeholder của riêng nó vào argv', () => {
    const out = interpolateArgs(['--bucket', '{{x}}'], { x: '{{evil}}' }, 'do-1')
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('unreachable')
    expect(out.issues[0]?.code).toBe('playbook.error.badValue')
  })

  it('giá trị bình thường thì nội suy đúng và không còn `{{…}}`', () => {
    const out = interpolateArgs(['--bucket', 'web-{{env}}'], { env: 'prod' }, 'do-1')
    expect(out).toEqual({ ok: true, args: ['--bucket', 'web-prod'] })
  })
})

describe('giá trị biến là dữ liệu L1', () => {
  it('ký tự điều khiển bị từ chối', () => {
    expect(isValidValue('web-prod')).toBe(true)
    expect(isValidValue(`web${NUL}prod`)).toBe(false)
    expect(isValidValue(`web${LF}prod`)).toBe(false)
    expect(isValidValue(`web${DEL}prod`)).toBe(false)
  })

  it('thiếu biến bắt buộc ⇒ nêu tên, không lặng lẽ lấy chuỗi rỗng', () => {
    const out = resolveVariables([{ name: 'domain', label: 'D', required: true }], {})
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('unreachable')
    expect(out.missing).toEqual(['domain'])
  })

  it('biến không bắt buộc thì lấy `default`', () => {
    const out = resolveVariables([{ name: 'env', label: 'E', required: false, default: 'dev' }], {})
    expect(out).toEqual({ ok: true, values: { env: 'dev' } })
  })
})

describe('id playbook đi thẳng vào `actor` của nhật ký', () => {
  it('`stepActor` đúng khuôn, và regex của nhật ký CHẤP NHẬN nó', () => {
    expect(stepActor('static-site', 3)).toBe('playbook:static-site#3')
    const entry = {
      at: new Date().toISOString(),
      actor: stepActor('static-site', 3),
      surface: 'playbook',
      tool: 'infra_playbook',
      argv: ['s3api', 'create-bucket', '--bucket', 'web'],
      context: {},
      class: 'write',
      decision: 'approved',
      result: { exitCode: 0, durationMs: 12 },
    }
    // Chứng minh bằng CHÍNH schema của nhật ký, không bằng một regex chép lại.
    expect(InfraAuditEntrySchema.safeParse(entry).success).toBe(true)
  })

  it('số bước ngoài khoảng hoặc id sai thì NÉM, không tạo ra actor rác', () => {
    expect(() => stepActor('static-site', 0)).toThrow()
    expect(() => stepActor('static-site', 10_000)).toThrow()
    expect(() => stepActor('bad id', 1)).toThrow()
  })

  it('id bắt đầu bằng dấu chấm bị từ chối — file ẩn sẽ biến mất khỏi danh sách', () => {
    expect(isValidPlaybookId('static-site')).toBe(true)
    expect(isValidPlaybookId('.hidden')).toBe(false)
    expect(isValidPlaybookId('..')).toBe(false)
    expect(isValidPlaybookId('a/b')).toBe(false)
  })
})

describe('PlaybookSchema — đọc lại bản chụp trong hồ sơ lượt chạy', () => {
  it('nhận bản hợp lệ và trả về ĐÚNG các bước đã ghi', () => {
    const parsed = PlaybookSchema.safeParse(paired())
    expect(parsed.success).toBe(true)
    if (!parsed.success) throw new Error('unreachable')
    expect(parsed.data.steps.map((s) => s.id)).toEqual(paired().steps.map((s) => s.id))
  })

  it('từ chối bản bị sửa tay cho `args` thành chuỗi thay vì mảng', () => {
    const raw = { ...paired(), steps: [{ ...step('do', 'do-1'), args: 's3api create-bucket' }] }
    expect(PlaybookSchema.safeParse(raw).success).toBe(false)
  })
})
