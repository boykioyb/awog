// Build a directory tree from a PR's flat changed-file list (like GitHub's "Files
// changed" sidebar). Single-child folder chains are compressed (a/b/c shown as one
// row) the way GitHub does, so deep nesting stays compact. Pure + sorted (dirs
// first, then files, alphabetical) so the render order is stable.

export type GhFileLeaf = { path: string; additions: number; deletions: number }

export type GhTreeFile = {
  type: 'file'
  name: string
  path: string
  additions: number
  deletions: number
}
export type GhTreeDir = { type: 'dir'; name: string; path: string; children: GhTreeNode[] }
export type GhTreeNode = GhTreeFile | GhTreeDir

type RawDir = { dirs: Map<string, RawDir>; files: GhTreeFile[]; path: string }

export function buildFileTree(files: readonly GhFileLeaf[]): GhTreeNode[] {
  const root: RawDir = { dirs: new Map(), files: [], path: '' }

  for (const f of files) {
    const parts = f.path.split('/')
    const fileName = parts.pop() ?? f.path
    let cur = root
    let acc = ''
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part
      let next = cur.dirs.get(part)
      if (!next) {
        next = { dirs: new Map(), files: [], path: acc }
        cur.dirs.set(part, next)
      }
      cur = next
    }
    cur.files.push({
      type: 'file',
      name: fileName,
      path: f.path,
      additions: f.additions,
      deletions: f.deletions,
    })
  }

  const toNodes = (dir: RawDir): GhTreeNode[] => {
    const out: GhTreeNode[] = []
    for (const name of [...dir.dirs.keys()].sort((a, b) => a.localeCompare(b))) {
      let d = dir.dirs.get(name)!
      let displayName = name
      // Compress a chain of single-child folders (no files, exactly one subdir).
      while (d.files.length === 0 && d.dirs.size === 1) {
        const [childName, childDir] = [...d.dirs.entries()][0]!
        displayName = `${displayName}/${childName}`
        d = childDir
      }
      out.push({ type: 'dir', name: displayName, path: d.path, children: toNodes(d) })
    }
    for (const f of [...dir.files].sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(f)
    }
    return out
  }

  return toNodes(root)
}
