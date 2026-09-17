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
export const NAME_RE = /^[a-z0-9][a-z0-9.-]{0,252}$/ // pod/namespace/deployment (DNS-1123)
export const CONTAINER_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/
/**
 * `--since` của kubectl: một khoảng thời gian tương đối (`15m`, `2h`, `30s`).
 *
 * Danh sách ĐÓNG chứ không nhận chuỗi tự do: giá trị này đi thẳng vào argv, và
 * `--since` còn có người anh em `--since-time` nhận RFC3339 — mở cửa cho chuỗi tự
 * do là mở cửa cho cả một họ cờ mà lớp `findForbiddenFlag` phải đuổi theo. Bốn chữ
 * số là trần: `9999h` ≈ 416 ngày, quá đủ, và không ai gõ nhầm thành một số khổng lồ.
 */
export const SINCE_RE = /^[1-9][0-9]{0,3}[smh]$/
const CLUSTER_RE = /^[0-9A-Za-z][A-Za-z0-9-_]{0,99}$/
const REGION_RE = /^[a-z]{2}(-[a-z]+)+-[0-9]+$/
const PROFILE_RE = /^[^\s-][^\r\n]{0,199}$/

const MAX_TAIL = 5000
const DEFAULT_TAIL = 200

export const k8sContext = z
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
  // ── Số liệu của màn Báo cáo ───────────────────────────────────────────────
  // Bốn thao tác dưới đây CHỈ ĐỌC và không nhận tham số nào từ UI ngoài ngữ cảnh
  // đã ghim: không có tên nào do cluster trả về đi vào argv, nên không có gì để
  // validate ngoài chính `context`. Chúng nằm trong `K8S_READ` (`get`/`top`) nên
  // chạy thẳng, không hỏi duyệt — cùng hạng với bảng Pods/Deployments.
  z.object({ ...ticketField, op: z.literal('nodes'), context: k8sContext }),
  z.object({ ...ticketField, op: z.literal('top-pods'), context: k8sContext }),
  z.object({ ...ticketField, op: z.literal('top-nodes'), context: k8sContext }),
  z.object({ ...ticketField, op: z.literal('events'), context: k8sContext }),
  // Mười hai bảng đọc thêm của màn Báo cáo (2026-09-17). Tất cả là `get`/`describe`
  // không cờ `-o`, tức `read` chạy thẳng — xem `sensitiveReadOf()`.
  z.object({ ...ticketField, op: z.literal('describe-nodes'), context: k8sContext }),
  z.object({ ...ticketField, op: z.literal('hpa'), context: k8sContext }),
  z.object({ ...ticketField, op: z.literal('statefulsets'), context: k8sContext }),
  z.object({ ...ticketField, op: z.literal('daemonsets'), context: k8sContext }),
  z.object({ ...ticketField, op: z.literal('jobs'), context: k8sContext }),
  z.object({ ...ticketField, op: z.literal('pvc'), context: k8sContext }),
  z.object({ ...ticketField, op: z.literal('services'), context: k8sContext }),
  z.object({ ...ticketField, op: z.literal('ingresses'), context: k8sContext }),
  z.object({ ...ticketField, op: z.literal('endpoints'), context: k8sContext }),
  z.object({ ...ticketField, op: z.literal('resourcequota'), context: k8sContext }),
  z.object({ ...ticketField, op: z.literal('pdb'), context: k8sContext }),
  z.object({ ...ticketField, op: z.literal('replicasets'), context: k8sContext }),
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
    since: z.string().max(8).optional(),
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

export function requireMatch(value: string, re: RegExp, label: string): string {
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
    // `-o wide` thêm hai cột IP và NODE. Nó KHÔNG làm bảng này thành "đọc nội
    // dung object": `sensitiveReadOf()` chỉ chặn `-o yaml|json|jsonpath|
    // go-template|custom-columns` (xem `infra/classify.ts`), còn `-o wide` vẫn là
    // bảng metadata ⇒ vẫn chạy thẳng, không sinh hộp thoại duyệt mỗi lần nạp.
    //
    // Vì sao cần: cột NODE là thứ DUY NHẤT nối pod với máy chạy nó. Thiếu nó thì
    // báo cáo chỉ ra được "node này RAM 100%" và dừng ở đúng chỗ người đọc phải
    // mở terminal để hỏi "pod nào đang ngồi trên đó". `kubectl top pods` không có
    // cột này, `kubectl top nodes` cũng không.
    case 'pods':
      return {
        tool: 'kubectl',
        args: ['get', 'pods', '-o', 'wide', '--no-headers'],
        context: k8s(raw.context),
        toolName: 'kube_pods',
        op: 'pods',
      }
    // `-o wide` thêm hai cột CONTAINERS + IMAGES, tức là chỗ DUY NHẤT trong bảng
    // này trả lời "phiên bản nào đang chạy" — thiếu nó thì báo cáo chỉ nói được
    // "3/3 sẵn sàng" mà không nói nổi 3 pod đó đang chạy image tag nào.
    //
    // Nó KHÔNG làm bảng này thành "đọc nội dung object": `sensitiveReadOf()` trong
    // `src/infra/classify.ts` chỉ chặn `-o yaml|json|jsonpath|go-template|
    // custom-columns`, còn `-o wide` vẫn là bảng metadata ⇒ vẫn là `read` chạy
    // thẳng, không sinh hộp thoại duyệt.
    //
    // `-o wide` chỉ THÊM cột vào cuối, nên các cột cũ (READY/UP-TO-DATE/AVAILABLE/
    // AGE) giữ nguyên vị trí — parser phía UI đọc theo chỉ số cột không phải sửa.
    case 'deployments':
      return {
        tool: 'kubectl',
        args: ['get', 'deployments', '-o', 'wide', '--no-headers'],
        context: k8s(raw.context),
        toolName: 'kube_deployments',
        op: 'deployments',
      }
    case 'nodes':
      return {
        tool: 'kubectl',
        args: ['get', 'nodes', '--no-headers'],
        context: k8s(raw.context),
        toolName: 'kube_nodes',
        op: 'nodes',
      }
    // `kubectl top` đọc metrics-server. Cụm CHƯA cài metrics-server sẽ trả exit
    // code khác 0 kèm `error: Metrics API not available` — đó là một câu trả lời
    // hợp lệ, không phải sự cố của AWOG, nên nó đi lên UI nguyên văn qua
    // `result.stderr` và màn Báo cáo hiện ô "chưa có nguồn CPU/RAM" thay vì số 0.
    case 'top-pods':
      return {
        tool: 'kubectl',
        args: ['top', 'pods', '--no-headers'],
        context: k8s(raw.context),
        toolName: 'kube_top_pods',
        op: 'top-pods',
      }
    case 'top-nodes':
      return {
        tool: 'kubectl',
        args: ['top', 'nodes', '--no-headers'],
        context: k8s(raw.context),
        toolName: 'kube_top_nodes',
        op: 'top-nodes',
      }
    // Chỉ `type=Warning`: bảng event đầy đủ gồm cả `Normal` (Scheduled/Pulled/
    // Started của mọi pod) — hàng nghìn dòng vô thưởng vô phạt che đúng cái dòng
    // OOMKilled mà người đọc báo cáo đang tìm. `--sort-by` dùng
    // `.metadata.creationTimestamp` (luôn có) chứ không `.lastTimestamp` (rỗng với
    // event ghi qua API events.k8s.io ⇒ kubectl báo lỗi không tìm thấy field).
    case 'events':
      return {
        tool: 'kubectl',
        args: [
          'get',
          'events',
          '--field-selector',
          'type=Warning',
          '--sort-by=.metadata.creationTimestamp',
          '--no-headers',
        ],
        context: k8s(raw.context),
        toolName: 'kube_events',
        op: 'events',
      }
    // `describe nodes` (KHÔNG kèm tên node) trả về MỌI node trong một lần gọi.
    // Đây là nguồn DUY NHẤT của "sức chứa thật": `Allocatable`, `Allocated
    // resources` (requests/limits + %) và số pod trên node. `kubectl top` chỉ nói
    // mức ĐANG dùng — mà pod `Pending` gần như luôn vì hết chỗ ĐẶT TRƯỚC
    // (requests), không phải vì CPU thật đang cao. Thiếu bảng này thì báo cáo
    // không bao giờ giải thích được vì sao pod mới không lên được.
    case 'describe-nodes':
      return {
        tool: 'kubectl',
        args: ['describe', 'nodes'],
        context: k8s(raw.context),
        toolName: 'kube_describe_nodes',
        op: 'describe-nodes',
      }
    case 'hpa':
      return {
        tool: 'kubectl',
        args: ['get', 'hpa', '--no-headers'],
        context: k8s(raw.context),
        toolName: 'kube_hpa',
        op: 'hpa',
      }
    // Ba loại workload KHÔNG phải Deployment. Tách ba lệnh chứ không gộp
    // `get sts,ds,job`: gộp lại thì kubectl in ba khối có SỐ CỘT KHÁC NHAU dính
    // liền nhau, và `parseKubeTable` (cắt theo ≥2 dấu cách) không có cách nào biết
    // hàng đang đọc thuộc khối nào.
    case 'statefulsets':
      return {
        tool: 'kubectl',
        args: ['get', 'statefulsets', '--no-headers'],
        context: k8s(raw.context),
        toolName: 'kube_statefulsets',
        op: 'statefulsets',
      }
    case 'daemonsets':
      return {
        tool: 'kubectl',
        args: ['get', 'daemonsets', '--no-headers'],
        context: k8s(raw.context),
        toolName: 'kube_daemonsets',
        op: 'daemonsets',
      }
    case 'jobs':
      return {
        tool: 'kubectl',
        args: ['get', 'jobs', '--no-headers'],
        context: k8s(raw.context),
        toolName: 'kube_jobs',
        op: 'jobs',
      }
    case 'pvc':
      return {
        tool: 'kubectl',
        args: ['get', 'pvc', '--no-headers'],
        context: k8s(raw.context),
        toolName: 'kube_pvc',
        op: 'pvc',
      }
    case 'services':
      return {
        tool: 'kubectl',
        args: ['get', 'services', '--no-headers'],
        context: k8s(raw.context),
        toolName: 'kube_services',
        op: 'services',
      }
    case 'ingresses':
      return {
        tool: 'kubectl',
        args: ['get', 'ingresses', '--no-headers'],
        context: k8s(raw.context),
        toolName: 'kube_ingresses',
        op: 'ingresses',
      }
    // `get endpoints` là câu trả lời cho "Service này có ai đứng sau không": cột
    // ENDPOINTS rỗng (`<none>`) nghĩa là selector không khớp pod nào — bảng
    // Services một mình không nói được điều đó, nó vẫn hiện CLUSTER-IP như thường.
    case 'endpoints':
      return {
        tool: 'kubectl',
        args: ['get', 'endpoints', '--no-headers'],
        context: k8s(raw.context),
        toolName: 'kube_endpoints',
        op: 'endpoints',
      }
    // Hạn mức của namespace: `describe nodes` nói sức chứa của MÁY, còn
    // ResourceQuota là trần do cụm đặt cho namespace — pod `Pending` vì chạm trần
    // quota trông y hệt pod Pending vì hết node, nhưng cách sửa thì khác hẳn.
    case 'resourcequota':
      return {
        tool: 'kubectl',
        args: ['get', 'resourcequota', '--no-headers'],
        context: k8s(raw.context),
        toolName: 'kube_resourcequota',
        op: 'resourcequota',
      }
    // PodDisruptionBudget: lý do phổ biến nhất khiến `drain`/nâng cấp node treo
    // giữa chừng. Dùng tên tài nguyên ĐẦY ĐỦ `poddisruptionbudgets` thay vì `pdb`
    // trong argv (viết tắt chỉ là bí danh của kubectl, tên đầy đủ thì mọi phiên
    // bản đều hiểu); `pdb` chỉ còn là tên thao tác phía UI.
    case 'pdb':
      return {
        tool: 'kubectl',
        args: ['get', 'poddisruptionbudgets', '--no-headers'],
        context: k8s(raw.context),
        toolName: 'kube_pdb',
        op: 'pdb',
      }
    // ReplicaSet: nơi nhìn ra một lần rollout đang DỞ DANG — deployment báo
    // AVAILABLE đủ trong khi vẫn còn hai RS cùng có pod, tức bản cũ chưa rút hết.
    case 'replicasets':
      return {
        tool: 'kubectl',
        args: ['get', 'rs', '--no-headers'],
        context: k8s(raw.context),
        toolName: 'kube_replicasets',
        op: 'replicasets',
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
      // `--since` ĐI CÙNG `--tail`, không thay nó: kubectl lấy giao của hai điều
      // kiện. Thiếu `--tail` thì "1 giờ qua" của một service ồn là vài trăm nghìn
      // dòng đổ thẳng vào modal.
      if (raw.since !== undefined) {
        args.push('--since', requireMatch(raw.since, SINCE_RE, 'Khoảng thời gian'))
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

export function k8s(ctx: { cluster?: string | undefined; namespace?: string | undefined }): InfraContext {
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
  /** Hàng/cột đã bóc, chỉ có ở các thao tác trả bảng (xem `TABLE_OPS`). */
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

/** Thao tác trả về BẢNG CHỮ ⇒ bóc thành `rows`. */
const TABLE_OPS: ReadonlySet<string> = new Set([
  'namespaces',
  'pods',
  'deployments',
  'nodes',
  'top-pods',
  'top-nodes',
  'events',
  'hpa',
  'statefulsets',
  'daemonsets',
  'jobs',
  'pvc',
  'services',
  'ingresses',
  'endpoints',
  'resourcequota',
  'pdb',
  'replicasets',
])
// `describe-nodes` CỐ Ý không ở đây: output của nó là văn bản nhiều khối lồng
// nhau, không phải bảng cột. UI đọc nó từ `result.stdout` bằng parser riêng
// (`nodeCapacity()`), vì bóc nó theo luật "≥2 dấu cách" sẽ ra rác.

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
  if (TABLE_OPS.has(built.op)) {
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
