import { computed, ref } from 'vue'
import type { AwsTrace } from '~/composables/useAwsLogsApi'
import type { InfraGraphNode } from '~/composables/useInfraGraphApi'

// CẦU NỐI: đường đi của một request (tab Nhật ký, L5) → tô sáng trên sơ đồ (tab Sơ
// đồ, G4).
//
// VÌ SAO MODULE-SCOPED REF — cùng lý do với `useInfraWindowSync`: `/infra` nằm dưới
// `<NuxtPage keepalive />` và hai màn này là hai TAB của cùng một trang, không tab
// nào bị unmount. Một biến sống trong component sẽ chết cùng lần chuyển tab.
//
// KHÔNG "một lần dùng" như `useInfraWindowSync`. Khoảng thời gian là thứ ÁP rồi
// thôi; đường đi là thứ người ta NHÌN, và nhìn xong còn bấm quanh sơ đồ. Nó ở lại
// cho tới khi người dùng tự tắt (`clear()`) hoặc lần theo một request khác.

/** Một chặng đã rút gọn — chỉ giữ thứ dùng để khớp với node. */
type HighlightHop = {
  service: string
  label: string
  logGroup: string | null
  status: 'ok' | 'error'
}

const active = ref<{ id: string; source: 'xray' | 'logs'; hops: HighlightHop[] } | null>(null)

/**
 * Một node có nằm trên đường đi không.
 *
 * BA PHÉP KHỚP, theo đúng thứ tự chắc chắn giảm dần — và KHÔNG có phép thứ tư kiểu
 * "cùng dịch vụ thì chắc là nó": trên một tài khoản thật có hàng chục hàm Lambda,
 * nên khớp theo dịch vụ sẽ tô sáng gần hết sơ đồ và làm cả tính năng vô nghĩa.
 *
 *   1. Nhóm log trùng — chắc chắn nhất, vì nhóm log là danh tính của chặng.
 *   2. Nhóm log của node là TIỀN TỐ của nhóm chặng (API Gateway: node không mang
 *      stage, chặng thì có).
 *   3. Nhãn trùng — nhánh X-Ray đặt tên segment theo tên tài nguyên.
 */
export function nodeOnTracePath(node: InfraGraphNode, hops: readonly HighlightHop[]): boolean {
  const nodeGroup = node.logGroup
  for (const hop of hops) {
    if (nodeGroup && hop.logGroup) {
      if (nodeGroup.kind === 'exact' && nodeGroup.value === hop.logGroup) return true
      if (nodeGroup.kind === 'prefix' && hop.logGroup.startsWith(nodeGroup.value)) return true
    }
    if (hop.label && hop.label === node.label) return true
  }
  return false
}

export function useInfraTraceHighlight() {
  /** Gieo đường đi từ một lượt lần theo. */
  function push(trace: AwsTrace): void {
    active.value = {
      id: trace.id,
      source: trace.source,
      hops: trace.hops.map((h) => ({
        service: h.service,
        label: h.label,
        logGroup: h.logGroup,
        status: h.status,
      })),
    }
  }

  function clear(): void {
    active.value = null
  }

  const traceId = computed(() => active.value?.id ?? '')
  const hops = computed<readonly HighlightHop[]>(() => active.value?.hops ?? [])
  const on = computed(() => hops.value.length > 0)

  /**
   * Node nào nằm trên đường đi. Trả `null` khi KHÔNG có đường đi nào đang tô — khác
   * hẳn với "tập rỗng": tập rỗng sẽ làm mờ TOÀN BỘ sơ đồ, và một sơ đồ mờ hết trông
   * y như một sơ đồ hỏng.
   */
  function matchOf(nodes: readonly InfraGraphNode[]): Set<string> | null {
    if (!on.value) return null
    const out = new Set<string>()
    for (const node of nodes) if (nodeOnTracePath(node, hops.value)) out.add(node.id)
    return out
  }

  /** Chặng hỏng có khớp được node nào không — để sơ đồ tô ĐỎ đúng chỗ chết. */
  function failedOf(nodes: readonly InfraGraphNode[]): Set<string> {
    const failed = hops.value.filter((h) => h.status === 'error')
    const out = new Set<string>()
    if (failed.length === 0) return out
    for (const node of nodes) if (nodeOnTracePath(node, failed)) out.add(node.id)
    return out
  }

  return { traceId, hops, on, push, clear, matchOf, failedOf }
}
