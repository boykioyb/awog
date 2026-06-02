import type { WorkflowEdge, WorkflowNode } from '~/types'

export function topoSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  const inDegree: Record<string, number> = {}
  const adj: Record<string, string[]> = {}

  nodes.forEach((n) => {
    inDegree[n.id] = 0
    adj[n.id] = []
  })
  edges.forEach((e) => {
    const toDegree = inDegree[e.to]
    if (toDegree !== undefined) inDegree[e.to] = toDegree + 1
    adj[e.from]?.push(e.to)
  })

  const queue: string[] = nodes.filter((n) => inDegree[n.id] === 0).map((n) => n.id)
  const result: string[] = []

  while (queue.length) {
    const id = queue.shift()!
    result.push(id)
    ;(adj[id] ?? []).forEach((next) => {
      const degree = inDegree[next]
      if (degree === undefined) return
      inDegree[next] = degree - 1
      if (inDegree[next] === 0) queue.push(next)
    })
  }
  return result
}

export function calcBadgeColWidth(roles: string[], size: 'sm' | 'md' = 'md'): number {
  const height = size === 'sm' ? 20 : 24
  const charWidth = size === 'sm' ? 5.8 : 6.4
  const padding = 18

  let maxWidth = height
  roles.forEach((r) => {
    const text = r || ''
    const isShort = text.length <= 3
    const width = isShort ? height : Math.ceil(text.length * charWidth + padding)
    if (width > maxWidth) maxWidth = width
  })
  return maxWidth
}
