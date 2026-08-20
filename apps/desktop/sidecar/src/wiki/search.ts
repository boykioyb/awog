// Wiki full-text search + backlinks (ADR 0073 D-6).
//
// Matching runs through `git grep --no-index` for the same reason fs.search does
// (methods/fs.search.ts): git's regex engine cannot catastrophically backtrack,
// so no user- or model-supplied query can ReDoS the single-threaded sidecar. The
// query is always passed as a FIXED string (`-F`) — a wiki search is a content
// lookup, not a regex facility, and `-F` removes the whole class of "why did
// `c++` return nothing" surprises.
//
// A wiki root is normally NOT a git repo, which is exactly what `--no-index`
// handles. When git is unavailable the search degrades to empty with a warning
// rather than falling back to a hand-rolled scan: the wiki is small enough that
// "search unavailable" is honest and rare, and a second engine would be a second
// set of bugs.

import { runGit } from '../git/runner.js'
import { log } from '../util/logger.js'
import { scanWiki } from './store.js'
import { backlinkNeedles, lineLinksTo } from './links.js'
import { globalWikiRoot, normaliseSlug, projectWikiRoot } from './paths.js'
import { loadProject } from '../projects/store.js'
import type { WikiPage, WikiSearchHit, WikiSource } from '../types/shared.js'

const GREP_TIMEOUT_MS = 15_000
const PREVIEW_CAP = 300
const DEFAULT_MAX_HITS = 100
const MAX_QUERY_CHARS = 500

interface RawHit {
  slug: string
  line: number
  text: string
}

function preview(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > PREVIEW_CAP ? `${trimmed.slice(0, PREVIEW_CAP)}…` : trimmed
}

// One `git grep` pass over a wiki root. Returns [] for "no matches" AND for
// "cannot search here" — callers treat both as no results.
async function grepRoot(
  root: string,
  needle: string,
  space: string | undefined,
  max: number,
): Promise<RawHit[]> {
  const args = ['grep', '--no-color', '-I', '-n', '--no-index', '-i', '-F', '-e', needle, '--']
  args.push(space ? `:(glob)${space}/**/*.md` : ':(glob)**/*.md')

  let res
  try {
    res = await runGit(root, args, { throwOnNonZero: false, timeoutMs: GREP_TIMEOUT_MS })
  } catch {
    return [] // git missing, or root does not exist yet
  }
  // git grep: 0 = matches, 1 = none, >1 = error / unusable path
  if (res.code !== 0) {
    if (res.code > 1) {
      log.warn('wiki: git grep unusable', { root, code: res.code })
    }
    return []
  }

  const hits: RawHit[] = []
  for (const raw of res.stdout.split('\n')) {
    if (raw === '') continue
    const m = raw.match(/^(.+?):(\d+):([\s\S]*)$/)
    if (!m) continue
    const path = m[1].startsWith('./') ? m[1].slice(2) : m[1]
    if (!path.toLowerCase().endsWith('.md')) continue
    hits.push({ slug: path.slice(0, -3), line: Number(m[2]), text: m[3] })
    if (hits.length >= max) break
  }
  return hits
}

async function rootsFor(
  projectIds: readonly string[],
): Promise<{ root: string; source: WikiSource; projectId?: string }[]> {
  const roots: { root: string; source: WikiSource; projectId?: string }[] = [
    { root: globalWikiRoot(), source: 'global' },
  ]
  for (const id of projectIds) {
    // eslint-disable-next-line no-await-in-loop
    const project = await loadProject(id)
    if (!project) continue
    roots.push({ root: projectWikiRoot(project.path), source: 'project', projectId: id })
  }
  return roots
}

export interface WikiSearchOptions {
  query: string
  projectIds?: readonly string[] | undefined
  space?: string | undefined
  max?: number | undefined
  // True = only pages the LLM may see (`context: true`). The `wiki_search` tool
  // sets this; the UI search does not (the user searches their own notes too).
  contextOnly?: boolean | undefined
  // Session whitelist (Session.wikiSpaces): drop hits outside these spaces so a
  // scoped session cannot search its way out of its own scope.
  spaces?: readonly string[] | undefined
}

export async function searchWiki(opts: WikiSearchOptions): Promise<WikiSearchHit[]> {
  const query = opts.query.trim().slice(0, MAX_QUERY_CHARS)
  if (!query) return []
  const max = opts.max ?? DEFAULT_MAX_HITS
  const projectIds = opts.projectIds ?? []
  const space = opts.space ? normaliseSlug(opts.space) : undefined

  // The scan gives titles + the context flag; grep gives the lines. Joining them
  // keeps the hit list useful (a path alone tells the reader little).
  const [{ pages }, roots] = await Promise.all([scanWiki(projectIds), rootsFor(projectIds)])
  const byKey = new Map<string, WikiPage>()
  for (const page of pages) byKey.set(`${page.source}:${page.projectId ?? ''}:${page.path}`, page)

  const hits: WikiSearchHit[] = []
  for (const entry of roots) {
    if (hits.length >= max) break
    // eslint-disable-next-line no-await-in-loop
    const raw = await grepRoot(entry.root, query, space, max - hits.length)
    for (const hit of raw) {
      const page = byKey.get(`${entry.source}:${entry.projectId ?? ''}:${hit.slug}`)
      if (!page) continue // _index.md / a file the scan skipped
      if (opts.contextOnly === true && !page.context) continue
      if (opts.spaces && opts.spaces.length > 0 && !opts.spaces.includes(page.space)) continue
      const out: WikiSearchHit = {
        path: page.path,
        source: page.source,
        title: page.title,
        line: hit.line,
        preview: preview(hit.text),
      }
      if (page.projectId) out.projectId = page.projectId
      hits.push(out)
      if (hits.length >= max) break
    }
  }
  return hits
}

// Pages linking TO `slug`, found by grepping for the two possible link forms and
// then confirming each hit resolves to this page (a prefix needle alone would
// count `[[data-flow-v2]]` as a link to `data-flow`).
export async function backlinksOf(
  slug: string,
  projectIds: readonly string[] = [],
): Promise<WikiPage[]> {
  const target = normaliseSlug(slug)
  const [{ pages }, roots] = await Promise.all([scanWiki(projectIds), rootsFor(projectIds)])
  const slugs = pages.map((p) => p.path)
  const byKey = new Map<string, WikiPage>()
  for (const page of pages) byKey.set(`${page.source}:${page.projectId ?? ''}:${page.path}`, page)

  const found = new Map<string, WikiPage>()
  for (const entry of roots) {
    for (const needle of backlinkNeedles(target)) {
      // eslint-disable-next-line no-await-in-loop
      const raw = await grepRoot(entry.root, needle, undefined, DEFAULT_MAX_HITS)
      for (const hit of raw) {
        if (hit.slug === target) continue // a page linking to itself is not a backlink
        const key = `${entry.source}:${entry.projectId ?? ''}:${hit.slug}`
        const page = byKey.get(key)
        if (!page || found.has(key)) continue
        if (!lineLinksTo(hit.text, target, hit.slug, slugs)) continue
        found.set(key, page)
      }
    }
  }
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path))
}
