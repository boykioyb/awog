// Dựng graph từ một ĐIỂM VÀO — chỗ duy nhất của graph chạm CLI.
//
// VÌ SAO TÁCH KHỎI RPC (cùng lý do với `resources/execute.ts`): ba RPC
// (`infra.graph-roots`, `-resolve`, `-expand`) chia sẻ đúng một chuỗi — dựng argv
// cho node → `runGated()` → đọc JSON phòng vệ → ghép node/cạnh có khử trùng. Viết
// chuỗi đó ba lần là ba chỗ để một bản quên `runGated`, tức một đường chạy lệnh
// không ai duyệt. Ở đây RPC chỉ còn là lớp xác thực payload IPC.
//
// GRAPH KHÔNG CÓ ĐƯỜNG RA MẠNG RIÊNG. Mọi resolver đi qua ĐÚNG cổng mà agent và
// Explorer dùng (`infra/gated.ts`) với `surface: 'graph'`, nên cùng một luật duyệt
// và cùng một dòng nhật ký. Ma trận quyền CÓ THỂ siết lớp `read` trên tài khoản
// production — khi đó `graph-resolve` trả `Blocked` và UI mở hộp duyệt như mọi
// màn khác. Đó là hành vi đúng, không phải lỗi cần lách.
//
// DỰNG DẦN (task 5.3): `resolveInfraGraph` mở từ một điểm vào tới trần độ sâu;
// `expandInfraGraph` mở đúng MỘT hop từ một node đã có. Hai đường dùng chung
// `executeBuild` + `mergeGraphParts` để luật khử trùng chỉ tồn tại một lần.

import { asArray, at } from '../resources/spec.js'
import { runGated, type InfraGatedResult } from '../gated.js'
import {
  GRAPH_NOTES,
  GRAPH_ROOT_COMMANDS,
  graphNodeId,
  hasGraphResolver,
  resolveGraphStep,
  resolverArgvFor,
  rootsFromResult,
  targetFromNodeId,
  type InfraResolveTarget,
  type InfraResolverSelf,
} from './resolvers.js'
import {
  INFRA_GRAPH_MAX_DEPTH,
  type InfraGraph,
  type InfraGraphBlocked,
  type InfraGraphEdge,
  type InfraGraphNode,
  type InfraGraphRoot,
  type InfraTrafficSource,
} from './types.js'
import type { InfraContext } from '../run.js'

/** Tên tool cho nhật ký — KHÔNG phải tên binary. Một tên cho mỗi RPC. */
const ROOTS_TOOL = 'infra_graph_roots'
const RESOLVE_TOOL = 'infra_graph_resolve'
const EXPAND_TOOL = 'infra_graph_expand'
const TRAFFIC_TOOL = 'infra_graph_traffic'

/** Cửa sổ lấy X-Ray khi dò xem tài khoản có nguồn lưu lượng hay không. */
const TRAFFIC_WINDOW_MS = 15 * 60 * 1000
/** Trần số điểm vào trả về — account nhiều nghìn zone vẫn phải mở được màn. */
const MAX_ROOTS = 300

/**
 * Khoá i18n của tầng dựng graph. `rootsFailed` là TIỀN TỐ: khoá đầy đủ có thêm tên
 * dịch vụ (`infra.graph.note.rootsFailed.route53`), để UI nói được cái nào hỏng
 * thay vì "không lấy được gì".
 */
export const GRAPH_BUILD_NOTES = {
  trafficXray: 'infra.graph.note.trafficXray',
  trafficCloudwatch: 'infra.graph.note.trafficCloudwatch',
  trafficNone: 'infra.graph.note.trafficNone',
  trafficBlocked: 'infra.graph.note.trafficBlocked',
  rootsFailedPrefix: 'infra.graph.note.rootsFailed',
  rootsTruncated: 'infra.graph.note.rootsTruncated',
  noRootFound: 'infra.graph.note.noRootFound',
  callFailed: 'infra.graph.note.callFailed',
} as const

export const GRAPH_ERRORS = {
  badRoot: 'infra.graph.error.badRoot',
} as const

export type InfraGraphPart = {
  nodes: readonly InfraGraphNode[]
  edges: readonly InfraGraphEdge[]
  notes: readonly string[]
}

/**
 * Ghép nhiều mảnh graph thành một, KHỬ TRÙNG theo `id`.
 *
 * Hai node cùng id là chuyện bình thường — hai bản ghi DNS cùng trỏ một
 * distribution, hay một lambda nhận hai route. Không khử thì VueFlow vẽ hai node
 * đè lên nhau và `roots`/`expand` cộng dồn thành rác. Bản ĐẦU TIÊN thắng: nó là
 * bản đến từ bước gần điểm vào nhất, tức bản có ngữ cảnh đầy đủ hơn.
 */
export function mergeGraphParts(parts: readonly InfraGraphPart[]): {
  nodes: InfraGraphNode[]
  edges: InfraGraphEdge[]
  notes: string[]
} {
  const nodes = new Map<string, InfraGraphNode>()
  const edges = new Map<string, InfraGraphEdge>()
  const notes: string[] = []
  const seenNotes = new Set<string>()
  for (const part of parts) {
    for (const node of part.nodes) if (!nodes.has(node.id)) nodes.set(node.id, node)
    for (const edge of part.edges) if (!edges.has(edge.id)) edges.set(edge.id, edge)
    for (const key of part.notes) {
      if (seenNotes.has(key)) continue
      seenNotes.add(key)
      notes.push(key)
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], notes }
}

// ─── Kết quả trả lên UI ───────────────────────────────────────────────────────

export type InfraGraphBuildOutcome =
  | { ok: true; graph: InfraGraph; command: string }
  | InfraGraphBlocked
  | { ok: false; blocked: false; error: string }

export type InfraGraphRootsOutcome =
  | { ok: true; roots: InfraGraphRoot[]; notes: string[] }
  | InfraGraphBlocked

/** Phần tham số dùng chung của ba RPC — khớp §3 của hợp đồng. */
type CallInput = {
  context: InfraContext
  sessionId?: string | undefined
  messageId?: string | undefined
  /** Vé duyệt của lượt gọi TRƯỚC, do chính sidecar phát. */
  approvalTicket?: string | undefined
}

// ─── Cổng quyền ───────────────────────────────────────────────────────────────

function gate(p: CallInput & { args: readonly string[]; toolName: string }): Promise<InfraGatedResult> {
  return runGated({
    tool: 'aws',
    args: p.args,
    context: p.context,
    surface: 'graph',
    toolName: p.toolName,
    ...(p.approvalTicket !== undefined ? { approvalTicket: p.approvalTicket } : {}),
    ...(p.sessionId !== undefined ? { sessionId: p.sessionId } : {}),
    ...(p.messageId !== undefined ? { messageId: p.messageId } : {}),
  })
}

/** Hình dạng §2 của hợp đồng — dùng chung cho cả ba RPC của graph. */
function blockedOf(gated: Extract<InfraGatedResult, { blocked: true }>): InfraGraphBlocked {
  return {
    ok: false,
    blocked: true,
    requiresApproval: gated.requiresApproval,
    ...(gated.approvalTicket !== undefined ? { approvalTicket: gated.approvalTicket } : {}),
    command: gated.command,
    reason: gated.reason,
    class: gated.class,
    accountKind: gated.accountKind,
    mode: gated.mode,
  }
}

// ─── Lõi dựng graph ───────────────────────────────────────────────────────────

type BuildInput = CallInput & {
  startIds: readonly string[]
  /** Số hop được phép mở (1 với `expand`, bằng trần độ sâu với `resolve`). */
  hops: number
  /** Trần dùng để tính `expandable`/`truncated` của node CON. */
  childDepthLimit: number
  /** Node bắt đầu có nằm trong `nodes` không (`expand` chỉ trả PHẦN MỚI). */
  includeStart: boolean
  toolName: string
}

type BuildCore =
  | {
      ok: true
      parts: InfraGraphPart[]
      selfs: Map<string, InfraResolverSelf>
      notes: string[]
      truncated: boolean
      command: string
    }
  | InfraGraphBlocked
  | { ok: false; blocked: false; error: string }

/**
 * Hàng đợi theo độ sâu: mỗi node có resolver được mở đúng một lần, node chạm trần
 * thì không mở. Node bắt đầu là node DUY NHẤT không do resolver sinh ra, nên nó
 * được dựng thẳng từ `id` — đủ để gọi CLI (đó cũng là lý do `id` mang theo service
 * + region + tên tài nguyên).
 */
async function executeBuild(input: BuildInput): Promise<BuildCore> {
  const parts: InfraGraphPart[] = []
  const selfs = new Map<string, InfraResolverSelf>()
  const queue: { target: InfraResolveTarget; depth: number }[] = []
  const seen = new Set<string>()
  const notes = new Set<string>()
  let truncated = false
  let command = ''
  let callsOk = 0
  let callsFailed = 0
  let firstError = ''

  for (const id of input.startIds) {
    const target = targetFromNodeId(id)
    if (!target) return { ok: false, blocked: false, error: GRAPH_ERRORS.badRoot }
    queue.push({ target, depth: 0 })
    if (input.includeStart) parts.push({ nodes: [startNode(target)], edges: [], notes: [] })
  }

  while (queue.length > 0) {
    const item = queue.shift()
    if (!item) break
    const key = graphNodeId(item.target)
    if (seen.has(key)) continue
    seen.add(key)

    const argvList = resolverArgvFor(item.target)
    if (argvList.length === 0) continue
    if (item.depth >= input.hops) {
      // Còn nhánh nhưng đã chạm trần: nói ra, đừng im lặng vẽ thiếu.
      if (Number.isFinite(input.childDepthLimit) && hasGraphResolver(item.target.service)) {
        truncated = true
        notes.add(GRAPH_NOTES.depthTruncated)
      }
      continue
    }

    const jsons: unknown[] = []
    for (const args of argvList) {
      const gated = await gate({ ...input, args, toolName: input.toolName })
      if (gated.blocked) return blockedOf(gated)
      if (command === '') command = gated.command
      if (gated.result.ok) {
        callsOk++
        jsons.push(parseJson(gated.result.stdout))
      } else {
        // Lệnh hỏng KHÔNG làm hỏng cả graph: một hàm Lambda thiếu quyền không nên
        // xoá luôn phần đã dựng được. Nhưng cũng không im lặng — xem cuối hàm.
        callsFailed++
        if (firstError === '') firstError = errorText(gated.result)
        jsons.push(null)
      }
    }

    const step = resolveGraphStep(item.target, jsons, {
      region: input.context.region ?? '',
      accountId: input.context.accountId,
      depth: item.depth,
      maxDepth: input.childDepthLimit,
    })
    parts.push({ nodes: step.nodes, edges: step.edges, notes: step.notes })
    if (step.self) selfs.set(key, step.self)
    if (step.truncated) truncated = true

    for (const child of step.nodes) {
      if (child.kind === 'external' || !child.expandable) continue
      const target = targetFromNodeId(child.id)
      if (target) queue.push({ target, depth: item.depth + 1 })
    }
  }

  // Không một lệnh nào chạy được ⇒ đây là lỗi thật (chưa đăng nhập, sai region,
  // thiếu quyền), không phải "graph rỗng". Trả câu của AWS để UI hiện được.
  if (callsOk === 0 && callsFailed > 0) {
    return { ok: false, blocked: false, error: firstError || 'infra.graph.error.callFailed' }
  }
  if (callsFailed > 0) notes.add(GRAPH_BUILD_NOTES.callFailed)

  return { ok: true, parts, selfs, notes: [...notes], truncated, command }
}

/**
 * Node bắt đầu. `expandable` là "còn resolver cho dịch vụ này", KHÔNG phải "còn
 * trong trần độ sâu" — người dùng luôn được phép mở tay một node bất kể trần.
 */
function startNode(target: InfraResolveTarget): InfraGraphNode {
  return {
    id: graphNodeId(target),
    service: target.service,
    label: target.name,
    region: target.region,
    kind: 'service',
    inferred: false,
    expandable: hasGraphResolver(target.service),
    detail: {},
  }
}

function applySelf(node: InfraGraphNode, self: InfraResolverSelf | undefined): InfraGraphNode {
  if (!self) return node
  return {
    ...node,
    ...(self.label !== undefined && self.label !== '' ? { label: self.label } : {}),
    detail: { ...node.detail, ...(self.detail ?? {}) },
  }
}

// ─── Lớp lưu lượng ────────────────────────────────────────────────────────────

/**
 * Nguồn lưu lượng đang dùng (task 5.3 / G3).
 *
 * DÒ CHỨ KHÔNG ĐOÁN: X-Ray trước (nguồn đúng nhất cho "luồng request"), không có
 * thì CloudWatch (chỉ có sức khoẻ từng node), không có nữa thì `none`. Câu hỏi "tài
 * khoản này có X-Ray không" chưa ai trả lời (Q4 của kế hoạch), nên tầng này KHÔNG
 * mặc định là có — nó hỏi, rồi `notes` nói ra kết quả.
 *
 * Phép dò là TUỲ CHỌN, nên nó KHÔNG làm hỏng lượt dựng: bị ma trận chặn thì ghi
 * chú `trafficBlocked` rồi đi tiếp (người dùng hỏi cấu trúc, không hỏi lưu lượng).
 */
async function detectTrafficSource(
  input: CallInput,
): Promise<{ source: InfraTrafficSource; notes: string[] }> {
  const now = Date.now()
  let blocked = false

  const xray = await gate({
    ...input,
    toolName: TRAFFIC_TOOL,
    args: [
      'xray',
      'get-service-graph',
      '--start-time',
      new Date(now - TRAFFIC_WINDOW_MS).toISOString(),
      '--end-time',
      new Date(now).toISOString(),
    ],
  })
  if (xray.blocked) blocked = true
  else if (xray.result.ok) return { source: 'xray', notes: [GRAPH_BUILD_NOTES.trafficXray] }

  const cloudwatch = await gate({
    ...input,
    toolName: TRAFFIC_TOOL,
    args: ['cloudwatch', 'list-metrics', '--max-items', '1'],
  })
  if (cloudwatch.blocked) blocked = true
  else if (
    cloudwatch.result.ok &&
    asArray(at(parseJson(cloudwatch.result.stdout), 'Metrics')).length > 0
  ) {
    return {
      source: 'cloudwatch',
      notes: [
        GRAPH_BUILD_NOTES.trafficCloudwatch,
        ...(blocked ? [GRAPH_BUILD_NOTES.trafficBlocked] : []),
      ],
    }
  }

  return {
    source: 'none',
    notes: [blocked ? GRAPH_BUILD_NOTES.trafficBlocked : GRAPH_BUILD_NOTES.trafficNone],
  }
}

// ─── Ba RPC ───────────────────────────────────────────────────────────────────

export function clampGraphDepth(depth: number | undefined): number {
  const wanted = Math.trunc(depth ?? INFRA_GRAPH_MAX_DEPTH)
  if (!Number.isFinite(wanted)) return INFRA_GRAPH_MAX_DEPTH
  return Math.min(Math.max(wanted, 0), INFRA_GRAPH_MAX_DEPTH)
}

async function assemble(input: {
  call: CallInput
  core: Extract<BuildCore, { ok: true }>
  roots: readonly string[]
  depth: number
}): Promise<InfraGraphBuildOutcome> {
  const traffic = await detectTrafficSource(input.call)
  const merged = mergeGraphParts(input.core.parts)
  const graph: InfraGraph = {
    nodes: merged.nodes.map((node) => applySelf(node, input.core.selfs.get(node.id))),
    edges: merged.edges,
    roots: [...input.roots],
    depth: input.depth,
    truncated: input.core.truncated,
    trafficSource: traffic.source,
    notes: [...merged.notes, ...input.core.notes, ...traffic.notes],
  }
  return { ok: true, graph, command: input.core.command }
}

export type InfraGraphResolveInput = CallInput & {
  rootId: string
  /** Trần độ sâu người dùng xin; luôn bị kẹp trong [0, 4]. */
  depth?: number | undefined
}

/** Dựng graph từ một điểm vào (task 5.1 + 5.2). */
export async function resolveInfraGraph(
  input: InfraGraphResolveInput,
): Promise<InfraGraphBuildOutcome> {
  const maxDepth = clampGraphDepth(input.depth)
  const core = await executeBuild({
    ...input,
    startIds: [input.rootId],
    hops: maxDepth,
    childDepthLimit: maxDepth,
    includeStart: true,
    toolName: RESOLVE_TOOL,
  })
  if (!core.ok) return core
  return assemble({ call: input, core, roots: [input.rootId], depth: maxDepth })
}

export type InfraGraphExpandInput = CallInput & { nodeId: string }

/**
 * Dựng tiếp từ MỘT node (task 5.3). Kết quả chỉ chứa PHẦN MỚI: node bắt đầu đã
 * nằm trong graph của UI rồi, trả lại nó là bắt UI tự khử trùng.
 *
 * Trần độ sâu KHÔNG áp ở đây — người dùng đã tự chỉ đúng nhánh họ cần, nên node mới
 * vẫn còn `expandable` cho lần mở tiếp theo. `depth: 1` nói đúng "một hop".
 */
export async function expandInfraGraph(
  input: InfraGraphExpandInput,
): Promise<InfraGraphBuildOutcome> {
  const core = await executeBuild({
    ...input,
    startIds: [input.nodeId],
    hops: 1,
    childDepthLimit: Number.POSITIVE_INFINITY,
    includeStart: false,
    toolName: EXPAND_TOOL,
  })
  if (!core.ok) return core
  return assemble({ call: input, core, roots: [input.nodeId], depth: 1 })
}

export type InfraGraphRootsInput = CallInput

/** Ba lượt đọc cho ba loại điểm vào: hosted zone · distribution · REST API. */
export async function listInfraGraphRoots(
  input: InfraGraphRootsInput,
): Promise<InfraGraphRootsOutcome> {
  const roots: InfraGraphRoot[] = []
  const notes: string[] = []
  let truncated = false

  for (const source of GRAPH_ROOT_COMMANDS) {
    const gated = await gate({ ...input, args: source.args, toolName: ROOTS_TOOL })
    if (gated.blocked) return blockedOf(gated)
    if (!gated.result.ok) {
      notes.push(`${GRAPH_BUILD_NOTES.rootsFailedPrefix}.${source.service}`)
      continue
    }
    const parsed = rootsFromResult(
      source.service,
      parseJson(gated.result.stdout),
      input.context.region ?? '',
    )
    if (parsed.truncated) truncated = true
    roots.push(...parsed.roots)
  }

  if (truncated || roots.length > MAX_ROOTS) notes.push(GRAPH_BUILD_NOTES.rootsTruncated)
  if (roots.length === 0) notes.push(GRAPH_BUILD_NOTES.noRootFound)

  return { ok: true, roots: roots.slice(0, MAX_ROOTS), notes: unique(notes) }
}

// ─── Dùng chung ───────────────────────────────────────────────────────────────

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function parseJson(stdout: string): unknown {
  const text = stdout.trim()
  if (text === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function errorText(result: { stderr: string; stdout: string }): string {
  const err = result.stderr.trim()
  if (err) return err.slice(0, 2000)
  return result.stdout.trim().slice(0, 2000)
}
