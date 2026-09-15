// Tool cho agent chạm vào TÀI NGUYÊN PHÍA AWOG của các màn hạ tầng (mốc 6–7).
//
// KHÁC `infra-tools.ts` Ở ĐIỂM NÀO. Bên kia cho agent chạy lệnh trên TÀI KHOẢN AWS
// (`aws_cli`, `infra_view`, `infra_action`, `logs_query`). File này cho agent chạm vào
// thứ AWOG tự giữ cho các màn đó: bảng điều khiển, kế hoạch dọn dẹp, và hai phép đọc
// tổng hợp (chi phí · lãng phí) mà màn hình đang hiện. Nói cách khác: bên kia là "làm gì
// với AWS", bên này là "dùng app đúng cách người dùng đang dùng nó".
//
// BA HẠNG, BA LUẬT KHÁC NHAU — đừng trộn:
//
//   1. ĐỌC FILE CỤC BỘ (`infra_dashboard_list`) — rẻ, không chạm mạng, không cổng quyền.
//
//   2. ĐỌC TỐN TIỀN (`infra_cost_summary`, `infra_waste_scan`) — đi ra AWS thật.
//      `ce` tính $0.01 mỗi request và một lượt tóm tắt là BA; hai phép dò `ec2-idle` /
//      `nat-idle` cần `get-metric-data`, thứ tính theo metric × điểm. Vì vậy mô tả tool
//      NÓI RÕ giá ngay trong câu đầu, và hai phép dò tốn tiền mặc định TẮT — model phải
//      xin tường minh. Một tool im lặng về giá là một tool sẽ bị gọi trong vòng lặp.
//
//   3. GHI FILE CỤC BỘ (`infra_dashboard_create`, `infra_cleanup_plan`) — tạo ra một
//      thực thể trong app của người dùng, nên đi qua cổng quyền như `wiki_write`
//      (`INFRA_APP_MUTATING_TOOL_NAMES` → `permission.ts`). Chúng KHÔNG đổi gì trên AWS.
//
// KẾ HOẠCH DỌN DẸP KHÔNG TỰ CHẠY. `infra_cleanup_plan` chỉ LƯU một playbook; chạy nó vẫn
// phải qua vòng đời duyệt của runner (preflight → gửi duyệt → người bấm). Không có đường
// nào ở đây xoá một tài nguyên AWS.
import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import type { InfraContext } from '../../infra/run.js'
import { listDashboards, saveDashboard } from '../../infra/dashboard/store.js'
import { getCostSummary } from '../../infra/cost/cost.js'
import { PRICING_AS_OF, PRICING_REGION } from '../../infra/cost/pricing.js'
import { WASTE_CHECKS, runWasteScan, type WasteCheck } from '../../infra/cost/waste.js'
import { buildCleanupDraft } from '../../infra/cost/cleanup.js'
import { savePlaybook } from '../../infra/playbook/store.js'
import { clampForLlm } from './output-budget.js'

export const INFRA_DASHBOARD_LIST_TOOL = 'infra_dashboard_list'
export const INFRA_DASHBOARD_CREATE_TOOL = 'infra_dashboard_create'
export const INFRA_COST_SUMMARY_TOOL = 'infra_cost_summary'
export const INFRA_WASTE_SCAN_TOOL = 'infra_waste_scan'
export const INFRA_CLEANUP_PLAN_TOOL = 'infra_cleanup_plan'

export const INFRA_APP_TOOL_NAMES = [
  INFRA_DASHBOARD_LIST_TOOL,
  INFRA_DASHBOARD_CREATE_TOOL,
  INFRA_COST_SUMMARY_TOOL,
  INFRA_WASTE_SCAN_TOOL,
  INFRA_CLEANUP_PLAN_TOOL,
] as const

/**
 * Tool TẠO RA một thực thể trong app của người dùng ⇒ cổng quyền như `wiki_write`.
 * `permission.ts` khớp cả tên trần (nhánh Pi) lẫn tên bắc cầu `mcp__awoginfra__…`.
 */
export const INFRA_APP_MUTATING_TOOL_NAMES = [
  INFRA_DASHBOARD_CREATE_TOOL,
  INFRA_CLEANUP_PLAN_TOOL,
] as const

/** Trần ký tự cho mọi output của nhóm này — cùng ngân sách context với nhóm infra. */
const MAX_CHARS = 24 * 1024

export interface CreateInfraAppToolsOptions {
  /** Ngữ cảnh đang ghim. Không có `profile` thì các tool đi ra AWS từ chối sớm. */
  context: InfraContext
  /** Project của phiên — quyết định tier `project` có dùng được không. */
  projectId?: string | undefined
}

/**
 * Gói kết quả cho model, đã kẹp ngân sách context.
 *
 * `clampForLlm` nhận MẢNG DÒNG chứ không nhận một chuỗi: nó kẹp theo từng dòng rồi mới
 * cộng dồn, nên cắt ở ranh giới dòng thay vì cắt giữa một con số.
 */
function textResult(lines: readonly string[]): AgentToolResult<Record<string, never>> {
  const clamped = clampForLlm([...lines], { maxTotalChars: MAX_CHARS })
  return { content: [{ type: 'text', text: clamped.text }], details: {} }
}

function errorResult(text: string): AgentToolResult<{ isError: true }> {
  return { content: [{ type: 'text', text }], details: { isError: true } }
}

// ─── Lược đồ tham số ─────────────────────────────────────────────────────────

const NoParams = Type.Object({})

const DashboardSeriesParam = Type.Object({
  key: Type.String({ description: 'Unique key for this series across the whole board.' }),
  namespace: Type.String({ description: 'CloudWatch namespace, e.g. "AWS/ApplicationELB".' }),
  metricName: Type.String({ description: 'CloudWatch metric name, e.g. "RequestCount".' }),
  stat: Type.String({ description: 'Statistic: Average, Sum, Maximum, Minimum or pNN.' }),
  label: Type.String({ description: 'Label shown at the end of the line.' }),
  color: Type.String({ description: 'A CSS variable name from the app palette, e.g. "--blue".' }),
  shade: Type.Number({ description: 'Shade step within the hue, 1 is the strongest.' }),
})

const DashboardChartParam = Type.Object({
  key: Type.String({ description: 'Unique key for this chart within the board.' }),
  title: Type.String({ description: 'Chart title shown to the user.' }),
  kind: Type.String({ description: '"line", "area" or "bar".' }),
  unit: Type.String({ description: 'Display label only, e.g. "Count" or "Seconds".' }),
  series: Type.Array(DashboardSeriesParam, { description: 'One entry per line on the chart.' }),
})

const DashboardCreateParams = Type.Object({
  name: Type.String({ description: 'Board name shown in the list.' }),
  charts: Type.Array(DashboardChartParam, {
    description: 'The charts to put on the board. At least one.',
  }),
  description: Type.Optional(Type.String({ description: 'One line on what the board is for.' })),
  tier: Type.Optional(
    Type.String({
      description:
        '"global" (default, available everywhere) or "project" (only inside this session\'s project).',
    }),
  ),
})

const CostSummaryParams = Type.Object({
  force: Type.Optional(
    Type.Boolean({
      description:
        'Ignore the day cache and pay for three more Cost Explorer requests. Leave unset unless the user explicitly asked for fresh figures.',
    }),
  ),
})

const WasteScanParams = Type.Object({
  checks: Type.Optional(
    Type.Array(Type.String(), {
      description: `Which checks to run. Defaults to the five free ones. Available: ${WASTE_CHECKS.join(', ')}. "ec2-idle" and "nat-idle" read CloudWatch metrics and COST MONEY.`,
    }),
  ),
})

const CleanupFindingParam = Type.Object({
  check: Type.String({ description: 'The check that produced this finding.' }),
  resourceId: Type.String({ description: 'The resource id exactly as the scan reported it.' }),
  label: Type.Optional(Type.String()),
  region: Type.Optional(Type.String()),
})

const CleanupPlanParams = Type.Object({
  name: Type.String({ description: 'Plan name shown in the list.' }),
  findings: Type.Array(CleanupFindingParam, {
    description: 'Findings from infra_waste_scan that the user agreed to act on.',
  }),
  tier: Type.Optional(Type.String({ description: '"global" (default) or "project".' })),
})

// ─── Nhà máy ─────────────────────────────────────────────────────────────────

export function createInfraAppTools(opts: CreateInfraAppToolsOptions): AgentTool[] {
  const { context, projectId } = opts

  /** Tier `project` chỉ dùng được khi phiên thuộc một project. */
  function resolveTier(want: string | undefined): { source: 'global' | 'project'; error?: string } {
    if (want !== 'project') return { source: 'global' }
    if (!projectId) {
      return { source: 'global', error: 'This session is not pinned to a project, so a project-tier item cannot be created. Retry without "tier", or ask the user to pin a project.' }
    }
    return { source: 'project' }
  }

  /** Id file từ tên. Cùng luật với `slugifyDashboardId` phía UI (ASCII, kebab). */
  function slugify(name: string, fallback: string): string {
    const ascii = name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
    const slug = ascii
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    return (slug || fallback).slice(0, 64).replace(/-+$/, '')
  }

  const dashboardList: AgentTool<typeof NoParams> = {
    name: INFRA_DASHBOARD_LIST_TOOL,
    label: 'Infra dashboards',
    description:
      "List the user's CloudWatch dashboards in AWOG — the built-in boards plus any they assembled. Reads local files only: free, no AWS call. Use it before creating a board so you revise an existing one instead of adding a near-duplicate.",
    parameters: NoParams,
    async execute(): Promise<AgentToolResult<Record<string, never>>> {
      const boards = await listDashboards(projectId ? [projectId] : [])
      if (boards.length === 0) return textResult(['No dashboards yet.'])
      const lines = boards.map(
        (b) =>
          `${b.id} · ${b.name} · ${b.source}${b.projectId ? `/${b.projectId}` : ''} · ${String(b.chartCount)} charts, ${String(b.seriesCount)} series${b.issues.length ? ` · BROKEN: ${b.issues.map((i) => i.code).join(', ')}` : ''}`,
      )
      return textResult(lines)
    },
  }

  const dashboardCreate: AgentTool<typeof DashboardCreateParams> = {
    name: INFRA_DASHBOARD_CREATE_TOOL,
    label: 'Create infra dashboard',
    description:
      "Create a CloudWatch dashboard in the user's AWOG so they can load it from the Health → Dashboards tab. Writes a local file; it does NOT create anything in AWS and does not fetch any metric. Series keys must be unique across the whole board. Call infra_dashboard_list first to avoid duplicating a board that already exists.",
    parameters: DashboardCreateParams,
    async execute(_id, params): Promise<AgentToolResult<Record<string, unknown>>> {
      const tier = resolveTier(params.tier)
      if (tier.error) return errorResult(tier.error)
      if (params.charts.length === 0) return errorResult('A dashboard needs at least one chart.')

      const id = slugify(params.name, 'bang')
      try {
        const saved = await saveDashboard({
          source: tier.source,
          ...(tier.source === 'project' && projectId ? { projectId } : {}),
          id,
          draft: {
            name: params.name,
            description: params.description ?? '',
            charts: params.charts.map((c) => ({
              key: c.key,
              title: c.title,
              kind: c.kind === 'area' || c.kind === 'bar' ? c.kind : 'line',
              unit: c.unit,
              series: c.series.map((s) => ({ ...s, dimensions: [] })),
            })),
          },
        })
        return textResult([
          `Created dashboard "${saved.name}" (${saved.id}, ${tier.source}). The user can open it under Health → Dashboards and press Load to fetch the metrics — loading costs money, so it is their call.`,
        ])
      } catch (err) {
        // `saveDashboard` ném với `issues` khi lược đồ từ chối — trả nguyên văn cho model
        // sửa, thay vì một câu "thất bại" không nói sai chỗ nào.
        return errorResult(`Dashboard was rejected: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  }

  const costSummary: AgentTool<typeof CostSummaryParams> = {
    name: INFRA_COST_SUMMARY_TOOL,
    label: 'AWS cost summary',
    description:
      'COSTS MONEY: one call is three Cost Explorer requests at $0.01 each. Returns this month to date, the previous month, the AWS month-end forecast and the top services by spend and by increase. Cached for the rest of the calendar day, so a second call the same day is free — do not pass force unless the user explicitly asked for fresh figures.',
    parameters: CostSummaryParams,
    async execute(_id, params): Promise<AgentToolResult<Record<string, unknown>>> {
      if (!context.profile) return errorResult('No AWS profile is pinned for this session.')
      const res = await getCostSummary({
        profile: context.profile,
        surface: 'session',
        actor: 'agent',
        ...(params.force === true ? { force: true } : {}),
      })
      if (!res.ok) return errorResult(`Cost Explorer failed: ${res.error}`)
      const s = res.value
      const lines = [
        `Period ${s.periodStart} → ${s.periodEnd} (figures as of ${s.asOf})`,
        `Spent so far: $${s.totalUsd.toFixed(2)}`,
        `Previous month: $${s.previousTotalUsd.toFixed(2)}`,
        s.forecastUsd !== null
          ? `AWS forecast for month end: $${s.forecastUsd.toFixed(2)}`
          : `No forecast: ${s.forecastError ?? 'AWS did not return one'}`,
        `This call spent $${s.estimatedUsd.toFixed(2)} (${String(s.calls)} requests)`,
        '',
        'Top services:',
        ...s.services.map((x) => `  ${x.service}: $${x.amountUsd.toFixed(2)} (was $${x.previousUsd.toFixed(2)})`),
      ]
      if (s.topIncreases.length) {
        lines.push('', 'Biggest increases:')
        lines.push(...s.topIncreases.map((x) => `  ${x.service}: +$${x.deltaUsd.toFixed(2)}`))
      }
      return textResult(lines)
    },
  }

  const wasteScan: AgentTool<typeof WasteScanParams> = {
    name: INFRA_WASTE_SCAN_TOOL,
    label: 'AWS waste scan',
    description:
      `Find resources costing money with nobody using them, in the pinned region only. The five default checks are plain describe-* calls and are free. Adding "ec2-idle" or "nat-idle" reads CloudWatch metrics and COSTS MONEY (billed per metric per data point) — only add them when the user asked about idle compute. Money figures are estimates from a static ${PRICING_REGION} list-price table taken ${PRICING_AS_OF}; a resource with no price in the table reports none rather than a guess. Feed the findings to infra_cleanup_plan once the user has agreed what to act on.`,
    parameters: WasteScanParams,
    async execute(_id, params): Promise<AgentToolResult<Record<string, unknown>>> {
      if (!context.profile) return errorResult('No AWS profile is pinned for this session.')
      const wanted = (params.checks ?? []).filter((c): c is WasteCheck =>
        (WASTE_CHECKS as readonly string[]).includes(c),
      )
      const res = await runWasteScan({
        profile: context.profile,
        ...(context.region ? { region: context.region } : {}),
        surface: 'session',
        actor: 'agent',
        ...(wanted.length ? { checks: wanted } : {}),
      })
      if (!res.ok) return errorResult(`Waste scan failed: ${res.error}`)
      const r = res.value
      const lines = [
        `${String(r.findings.length)} findings in ${r.region || 'the pinned region'}, about $${r.totalMonthlyUsd.toFixed(2)}/month${r.unpricedCount ? ` plus ${String(r.unpricedCount)} not priced` : ''}`,
      ]
      if (r.failed.length) {
        lines.push(...r.failed.map((f) => `CHECK FAILED ${f.check}: ${f.error}`))
      }
      lines.push(
        ...r.findings.map(
          (f) =>
            `  [${f.check}] ${f.resourceId} ${f.label !== f.resourceId ? `(${f.label}) ` : ''}— ${f.monthlyUsd === null ? 'not priced' : `${f.overEstimate ? '≤ ' : ''}$${f.monthlyUsd.toFixed(2)}/month`}`,
        ),
      )
      return textResult(lines)
    },
  }

  const cleanupPlan: AgentTool<typeof CleanupPlanParams> = {
    name: INFRA_CLEANUP_PLAN_TOOL,
    label: 'Create cleanup plan',
    description:
      'Turn waste findings into a playbook saved in AWOG, so the user can review and run it from the Changes → Plans tab. Writes a local file and changes NOTHING in AWS — running the plan still goes through preflight, approval and a per-step permission gate. Only stopping an instance, setting log retention and releasing an idle EIP get generated as commands; deleting a volume, snapshot, load balancer or NAT gateway is recorded as a note for the user to decide, because those have no undo that can be written down.',
    parameters: CleanupPlanParams,
    async execute(_id, params): Promise<AgentToolResult<Record<string, unknown>>> {
      const tier = resolveTier(params.tier)
      if (tier.error) return errorResult(tier.error)
      if (params.findings.length === 0) return errorResult('No findings were given.')

      const findings = params.findings
        .filter((f): f is typeof f & { check: WasteCheck } =>
          (WASTE_CHECKS as readonly string[]).includes(f.check),
        )
        .map((f) => ({
          check: f.check,
          resourceId: f.resourceId,
          label: f.label ?? f.resourceId,
          region: f.region ?? context.region ?? '',
          monthlyUsd: null,
          overEstimate: false,
          detail: {},
        }))
      if (findings.length === 0) {
        return errorResult(`No finding had a known check. Valid checks: ${WASTE_CHECKS.join(', ')}.`)
      }

      const draft = buildCleanupDraft(findings, {
        name: params.name,
        region: context.region ?? '',
      })
      const id = slugify(params.name, 'don-dep')
      try {
        const saved = await savePlaybook({
          source: tier.source,
          ...(tier.source === 'project' && projectId ? { projectId } : {}),
          id,
          draft,
        })
        const writes = saved.steps.filter((s) => s.verb === 'do').length
        return textResult([
          `Saved plan "${saved.name}" (${saved.id}, ${tier.source}) with ${String(saved.steps.length)} steps, ${String(writes)} of them write commands. It is a draft: the user reviews it under Changes → Plans and it only runs after preflight and approval.`,
        ])
      } catch (err) {
        return errorResult(`Plan was rejected: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  }

  return [dashboardList, dashboardCreate, costSummary, wasteScan, cleanupPlan] as AgentTool[]
}
