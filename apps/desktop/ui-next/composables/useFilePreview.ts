import { inject, provide, type InjectionKey, type MaybeRefOrGetter } from 'vue'
import { usePreview, type PreviewRef } from './usePreview'
import { useWorkspaceData } from './useWorkspaceData'
import { useFsApi } from './useFsApi'
import { useSessionTouchedPaths } from './useSessionTouchedPaths'
import type { Session } from './useSessionsData'

// Detect a workspace file reference written in chat markdown (e.g. an inline-code
// `docs/features/x.md`, `tasks/#21/plan.md`, or a full absolute path) and open it
// in the shared PreviewModal — porting the old UI's "click a file path → preview".
//
// Resolution: the active session's project → absolute workspace root
// (useWorkspaceData), combined with the path → fs.readFile inside the modal
// (assertInsideWorkspace resolves relative-from-root AND absolute-inside-root).
// provide/inject so a leaf markdown node triggers a preview without resolving the
// root per text run — one resolver per transcript, many cheap consumers.

type FilePreviewApi = {
  // Open the given path (relative-to-root or absolute) in the shared PreviewModal.
  open: (path: string) => void
  // Display form: strip the workspace-root prefix so an absolute path renders as a
  // clean relative path in the chip (the full path is still used for the click).
  shorten: (path: string) => string
  // Resolve a written path to a REAL workspace-relative path if the file exists,
  // else null. Used to gate file-chip highlighting on actual existence — a merely
  // *proposed* filename in prose must not linkify.
  resolve: (path: string) => Promise<string | null>
  // Resolve a markdown image src (a path relative to the workspace root) to a
  // base64 data: URL by reading the file bytes, or null when it can't be resolved
  // (browser-dev, climbs out of the workspace, missing, non-image, over the size
  // cap). Lets the transcript render `![alt](tasks/…/shot.png)` images inline.
  imageSrc: (src: string) => Promise<string | null>
}
const KEY: InjectionKey<FilePreviewApi> = Symbol('filePreview')

// Extensions we treat as previewable workspace files. Kept broad (source, config,
// docs, images, pdf) but closed — an unknown extension is NOT linkified so prose
// like `array.map` or `1.2.3` never turns into a fake file link.
const FILE_EXT =
  /\.(md|markdown|mdx|txt|json|jsonl|ya?ml|toml|ini|conf|cfg|env|lock|ts|tsx|js|jsx|mjs|cjs|vue|svelte|css|scss|sass|less|html?|xml|svg|py|rb|go|rs|java|kt|kts|c|h|cc|cpp|hpp|cs|swift|php|sh|bash|zsh|fish|sql|gradle|csv|png|jpe?g|gif|webp|bmp|ico|pdf)$/i

// Return the cleaned path if `raw` looks like a file path, else null. `raw` is the
// full text of an inline-code span / link href (atomic in markdown). Keeps a leading
// `/` (absolute paths must survive) but strips a leading `./` and a `:line(:col)`
// suffix.
export function filePathOf(raw: string): string | null {
  const s = raw.trim()
  if (!s || s.length > 400 || /\s/.test(s)) return null // paths have no spaces
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(s)) return null // URL scheme (http://, file://…)
  if (s.startsWith('#') || s.startsWith('@')) return null // anchors / npm scopes
  const path = s.replace(/^\.\//, '').replace(/:\d+(?::\d+)?$/, '') // strip ./ and :line(:col)
  if (!FILE_EXT.test(path)) return null
  // path-segment-safe chars only. Unicode letters/numbers/marks are allowed so
  // non-ASCII filenames (e.g. Japanese 仕様書.md, accented Vietnamese) linkify too.
  if (!/^[\p{L}\p{N}\p{M}\w./#@~+-]+$/u.test(path)) return null
  if (/^\.+$/.test(path)) return null // not a bare ".", ".."
  if (/^\d+(\.\d+)+$/.test(path)) return null // not a version like 1.2.3
  return path
}

function kindFromName(name: string): PreviewRef['kind'] {
  if (/\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i.test(name)) return 'image'
  if (/\.pdf$/i.test(name)) return 'pdf'
  if (/\.(md|markdown|mdx)$/i.test(name)) return 'markdown'
  return 'text'
}

// Resolve the active session's workspace root once and provide the file-preview API
// to descendants. Call in the transcript host (SessionDetail).
export function provideFilePreview(
  projectName: MaybeRefOrGetter<string | undefined>,
  session: MaybeRefOrGetter<Session>,
): void {
  const { root } = useWorkspaceData(projectName)
  const { open: openPreview } = usePreview()
  const fs = useFsApi()
  // Files the session wrote/edited — the model's working context. Used to anchor a
  // bare/relative link (`[plan.md](plan.md)`) to the file it's really about instead of
  // an arbitrary same-named file elsewhere in the repo (memory: session-file-link-path-base).
  const { touchedPaths } = useSessionTouchedPaths(session, root)

  // Lazy, root-keyed cache of every workspace file path (`git ls-files`). Used to
  // resolve a model-written path that doesn't map 1:1 to a real file — a bare
  // basename (`botRegistry.ts`), a path anchored at the wrong base, or an absolute
  // path. Fetched once per root on the first click that needs it.
  let cacheRoot: string | null = null
  let cacheFiles: string[] | null = null
  async function workspaceFiles(r: string): Promise<string[]> {
    if (cacheFiles && cacheRoot === r) return cacheFiles
    try {
      const res = await fs.listFiles(r)
      cacheFiles = (res.files ?? []).map((f) => f.path)
      cacheRoot = r
      return cacheFiles
    } catch {
      return []
    }
  }
  const baseName = (p: string): string => p.split('/').pop() || p
  // Map a written path to a REAL workspace-relative path, or null when no file
  // matches. Tries, in order: the path as-is, a suffix match (wrong-base relative),
  // then a unique-ish basename match (shortest path wins). Returns null when the
  // file index is empty/unavailable so callers can tell "exists" from "can't verify".
  async function matchPath(r: string, raw: string, hints: string[]): Promise<string | null> {
    const files = await workspaceFiles(r)
    if (!files.length) return null
    let p = raw
    if (p.startsWith(r + '/') || p.startsWith(r + '\\')) p = p.slice(r.length) // absolute-in-root
    p = p.replace(/^[/\\]+/, '')
    if (files.includes(p)) return p // exact full path wins (authoritative)
    const base = baseName(p)
    // Anchor to the model's working context BEFORE the global fallbacks: a relative
    // link like `[plan.md](plan.md)` is relative to the doc it's about, so in a repo
    // with dozens of same-named files the one the SESSION actually touched (wrote/
    // edited) is the right target — not an arbitrary global basename hit. Suffix match
    // first (handles `e-contracts/plan.md` → `tasks/e-contracts/plan.md`), then bare
    // basename. A touched path exists on disk even when untracked, so no git gating.
    const hint =
      hints.find((h) => h === p || h.endsWith('/' + p)) ?? hints.find((h) => baseName(h) === base)
    if (hint) return hint
    const suffix = files.find((f) => f === p || f.endsWith('/' + p))
    if (suffix) return suffix
    const hits = files.filter((f) => baseName(f) === base).sort((a, b) => a.length - b.length)
    return hits[0] ?? null
  }

  const open: FilePreviewApi['open'] = async (rawPath) => {
    const detected = filePathOf(rawPath) ?? rawPath.trim()
    if (!detected) return
    const r = root.value
    // With a root, resolve against the real file tree (handles bare names / wrong
    // base); fall back to the written path so the modal can still surface a clear
    // "could not load". Without a root (browser-dev) degrade to a placeholder.
    const path = r ? ((await matchPath(r, detected, touchedPaths.value)) ?? detected) : detected
    const name = baseName(path)
    const item: PreviewRef = { name, kind: kindFromName(name) }
    if (r) {
      item.workspaceRoot = r
      item.path = path
    }
    openPreview(item)
  }
  const shorten: FilePreviewApi['shorten'] = (path) => {
    const r = root.value
    if (r && (path === r || path.startsWith(r + '/') || path.startsWith(r + '\\'))) {
      return path.slice(r.length).replace(/^[/\\]+/, '') || path
    }
    return path
  }
  // Existence check for chip highlighting: only a path that resolves to a real
  // workspace file returns non-null. No root (browser-dev / no-project session) →
  // null, so unverifiable references stay plain text rather than fake chips.
  const resolve: FilePreviewApi['resolve'] = async (rawPath) => {
    const detected = filePathOf(rawPath)
    if (!detected) return null
    const r = root.value
    if (!r) return null
    return matchPath(r, detected, touchedPaths.value)
  }

  // ── markdown image inlining (workspace-relative → base64 data URL) ───────────
  // Chat markdown images reference workspace files by a path relative to the
  // session's workspace root (e.g. a QA report's evidence screenshots:
  // `![RFQ](tasks/…/ac-001-rfq.png)`). The renderer resolves that against the page
  // origin (app://bundle/… or the dev server), not the workspace, so the <img>
  // 404s and renders a broken icon. Read the bytes through the sidecar and return a
  // data: URL. Cached per normalized path; '' negative-caches a miss so per-frame
  // re-renders don't re-read. Mirrors usePreviewModal's markdown image resolution,
  // but anchored at the workspace root (the session cwd), not a file's directory.
  const imageCache = new Map<string, string>()
  // Absolute/remote schemes are already loadable — only local relative refs resolve.
  const ABSOLUTE_SCHEME = /^(?:https?:|data:|blob:|app:|file:)/i
  // Normalize a relative ref against the workspace root, collapsing '.'/'..'; a ref
  // that climbs out of the root returns null (invariant #2, defence-in-depth on top
  // of the sidecar's assertInsideWorkspace).
  const normalizeAsset = (src: string): string | null => {
    let s = src.split(/[?#]/)[0] ?? ''
    try {
      s = decodeURIComponent(s)
    } catch {
      // not valid percent-encoding → use the raw string
    }
    const out: string[] = []
    for (const seg of s.replace(/^\/+/, '').split('/')) {
      if (!seg || seg === '.') continue
      if (seg === '..') {
        if (!out.length) return null
        out.pop()
        continue
      }
      out.push(seg)
    }
    return out.length ? out.join('/') : null
  }
  const imageSrc: FilePreviewApi['imageSrc'] = async (rawSrc) => {
    const r = root.value
    if (!r) return null
    const s = (rawSrc ?? '').trim()
    if (!s || ABSOLUTE_SCHEME.test(s)) return null
    const rel = normalizeAsset(s)
    if (!rel) return null
    const cached = imageCache.get(rel)
    if (cached !== undefined) return cached || null
    try {
      const res = await fs.readFileBase64(r, rel)
      const url =
        res.base64 && !res.truncated && res.mimeType.startsWith('image/')
          ? `data:${res.mimeType};base64,${res.base64}`
          : ''
      imageCache.set(rel, url)
      return url || null
    } catch {
      imageCache.set(rel, '') // negative-cache a missing / out-of-root file
      return null
    }
  }
  provide(KEY, { open, shorten, resolve, imageSrc })
}

// No host (markdown rendered outside a session transcript) → links are inert.
const NOOP: FilePreviewApi = {
  open: () => undefined,
  shorten: (p) => p,
  resolve: () => Promise.resolve(null),
  imageSrc: () => Promise.resolve(null),
}

// Leaf-side API, injected from the nearest provideFilePreview ancestor.
export function useFilePreview(): FilePreviewApi {
  return inject(KEY, NOOP)
}
