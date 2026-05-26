// Pure logic cho workflow edge: derive VueFlow edge id + filter edges sau khi
// VueFlow phát NodeChange / EdgeChange. Không phụ thuộc Vue/VueFlow runtime — test được standalone.
//
// Edge id format khớp với mapping trong `WorkflowCanvas.vue`:
//   `${edge.from}-${edge.to}-${index}` (index = vị trí trong mảng `workflow.edges`)

import type { WorkflowEdge } from '~/types'

/**
 * Derive VueFlow edge id từ một `WorkflowEdge` cộng index trong mảng.
 * Phải khớp với cách `WorkflowCanvas` map edges → VueFlow elements.
 */
export const deriveEdgeId = (edge: WorkflowEdge, index: number): string =>
  `${edge.from}-${edge.to}-${index}`

/**
 * Lọc bỏ những edge có id nằm trong `removedIds` (từ VueFlow EdgeChange type='remove').
 * Trả mảng edges mới (không mutate input).
 */
export const filterEdgesByRemovedIds = (
  edges: WorkflowEdge[],
  removedIds: string[],
): WorkflowEdge[] => {
  if (removedIds.length === 0) return edges
  const removedSet = new Set(removedIds)
  return edges.filter((edge, i) => !removedSet.has(deriveEdgeId(edge, i)))
}

/**
 * Lọc bỏ những edge có endpoint thuộc node đã xóa.
 * Dùng khi VueFlow phát NodeChange type='remove' — phải dọn edge orphan kèm theo.
 */
export const filterEdgesByRemovedNodes = (
  edges: WorkflowEdge[],
  removedNodeIds: string[],
): WorkflowEdge[] => {
  if (removedNodeIds.length === 0) return edges
  const removedSet = new Set(removedNodeIds)
  return edges.filter((edge) => !removedSet.has(edge.from) && !removedSet.has(edge.to))
}

/**
 * Trích id của tất cả change có `type === 'remove'`.
 * VueFlow `NodeChange` / `EdgeChange` đều có shape `{ type: 'remove', id: string }`
 * cho biến thể remove — ta chỉ quan tâm `id`.
 */
export const extractRemovedIds = <T extends { type: string }>(changes: T[]): string[] =>
  changes
    .filter((change) => change.type === 'remove')
    .map((change) => (change as unknown as { id: string }).id)
