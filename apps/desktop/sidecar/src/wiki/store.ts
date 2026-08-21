// Wiki persistence (ADR 0073). Two tiers of plain Markdown files:
//
//   global  → ~/.awog/wiki/<space>/**/*.md
//   project → {project.path}/.awog/wiki/<space>/**/*.md
//
// A page is a `.md` file; its `path` (slug) is the root-relative path without the
// extension. A space is a top-level folder; `<space>/_index.md` describes it and
// is NOT listed as a page. `source`/`projectId` are location-derived and never
// written into the file — a project wiki committed to a repo must not carry the
// machine-specific project id (same rule as rules/store.ts, ADR 0033).
//
// Scanning reads only the HEAD of each file (frontmatter + first lines) because
// the tree needs metadata, not content: a 2.000-page wiki must not mean reading
// 2.000 whole files on every refresh.

import { chmod, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { log } from '../util/logger.js'
import { RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'
import { parseFrontmatter, serializeFrontmatter } from '../skills/frontmatter.js'
import {
  MAX_SLUG_DEPTH,
  assertInsideWiki,
  globalWikiRoot,
  normaliseSlug,
  pageFile,
  projectWikiRoot,
  resolveWikiRoot,
} from './paths.js'
import type {
  WikiImportReport,
  WikiPage,
  WikiPageContent,
  WikiSource,
  WikiSpace,
  WikiTree,
} from '../types/shared.js'

// Metadata is parsed from this much of the file. Frontmatter + a first paragraph
// fit comfortably; a page whose frontmatter is longer than this falls back to
// heading/filename derivation rather than failing.
const SCAN_HEAD_BYTES = 8 * 1024
// Whole-file read cap (reader, editor, import, backlink scan).
const MAX_PAGE_BYTES = 1024 * 1024
// Total pages per wiki root — a backstop against an accidental import of a
// node_modules-sized tree.
const MAX_PAGES_PER_ROOT = 2000
const DESCRIPTION_CAP = 200
const SPACE_INDEX_FILE = '_index.md'
const IMPORT_EXTENSIONS = new Set(['.md', '.markdown', '.mdx', '.txt'])

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

function asString(value: string | string[] | undefined, fallback = ''): string {
  if (Array.isArray(value)) return value.join(', ')
  return value ?? fallback
}

function asStringArray(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
  return raw.map((s) => s.trim()).filter((s) => s.length > 0)
}

// Human-friendly fallback title: `data-flow` → `Data flow`.
function humanise(segment: string): string {
  const spaced = segment.replace(/[-_]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// First markdown heading of a body, if any.
function firstHeading(body: string): string {
  const m = body.match(/^#{1,6}\s+(.+)$/m)
  return m ? m[1].trim() : ''
}

// Strip inline markdown so a derived description reads as a sentence. It is shown
// verbatim in two places that cannot render markup — the reader's subtitle and the
// `<wiki_index>` line the model reads — so leaving `**bold**` and `[x](y)` in it
// looks broken in the UI and wastes prompt characters.
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, label) => label || target)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)[*_]([^*_]+)[*_]/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

// First line that reads like prose: not a heading, not a fence, not a table row,
// not an HTML comment. Used when frontmatter has no description — and the
// description is what the LLM index shows, so a decent guess matters.
function firstProseLine(body: string): string {
  let inFence = false
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('```') || line.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence || line === '') continue
    if (line.startsWith('#') || line.startsWith('<!--') || line.startsWith('|')) continue
    // A leading list marker, blockquote `>` or emphasis wrapper is formatting, not
    // content — an imported doc very often opens with `> summary line`.
    const text = stripInlineMarkdown(
      line
        .replace(/^>\s*/, '')
        .replace(/^[-*+]\s+/, '')
        .replace(/^\d+\.\s+/, ''),
    )
    if (text === '') continue
    return text.length > DESCRIPTION_CAP ? `${text.slice(0, DESCRIPTION_CAP)}…` : text
  }
  return ''
}

function spaceOf(slug: string): string {
  const idx = slug.indexOf('/')
  return idx === -1 ? '' : slug.slice(0, idx)
}

interface PageMeta {
  title: string
  description: string
  // See WikiPage.descriptionDerived.
  descriptionDerived: boolean
  tags: string[]
  context: boolean
}

function parsePageMeta(head: string, slug: string): PageMeta {
  const { data, body } = parseFrontmatter(head)
  const title =
    stripInlineMarkdown(asString(data.title)) ||
    stripInlineMarkdown(firstHeading(body)) ||
    humanise(basename(slug))
  // Flatten a FRONTMATTER description too, not just a derived one: it is displayed
  // verbatim in the reader subtitle and in the `<wiki_index>` line, and neither
  // renders markup — an imported page whose description says `**summary**` would
  // show the asterisks in the UI and waste them on the model.
  const explicit = stripInlineMarkdown(asString(data.description))
  const description = explicit || firstProseLine(body)
  return {
    title,
    description:
      description.length > DESCRIPTION_CAP
        ? `${description.slice(0, DESCRIPTION_CAP)}…`
        : description,
    descriptionDerived: explicit === '' && description !== '',
    tags: asStringArray(data.tags),
    // Only an explicit `false` hides a page from the LLM.
    context: asString(data.context, 'true').toLowerCase() !== 'false',
  }
}

async function readHead(file: string): Promise<string> {
  const handle = await open(file, 'r')
  try {
    const buf = Buffer.alloc(SCAN_HEAD_BYTES)
    const { bytesRead } = await handle.read(buf, 0, SCAN_HEAD_BYTES, 0)
    return buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

const isMarkdown = (name: string): boolean => extname(name).toLowerCase() === '.md'

interface ScanResult {
  pages: WikiPage[]
  // Space id → metadata parsed from `<space>/_index.md`.
  spaceMeta: Map<string, { title: string; description: string }>
}

// Walk one wiki root. Symlinks are skipped outright (cheapest possible defence
// against a link pointing out of the wiki) and hidden entries are ignored so a
// stray `.git` / `.DS_Store` never shows up as a page.
async function scanRoot(
  root: string,
  source: WikiSource,
  projectId: string | undefined,
): Promise<ScanResult> {
  const pages: WikiPage[] = []
  const spaceMeta = new Map<string, { title: string; description: string }>()
  const queue: { rel: string; depth: number }[] = [{ rel: '', depth: 0 }]

  while (queue.length > 0) {
    const { rel, depth } = queue.shift() as { rel: string; depth: number }
    let dirents
    try {
      // eslint-disable-next-line no-await-in-loop
      dirents = await readdir(rel ? join(root, rel) : root, { withFileTypes: true })
    } catch (err) {
      if (!isMissing(err)) {
        log.warn('wiki: readdir failed', {
          dir: rel,
          err: err instanceof Error ? err.message : String(err),
        })
      }
      continue
    }

    for (const dirent of dirents) {
      if (pages.length >= MAX_PAGES_PER_ROOT) break
      const { name } = dirent
      if (name.startsWith('.') || dirent.isSymbolicLink()) continue
      const childRel = rel ? `${rel}/${name}` : name

      if (dirent.isDirectory()) {
        if (depth + 1 < MAX_SLUG_DEPTH) queue.push({ rel: childRel, depth: depth + 1 })
        continue
      }
      if (!dirent.isFile() || !isMarkdown(name)) continue

      const abs = join(root, childRel)
      let st
      let head: string
      try {
        // eslint-disable-next-line no-await-in-loop
        st = await stat(abs)
        // eslint-disable-next-line no-await-in-loop
        head = await readHead(abs)
      } catch (err) {
        log.warn('wiki: failed to read page head', {
          file: childRel,
          err: err instanceof Error ? err.message : String(err),
        })
        continue
      }

      // `_index.md` IS its folder's page (Notion shape: a parent is also readable),
      // so its slug is the FOLDER path, not `<folder>/_index`. At depth 1 it doubles
      // as the space's title/description. A folder page whose `<folder>.md` sibling
      // already exists loses to that sibling — one slug, one file.
      let slug = childRel.slice(0, -3)
      if (name === SPACE_INDEX_FILE && rel !== '') {
        const meta = parsePageMeta(head, rel)
        if (depth === 1) {
          spaceMeta.set(rel, { title: meta.title || humanise(rel), description: meta.description })
        }
        if (pages.some((p) => p.path === rel)) continue
        slug = rel
      }

      const meta = parsePageMeta(head, slug)
      const page: WikiPage = {
        path: slug,
        source,
        // A top-level folder page (`<space>/_index.md` → slug `<space>`) belongs to
        // the space it introduces; spaceOf() would say '' because there is no '/'.
        space: slug.includes('/') ? spaceOf(slug) : slug === rel ? slug : spaceOf(slug),
        title: meta.title,
        description: meta.description,
        tags: meta.tags,
        context: meta.context,
        bytes: st.size,
        updatedAt: st.mtimeMs,
        ...(meta.descriptionDerived ? { descriptionDerived: true } : {}),
      }
      if (projectId) page.projectId = projectId
      pages.push(page)
    }
  }

  return { pages, spaceMeta }
}

// Roots to consider for a given set of projects: the global wiki plus one per
// project. Missing dirs are fine — scanRoot yields nothing for them.
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

export async function scanWiki(projectIds: readonly string[] = []): Promise<WikiTree> {
  const roots = await rootsFor(projectIds)
  const scans = await Promise.all(
    roots.map(async (entry) => ({ entry, result: await scanRoot(entry.root, entry.source, entry.projectId) })),
  )

  const pages: WikiPage[] = []
  const spaces: WikiSpace[] = []
  const reports: WikiTree['reports'] = []

  for (const { entry, result } of scans) {
    pages.push(...result.pages)
    const report: WikiTree['reports'][number] = {
      dir: entry.root,
      source: entry.source,
      found: result.pages.length,
    }
    if (entry.projectId) report.projectId = entry.projectId
    reports.push(report)

    // A space exists when at least one page sits under it. Root-level pages
    // (space '') are listed by the UI without a space header.
    const counts = new Map<string, number>()
    for (const page of result.pages) {
      if (page.space === '') continue
      counts.set(page.space, (counts.get(page.space) ?? 0) + 1)
    }
    for (const [id, pageCount] of counts) {
      const meta = result.spaceMeta.get(id)
      const space: WikiSpace = {
        id,
        source: entry.source,
        title: meta?.title || humanise(id),
        description: meta?.description ?? '',
        pageCount,
      }
      if (entry.projectId) space.projectId = entry.projectId
      spaces.push(space)
    }
  }

  pages.sort((a, b) => a.path.localeCompare(b.path))
  spaces.sort((a, b) => a.id.localeCompare(b.id))
  return { spaces, pages, reports }
}

// Read one page. `raw` is the file verbatim (what the editor saves back); `body`
// is the content below the frontmatter (what the reader renders and what the
// `wiki_read` tool hands the model).
interface ResolvedPageFile {
  file: string
  // True when the page lives in `<slug>/_index.md` rather than `<slug>.md`.
  isFolderIndex: boolean
}

async function resolvePageFile(root: string, slug: string): Promise<ResolvedPageFile | null> {
  const direct = pageFile(root, slug)
  const exists = await stat(direct).then(
    () => true,
    () => false,
  )
  if (exists) return { file: direct, isFolderIndex: false }
  const folderIndex = join(root, normaliseSlug(slug), SPACE_INDEX_FILE)
  const indexExists = await stat(folderIndex).then(
    () => true,
    () => false,
  )
  return indexExists ? { file: folderIndex, isFolderIndex: true } : null
}

export async function readWikiPage(
  source: WikiSource,
  projectId: string | undefined,
  slug: string,
): Promise<WikiPageContent> {
  const root = await resolveWikiRoot(source, projectId)
  const resolved = await resolvePageFile(root, slug)
  if (!resolved) throw new RpcError(-32602, `Wiki page not found: ${slug}`)
  const { file } = resolved
  await assertInsideWiki(root, file, true)
  const st = await stat(file)

  const raw = await readFile(file, 'utf8')
  const truncated = raw.length > MAX_PAGE_BYTES
  const kept = truncated ? raw.slice(0, MAX_PAGE_BYTES) : raw
  const { body } = parseFrontmatter(kept)
  const meta = parsePageMeta(kept.slice(0, SCAN_HEAD_BYTES), normaliseSlug(slug))

  const page: WikiPage = {
    path: normaliseSlug(slug),
    source,
    space: spaceOf(normaliseSlug(slug)),
    title: meta.title,
    description: meta.description,
    tags: meta.tags,
    context: meta.context,
    bytes: st.size,
    updatedAt: st.mtimeMs,
    ...(meta.descriptionDerived ? { descriptionDerived: true } : {}),
  }
  if (projectId) page.projectId = projectId
  return { page, raw: kept, body, truncated }
}

// Optional fields spell out `| undefined` because the sidecar runs with
// `exactOptionalPropertyTypes` and these objects come straight from a zod parse.
export interface SaveWikiPageInput {
  source: WikiSource
  projectId?: string | undefined
  path: string
  title: string
  description?: string | undefined
  tags?: string[] | undefined
  context?: boolean | undefined
  body: string
  // Create-only: fail instead of overwriting an existing page.
  mode?: 'create' | 'update' | undefined
}

async function writeAtomic(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, content, 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

export async function saveWikiPage(input: SaveWikiPageInput): Promise<WikiPage> {
  const slug = normaliseSlug(input.path)
  const root = await resolveWikiRoot(input.source, input.projectId)
  // Write back to whichever file already holds this slug: editing a space's intro
  // page must update `<space>/_index.md`, not create a rival `<space>.md`.
  const resolved = await resolvePageFile(root, slug)
  const file = resolved?.file ?? pageFile(root, slug)
  await assertInsideWiki(root, file, false)

  if (input.mode === 'create' && resolved) {
    throw new RpcError(-32602, `Wiki page already exists: ${slug}`)
  }

  const content = serializeFrontmatter(
    {
      title: input.title,
      description: input.description ?? '',
      ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
      // Persist only the non-default value: `context: true` is the default, so
      // writing it would add noise to every file.
      ...(input.context === false ? { context: 'false' } : {}),
    },
    input.body ?? '',
  )
  await writeAtomic(file, content)

  const st = await stat(file)
  const page: WikiPage = {
    path: slug,
    source: input.source,
    space: spaceOf(slug),
    title: input.title,
    description: input.description ?? '',
    tags: input.tags ?? [],
    context: input.context !== false,
    bytes: st.size,
    updatedAt: st.mtimeMs,
  }
  if (input.projectId) page.projectId = input.projectId
  return page
}

export async function deleteWikiPage(
  source: WikiSource,
  projectId: string | undefined,
  slug: string,
): Promise<void> {
  const root = await resolveWikiRoot(source, projectId)
  const resolved = await resolvePageFile(root, slug)
  if (!resolved) return // already gone
  await assertInsideWiki(root, resolved.file, true)
  try {
    await rm(resolved.file)
  } catch (err) {
    if (!isMissing(err)) throw err
  }
}

export async function moveWikiPage(
  source: WikiSource,
  projectId: string | undefined,
  from: string,
  to: string,
): Promise<WikiPage> {
  const root = await resolveWikiRoot(source, projectId)
  const resolvedFrom = await resolvePageFile(root, from)
  if (!resolvedFrom) throw new RpcError(-32602, `Wiki page not found: ${normaliseSlug(from)}`)
  const fromFile = resolvedFrom.file
  // Renaming a folder-index page keeps it an index of the DESTINATION folder, so the
  // moved page stays the parent it was instead of becoming a stray sibling.
  const toFile = resolvedFrom.isFolderIndex
    ? join(root, normaliseSlug(to), SPACE_INDEX_FILE)
    : pageFile(root, to)
  await assertInsideWiki(root, fromFile, true)
  await assertInsideWiki(root, toFile, false)

  const clash = await stat(toFile).then(
    () => true,
    () => false,
  )
  if (clash) throw new RpcError(-32602, `Wiki page already exists: ${normaliseSlug(to)}`)

  // A page can have children (`adr.md` + `adr/`, or a folder index + its folder).
  // Renaming the page has to carry the SUBTREE, or the children silently detach into
  // a folder named after the old title — the parent disappears from above them and
  // every `[[link]]` into the branch breaks at once.
  const fromDir = join(root, normaliseSlug(from))
  const toDir = join(root, normaliseSlug(to))
  const hasChildren = await stat(fromDir).then(
    (st) => st.isDirectory(),
    () => false,
  )
  if (hasChildren) {
    const dirClash = await stat(toDir).then(
      () => true,
      () => false,
    )
    if (dirClash) {
      throw new RpcError(-32602, `A wiki folder already exists at ${normaliseSlug(to)}`)
    }
    await assertInsideWiki(root, toDir, false)
    await mkdir(dirname(toDir), { recursive: true, mode: 0o700 })
    await rename(fromDir, toDir)
    // The folder move already carried a folder-index page with it.
    if (!resolvedFrom.isFolderIndex) {
      await mkdir(dirname(toFile), { recursive: true, mode: 0o700 })
      await rename(fromFile, toFile)
    }
  } else {
    await mkdir(dirname(toFile), { recursive: true, mode: 0o700 })
    await rename(fromFile, toFile)
  }
  const { page } = await readWikiPage(source, projectId, to)
  return page
}

// Delete a whole space (folder) and every page under it.
export async function deleteWikiSpace(
  source: WikiSource,
  projectId: string | undefined,
  space: string,
): Promise<void> {
  const root = await resolveWikiRoot(source, projectId)
  const dir = resolve(root, normaliseSlug(space))
  await assertInsideWiki(root, dir, true)
  await rm(dir, { recursive: true, force: true })
}

// ─── Import ──────────────────────────────────────────────────────────────────
// The one place AWOG reads files the user picked from ANYWHERE on disk (OS
// dialog / drag-drop) — a deliberate, consent-scoped exception to the
// workspace-only read rule (ADR 0073 D-8). Everything read here is copied in
// once; nothing is read through at turn time. Guards: extension allowlist, size
// cap, page cap, symlinks refused.

// Turn an arbitrary filename into a slug segment: lowercase, spaces/underscores
// to dashes, anything exotic dropped. Returns '' when nothing usable survives.
function slugifySegment(name: string): string {
  const base = name.replace(/\.(md|markdown|mdx|txt)$/i, '')
  const slug = base
    .normalize('NFKD')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/[.-]+$/, '')
    .toLowerCase()
  return slug
}

interface ImportCandidate {
  abs: string
  // Slug segments relative to the import root (already slugified).
  segments: string[]
}

// Collect importable files from one picked path. A directory is walked (depth
// capped); a file is taken as-is.
async function collectCandidates(
  abs: string,
  segments: string[],
  depth: number,
  out: ImportCandidate[],
  skipped: WikiImportReport['skipped'],
): Promise<void> {
  let st
  try {
    st = await stat(abs)
  } catch {
    skipped.push({ name: basename(abs), reason: 'unreadable' })
    return
  }

  if (st.isDirectory()) {
    if (depth >= MAX_SLUG_DEPTH) {
      skipped.push({ name: basename(abs), reason: 'too-deep' })
      return
    }
    let dirents
    try {
      dirents = await readdir(abs, { withFileTypes: true })
    } catch {
      skipped.push({ name: basename(abs), reason: 'unreadable' })
      return
    }
    for (const dirent of dirents) {
      if (dirent.name.startsWith('.') || dirent.isSymbolicLink()) continue
      // Only a DIRECTORY contributes a segment here. The file's own name is
      // appended once by the caller (importWikiDocs) — adding it here too produced
      // `imported/nested/deep-note/deep-note`.
      if (!dirent.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await collectCandidates(join(abs, dirent.name), segments, depth + 1, out, skipped)
        continue
      }
      const seg = slugifySegment(dirent.name)
      if (!seg) {
        skipped.push({ name: dirent.name, reason: 'bad-name' })
        continue
      }
      // eslint-disable-next-line no-await-in-loop
      await collectCandidates(join(abs, dirent.name), [...segments, seg], depth + 1, out, skipped)
    }
    return
  }

  if (!st.isFile()) {
    skipped.push({ name: basename(abs), reason: 'not-a-file' })
    return
  }
  if (!IMPORT_EXTENSIONS.has(extname(abs).toLowerCase())) {
    skipped.push({ name: basename(abs), reason: 'unsupported-type' })
    return
  }
  if (st.size > MAX_PAGE_BYTES) {
    skipped.push({ name: basename(abs), reason: 'too-large' })
    return
  }
  out.push({ abs, segments })
}

export interface ImportWikiInput {
  source: WikiSource
  projectId?: string | undefined
  // Space the files land in. Empty = the wiki root.
  space?: string | undefined
  paths: string[]
  overwrite?: boolean | undefined
}

export async function importWikiDocs(input: ImportWikiInput): Promise<WikiImportReport> {
  const root = await resolveWikiRoot(input.source, input.projectId)
  const report: WikiImportReport = { imported: [], skipped: [] }
  const candidates: ImportCandidate[] = []

  for (const picked of input.paths) {
    if (!picked || typeof picked !== 'string') continue
    const abs = resolve(picked)
    const seg = slugifySegment(basename(abs))
    if (!seg) {
      report.skipped.push({ name: basename(abs), reason: 'bad-name' })
      continue
    }
    // A picked FILE keeps only its own name; a picked FOLDER contributes its name
    // as a slug segment so the tree structure survives the copy.
    // eslint-disable-next-line no-await-in-loop
    const st = await stat(abs).catch(() => null)
    if (!st) {
      report.skipped.push({ name: basename(abs), reason: 'unreadable' })
      continue
    }
    // eslint-disable-next-line no-await-in-loop
    await collectCandidates(abs, st.isDirectory() ? [seg] : [], 0, candidates, report.skipped)
  }

  const existing = (await scanRoot(root, input.source, input.projectId)).pages.length
  const space = input.space ? normaliseSlug(input.space) : ''

  for (const candidate of candidates) {
    if (existing + report.imported.length >= MAX_PAGES_PER_ROOT) {
      report.skipped.push({ name: basename(candidate.abs), reason: 'page-cap' })
      continue
    }
    const fileSeg = slugifySegment(basename(candidate.abs))
    if (!fileSeg) {
      report.skipped.push({ name: basename(candidate.abs), reason: 'bad-name' })
      continue
    }
    const segments = [...(space ? [space] : []), ...candidate.segments, fileSeg]
    let slug: string
    let dest: string
    try {
      slug = normaliseSlug(segments.join('/'))
      dest = pageFile(root, slug)
      // eslint-disable-next-line no-await-in-loop
      await assertInsideWiki(root, dest, false)
    } catch (err) {
      report.skipped.push({
        name: basename(candidate.abs),
        reason: err instanceof RpcError ? 'bad-path' : 'error',
      })
      continue
    }

    // eslint-disable-next-line no-await-in-loop
    const clash = await stat(dest).then(
      () => true,
      () => false,
    )
    if (clash && input.overwrite !== true) {
      report.skipped.push({ name: slug, reason: 'exists' })
      continue
    }

    try {
      // Copy VERBATIM: an imported document keeps its own frontmatter/heading, and
      // scanning derives title/description from them. Re-serialising here would
      // silently rewrite the user's file.
      // eslint-disable-next-line no-await-in-loop
      const content = await readFile(candidate.abs, 'utf8')
      // eslint-disable-next-line no-await-in-loop
      await writeAtomic(dest, content.length > MAX_PAGE_BYTES ? content.slice(0, MAX_PAGE_BYTES) : content)
      report.imported.push(slug)
    } catch (err) {
      log.warn('wiki: import copy failed', {
        file: candidate.abs,
        err: err instanceof Error ? err.message : String(err),
      })
      report.skipped.push({ name: basename(candidate.abs), reason: 'copy-failed' })
    }
  }

  return report
}
