// Source Control view — cây file theo đường dẫn (staged/unstaged/conflicted).
// Build một cây per section, compact dir đơn-con (a/b/c → một dòng), render
// phẳng với depth + chevron. Pure module: composable sở hữu `collapsed` ref,
// truyền vào `flattenScmTree`; parent giữ row-dir ops (stage/unstage/discard
// cả thư mục chạy trên `collectScmFiles`).
import type { GitFile } from '~/components/git/git-types'

export type ScmTreeNode = {
  path: string // dir path hoặc file path
  name: string
  isDir: boolean
  depth: number
  children?: ScmTreeNode[]
  // file only
  file?: GitFile
}

export const scmNameOf = (p: string): string => p.split('/').pop() ?? p
export const scmDirOf = (p: string): string =>
  p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''

type Dir = { children: Map<string, Dir>; files: GitFile[] }

export function buildScmTree(files: GitFile[]): ScmTreeNode[] {
  const root: Dir = { children: new Map(), files: [] }
  for (const f of files) {
    const parts = f.f.split('/')
    let cur = root
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]!
      if (!cur.children.has(seg)) cur.children.set(seg, { children: new Map(), files: [] })
      cur = cur.children.get(seg)!
    }
    cur.files.push(f)
  }
  const out: ScmTreeNode[] = []
  // Compact dir đơn-con duy nhất và không có file ở giữa (a/b/c → một dòng).
  const compact = (seg: string, child: Dir, prefix: string) => {
    let path = prefix ? `${prefix}/${seg}` : seg
    let name = seg
    let c = child
    while (c.files.length === 0 && c.children.size === 1) {
      const [nseg, nchild] = [...c.children.entries()][0]!
      path = `${path}/${nseg}`
      name = `${name}/${nseg}`
      c = nchild
    }
    return { path, name, c }
  }
  function walkInto(node: ScmTreeNode, dir: Dir, prefix: string): void {
    const kids: ScmTreeNode[] = []
    const entries = [...dir.children.entries()].sort(([a], [b]) => a.localeCompare(b))
    for (const [seg, child] of entries) {
      const { path, name, c } = compact(seg, child, prefix)
      const n: ScmTreeNode = { path, name, isDir: true, depth: node.depth + 1, children: [] }
      kids.push(n)
      walkInto(n, c, path)
    }
    for (const f of dir.files) {
      kids.push({ path: f.f, name: scmNameOf(f.f), isDir: false, depth: node.depth + 1, file: f })
    }
    node.children = kids
  }
  const entries = [...root.children.entries()].sort(([a], [b]) => a.localeCompare(b))
  for (const [seg, child] of entries) {
    const { path, name, c } = compact(seg, child, '')
    const node: ScmTreeNode = { path, name, isDir: true, depth: 0, children: [] }
    out.push(node)
    walkInto(node, c, path)
  }
  for (const f of root.files) {
    out.push({ path: f.f, name: scmNameOf(f.f), isDir: false, depth: 0, file: f })
  }
  return out
}

// Phẳng hoá theo collapse; file con của dir đóng không render.
export function flattenScmTree(
  nodes: ScmTreeNode[],
  collapsed: ReadonlySet<string>,
): ScmTreeNode[] {
  const out: ScmTreeNode[] = []
  function visit(ns: ScmTreeNode[], depth: number) {
    for (const n of ns) {
      out.push({ ...n, depth })
      if (n.isDir && !collapsed.has(n.path) && n.children) visit(n.children, depth + 1)
    }
  }
  visit(nodes, 0)
  return out
}

// Flat mode: danh sách phẳng depth 0, không dir row.
export function scmFlatNodes(files: GitFile[]): ScmTreeNode[] {
  return files.map((f) => ({ path: f.f, name: scmNameOf(f.f), isDir: false, depth: 0, file: f }))
}

// Mọi file path con của node (dir → đệ quy, file → chính nó) — dùng cho
// stage/unstage/discard cả thư mục.
export function collectScmFiles(n: ScmTreeNode): string[] {
  if (!n.isDir) return n.file ? [n.file.f] : []
  const out: string[] = []
  const visit = (x: ScmTreeNode) => {
    if (!x.isDir) out.push(x.file!.f)
    else x.children?.forEach(visit)
  }
  visit(n)
  return out
}
