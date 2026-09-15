// Bảng ca cho BA MẪU chia sẻ và BỐN LOẠI báo cáo (mốc 6.6 + 6.7).
//
// Lời hứa đắt nhất của cả mốc nằm ở đây: mẫu "Kế hoạch để duyệt" **không có dòng
// lệnh, không ARN** (`playbooks.md:99`). Đó không phải một sắc thái trình bày —
// gửi cho quản lý một bản có `aws ecs update-service` là gửi nhầm thứ. Nên phép
// kiểm không hỏi "hàm có nhánh đúng không" mà soi chính CHUỖI sắp ghi ra đĩa: bản
// kế hoạch phải sạch ARN kể cả khi ghi chú của tác giả có nhét ARN vào.
import { describe, expect, it } from 'vitest'
import { applyMask, renderMarkdown } from '../kit.js'
import {
  REPORT_DEFINITIONS,
  REPORT_KINDS,
  audienceForcesMask,
  buildPlaybookShare,
  buildReportShare,
  buildRunShare,
  planSteps,
  reportDefinition,
  reportScheduleTrigger,
} from '../templates.js'
import type { Playbook, PlaybookStep } from '../../playbook/schema.js'
import type { PlaybookRun } from '../../playbook/runner.js'

const NOW = '2026-09-15T08:50:42.000Z'

function step(over: Partial<PlaybookStep> & Pick<PlaybookStep, 'id' | 'verb'>): PlaybookStep {
  return {
    title: `Step ${over.id}`,
    tool: 'aws',
    args: ['ecs', 'describe-services'],
    note: '',
    ...over,
  }
}

const PLAYBOOK: Playbook = {
  id: 'checkout-scale',
  name: 'Scale checkout',
  description: 'Raise the checkout service to four tasks.',
  kind: 'deployment',
  tier: 'global',
  variables: [{ name: 'count', label: 'Task count', required: true }],
  steps: [
    step({ id: 'c1', verb: 'check', args: ['ecs', 'describe-services'] }),
    step({
      id: 'd1',
      verb: 'do',
      args: ['ecs', 'update-service', '--desired-count', '{{count}}'],
      // ARN CỐ Ý nằm trong ghi chú: mẫu "để duyệt" phải sạch nó, và chỉ lớp che
      // mới làm được điều đó — hình dạng markdown của mẫu không đụng tới ghi chú.
      note: 'Runs in arn:aws:iam::229012345678:role/Deployer, account 229012345678.',
    }),
    step({ id: 'v1', verb: 'verify', args: ['ecs', 'describe-services'] }),
    step({ id: 'r1', verb: 'rollback', args: ['ecs', 'update-service', '--desired-count', '2'] }),
  ],
  updatedAt: '2026-09-01T00:00:00.000Z',
}

describe('planSteps — ghép bốn verb theo CHỈ SỐ', () => {
  it('một bước của người đọc = bốn mục của file', () => {
    const steps = planSteps(PLAYBOOK)
    expect(steps).toHaveLength(1)
    expect(steps[0]?.number).toBe(1)
    expect(steps[0]?.do?.id).toBe('d1')
    expect(steps[0]?.rollback?.id).toBe('r1')
  })

  it('đánh số theo nhóm dài nhất, không theo tổng số lệnh', () => {
    const steps = planSteps({
      ...PLAYBOOK,
      steps: [
        step({ id: 'd1', verb: 'do' }),
        step({ id: 'd2', verb: 'do' }),
        step({ id: 'r1', verb: 'rollback' }),
        step({ id: 'r2', verb: 'rollback' }),
        step({ id: 'r3', verb: 'rollback' }),
      ],
    })
    expect(steps.map((s) => s.number)).toEqual([1, 2, 3])
    expect(steps[2]?.do).toBeUndefined()
  })
})

describe('mẫu "Kế hoạch để duyệt" — không lệnh, không ARN', () => {
  const md = renderMarkdown(
    applyMask(
      buildPlaybookShare({
        playbook: PLAYBOOK,
        audience: 'approval',
        generatedAt: NOW,
        lang: 'vi',
        status: 'awaiting-approval',
      }),
      { enabled: true },
    ),
  )

  it('KHÔNG có dòng lệnh nào', () => {
    expect(md).not.toContain('update-service')
    expect(md).not.toContain('describe-services')
    expect(md).not.toContain('{{count}}')
  })

  it('KHÔNG còn ARN hay account id trần — chúng đi qua lớp che, dù nằm trong ghi chú', () => {
    expect(md).not.toContain('arn:')
    expect(md).not.toContain('229012345678')
    expect(md).toContain('…:role/Deployer')
    expect(md).toContain('2290********')
  })

  it('vẫn nói được việc · ảnh hưởng · quay lui · sơ đồ', () => {
    expect(md).toContain('Kế hoạch triển khai: Scale checkout')
    expect(md).toContain('Có thay đổi trên tài khoản')
    expect(md).toContain('Step r1')
    expect(md).toContain('flowchart TD')
  })

  it('bị buộc che — công tắc của người dùng không tắt được', () => {
    expect(audienceForcesMask('approval')).toBe(true)
    expect(audienceForcesMask('runbook')).toBe(false)
    expect(audienceForcesMask('post-run')).toBe(false)
  })
})

describe('mẫu "Runbook kỹ thuật" — đủ mọi thứ', () => {
  const doc = buildPlaybookShare({
    playbook: PLAYBOOK,
    audience: 'runbook',
    generatedAt: NOW,
    lang: 'vi',
    status: 'draft',
  })
  const md = renderMarkdown(doc)

  it('giữ nguyên lệnh cùng placeholder biến', () => {
    expect(md).toContain('aws ecs update-service --desired-count {{count}}')
    expect(md).toContain('Kiểm tra')
    expect(md).toContain('Quay lui')
  })

  it('kể cả hai thứ mà mẫu "để duyệt" cố ý bỏ: ARN trong ghi chú và bảng biến', () => {
    expect(md).toContain('arn:aws:iam::229012345678:role/Deployer')
    expect(md).toContain('| count | Task count | có |')
  })

  it('nói ra khi một bước thiếu đường lùi', () => {
    const missing = buildPlaybookShare({
      playbook: { ...PLAYBOOK, steps: PLAYBOOK.steps.filter((s) => s.verb !== 'rollback') },
      audience: 'runbook',
      generatedAt: NOW,
      lang: 'vi',
      status: 'draft',
    })
    expect(renderMarkdown(missing)).toContain('không khai báo bước quay lui')
  })
})

describe('mẫu "Báo cáo sau khi chạy" — kết quả THẬT', () => {
  const run: PlaybookRun = {
    id: 'run-1',
    playbookId: PLAYBOOK.id,
    playbookName: PLAYBOOK.name,
    source: 'global',
    playbook: PLAYBOOK,
    status: 'done',
    context: { profile: 'prod', region: 'ap-southeast-1' },
    values: { count: '4' },
    steps: [
      {
        stepId: 'd1',
        verb: 'do',
        title: 'Scale to four',
        actor: 'playbook:checkout-scale#1',
        command: 'aws ecs update-service --desired-count 4',
        status: 'ok',
        class: 'write',
        exitCode: 0,
        durationMs: 12_400,
        at: '2026-09-12T10:32:00.000Z',
      },
      {
        stepId: 'r1',
        verb: 'rollback',
        title: 'Rollback to two',
        actor: 'playbook:checkout-scale#1',
        command: 'aws ecs update-service --desired-count 2',
        status: 'ok',
        class: 'write',
        exitCode: 0,
        durationMs: 900,
        at: '2026-09-12T10:34:00.000Z',
      },
    ],
    createdAt: '2026-09-12T10:31:00.000Z',
    updatedAt: '2026-09-12T10:34:00.000Z',
    approvedBy: 'kyro',
    approvedAt: '2026-09-12T10:30:00.000Z',
    frozen: true,
  }
  const md = renderMarkdown(buildRunShare({ run, generatedAt: NOW, lang: 'vi' }))

  it('có thời lượng thật, ai duyệt, và lệnh đã chạy', () => {
    expect(md).toContain('12s')
    expect(md).toContain('900ms')
    expect(md).toContain('kyro')
    expect(md).toContain('aws ecs update-service --desired-count 4')
  })

  it('nối tới nhật ký bằng `actor` — chính cột "Ai bảo" để lọc', () => {
    expect(md).toContain('playbook:checkout-scale#1')
    expect(md).toContain('Ai bảo')
  })

  it('nói rõ đây là bản chụp bất biến', () => {
    expect(md).toContain('trạng thái: done')
    expect(md).toContain('Đây là bản chụp')
  })
})

describe('bốn loại báo cáo — đúng bốn, đúng tên trong spec', () => {
  it('không thừa không thiếu', () => {
    expect([...REPORT_KINDS]).toEqual(['cost-monthly', 'health-weekly', 'activity', 'incident'])
    expect(REPORT_DEFINITIONS).toHaveLength(4)
  })

  it('mỗi loại có một câu lệnh và một khoá i18n', () => {
    for (const def of REPORT_DEFINITIONS) {
      expect(def.prompt.length).toBeGreaterThan(80)
      expect(def.labelKey.startsWith('infra.report.kind.')).toBe(true)
      expect(def.aboutKey.startsWith('infra.report.kind.')).toBe(true)
    }
  })

  it('Sức khoẻ tuần đặt lịch được: 9:00 thứ hai', () => {
    expect(reportScheduleTrigger('health-weekly')).toEqual({
      kind: 'weekly',
      weekdays: [1],
      time: '09:00',
    })
  })

  it('Chi phí tháng NÓI RA rằng nhịp "ngày 1 hằng tháng" chưa đặt được', () => {
    expect(reportScheduleTrigger('cost-monthly')).toBeNull()
    expect(reportDefinition('cost-monthly').scheduleGapKey).toBe('infra.report.gap.monthly')
  })

  it('Hoạt động và Sự cố chỉ chạy khi bấm — không phải lỗ hổng, không có khoá "gap"', () => {
    expect(reportScheduleTrigger('activity')).toBeNull()
    expect(reportScheduleTrigger('incident')).toBeNull()
    expect(reportDefinition('activity').scheduleGapKey).toBeNull()
    expect(reportDefinition('incident').scheduleGapKey).toBeNull()
  })
})

describe('bản xuất của một báo cáo', () => {
  it('giữ nguyên thân markdown do agent viết và ghi rõ phạm vi', () => {
    const md = renderMarkdown(
      buildReportShare({
        kind: 'incident',
        title: 'Sự cố 12/9',
        body: '## Dòng thời gian\n\n- 10:28 chạy bước 2\n- 10:31 p95 vọt',
        generatedAt: NOW,
        lang: 'vi',
        scope: 'prod · ap-southeast-1',
        diagram: { mermaid: 'flowchart LR\n  a --> b' },
      }),
    )
    expect(md).toContain('- 10:28 chạy bước 2')
    expect(md).toContain('prod · ap-southeast-1')
    expect(md).toContain('flowchart LR')
    expect(md).toContain('trạng thái: generated')
  })
})
