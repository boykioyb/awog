// Remote Project Template fetch — ADR 0037. Pulls one or more template bundles
// out of a *public* GitHub folder and writes them into ~/.awog/templates/, from
// where they install exactly like a locally-exported template (ADR 0036).
//
// Manifest-driven: every bundle MUST contain a template.json (no entity-kind
// guessing). The URL may point at a single bundle folder, OR at a "registry"
// folder holding several bundle subfolders (one template.json each, one level
// deep) — mirroring the on-disk ~/.awog/templates/ layout.
//
// Security (security.md invariants):
//  #7 SSRF  — only api.github.com / raw.githubusercontent.com are contacted;
//             ssrfCheck() + an explicit host allowlist gate every request, and
//             the post-redirect host is re-checked.
//  #2 Path  — every written path is split through sanitizeChild() (rejects `..`
//             and separators) and isInside()-guarded against the template dir.
//  L1       — the manifest + every file are untrusted: zod-validated, JSON parse
//             guarded, and capped by file/total size + file count.
// Installed hooks still land untrusted (no .trust.json) via the normal install
// path. Templates never carry secret values — only ${secret:KEY} refs.

import { mkdir, writeFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import { ssrfCheck } from '../mcp/http-client.js'
import { sanitizeChild } from '../util/path.js'
import { getTemplate, isInside, manifestFile, slugify, templateDir } from './store.js'
import type { ProjectTemplate, TemplateEntityRef, TemplateFetchResult } from '../types/shared.js'

const API_HOST = 'api.github.com'
const RAW_HOST = 'raw.githubusercontent.com'
// Initial request hosts (exact). The post-redirect host may also be
// *.githubusercontent.com (raw 302s large blobs to objects.githubusercontent.com).
const ALLOWED_INITIAL_HOSTS = new Set([API_HOST, RAW_HOST])

// Caps for untrusted remote content. Aggregate across all bundles in one fetch.
const MAX_FILE_BYTES = 1024 * 1024 // 1 MB per file
const MAX_TOTAL_BYTES = 20 * 1024 * 1024 // 20 MB total
const MAX_FILES = 500
const MAX_MANIFEST_BYTES = 256 * 1024 // 256 KB
const FETCH_TIMEOUT_MS = 20_000
const MANIFEST_NAME = 'template.json'

const ManifestSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  entities: z
    .array(
      z.object({
        kind: z.enum(['agent', 'skill', 'hook', 'rule', 'command']),
        id: z.string().min(1).max(256),
        file: z.string().min(1).max(1024),
      }),
    )
    .max(MAX_FILES),
})
type RemoteManifest = z.infer<typeof ManifestSchema>

interface RepoRef {
  owner: string
  repo: string
  ref: string // branch / tag / sha (single segment)
  dirPath: string // folder within the repo, '' = root, no leading/trailing slash
}

interface TreeEntry {
  path: string
  type: string
  size?: number
}

// One file resolved for download (during the plan phase).
interface PlannedFile {
  repoPath: string // path within the repo
  relPath: string // path within the bundle (= local write path)
  size: number
}

interface PlannedBundle {
  localId: string
  name: string
  description: string
  entities: TemplateEntityRef[]
  files: PlannedFile[]
  overwriteExisting: boolean
}

// ─── URL parsing ────────────────────────────────────────────────────────────

function badUrl(reason: string): RpcError {
  return new RpcError(-32602, `Invalid GitHub template URL: ${reason}`)
}

const SEGMENT_RE = /^[A-Za-z0-9._-]+$/
const PATH_RE = /^[A-Za-z0-9._/-]+$/

// Parse a github.com folder URL into its parts. Accepts:
//   https://github.com/<owner>/<repo>                         (repo root)
//   https://github.com/<owner>/<repo>/tree/<ref>              (branch root)
//   https://github.com/<owner>/<repo>/tree/<ref>/<dir...>     (a folder)
function parseGithubUrl(rawUrl: string): RepoRef {
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    throw badUrl('not a URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw badUrl('use http(s)')
  if (url.hostname.toLowerCase() !== 'github.com') throw badUrl('only github.com links are supported')

  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2) throw badUrl('expected github.com/<owner>/<repo>/…')

  const owner = parts[0]
  let repo = parts[1]
  if (repo.endsWith('.git')) repo = repo.slice(0, -4)

  let ref = ''
  let dirPath = ''
  if (parts.length >= 3) {
    if (parts[2] !== 'tree') throw badUrl('expected a /tree/<branch>/<folder> link')
    if (parts.length < 4) throw badUrl('missing branch after /tree/')
    ref = decodeURIComponent(parts[3])
    dirPath = parts
      .slice(4)
      .map((p) => decodeURIComponent(p))
      .join('/')
  }

  if (!SEGMENT_RE.test(owner) || !SEGMENT_RE.test(repo)) throw badUrl('bad owner/repo')
  if (ref && (!SEGMENT_RE.test(ref) || ref.includes('..')))
    throw badUrl('unsupported branch — use a single-segment name (no "/")')
  if (owner.includes('..') || repo.includes('..')) throw badUrl('bad owner/repo')
  if (dirPath && (!PATH_RE.test(dirPath) || dirPath.includes('..')))
    throw badUrl('bad folder path')

  return { owner, repo, ref, dirPath }
}

// ─── HTTP (allowlisted, capped) ────────────────────────────────────────────

function isGithubContentHost(host: string): boolean {
  const h = host.toLowerCase()
  return h === API_HOST || h === 'github.com' || h.endsWith('.githubusercontent.com')
}

function assertInitialHostAllowed(urlStr: string): void {
  const guard = ssrfCheck(urlStr)
  if (!guard.ok) throw new RpcError(-32010, `blocked URL: ${guard.reason}`)
  const host = new URL(urlStr).hostname.toLowerCase()
  if (!ALLOWED_INITIAL_HOSTS.has(host)) throw new RpcError(-32010, `host not allowed: ${host}`)
}

async function httpGet(urlStr: string, accept: string): Promise<Response> {
  assertInitialHostAllowed(urlStr)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(urlStr, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { Accept: accept, 'User-Agent': 'AWOG-template-fetch' },
    })
  } catch (err) {
    throw new RpcError(-32011, `network error: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timer)
  }
  // Defense in depth: a redirect must not have escaped GitHub.
  const finalHost = (() => {
    try {
      return new URL(res.url || urlStr).hostname
    } catch {
      return ''
    }
  })()
  if (finalHost && !isGithubContentHost(finalHost))
    throw new RpcError(-32010, `redirected to disallowed host: ${finalHost}`)
  return res
}

async function readCapped(res: Response, max: number, label: string): Promise<Buffer> {
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > max)
    throw new RpcError(-32014, `${label} too large (${buf.byteLength} > ${max} bytes)`)
  return buf
}

function rawUrl(ref: RepoRef, repoPath: string): string {
  const encPath = repoPath.split('/').map(encodeURIComponent).join('/')
  return `https://${RAW_HOST}/${ref.owner}/${ref.repo}/${encodeURIComponent(ref.ref)}/${encPath}`
}

// ─── GitHub API calls ────────────────────────────────────────────────────────

async function resolveDefaultBranch(ref: RepoRef): Promise<string> {
  const url = `https://${API_HOST}/repos/${ref.owner}/${ref.repo}`
  const res = await httpGet(url, 'application/vnd.github+json')
  if (res.status === 404) throw new RpcError(-32012, 'repo not found (is it public?)')
  if (!res.ok) throw new RpcError(-32012, `cannot read repo (HTTP ${res.status})`)
  const body = (await res.json()) as { default_branch?: string }
  if (!body.default_branch) throw new RpcError(-32012, 'cannot determine default branch')
  return body.default_branch
}

async function fetchTree(ref: RepoRef): Promise<TreeEntry[]> {
  const url = `https://${API_HOST}/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(
    ref.ref,
  )}?recursive=1`
  const res = await httpGet(url, 'application/vnd.github+json')
  if (res.status === 404) throw new RpcError(-32012, 'repo or branch not found (is it public?)')
  if (res.status === 403)
    throw new RpcError(-32012, 'GitHub rejected the request (rate limit or private repo)')
  if (!res.ok) throw new RpcError(-32012, `GitHub API error (HTTP ${res.status})`)
  const body = (await res.json()) as { tree?: TreeEntry[]; truncated?: boolean }
  if (body.truncated)
    throw new RpcError(-32012, 'repo tree too large — point the link at a more specific folder')
  return Array.isArray(body.tree) ? body.tree : []
}

async function fetchManifest(ref: RepoRef, bundleDir: string): Promise<RemoteManifest> {
  const path = bundleDir ? `${bundleDir}/${MANIFEST_NAME}` : MANIFEST_NAME
  const res = await httpGet(rawUrl(ref, path), 'application/json')
  if (!res.ok) throw new RpcError(-32012, `cannot read ${path} (HTTP ${res.status})`)
  const buf = await readCapped(res, MAX_MANIFEST_BYTES, path)
  let json: unknown
  try {
    json = JSON.parse(buf.toString('utf8'))
  } catch {
    throw new RpcError(-32013, `${path} is not valid JSON`)
  }
  const parsed = ManifestSchema.safeParse(json)
  if (!parsed.success)
    throw new RpcError(
      -32013,
      `${path} is not a valid template manifest: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
    )
  return parsed.data
}

// ─── Bundle discovery + planning ───────────────────────────────────────────

function repoPrefix(bundleDir: string): string {
  return bundleDir ? `${bundleDir}/` : ''
}

// Folders under `dirPath` that hold a template.json: either dirPath itself
// (single bundle) or a child one level deep (registry).
function discoverBundleDirs(tree: TreeEntry[], dirPath: string): string[] {
  const prefix = repoPrefix(dirPath)
  const dirs = new Set<string>()
  for (const e of tree) {
    if (e.type !== 'blob' || !e.path.startsWith(prefix)) continue
    const rel = e.path.slice(prefix.length)
    if (rel === MANIFEST_NAME) {
      dirs.add(dirPath)
    } else if (rel.endsWith(`/${MANIFEST_NAME}`)) {
      const sub = rel.slice(0, -(MANIFEST_NAME.length + 1))
      if (!sub.includes('/')) dirs.add(dirPath ? `${dirPath}/${sub}` : sub)
    }
  }
  return [...dirs]
}

function safeRelPath(relPath: string): boolean {
  if (!relPath || relPath.includes('..')) return false
  return relPath.split('/').every((seg) => seg.length > 0 && seg !== '.' && seg !== '..')
}

// Resolve one manifest's entities to concrete files using the repo tree. An
// entity whose `file` is a single blob → that file; otherwise treat it as a
// directory and take every blob beneath it (e.g. skills/<id>/…). Entities with
// no matching files are dropped (logged) so the local manifest stays consistent.
function planBundle(
  bundleDir: string,
  manifest: RemoteManifest,
  blobByPath: Map<string, TreeEntry>,
  allBlobs: TreeEntry[],
  overwriteExisting: boolean,
): { bundle: PlannedBundle | null; reason?: string } {
  const localId = slugify(manifest.id ?? '') || slugify(manifest.name)
  if (!localId) return { bundle: null, reason: 'manifest has no usable id/name' }

  const prefix = repoPrefix(bundleDir)
  const files: PlannedFile[] = []
  const seenRepoPaths = new Set<string>()
  const keptEntities: TemplateEntityRef[] = []

  for (const entity of manifest.entities) {
    const entBase = `${prefix}${entity.file}`.replace(/\/+$/, '')
    const single = blobByPath.get(entBase)
    const blobs = single
      ? [single]
      : allBlobs.filter((b) => b.type === 'blob' && b.path.startsWith(`${entBase}/`))
    if (blobs.length === 0) {
      log.warn('templates: remote entity not found, dropping', { kind: entity.kind, file: entity.file })
      continue
    }
    let kept = false
    for (const blob of blobs) {
      const relPath = blob.path.slice(prefix.length)
      if (!safeRelPath(relPath)) {
        log.warn('templates: unsafe remote path, skipping', { path: blob.path })
        continue
      }
      if (seenRepoPaths.has(blob.path)) continue
      seenRepoPaths.add(blob.path)
      files.push({ repoPath: blob.path, relPath, size: blob.size ?? 0 })
      kept = true
    }
    if (kept) keptEntities.push({ kind: entity.kind, id: entity.id, file: entity.file })
  }

  if (keptEntities.length === 0) return { bundle: null, reason: 'no entity files found in repo' }
  return {
    bundle: {
      localId,
      name: manifest.name,
      description: manifest.description ?? '',
      entities: keptEntities,
      files,
      overwriteExisting,
    },
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

// ─── Execute: download + write one planned bundle ──────────────────────────

async function writeBundle(ref: RepoRef, bundle: PlannedBundle): Promise<ProjectTemplate> {
  const localDir = templateDir(bundle.localId)
  if (bundle.overwriteExisting) await rm(localDir, { recursive: true, force: true })
  await mkdir(localDir, { recursive: true, mode: 0o700 })

  for (const f of bundle.files) {
    // Re-assert path safety at write time (defense in depth, invariant #2).
    const dest = join(localDir, ...f.relPath.split('/').map(sanitizeChild))
    if (!isInside(dest, localDir)) throw new RpcError(-32010, `unsafe path: ${f.relPath}`)
    const res = await httpGet(rawUrl(ref, f.repoPath), 'application/octet-stream')
    if (!res.ok) throw new RpcError(-32012, `cannot download ${f.repoPath} (HTTP ${res.status})`)
    const buf = await readCapped(res, MAX_FILE_BYTES, f.repoPath)
    await mkdir(join(dest, '..'), { recursive: true, mode: 0o700 })
    await writeFile(dest, buf)
  }

  const template: ProjectTemplate = {
    id: bundle.localId,
    name: bundle.name,
    description: bundle.description,
    createdAt: new Date().toISOString(),
    entities: bundle.entities,
  }
  const file = manifestFile(bundle.localId)
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(template, null, 2), 'utf8')
  await rename(tmp, file)
  return template
}

// ─── Public entry ──────────────────────────────────────────────────────────

export async function fetchRemoteTemplates(
  rawUrlInput: string,
  options: { overwrite?: boolean } = {},
): Promise<TemplateFetchResult> {
  const overwrite = options.overwrite ?? false
  const ref = parseGithubUrl(rawUrlInput)
  if (!ref.ref) ref.ref = await resolveDefaultBranch(ref)

  const tree = await fetchTree(ref)
  const bundleDirs = discoverBundleDirs(tree, ref.dirPath)
  if (bundleDirs.length === 0)
    throw new RpcError(-32012, 'no template.json found in that folder or its subfolders')

  const blobByPath = new Map(tree.filter((e) => e.type === 'blob').map((e) => [e.path, e]))

  // ── Plan phase: validate every bundle + enforce caps before any write. ──
  const planned: PlannedBundle[] = []
  const skipped: TemplateFetchResult['skipped'] = []
  const usedIds = new Set<string>()
  let totalFiles = 0
  let totalBytes = 0

  for (const bundleDir of bundleDirs) {
    const label = bundleDir || ref.repo
    let manifest: RemoteManifest
    try {
      manifest = await fetchManifest(ref, bundleDir)
    } catch (err) {
      skipped.push({ id: label, reason: err instanceof RpcError ? err.message : 'manifest error' })
      continue
    }
    const { bundle, reason } = planBundle(bundleDir, manifest, blobByPath, tree, overwrite)
    if (!bundle) {
      skipped.push({ id: label, reason: reason ?? 'invalid bundle' })
      continue
    }
    if (usedIds.has(bundle.localId)) {
      skipped.push({ id: bundle.localId, reason: 'duplicate id in source' })
      continue
    }
    if (!overwrite && (await dirExists(templateDir(bundle.localId)))) {
      skipped.push({ id: bundle.localId, reason: 'already exists' })
      continue
    }
    // Enforce caps against the tree-reported sizes (pre-download).
    const bundleBytes = bundle.files.reduce((sum, f) => sum + f.size, 0)
    const oversized = bundle.files.find((f) => f.size > MAX_FILE_BYTES)
    if (oversized)
      throw new RpcError(-32014, `${oversized.repoPath} exceeds ${MAX_FILE_BYTES} bytes`)
    totalFiles += bundle.files.length
    totalBytes += bundleBytes
    if (totalFiles > MAX_FILES) throw new RpcError(-32014, `too many files (> ${MAX_FILES})`)
    if (totalBytes > MAX_TOTAL_BYTES)
      throw new RpcError(-32014, `bundle too large (> ${MAX_TOTAL_BYTES} bytes)`)
    usedIds.add(bundle.localId)
    planned.push(bundle)
  }

  // ── Execute phase: download + write. ──
  const imported: ProjectTemplate[] = []
  for (const bundle of planned) {
    try {
      await writeBundle(ref, bundle)
      const tpl = await getTemplate(bundle.localId)
      if (tpl) imported.push(tpl)
    } catch (err) {
      log.warn('templates: write remote bundle failed', {
        id: bundle.localId,
        err: err instanceof Error ? err.message : String(err),
      })
      skipped.push({ id: bundle.localId, reason: err instanceof RpcError ? err.message : 'write failed' })
    }
  }

  log.info('templates: remote fetch done', {
    url: rawUrlInput,
    imported: imported.length,
    skipped: skipped.length,
  })
  return { imported, skipped }
}
