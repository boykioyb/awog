// Nhóm log của một TÀI NGUYÊN GIÁM SÁT — nửa còn thiếu của màn Giám sát.
//
// VÌ SAO CẦN. Số liệu CloudWatch nói "có bao nhiêu lỗi 5XX"; chúng KHÔNG nói lỗi
// gì. Câu đó nằm trong log của chính ứng dụng, và cho tới nay màn Giám sát không
// có đường nào tới đó — người dùng phải tự nhớ tên nhóm log rồi gõ lại ở tab Nhật
// ký. Với ECS thì gần như không nhớ nổi: AWS KHÔNG ép ECS ghi vào `/ecs/<gì đó>`,
// tên nhóm do `awslogs-group` trong task definition quyết định và đặt tuỳ ý.
//
// HAI MỨC TIN CẬY, VÀ UI PHẢI PHÂN BIỆT ĐƯỢC CHÚNG:
//   · `exact`  — đọc thẳng từ cấu hình (ECS task definition). Đúng, không phải đoán.
//   · `guess`  — khớp TÊN trong danh sách nhóm log của tài khoản. Có thể sót, có
//     thể thừa, và vì vậy UI nói ra rằng đây là phỏng đoán.
// Đây là cùng luật với `graph/log-groups.ts`: một tên nhóm log đoán sai KHÔNG báo
// lỗi, nó chỉ mở ra một màn trống, và người đang chữa cháy sẽ đọc cái trống đó
// thành "chặng này không ghi gì" — một kết luận sai về hệ thống của họ.
//
// MỌI LỜI GỌI Ở ĐÂY LÀ `read` ĐÃ ALLOWLIST (`classify.ts`): `ecs describe-services`,
// `ecs describe-task-definition`, `logs describe-log-groups`. Không lệnh nào trả
// NỘI DUNG dòng log, nên không lệnh nào rơi vào nhóm bị siết ở tài khoản production.

import { z } from 'zod'
import { runInfra } from './run.js'
import { shortAwsError } from './monitor-targets.js'
import type { MonitorTargetKind } from './monitor-targets.js'
import type { InfraSurface } from './audit/store.js'

const RUN_TIMEOUT_MS = 30_000
/** Trần nhóm log trả về. `MAX_LOG_GROUPS` của Insights là 25 — vượt là lỗi của AWS. */
const MAX_GROUPS = 10

export type MonitorLogGroups = {
  groups: string[]
  /** `exact` đọc từ cấu hình; `guess` khớp theo tên và UI phải nói ra. */
  basis: 'exact' | 'guess'
  error: string
}

export interface MonitorLogGroupsInput {
  kind: MonitorTargetKind
  /** Tên tài nguyên cho nhánh `guess` (nhãn người đọc, vd tên service). */
  name: string
  /** Cluster ECS — chỉ nhánh `ecs-service` dùng. */
  cluster?: string | undefined
  profile?: string | undefined
  region?: string | undefined
  actor?: string | undefined
  surface: InfraSurface
}

const Services = z.object({
  services: z.array(z.object({ taskDefinition: z.string().optional() })).optional(),
})

const TaskDefinition = z.object({
  taskDefinition: z
    .object({
      containerDefinitions: z
        .array(
          z.object({
            logConfiguration: z
              .object({
                logDriver: z.string().optional(),
                options: z.record(z.string()).optional(),
              })
              .optional(),
          }),
        )
        .optional(),
    })
    .optional(),
})

const LogGroups = z.object({
  logGroups: z.array(z.object({ logGroupName: z.string().optional() })).optional(),
})

/** `--output json` của AWS CLI trả khoá PascalCase; hạ chữ đầu để khớp schema. */
function lowerFirstKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(lowerFirstKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k.charAt(0).toLowerCase() + k.slice(1)] = lowerFirstKeys(v)
    }
    return out
  }
  return value
}

async function readJson(
  args: readonly string[],
  input: MonitorLogGroupsInput,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const run = await runInfra({
    tool: 'aws',
    args: [...args, '--output', 'json'],
    context: {
      ...(input.profile ? { profile: input.profile } : {}),
      ...(input.region ? { region: input.region } : {}),
    },
    actor: input.actor ?? 'human',
    surface: input.surface,
    toolName: 'monitor_log_groups',
    decision: 'auto',
    timeoutMs: RUN_TIMEOUT_MS,
  })
  if (!run.ok) {
    return { ok: false, error: shortAwsError(run.stderr) || 'aws exited without saying why' }
  }
  try {
    return { ok: true, value: lowerFirstKeys(JSON.parse(run.stdout)) }
  } catch {
    return { ok: false, error: 'BAD_OUTPUT' }
  }
}

/**
 * ECS service ⇒ nhóm log ĐỌC TỪ CẤU HÌNH.
 *
 * Hai lời gọi, và cả hai đều cần: `describe-services` chỉ cho ta ARN của task
 * definition, còn `awslogs-group` nằm trong chính task definition. Đây là mức
 * `exact` — không có phép đoán nào ở đây.
 *
 * CHỈ LẤY `logDriver === 'awslogs'`. Container dùng `awsfirelens` hay `fluentd`
 * đẩy log đi nơi khác, và `options` của chúng KHÔNG mang tên nhóm CloudWatch —
 * đọc bừa `awslogs-group` ở đó là dựng ra một tên không tồn tại.
 */
async function ecsLogGroups(input: MonitorLogGroupsInput): Promise<MonitorLogGroups> {
  const cluster = input.cluster ?? ''
  if (!cluster) return { groups: [], basis: 'exact', error: 'MISSING_CLUSTER' }

  const svc = await readJson(
    ['ecs', 'describe-services', '--cluster', cluster, '--services', input.name],
    input,
  )
  if (!svc.ok) return { groups: [], basis: 'exact', error: svc.error }
  const parsedSvc = Services.safeParse(svc.value)
  if (!parsedSvc.success) return { groups: [], basis: 'exact', error: 'BAD_OUTPUT' }

  const taskDef = parsedSvc.data.services?.[0]?.taskDefinition ?? ''
  if (!taskDef) return { groups: [], basis: 'exact', error: 'NO_TASK_DEFINITION' }

  const def = await readJson(
    ['ecs', 'describe-task-definition', '--task-definition', taskDef],
    input,
  )
  if (!def.ok) return { groups: [], basis: 'exact', error: def.error }
  const parsedDef = TaskDefinition.safeParse(def.value)
  if (!parsedDef.success) return { groups: [], basis: 'exact', error: 'BAD_OUTPUT' }

  const names = new Set<string>()
  for (const c of parsedDef.data.taskDefinition?.containerDefinitions ?? []) {
    if (c.logConfiguration?.logDriver !== 'awslogs') continue
    const group = c.logConfiguration.options?.['awslogs-group']
    if (group) names.add(group)
  }
  return { groups: [...names].slice(0, MAX_GROUPS), basis: 'exact', error: '' }
}

/**
 * Mọi loại còn lại ⇒ KHỚP THEO TÊN trong danh sách nhóm log của tài khoản.
 *
 * Không có cấu hình nào nối một ALB hay một hàng đợi với một nhóm log, nên đây là
 * phỏng đoán và nó được gắn nhãn `guess`. Quy ước đặt tên phổ biến đủ để phép này
 * hữu ích (`/ecs/<service>`, `/aws/rds/instance/<id>/…`), nhưng nó SÓT được, và UI
 * phải nói ra điều đó thay vì để người dùng tin một danh sách rỗng.
 */
async function guessByName(input: MonitorLogGroupsInput): Promise<MonitorLogGroups> {
  const needle = input.name.trim().toLowerCase()
  if (!needle) return { groups: [], basis: 'guess', error: '' }

  const res = await readJson(['logs', 'describe-log-groups'], input)
  if (!res.ok) return { groups: [], basis: 'guess', error: res.error }
  const parsed = LogGroups.safeParse(res.value)
  if (!parsed.success) return { groups: [], basis: 'guess', error: 'BAD_OUTPUT' }

  const hits: string[] = []
  for (const g of parsed.data.logGroups ?? []) {
    const name = g.logGroupName ?? ''
    if (!name) continue
    if (!name.toLowerCase().includes(needle)) continue
    hits.push(name)
    if (hits.length >= MAX_GROUPS) break
  }
  return { groups: hits, basis: 'guess', error: '' }
}

export async function monitorLogGroups(
  input: MonitorLogGroupsInput,
): Promise<MonitorLogGroups> {
  // Tài nguyên CHÍNH LÀ một nhóm log ⇒ không có gì để dò, và cũng không có gì để
  // đoán. Đây là đường duy nhất chạy được khi tài khoản chỉ có quyền đọc log —
  // đúng ca của role `Offshore-Developer` đo được 2026-09-17, nơi mọi lệnh
  // `describe-*` của ECS/ELB/SQS/EC2 đều bị từ chối.
  if (input.kind === 'log-group') {
    return { groups: [input.name], basis: 'exact', error: '' }
  }
  return input.kind === 'ecs-service' ? ecsLogGroups(input) : guessByName(input)
}
