// `infra.kube` — các thao tác Kubernetes/Elastic Kubernetes Service mà NGƯỜI DÙNG
// bấm nút trong tab `/infra → Kubernetes`.
//
// Vì sao là RPC riêng với một DANH SÁCH ĐÓNG thao tác, chứ không để UI gửi `args`
// tự do qua `infra.run`:
//   · Tên pod/namespace/deployment đến từ OUTPUT của cluster, tức từ dữ liệu bên
//     ngoài. Một tên do cluster bịa ra (`--kubeconfig=/etc/passwd`) chỉ trở thành
//     cờ nếu nó được ghép vào argv ở đâu đó — và chỗ ghép duy nhất ở đây là
//     sidecar, sau khi đã qua regex tên hợp lệ. UI gửi "tôi muốn xem log của pod
//     X trong namespace Y", không gửi argv.
//   · Cùng lý do đó, mọi thao tác ở đây dùng BẢNG CHỮ (`--no-headers`) thay vì
//     `-o json`/`custom-columns`: định dạng sau in NỘI DUNG object nên bị
//     `sensitiveReadOf()` xếp vào nhóm phải hỏi — bảng mặc định thì không.
//   · Ngữ cảnh (profile/region/cluster/namespace) KHÔNG đi thành cờ do UI ghép:
//     `--profile`/`--region`/`--namespace` nằm trong danh sách cờ bị `infra/run.ts`
//     từ chối, nên chúng chỉ có thể đến từ `context` của chính lời gọi — đúng
//     một đường, do sidecar chèn.
//
// Cổng quyền KHÔNG được viết lại ở đây: mọi thao tác đi qua `runGated()`, cùng
// hàm mà `infra.run` dùng. Nhờ vậy `ask` ở đây cũng đòi một VÉ do sidecar phát
// (`approvalTicket`) như mọi bề mặt khác — UI không tự khai "người dùng đã duyệt".
import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { runGated } from '../infra/gated.js'
import { parseDescribeContainerNames, parseKubeTable } from '../infra/kubectl/table.js'
import type { InfraGatedResult } from '../infra/gated.js'
import type { InfraContext } from '../infra/run.js'

// ─── Biên validate tên ──────────────────────────────────────────────────────
// Mọi giá trị dưới đây đi vào argv của một tiến trình con. Luật chung: KÝ TỰ ĐẦU
// không được là `-` (không thể bắt đầu một cờ) và không có xuống dòng. Đây là
// hàng rào độc lập với dò cờ của `run.ts` — hai lớp, vì một lớp thì một ngày nào
// đó sẽ có người nới nó ra vì "validate chặt quá".
const NAME_RE = /^[a-z0-9][a-z0-9.-]{0,252}$/ // pod/namespace/deployment (DNS-1123)
const CONTAINER_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/
const CLUSTER_RE = /^[0-9A-Za-z][A-Za-z0-9-_]{0,99}$/
const REGION_RE = /^[a-z]{2}(-[a-z]+)+-[0-9]+$/
const PROFILE_RE = /^[^\s-][^\r\n]{0,199}$/

const MAX_TAIL = 5000
const DEFAULT_TAIL = 200

const k8sContext = z
  .object({
    cluster: z.string().max(200).optional(),
    namespace: z.string().max(200).optional(),
  })
  .default({})

const awsContext = z
  .object({
    profile: z.string().max(200).optional(),
    region: z.string().max(64).optional(),
  })
  .default({})

// Vé duyệt là trường CHUNG của mọi thao tác: UI gọi lần đầu, nhận `blocked` +
// `approvalTicket`, hỏi người dùng, rồi gọi lại ĐÚNG payload cũ kèm vé — cùng
// khuôn với `infra.run` (một đường, hai RPC, không lệch nhau).
const ticketField = { approvalTicket: z.string().max(100).optional() }

const Params = z.discriminatedUnion('op', [
  z.object({ ...ticketField, op: z.literal('namespaces'), context: k8sContext }),
  z.object({ ...ticketField, op: z.literal('pods'), context: k8sContext }),
  z.object({ ...ticketField, op: z.literal('deployments'), context: k8sContext }),
  z.object({
    ...ticketField,
    op: z.literal('containers'),
    context: k8sContext,
    pod: z.string().max(253),
  }),
  z.object({
    ...ticketField,
    op: z.literal('logs'),
    context: k8sContext,
    pod: z.string().max(253),
    container: z.string().max(63).optional(),
    tail: z.number().int().positive().max(MAX_TAIL).optional(),
  }),
  z.object({
    ...ticketField,
    op: z.literal('describe'),
    context: k8sContext,
    pod: z.string().max(253),
  }),
  z.object({
    ...ticketField,
    op: z.literal('restart'),
    context: k8sContext,
    deployment: z.string().max(253),
  }),
  z.object({
    ...ticketField,
    op: z.literal('delete-pod'),
    context: k8sContext,
    pod: z.string().max(253),
  }),
  z.object({ ...ticketField, op: z.literal('eks-clusters'), context: awsContext }),
  z.object({
    ...ticketField,
    op: z.literal('add-cluster'),
    context: awsContext,
    cluster: z.string().max(100),
  }),
])

function requireMatch(value: string, re: RegExp, label: string): string {
  if (!re.test(value)) {
    // Không nói ra giá trị: nó đến từ output của cluster hoặc từ IPC, và câu này
    // đi thẳng lên UI.
    throw new RpcError(-32602, `${label} không hợp lệ`)
  }
  return value
}

export type Built = {
  tool: 'kubectl' | 'aws'
  args: string[]
  context: InfraContext
  toolName: string
  /** Tên thao tác trong kết quả trả về, để UI biết đường parse. */
  op: string
}

/**
 * Dựng (tool, argv, context) cho một thao tác. Xuất ra ngoài để test được phần
 * đáng test nhất của file này: tên đến từ cluster phải bị chặn TRƯỚC khi thành
 * một phần tử argv.
 */
export function buildKubeCommand(raw: z.infer<typeof Params>): Built {
  switch (raw.op) {
    case 'namespaces':
      return {
        tool: 'kubectl',
        args: ['get', 'namespaces', '--no-headers'],
        context: k8s(raw.context),
        toolName: 'kube_namespaces',
        op: 'namespaces',
      }
    case 'pods':
      return {
        tool: 'kubectl',
        args: ['get', 'pods', '--no-headers'],
        context: k8s(raw.context),
        toolName: 'kube_pods',
        op: 'pods',
      }
    case 'deployments':
      return {
        tool: 'kubectl',
        args: ['get', 'deployments', '--no-headers'],
        context: k8s(raw.context),
        toolName: 'kube_deployments',
        op: 'deployments',
      }
    case 'containers':
      return {
        tool: 'kubectl',
        args: ['describe', 'pod', requireMatch(raw.pod, NAME_RE, 'Tên pod')],
        context: k8s(raw.context),
        toolName: 'kube_containers',
        op: 'containers',
      }
    case 'logs': {
      const args = ['logs', requireMatch(raw.pod, NAME_RE, 'Tên pod'), '--tail']
      args.push(String(raw.tail ?? DEFAULT_TAIL))
      if (raw.container !== undefined) {
        args.push('--container', requireMatch(raw.container, CONTAINER_RE, 'Tên container'))
      }
      return { tool: 'kubectl', args, context: k8s(raw.context), toolName: 'kube_logs', op: 'logs' }
    }
    case 'describe':
      return {
        tool: 'kubectl',
        args: ['describe', 'pod', requireMatch(raw.pod, NAME_RE, 'Tên pod')],
        context: k8s(raw.context),
        toolName: 'kube_describe',
        op: 'describe',
      }
    case 'restart':
      return {
        tool: 'kubectl',
        args: [
          'rollout',
          'restart',
          `deployment/${requireMatch(raw.deployment, NAME_RE, 'Tên deployment')}`,
        ],
        context: k8s(raw.context),
        toolName: 'kube_restart',
        op: 'restart',
      }
    case 'delete-pod':
      return {
        tool: 'kubectl',
        args: ['delete', 'pod', requireMatch(raw.pod, NAME_RE, 'Tên pod')],
        context: k8s(raw.context),
        toolName: 'kube_delete_pod',
        op: 'delete-pod',
      }
    case 'eks-clusters':
      return {
        tool: 'aws',
        args: ['eks', 'list-clusters', '--output', 'json'],
        context: aws(raw.context),
        toolName: 'kube_eks_clusters',
        op: 'eks-clusters',
      }
    case 'add-cluster': {
      const ctx = aws(raw.context)
      if (ctx.region === undefined) {
        // `--region` không được đi trong `args` (cờ ngữ cảnh), nên thiếu region ⇒
        // không có đường nào nói cho CLI biết phải hỏi EKS ở đâu. Đòi ở đây thay
        // vì để CLI tự đoán theo `[default]` — đoán sai thì người dùng nhận một
        // lỗi khó hiểu hoặc một cluster của region khác.
        throw new RpcError(-32602, 'Cần chọn region trước khi thêm cluster')
      }
      return {
        tool: 'aws',
        args: ['eks', 'update-kubeconfig', '--name', requireMatch(raw.cluster, CLUSTER_RE, 'Tên cluster')],
        context: ctx,
        toolName: 'kube_add_cluster',
        op: 'add-cluster',
      }
    }
    default:
      throw new RpcError(-32602, 'Thao tác không hợp lệ')
  }
}

function k8s(ctx: { cluster?: string | undefined; namespace?: string | undefined }): InfraContext {
  const out: InfraContext = {}
  if (ctx.cluster !== undefined) out.cluster = requireMatch(ctx.cluster, NAME_RE, 'Tên context')
  if (ctx.namespace !== undefined) {
    out.namespace = requireMatch(ctx.namespace, NAME_RE, 'Tên namespace')
  }
  return out
}

function aws(ctx: { profile?: string | undefined; region?: string | undefined }): InfraContext {
  const out: InfraContext = {}
  if (ctx.profile !== undefined) out.profile = requireMatch(ctx.profile, PROFILE_RE, 'Tên profile')
  if (ctx.region !== undefined) out.region = requireMatch(ctx.region, REGION_RE, 'Region')
  return out
}

export type InfraKubeOk = {
  blocked: false
  op: string
  command: string
  class: string
  decision: string
  /** Hàng/cột đã bóc, chỉ có ở ba thao tác bảng. */
  rows?: string[][]
  /** Tên container, chỉ có ở `containers`. */
  names?: string[]
  /** Tên cluster EKS, chỉ có ở `eks-clusters`. */
  clusters?: string[]
  result: {
    ok: boolean
    exitCode: number | null
    stdout: string
    stderr: string
    durationMs: number
    truncated: boolean
  }
}

export type InfraKubeBlocked = Extract<InfraGatedResult, { blocked: true }> & { op: string }
export type InfraKubeResult = InfraKubeOk | InfraKubeBlocked

async function execute(built: Built, ticket?: string): Promise<InfraKubeResult> {
  const gated = await runGated({
    tool: built.tool,
    args: built.args,
    context: built.context,
    surface: 'explorer',
    toolName: built.toolName,
    ...(ticket !== undefined ? { approvalTicket: ticket } : {}),
  })
  if (gated.blocked) return { ...gated, op: built.op }

  const result = gated.result
  const out: InfraKubeOk = {
    blocked: false,
    op: built.op,
    command: gated.command,
    class: gated.class,
    decision: gated.decision,
    result: {
      ok: result.ok,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      truncated: result.truncated,
    },
  }

  // Chỉ bóc khi lệnh THÀNH CÔNG: stdout của một lệnh hỏng là thông báo lỗi, bóc
  // nó thành "bảng" sẽ cho ra một bảng một ô vô nghĩa.
  if (!result.ok) return out
  if (built.op === 'namespaces' || built.op === 'pods' || built.op === 'deployments') {
    out.rows = parseKubeTable(result.stdout)
  } else if (built.op === 'containers') {
    out.names = parseDescribeContainerNames(result.stdout)
  } else if (built.op === 'eks-clusters') {
    out.clusters = parseEksClusterNames(result.stdout)
  }
  return out
}

/** `aws eks list-clusters --output json` → `{"clusters":["a","b"]}`. */
export function parseEksClusterNames(stdout: string): string[] {
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (typeof parsed !== 'object' || parsed === null) return []
    const list = (parsed as { clusters?: unknown }).clusters
    if (!Array.isArray(list)) return []
    return list.filter((v): v is string => typeof v === 'string' && CLUSTER_RE.test(v))
  } catch {
    return []
  }
}

register('infra.kube', async (raw): Promise<InfraKubeResult> => {
  const p = Params.parse(raw ?? {})
  return execute(buildKubeCommand(p), p.approvalTicket)
})
