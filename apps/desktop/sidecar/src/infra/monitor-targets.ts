// Danh sách tài nguyên cho HAI ô lọc của màn Giám sát (ALB · EC2).
//
// VÌ SAO CẦN. Trước 2026-09-16 hai ô đó là hai ô chữ trần: người dùng phải tự
// biết CloudWatch muốn gì rồi gõ tay vào. Với EC2 thì còn đoán được (`i-…`), với
// ALB thì gần như không: dimension `LoadBalancer` KHÔNG nhận tên load balancer,
// nó nhận PHẦN ĐUÔI của ARN — `app/<tên>/<mã>`. Bắt người dùng tự cắt một chuỗi
// ARN ra để dán vào một ô không có gợi ý là một câu đố, không phải một giao diện.
//
// PHÉP CẮT ARN Ở ĐÂY, KHÔNG Ở RENDERER. Nó là tri thức về CloudWatch, cùng họ
// với `TARGET_DIMENSIONS`; để renderer tự cắt chuỗi là rải một luật của AWS ra
// chỗ chỉ nên biết cách vẽ.
//
// HAI LỜI GỌI, CẢ HAI ĐỀU LÀ `read` ĐÃ ALLOWLIST (`classify.ts`): `elbv2
// describe-load-balancers` và `ec2 describe-instances`. Không lời gọi nào ở đây
// ra ngoài lớp `read` được — args là hằng số, không có đường nào cho tham số của
// người gọi lọt vào argv.
//
// MỘT NGUỒN HỎNG KHÔNG LÀM HỎNG CẢ LƯỢT. Thiếu quyền `elbv2` mà vẫn có quyền
// `ec2` là chuyện thường; trả về lỗi chung sẽ làm mất luôn danh sách đọc được.
// Mỗi nhóm mang lỗi riêng, UI hiện được phần chạy và nói ra phần hỏng.

import { z } from 'zod'
import { runInfra } from './run.js'
import type { InfraSurface } from './audit/store.js'

const RUN_TIMEOUT_MS = 30_000
/** Trần số mục mỗi nhóm — một tài khoản lớn có hàng nghìn EC2 và picker thì không. */
const MAX_ITEMS = 300

export type MonitorTarget = {
  /** Giá trị ĐÚNG như CloudWatch muốn cho dimension tương ứng. */
  value: string
  /** Chuỗi cho người đọc: tên (nếu có) + định danh. */
  label: string
}

export type MonitorTargetGroup = {
  items: MonitorTarget[]
  /** Lỗi của RIÊNG nhóm này. `''` = chạy được. */
  error: string
}

export type MonitorTargets = {
  loadBalancers: MonitorTargetGroup
  instances: MonitorTargetGroup
}

export interface MonitorTargetsInput {
  profile?: string | undefined
  region?: string | undefined
  actor?: string | undefined
  surface: InfraSurface
}

/**
 * `arn:aws:elasticloadbalancing:<region>:<acct>:loadbalancer/app/my-alb/50dc6c…`
 * ⇒ `app/my-alb/50dc6c…`
 *
 * Trả `''` khi chuỗi không có đoạn `loadbalancer/`: thà bỏ một dòng còn hơn đưa
 * vào picker một giá trị mà CloudWatch chắc chắn không hiểu. NLB/GWLB cũng khớp
 * luật này (`net/…`, `gwy/…`) nên không cần nhánh riêng — nhưng chúng dùng
 * namespace khác, nên nhãn giữ nguyên tiền tố để người đọc phân biệt được.
 */
export function albDimensionValue(arn: string): string {
  const marker = ':loadbalancer/'
  const at = arn.indexOf(marker)
  if (at < 0) return ''
  const tail = arn.slice(at + marker.length)
  return tail.includes('/') ? tail : ''
}

const LoadBalancers = z.object({
  loadBalancers: z
    .array(
      z.object({
        loadBalancerArn: z.string().optional(),
        loadBalancerName: z.string().optional(),
        type: z.string().optional(),
      }),
    )
    .optional(),
})

const Instances = z.object({
  reservations: z
    .array(
      z.object({
        instances: z
          .array(
            z.object({
              instanceId: z.string().optional(),
              state: z.object({ name: z.string().optional() }).optional(),
              tags: z
                .array(z.object({ key: z.string().optional(), value: z.string().optional() }))
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
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
  input: MonitorTargetsInput,
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
    toolName: 'monitor_targets',
    decision: 'auto',
    timeoutMs: RUN_TIMEOUT_MS,
  })
  if (!run.ok) {
    const first = run.stderr.split('\n').find((l) => l.trim().length > 0) ?? ''
    return { ok: false, error: first.trim().slice(0, 300) || 'aws exited without saying why' }
  }
  try {
    return { ok: true, value: lowerFirstKeys(JSON.parse(run.stdout)) }
  } catch {
    return { ok: false, error: 'BAD_OUTPUT' }
  }
}

async function listLoadBalancers(input: MonitorTargetsInput): Promise<MonitorTargetGroup> {
  const res = await readJson(['elbv2', 'describe-load-balancers'], input)
  if (!res.ok) return { items: [], error: res.error }
  const parsed = LoadBalancers.safeParse(res.value)
  if (!parsed.success) return { items: [], error: 'BAD_OUTPUT' }

  const items: MonitorTarget[] = []
  for (const lb of parsed.data.loadBalancers ?? []) {
    const value = albDimensionValue(lb.loadBalancerArn ?? '')
    if (!value) continue
    const name = lb.loadBalancerName ?? value
    items.push({ value, label: lb.type ? `${name} · ${lb.type}` : name })
    if (items.length >= MAX_ITEMS) break
  }
  return { items, error: '' }
}

async function listInstances(input: MonitorTargetsInput): Promise<MonitorTargetGroup> {
  const res = await readJson(['ec2', 'describe-instances'], input)
  if (!res.ok) return { items: [], error: res.error }
  const parsed = Instances.safeParse(res.value)
  if (!parsed.success) return { items: [], error: 'BAD_OUTPUT' }

  const items: MonitorTarget[] = []
  for (const reservation of parsed.data.reservations ?? []) {
    for (const vm of reservation.instances ?? []) {
      const value = vm.instanceId ?? ''
      if (!value) continue
      // Máy đã `terminated` không còn phát metric nào — để trong picker là mời
      // người dùng chọn một biểu đồ chắc chắn rỗng.
      const state = vm.state?.name ?? ''
      if (state === 'terminated') continue
      const name = vm.tags?.find((t) => t.key === 'Name')?.value ?? ''
      const head = name ? `${name} · ${value}` : value
      items.push({ value, label: state && state !== 'running' ? `${head} · ${state}` : head })
      if (items.length >= MAX_ITEMS) break
    }
    if (items.length >= MAX_ITEMS) break
  }
  return { items, error: '' }
}

/** Hai nguồn chạy SONG SONG và độc lập — xem đầu file. */
export async function listMonitorTargets(input: MonitorTargetsInput): Promise<MonitorTargets> {
  const [loadBalancers, instances] = await Promise.all([
    listLoadBalancers(input),
    listInstances(input),
  ])
  return { loadBalancers, instances }
}
