// Tool "tài nguyên phía AWOG" của các màn hạ tầng (mốc 6–7).
//
// Ba tính chất được khoá ở đây là hàng rào, không phải tiện ích:
//   · DANH SÁCH GHI phải đúng bằng các tool ghi. Thiếu một cái là một lượt ghi vào không
//     gian của người dùng lọt qua cổng quyền; thừa một cái là bắt duyệt một phép đọc.
//   · KHÔNG tool nào chạy được một kế hoạch — `submit → approve → run` là ba cú bấm của
//     NGƯỜI, và một tool "run" ở đây là bỏ qua đúng cái vòng mốc 5 dựng ra.
//   · TIER `project` phải bị từ chối khi phiên không thuộc project nào — im lặng rơi về
//     `global` là ghi vào chỗ người dùng không chọn.
//   · Không tool nào đi ra AWS khi chưa ghim profile: nó phải trả lỗi có tên chứ không
//     spawn một lệnh chắc chắn hỏng.
//
// Run với vitest: `npx vitest run src/runtime/tools/__tests__/infra-app-tools.test.ts`
import { describe, expect, it } from 'vitest'
import {
  INFRA_APP_MUTATING_TOOL_NAMES,
  INFRA_APP_TOOL_NAMES,
  createInfraAppTools,
} from '../infra-app-tools.js'

function toolsOf(opts: Parameters<typeof createInfraAppTools>[0]) {
  const list = createInfraAppTools(opts)
  return new Map(list.map((t) => [t.name, t]))
}

async function runTool(
  name: string,
  params: unknown,
  opts: Parameters<typeof createInfraAppTools>[0],
): Promise<{ text: string; isError: boolean }> {
  const tool = toolsOf(opts).get(name)
  if (!tool) throw new Error(`tool ${name} không tồn tại`)
  // `execute` nhận (id, params) — id chỉ để gắn vào step, không ảnh hưởng nhánh nào.
  const res = (await (tool.execute as (id: string, p: unknown) => Promise<unknown>)(
    'test',
    params,
  )) as { content: { text: string }[]; details?: { isError?: boolean } }
  return { text: res.content.map((c) => c.text).join('\n'), isError: res.details?.isError === true }
}

describe('bộ tool', () => {
  it('danh sách tên khớp đúng thứ nhà máy trả về', () => {
    const names = [...toolsOf({ context: {} }).keys()]
    expect(names).toHaveLength(INFRA_APP_TOOL_NAMES.length)
    expect(new Set(names)).toEqual(new Set(INFRA_APP_TOOL_NAMES))
  })

  it('danh sách GHI đúng bằng các tool ghi — không thiếu, không thừa', () => {
    // Thiếu ⇒ một lượt ghi lọt cổng quyền. Thừa ⇒ bắt duyệt một phép đọc.
    expect([...INFRA_APP_MUTATING_TOOL_NAMES].sort()).toEqual(
      ['infra_cleanup_plan',
        'infra_dashboard_save',
        'infra_dashboard_delete',
        'infra_logs_save_query',
        'infra_playbook_save',
        'infra_playbook_delete',].sort(),
    )
    for (const n of INFRA_APP_MUTATING_TOOL_NAMES) {
      expect(INFRA_APP_TOOL_NAMES).toContain(n)
    }
  })

  it('mọi tool đều có mô tả, và hai tool tốn tiền nói ra điều đó', () => {
    const tools = toolsOf({ context: {} })
    for (const t of tools.values()) expect(t.description.length).toBeGreaterThan(40)
    expect(tools.get('infra_cost_summary')?.description).toMatch(/COSTS MONEY/)
    expect(tools.get('infra_waste_scan')?.description).toMatch(/COSTS? MONEY/i)
  })
})

describe('ranh giới an toàn', () => {
  it('KHÔNG có tool nào chạy một kế hoạch — chạy phải qua vòng duyệt của người', () => {
    // `submit → approve → run` là ba cú bấm của NGƯỜI. Một tool "run" ở đây là bỏ qua
    // đúng cái vòng mà mốc 5 dựng ra.
    const names = [...INFRA_APP_TOOL_NAMES] as string[]
    expect(names.filter((n) => /run|execute|approve|submit/.test(n))).toEqual([])
  })

  it('bảng và kế hoạch đều có đủ list · read/save · delete — không họ nào cụt', () => {
    // Bản đầu chỉ có `create` cho bảng và không có gì để sửa/xoá kế hoạch: một giới hạn
    // do phạm vi, không do nguyên tắc. Ca này giữ cho hai họ đối xứng.
    for (const family of ['dashboard', 'playbook']) {
      const names = [...INFRA_APP_TOOL_NAMES].filter((n) => n.startsWith(`infra_${family}_`))
      expect(names).toContain(`infra_${family}_list`)
      expect(names).toContain(`infra_${family}_read`)
      expect(names).toContain(`infra_${family}_save`)
      expect(names).toContain(`infra_${family}_delete`)
    }
  })

  it('tool đọc sổ và tool đọc CloudTrail là hai thứ khác nhau', () => {
    // Sổ AWOG = thứ AWOG chạy; CloudTrail = thứ tài khoản bị đổi. Gộp làm một là mất
    // đúng câu hỏi màn Nhật ký sinh ra để trả lời.
    expect(INFRA_APP_TOOL_NAMES).toContain('infra_audit_query')
    expect(INFRA_APP_TOOL_NAMES).toContain('infra_trail_lookup')
  })
})

describe('tier project', () => {
  const noProject = { context: {} }

  it('xin tier project khi phiên không có project ⇒ lỗi có tên, KHÔNG rơi về global', async () => {
    const res = await runTool(
      'infra_dashboard_save',
      { name: 'Thử', tier: 'project', charts: [{ key: 'c1', title: 'A', kind: 'line', unit: 'Count', series: [] }] },
      noProject,
    )
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/not pinned to a project/)
  })

  it('kế hoạch dọn dẹp cũng vậy', async () => {
    const res = await runTool(
      'infra_cleanup_plan',
      { name: 'Dọn', tier: 'project', findings: [{ check: 'eip-idle', resourceId: 'eipalloc-1' }] },
      noProject,
    )
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/not pinned to a project/)
  })
})

describe('chưa ghim profile', () => {
  it('cost summary từ chối sớm thay vì spawn lệnh chắc chắn hỏng', async () => {
    const res = await runTool('infra_cost_summary', {}, { context: {} })
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/No AWS profile/)
  })

  it('waste scan từ chối sớm', async () => {
    const res = await runTool('infra_waste_scan', {}, { context: {} })
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/No AWS profile/)
  })
})

describe('kiểm tham số trước khi chạm đĩa', () => {
  it('bảng không có biểu đồ nào bị từ chối', async () => {
    const res = await runTool('infra_dashboard_save', { name: 'Trống', charts: [] }, { context: {} })
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/at least one chart/)
  })

  it('lưu truy vấn log không có log group nào bị từ chối', async () => {
    const res = await runTool(
      'infra_logs_save_query',
      { name: 'Q', query: 'fields @message', logGroups: [], windowSeconds: 3600 },
      { context: {} },
    )
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/at least one log group/)
  })

  it('kế hoạch không có bước nào bị từ chối', async () => {
    const res = await runTool('infra_playbook_save', { id: 'p1', name: 'P', steps: [] }, { context: {} })
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/at least one step/)
  })

  it('verb lạ bị từ chối kèm bộ hợp lệ — model không được bịa một verb', async () => {
    const res = await runTool(
      'infra_playbook_save',
      { id: 'p1', name: 'P', steps: [{ id: 's1', title: 'A', verb: 'nuke', tool: 'aws', args: ['x'] }] },
      { context: {} },
    )
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/check, do, verify or rollback/)
  })

  it('tool lạ bị từ chối — allowlist binary là hàng rào, không phải gợi ý', async () => {
    const res = await runTool(
      'infra_playbook_save',
      { id: 'p1', name: 'P', steps: [{ id: 's1', title: 'A', verb: 'do', tool: 'bash', args: ['x'] }] },
      { context: {} },
    )
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/aws, terraform or kubectl/)
  })

  it('bước không có đối số nào bị từ chối', async () => {
    const res = await runTool(
      'infra_playbook_save',
      { id: 'p1', name: 'P', steps: [{ id: 's1', title: 'A', verb: 'check', tool: 'aws', args: [] }] },
      { context: {} },
    )
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/no arguments/)
  })

  it('đọc một bảng không tồn tại ⇒ lỗi có tên', async () => {
    const res = await runTool('infra_dashboard_read', { id: 'khong-co-that' }, { context: {} })
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/No dashboard/)
  })

  it('đọc một kế hoạch không tồn tại ⇒ lỗi có tên', async () => {
    const res = await runTool('infra_playbook_read', { id: 'khong-co-that' }, { context: {} })
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/No plan/)
  })

  it('danh sách phát hiện rỗng bị từ chối', async () => {
    const res = await runTool('infra_cleanup_plan', { name: 'Dọn', findings: [] }, { context: {} })
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/No findings/)
  })

  it('phát hiện mang `check` lạ bị loại, và lượt gọi nói ra bộ hợp lệ', async () => {
    // Model bịa một tên phép dò ⇒ không được im lặng tạo một kế hoạch rỗng.
    const res = await runTool(
      'infra_cleanup_plan',
      { name: 'Dọn', findings: [{ check: 'khong-ton-tai', resourceId: 'x' }] },
      { context: {} },
    )
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/Valid checks:/)
  })
})
