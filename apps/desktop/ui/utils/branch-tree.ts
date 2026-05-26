/**
 * Pure logic cho branch tree: build tree từ flat branch list (group theo `/`),
 * collapse folder singleton, flatten cho render, validate git ref name.
 *
 * KHÔNG phụ thuộc Vue / Pinia / DOM — chỉ data transform. Test smoke có thể
 * gọi trực tiếp với input arbitrary.
 *
 * Reference: ADR 0009 §5.C — tách logic khỏi `GitBranchList.vue`.
 */
import type { GitBranch } from '~/types'

// ─── Tree node types ────────────────────────────────────────────────────
export type BranchLeaf = { kind: 'leaf'; branch: GitBranch; displayName: string }
export type BranchFolder = {
  kind: 'folder'
  name: string
  path: string
  displayName: string
  children: BranchTreeNode[]
}
export type BranchTreeNode = BranchLeaf | BranchFolder

// ─── Row types (output của flatten cho render) ──────────────────────────
export type FolderRow = {
  kind: 'folder'
  depth: number
  id: string
  displayName: string
  leafCount: number
}
export type BranchRow = {
  kind: 'branch'
  depth: number
  id: string
  branch: GitBranch
  displayName: string
}
export type Row = FolderRow | BranchRow

// ─── Counting ───────────────────────────────────────────────────────────
export const countLeaves = (n: BranchTreeNode): number => {
  if (n.kind === 'leaf') return 1
  return n.children.reduce((acc, c) => acc + countLeaves(c), 0)
}

// ─── Collapse singleton folder ──────────────────────────────────────────
// Folder có đúng 1 child → flatten (gộp tên), giảm noise UI khi cấu trúc
// branch dạng `feat/x` mà nhánh `feat` chỉ có một con.
export const collapseSingletons = (nodes: BranchTreeNode[]): BranchTreeNode[] =>
  nodes.map((n) => {
    if (n.kind === 'leaf') return n
    const collapsed = collapseSingletons(n.children)
    if (collapsed.length === 1) {
      const only = collapsed[0]!
      if (only.kind === 'leaf') {
        return {
          kind: 'leaf',
          branch: only.branch,
          displayName: `${n.name}/${only.displayName}`,
        }
      }
      return {
        kind: 'folder',
        name: `${n.name}/${only.name}`,
        path: `${n.path}/${only.name}`,
        displayName: `${n.displayName}/${only.displayName}`,
        children: only.children,
      }
    }
    return { ...n, children: collapsed }
  })

// ─── Build tree ─────────────────────────────────────────────────────────
export const buildBranchTree = (branches: GitBranch[]): BranchTreeNode[] => {
  const root: BranchFolder = {
    kind: 'folder',
    name: '',
    path: '',
    displayName: '',
    children: [],
  }
  branches.forEach((b) => {
    const segs = b.name.split('/')
    let cur: BranchFolder = root
    for (let i = 0; i < segs.length - 1; i += 1) {
      const seg = segs[i] ?? ''
      const segPath = cur.path ? `${cur.path}/${seg}` : seg
      let next = cur.children.find((c): c is BranchFolder => c.kind === 'folder' && c.name === seg)
      if (!next) {
        next = {
          kind: 'folder',
          name: seg,
          path: segPath,
          displayName: seg,
          children: [],
        }
        cur.children.push(next)
      }
      cur = next
    }
    const leafName = segs[segs.length - 1] ?? b.name
    cur.children.push({ kind: 'leaf', branch: b, displayName: leafName })
  })
  return collapseSingletons(root.children)
}

// ─── Flatten cho render ─────────────────────────────────────────────────
// `prefix` giúp tách namespace ID giữa local vs remote (tránh trùng path
// khi cùng tên folder ở 2 list khác nhau).
export const flattenTree = (
  nodes: BranchTreeNode[],
  collapsedFolders: ReadonlySet<string>,
  depth = 0,
  prefix = '',
): Row[] => {
  const out: Row[] = []
  nodes.forEach((n) => {
    if (n.kind === 'leaf') {
      out.push({
        kind: 'branch',
        depth,
        id: n.branch.name,
        branch: n.branch,
        displayName: n.displayName,
      })
      return
    }
    const folderId = `${prefix}${n.path}`
    out.push({
      kind: 'folder',
      depth,
      id: folderId,
      displayName: n.displayName,
      leafCount: countLeaves(n),
    })
    if (!collapsedFolders.has(folderId)) {
      out.push(...flattenTree(n.children, collapsedFolders, depth + 1, prefix))
    }
  })
  return out
}

// ─── Validate git ref ───────────────────────────────────────────────────
// Subset của git-check-ref-format rules — đủ để chặn input UI tạo branch
// không hợp lệ. Không cover full spec (vd: `.lock` suffix) — fail-fast UI,
// engine sẽ reject lần cuối.
const INVALID_CHARS = /[\s~^:?*[]/
export const isValidGitRef = (name: string): boolean => {
  if (!name) return false
  if (INVALID_CHARS.test(name)) return false
  if (name.includes('..')) return false
  if (name.includes('@{')) return false
  return true
}
