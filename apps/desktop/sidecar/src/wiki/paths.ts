// Wiki path resolution + slug sanitisation (ADR 0073).
//
// A wiki lives OUTSIDE the session workspace (`~/.awog/wiki`), so it cannot
// reuse git/path-sanitize.ts#assertInsideWorkspace — that guard is bound to the
// workspace root. This module is the wiki's own counterpart of it: every path
// that reaches the filesystem is composed from a validated slug and re-checked
// against the wiki root, symlinks included.
//
// Slugs are L1-untrusted: they arrive from the UI, from a `[[wikilink]]` inside
// an imported document, and from the model via the `wiki_read` tool.

import { realpath } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { awogHome } from '../util/path.js'
import { loadProject } from '../projects/store.js'
import { RpcError } from '../transport/rpc.js'
import type { WikiSource } from '../types/shared.js'

const WIKI_DIR_NAME = 'wiki'

// Cap nesting so a pathological import (or a symlink loop that survived the
// escape check) cannot produce an unbounded tree. Matches the scan-depth cap.
export const MAX_SLUG_DEPTH = 5
const MAX_SLUG_CHARS = 400

export function globalWikiRoot(): string {
  return join(awogHome(), WIKI_DIR_NAME)
}

export function projectWikiRoot(projectPath: string): string {
  return join(projectPath, '.awog', WIKI_DIR_NAME)
}

export async function resolveWikiRoot(
  source: WikiSource,
  projectId: string | undefined,
): Promise<string> {
  if (source === 'global') return globalWikiRoot()
  if (!projectId) throw new RpcError(-32602, 'Project wiki requires a projectId')
  const project = await loadProject(projectId)
  if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
  return projectWikiRoot(project.path)
}

// Normalise a page slug to its canonical form: forward slashes, no `.md`
// extension, no leading/trailing separator. Throws on anything that could
// escape the wiki root or reach a dotfile.
export function normaliseSlug(input: string): string {
  const raw = String(input ?? '').trim()
  if (!raw) throw new RpcError(-32602, 'Wiki path is empty')
  if (raw.length > MAX_SLUG_CHARS) throw new RpcError(-32602, 'Wiki path is too long')
  if (raw.includes('\0')) throw new RpcError(-32602, 'Wiki path contains a null byte')
  // An ABSOLUTE path is refused, not rewritten. Stripping the leading '/' would
  // silently turn `/etc/passwd` into the wiki page `etc/passwd` — it never escapes
  // the root, but quietly answering a different question than the caller asked is
  // exactly the surprise this guard exists to prevent.
  if (raw.startsWith('/') || raw.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(raw)) {
    throw new RpcError(-32602, 'Wiki path must be relative to the wiki root')
  }

  // Accept both separators on input (a Windows-authored link, a pasted path) but
  // canonicalise to '/', then strip the extension callers may have included.
  let slug = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  slug = slug.replace(/\.(md|markdown|mdx)$/i, '')
  const segments = slug.split('/').filter((s) => s !== '')
  if (segments.length === 0) throw new RpcError(-32602, 'Wiki path is empty')
  if (segments.length > MAX_SLUG_DEPTH) {
    throw new RpcError(-32602, `Wiki path is nested deeper than ${MAX_SLUG_DEPTH} levels`)
  }
  for (const segment of segments) {
    // `..` is the obvious traversal; a bare `.` normalises away to the parent
    // itself; a leading dot would reach `.git`/`.DS_Store` and friends.
    if (segment === '.' || segment === '..' || segment.startsWith('.')) {
      throw new RpcError(-32602, `Illegal wiki path segment: ${segment}`)
    }
  }
  return segments.join('/')
}

export function pageFile(root: string, slug: string): string {
  return resolve(root, `${normaliseSlug(slug)}.md`)
}

function within(path: string, root: string): boolean {
  return path === root || path.startsWith(root + sep)
}

// Confirm `abs` really sits inside `root` after symlinks are followed. `mustExist
// = false` checks the PARENT directory instead, which is what a create/write
// needs (the file itself does not exist yet). A root that does not exist yet is
// fine — nothing can be reached through it.
export async function assertInsideWiki(
  root: string,
  abs: string,
  mustExist: boolean,
): Promise<void> {
  if (!within(resolve(abs), resolve(root))) {
    throw new RpcError(-32602, 'Wiki path escapes the wiki root')
  }
  let realRoot: string
  try {
    realRoot = await realpath(root)
  } catch {
    return // root not created yet → no symlink can lead out of it
  }
  const target = mustExist ? abs : dirname(abs)
  let real: string
  try {
    real = await realpath(target)
  } catch {
    // Missing target: for a write, the parent chain is created by mkdir under
    // the already-verified root, so the lexical check above is the guarantee.
    return
  }
  if (!within(real, realRoot)) {
    throw new RpcError(-32602, 'Wiki path escapes the wiki root via a symlink')
  }
}
