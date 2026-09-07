// Tests cho `report_findings` (gói #8) — trọng tâm là BA LỚP CHỐNG LẠM DỤNG,
// vì năng lực của tool thì tầm thường còn tiết chế mới là vấn đề thiết kế: một
// bảng 40 dòng "có thể có vấn đề" tệ hơn không có bảng nào.
//
// Lớp 1 (chính sách trong description) không test được bằng code — nó là câu chữ
// model đọc; ở đây chỉ khẳng định description có nêu ngân sách. Lớp 2 (per-turn)
// và lớp 3 (per-session ledger) là code, và được test thật.
//
// Run: `npx vitest run src/runtime/tools/__tests__/report-findings.test.ts`
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  SURFACE_TOOL_TEXT,
  createSurfaceTurnCounters,
  runReportFindings,
  type SessionFindingsSurface,
  type SurfaceTurnCounters,
} from '../surface-tools.js'

let cwd = ''

// Một finding hợp lệ, đủ 4 trường bắt buộc.
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    file: 'src/a.ts',
    line: 12,
    severity: 'blocker',
    summary: 'Cancel leaves the lock held',
    failure: 'When the turn aborts mid-flight the finally never runs, so the next send blocks.',
    ...over,
  }
}

function findings(surface: SurfacePayloadLike | undefined): SessionFindingsSurface {
  expect(surface).toBeDefined()
  expect(surface?.kind).toBe('findings')
  return surface as SessionFindingsSurface
}
type SurfacePayloadLike = { kind: string } | undefined

// Mỗi test một sessionId riêng ⇒ ledger per-session không rò sang test khác.
let seq = 0
function newSession(): { sessionId: string; turn: SurfaceTurnCounters } {
  seq += 1
  return { sessionId: `ses-findings-${seq}`, turn: createSurfaceTurnCounters() }
}

beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'awog-findings-'))
  await mkdir(join(cwd, 'src'), { recursive: true })
  await writeFile(join(cwd, 'src', 'a.ts'), 'export const a = 1\n', 'utf8')
  await writeFile(join(cwd, 'src', 'b.ts'), 'export const b = 2\n', 'utf8')
})

describe('report_findings — lớp 1 (chính sách trong description)', () => {
  it('nêu trần mỗi lượt, trần mỗi phiên và yêu cầu đã kiểm chứng', () => {
    const d = SURFACE_TOOL_TEXT.reportFindings.description
    expect(d).toContain('max 8 per call')
    expect(d).toContain('20 per session')
    expect(d).toContain('VERIFIED')
  })
})

describe('report_findings — hợp lệ', () => {
  it('trả surface findings, path thành workspace-relative và linkable', async () => {
    const { sessionId, turn } = newSession()
    const res = await runReportFindings(
      { findings: [row()], scope: 'PR #128' },
      cwd,
      sessionId,
      turn,
    )
    const surface = findings(res.surface)
    expect(surface.findings).toHaveLength(1)
    expect(surface.findings[0]).toMatchObject({
      file: 'src/a.ts',
      line: 12,
      severity: 'blocker',
      linkable: true,
    })
    expect(surface.scope).toBe('PR #128')
    expect(turn.findings).toBe(1)
  })

  it('giữ verdict khi model nói đã kiểm chứng thế nào', async () => {
    const { sessionId, turn } = newSession()
    const res = await runReportFindings(
      { findings: [row({ verdict: 'Traced abortSession() → finally is skipped on throw.' })] },
      cwd,
      sessionId,
      turn,
    )
    expect(findings(res.surface).findings[0]?.verdict).toContain('abortSession')
  })
})

describe('report_findings — validate từng dòng (L1)', () => {
  it('bỏ dòng thiếu failure hoặc severity lạ, giữ dòng còn lại', async () => {
    const { sessionId, turn } = newSession()
    const res = await runReportFindings(
      {
        findings: [
          row({ failure: '' }),
          row({ file: 'src/b.ts', severity: 'critical' }),
          row({ file: 'src/b.ts', severity: 'minor', summary: 'Off-by-one in the loop bound' }),
        ],
      },
      cwd,
      sessionId,
      turn,
    )
    const surface = findings(res.surface)
    expect(surface.findings).toHaveLength(1)
    expect(surface.findings[0]?.severity).toBe('minor')
  })

  it('path ngoài workspace vẫn thành dòng, nhưng KHÔNG thành link', async () => {
    const { sessionId, turn } = newSession()
    const res = await runReportFindings(
      { findings: [row({ file: '../../etc/passwd' })] },
      cwd,
      sessionId,
      turn,
    )
    const surface = findings(res.surface)
    expect(surface.findings).toHaveLength(1)
    expect(surface.findings[0]?.linkable).toBe(false)
    expect(res.text).toContain('Not openable')
  })

  it('path trong workspace nhưng không tồn tại cũng không thành link', async () => {
    const { sessionId, turn } = newSession()
    const res = await runReportFindings(
      { findings: [row({ file: 'src/ghost.ts' })] },
      cwd,
      sessionId,
      turn,
    )
    expect(findings(res.surface).findings[0]?.linkable).toBe(false)
  })

  it('line không phải số nguyên ≥ 1 thì bỏ, dòng vẫn ở mức file', async () => {
    const { sessionId, turn } = newSession()
    const res = await runReportFindings(
      { findings: [row({ line: 0 }), row({ file: 'src/b.ts', line: 2.5 })] },
      cwd,
      sessionId,
      turn,
    )
    for (const f of findings(res.surface).findings) expect(f.line).toBeUndefined()
  })

  it('từ chối khi không còn dòng nào dùng được', async () => {
    const { sessionId, turn } = newSession()
    const res = await runReportFindings(
      { findings: [{ summary: 'something smells' }] },
      cwd,
      sessionId,
      turn,
    )
    expect(res.surface).toBeUndefined()
    expect(res.text).toContain('no usable finding')
    expect(turn.findings).toBe(0)
  })
})

describe('report_findings — lớp 2 (per-turn)', () => {
  it('chỉ một danh sách mỗi lượt', async () => {
    const { sessionId, turn } = newSession()
    await runReportFindings({ findings: [row()] }, cwd, sessionId, turn)
    const second = await runReportFindings(
      { findings: [row({ file: 'src/b.ts', summary: 'Another one' })] },
      cwd,
      sessionId,
      turn,
    )
    expect(second.surface).toBeUndefined()
    expect(second.text).toContain('already reported findings in this reply')
  })

  it('từ chối (không cắt bớt) khi vượt trần mỗi lượt', async () => {
    const { sessionId, turn } = newSession()
    const many = Array.from({ length: 9 }, (_, i) => row({ summary: `Defect ${i}` }))
    const res = await runReportFindings({ findings: many }, cwd, sessionId, turn)
    expect(res.surface).toBeUndefined()
    expect(res.text).toContain('at most 8')
    // Bị từ chối ⇒ lượt chưa tiêu, model sửa lại rồi gọi tiếp được.
    expect(turn.findings).toBe(0)
  })
})

describe('report_findings — lớp 3 (ledger per-session)', () => {
  it('bỏ dòng trùng đã báo ở lượt trước', async () => {
    const { sessionId } = newSession()
    await runReportFindings({ findings: [row()] }, cwd, sessionId, createSurfaceTurnCounters())
    const res = await runReportFindings(
      { findings: [row({ summary: 'CANCEL   leaves the Lock held' }), row({ file: 'src/b.ts' })] },
      cwd,
      sessionId,
      createSurfaceTurnCounters(),
    )
    const surface = findings(res.surface)
    expect(surface.findings).toHaveLength(1)
    expect(surface.findings[0]?.file).toBe('src/b.ts')
    expect(res.text).toContain('1 duplicate(s)')
  })

  it('từ chối khi cả danh sách đều là dòng đã báo', async () => {
    const { sessionId } = newSession()
    await runReportFindings({ findings: [row()] }, cwd, sessionId, createSurfaceTurnCounters())
    const res = await runReportFindings(
      { findings: [row()] },
      cwd,
      sessionId,
      createSurfaceTurnCounters(),
    )
    expect(res.surface).toBeUndefined()
    expect(res.text).toContain('already reported in this session')
  })

  it('chặn khi phiên đã tiêu hết trần 20', async () => {
    const { sessionId } = newSession()
    // 3 lượt × 8 = 24 > 20 ⇒ lượt thứ 3 chỉ còn 4 chỗ, lượt thứ 4 bị chặn hẳn.
    for (let turnIndex = 0; turnIndex < 3; turnIndex++) {
      const batch = Array.from({ length: 8 }, (_, i) =>
        row({ summary: `Defect ${turnIndex}-${i}`, line: turnIndex * 8 + i + 1 }),
      )
      // eslint-disable-next-line no-await-in-loop -- ledger là state tuần tự theo lượt
      await runReportFindings({ findings: batch }, cwd, sessionId, createSurfaceTurnCounters())
    }
    const res = await runReportFindings(
      { findings: [row({ summary: 'One more', line: 999 })] },
      cwd,
      sessionId,
      createSurfaceTurnCounters(),
    )
    expect(res.surface).toBeUndefined()
    expect(res.text).toContain('already reported 20 findings')
  })
})
