// Phát hiện lãng phí → playbook dọn dẹp (mốc 7, 7.3).
//
// Ca đáng giá nhất ở đây nối HAI hệ: bản nháp do `buildCleanupDraft` sinh ra phải qua
// được chính `validatePlaybook` + `canSubmit` của `infra/playbook/schema.ts`. Không có
// ca đó thì AWOG sinh ra được một kế hoạch mà chính AWOG từ chối gửi duyệt, và người
// dùng chỉ phát hiện lúc bấm nút.
//
// Run với vitest: `npx vitest run src/infra/cost/__tests__/cleanup.test.ts`
import { describe, expect, it } from 'vitest'
import { buildCleanupDraft, isReversible } from '../cleanup.js'
import { WASTE_CHECKS } from '../waste.js'
import { buildPlaybook, canSubmit, missingRollbackSteps, validatePlaybook } from '../../playbook/schema.js'
import type { WasteCheck, WasteFinding } from '../waste.js'

function finding(check: WasteCheck, id: string): WasteFinding {
  return {
    check,
    resourceId: id,
    label: id,
    region: 'ap-southeast-1',
    monthlyUsd: 1,
    overEstimate: false,
    detail: {},
  }
}

function asPlaybook(findings: readonly WasteFinding[]) {
  const draft = buildCleanupDraft(findings, { name: 'Dọn dẹp', region: 'ap-southeast-1' })
  return buildPlaybook(draft, {
    id: 'don-dep',
    tier: 'global',
    updatedAt: '2026-09-15T00:00:00.000Z',
  })
}

describe('buildCleanupDraft', () => {
  it('bản nháp sinh ra QUA được luật của sidecar, kể cả khi trộn đủ 7 loại phát hiện', () => {
    const pb = asPlaybook(WASTE_CHECKS.map((c, i) => finding(c, `r-${String(i)}`)))
    expect(validatePlaybook(pb)).toEqual([])
    expect(missingRollbackSteps(pb)).toEqual([])
    // Đây là câu hỏi thật: kế hoạch này có gửi duyệt được không.
    expect(canSubmit(pb)).toBe(true)
  })

  it('mỗi phát hiện hoàn tác được sinh đủ cụm 4 bước, và số do = số rollback', () => {
    const pb = asPlaybook([finding('ec2-idle', 'i-1'), finding('logs-no-retention', '/aws/lambda/x')])
    expect(pb.steps).toHaveLength(8)
    const dos = pb.steps.filter((s) => s.verb === 'do')
    const undos = pb.steps.filter((s) => s.verb === 'rollback')
    expect(dos).toHaveLength(2)
    expect(undos).toHaveLength(2)
  })

  it('phát hiện KHÔNG hoàn tác được chỉ sinh bước `check` — không lệnh ghi nào', () => {
    const pb = asPlaybook([
      finding('ebs-unattached', 'vol-1'),
      finding('snapshot-stale', 'snap-1'),
      finding('lb-no-targets', 'arn:aws:elasticloadbalancing:::lb/x'),
      finding('nat-idle', 'nat-1'),
    ])
    expect(pb.steps).toHaveLength(4)
    expect(pb.steps.every((s) => s.verb === 'check')).toBe(true)
    // Không có `do` thì cũng không có gì để quay lui — và nó vẫn gửi duyệt được.
    expect(canSubmit(pb)).toBe(true)
  })

  it('id bước không mang danh tính tài nguyên — tên log group có `/`, ARN có `:`', () => {
    const pb = asPlaybook([
      finding('logs-no-retention', '/aws/lambda/ten-rat-dai'),
      finding('lb-no-targets', 'arn:aws:elasticloadbalancing:ap-southeast-1:1:loadbalancer/app/x/y'),
    ])
    // `STEP_ID_RE` không nhận `/` lẫn `:`; nhét id tài nguyên vào đây là hỏng ngay ở zod.
    for (const s of pb.steps) expect(s.id).toMatch(/^[A-Za-z0-9._-]{1,64}$/)
    expect(new Set(pb.steps.map((s) => s.id)).size).toBe(pb.steps.length)
  })

  it('id bước duy nhất xuyên suốt khi trộn nhóm 4 bước với nhóm 1 bước', () => {
    // Nhóm 1 bước ở GIỮA là chỗ bộ đếm dễ nhảy sai nhất.
    const pb = asPlaybook([
      finding('ec2-idle', 'i-1'),
      finding('ebs-unattached', 'vol-1'),
      finding('eip-idle', 'eipalloc-1'),
    ])
    expect(pb.steps).toHaveLength(4 + 1 + 4)
    expect(new Set(pb.steps.map((s) => s.id)).size).toBe(pb.steps.length)
    expect(validatePlaybook(pb)).toEqual([])
  })

  it('lệnh ghi mang ĐÚNG id tài nguyên của phát hiện', () => {
    const pb = asPlaybook([finding('ec2-idle', 'i-0abc')])
    const stop = pb.steps.find((s) => s.verb === 'do')
    expect(stop?.args).toEqual(['ec2', 'stop-instances', '--instance-ids', 'i-0abc'])
    const start = pb.steps.find((s) => s.verb === 'rollback')
    expect(start?.args).toEqual(['ec2', 'start-instances', '--instance-ids', 'i-0abc'])
  })

  it('dừng máy chứ KHÔNG terminate — terminate không có đường lùi', () => {
    const pb = asPlaybook([finding('ec2-idle', 'i-1')])
    const argv = pb.steps.flatMap((s) => s.args)
    expect(argv).toContain('stop-instances')
    expect(argv).not.toContain('terminate-instances')
  })

  it('không phát hiện nào ngoài ba loại hoàn tác được sinh ra lệnh ghi', () => {
    for (const check of WASTE_CHECKS) {
      const pb = asPlaybook([finding(check, 'r-1')])
      const hasWrite = pb.steps.some((s) => s.verb === 'do')
      expect(hasWrite).toBe(isReversible(check))
    }
  })

  it('danh sách rỗng ra một kế hoạch rỗng, không ném', () => {
    const draft = buildCleanupDraft([], { name: 'Trống', region: '' })
    expect(draft.steps).toEqual([])
  })
})
