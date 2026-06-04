/**
 * Pure logic: build a folder tree from a flat list of items keyed by `path`,
 * collapsing single-child directory chains (a/b/c → one "a/b/c" row), and
 * flatten into render rows. Used by the Git Changes list (tree view) and any
 * other file-path list that wants folder grouping.
 *
 * No Vue / Pinia / DOM dependency — data transform only.
 */

// ─── Row types ────────────────────────────────────────────────────────────
export type PathTreeDirRow = {
  kind: 'dir'
  id: string
  path: string
  label: string
  depth: number
}
export type PathTreeFileRow<T> = {
  kind: 'file'
  id: string
  path: string
  label: string
  depth: number
  item: T
}
export type PathTreeRow<T> = PathTreeDirRow | PathTreeFileRow<T>

type RawNode<T> = {
  name: string
  fullPath: string
  files: T[]
  children: Map<string, RawNode<T>>
}

const leafName = (p: string): string => p.split('/').at(-1) ?? p

/**
 * Flatten `items` into dir/file rows. Directories in `collapsed` (by their
 * full path) are not descended into. Sort: dirs first (alpha), then files (alpha).
 */
export function buildPathTreeRows<T extends { path: string }>(
  items: readonly T[],
  collapsed: ReadonlySet<string>,
): PathTreeRow<T>[] {
  const root: RawNode<T> = { name: '', fullPath: '', files: [], children: new Map() }
  items.forEach((item) => {
    const segs = item.path.split('/')
    let cur = root
    for (let i = 0; i < segs.length - 1; i += 1) {
      const seg = segs[i]!
      let next = cur.children.get(seg)
      if (!next) {
        const prefix = cur.fullPath ? `${cur.fullPath}/${seg}` : seg
        next = { name: seg, fullPath: prefix, files: [], children: new Map() }
        cur.children.set(seg, next)
      }
      cur = next
    }
    cur.files.push(item)
  })

  const rows: PathTreeRow<T>[] = []
  const walk = (node: RawNode<T>, depth: number): void => {
    const subDirs = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name))
    const files = [...node.files].sort((a, b) => leafName(a.path).localeCompare(leafName(b.path)))

    subDirs.forEach((dir) => {
      // Collapse single-child dir chains: a dir with exactly 1 sub-dir and no
      // files merges with its child as one "a/b" row.
      let cur = dir
      let label = cur.name
      let dirPath = cur.fullPath
      while (cur.children.size === 1 && cur.files.length === 0) {
        const [onlyChild] = [...cur.children.values()]
        if (!onlyChild) break
        cur = onlyChild
        label = `${label}/${cur.name}`
        dirPath = cur.fullPath
      }
      rows.push({ kind: 'dir', id: `d:${dirPath}`, path: dirPath, label, depth })
      if (!collapsed.has(dirPath)) walk(cur, depth + 1)
    })

    files.forEach((item) => {
      rows.push({
        kind: 'file',
        id: `f:${item.path}`,
        path: item.path,
        label: leafName(item.path),
        depth,
        item,
      })
    })
  }
  walk(root, 0)
  return rows
}
