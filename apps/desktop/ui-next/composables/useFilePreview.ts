import {
  inject,
  provide,
  ref,
  toValue,
  watch,
  type InjectionKey,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue'
import { usePreview, previewKindFromPath, type PreviewRef } from './usePreview'
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
  // Absolute workspace root of the session (its cwd), resolved on demand (cached).
  // Callers that hand a message's markdown to ANOTHER renderer — the fullscreen
  // PreviewModal — need it to anchor relative image refs at the same base the
  // transcript uses. null in browser-dev / a session with no project.
  root: () => Promise<string | null>
  // Bumped every time the resolved-image cache is dropped, i.e. at the end of a turn.
  // Renderers watch it to re-resolve the <img> nodes they already painted (see below —
  // a file re-rendered on disk keeps its path, so nothing else would tell them).
  imagesVersion: Readonly<Ref<number>>
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

// Resolve the active session's workspace root once and provide the file-preview API
// to descendants. Call in the transcript host (SessionDetail).
export function provideFilePreview(
  projectName: MaybeRefOrGetter<string | undefined>,
  session: MaybeRefOrGetter<Session>,
): void {
  const { root, resolve: resolveRoot } = useWorkspaceData(projectName)
  const { open: openPreview } = usePreview()
  const fs = useFsApi()
  // Files the session wrote/edited — the model's working context. Used to anchor a
  // bare/relative link (`[plan.md](plan.md)`) to the file it's really about instead of
  // an arbitrary same-named file elsewhere in the repo (memory: session-file-link-path-base).
  const { touchedPaths } = useSessionTouchedPaths(session, root)

  // The project→path lookup (useWorkspaceData) resolves ASYNCHRONOUSLY. When a
  // historical transcript mounts before it lands, `root` is still null — reading it
  // directly here would bail early and permanently degrade the run (workspace images
  // → a "missing" placeholder that never retries; file paths → not linkified), because
  // nothing re-runs these resolvers when root arrives later. Await the idempotent,
  // cache-warm resolve once so the first render waits it out instead of giving up.
  async function ensureRoot(): Promise<string | null> {
    if (root.value) return root.value
    await resolveRoot()
    return root.value
  }

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
  // Strip a workspace-root prefix so a path written as absolute becomes root-relative
  // (unchanged when it lies outside the root). A PreviewRef must carry the relative form:
  // the modal builds "copy path" as `root + '/' + path` (an absolute path there would
  // double the prefix) and the media:// stream URL the same way.
  const relativeToRoot = (r: string, p: string): string =>
    p.startsWith(r + '/') || p.startsWith(r + '\\') ? p.slice(r.length + 1) : p
  // Map a written path to a REAL workspace-relative path, or null when no file
  // matches. Match tiers, most-specific first (directory-preserving beats basename-only,
  // because a bare filename can collide with same-named files all over the repo):
  //   1. exact full path — authoritative.
  //   2. directory-preserving match — the written path and a real file share a full
  //      trailing segment. Covers an UNDER-qualified link (`architecture/data-model.md`
  //      → `docs/architecture/data-model.md`, real path longer) AND an OVER-qualified one
  //      anchored at an ancestor cwd (`awog/docs/x.md` → `docs/x.md`, written path longer
  //      — memory: session-file-link-path-base). Requires the shorter side to carry a
  //      directory, so it never degenerates into a basename guess.
  //   3. basename-only — last resort, no directory info survives.
  // Within tiers 2 & 3 the session's touched files (its working context) win over an
  // arbitrary global hit, then the shortest path. Returns null when the file index is
  // empty/unavailable so callers can tell "exists" from "can't verify".
  async function matchPath(r: string, raw: string, hints: string[]): Promise<string | null> {
    const files = await workspaceFiles(r)
    if (!files.length) return null
    let p = relativeToRoot(r, raw) // absolute-in-root → relative
    p = p.replace(/^[/\\]+/, '')
    if (files.includes(p)) return p // tier 1 — exact full path wins

    // tier 2 — directory-preserving. Both branches keep at least one directory segment
    // from the shorter side, so `plan.md` (bare) falls through to tier 3 instead of
    // matching every `*/plan.md`.
    const dirMatch = (f: string): boolean =>
      f === p ||
      (p.includes('/') && f.endsWith('/' + p)) || // link under-qualified: real path longer
      (f.includes('/') && p.endsWith('/' + f)) // link over-qualified: ancestor-cwd prefix
    const hintDir = hints.find(dirMatch)
    if (hintDir) return hintDir
    const globalDir = files.filter(dirMatch).sort((a, b) => a.length - b.length)
    if (globalDir[0]) return globalDir[0]

    // tier 3 — basename-only, prefer a touched file over an arbitrary same-named one.
    const base = baseName(p)
    const hintBase = hints.find((h) => baseName(h) === base)
    if (hintBase) return hintBase
    const hits = files.filter((f) => baseName(f) === base).sort((a, b) => a.length - b.length)
    return hits[0] ?? null
  }

  // ── session image set (the preview's ‹ › gallery) ────────────────────────────
  // Clicking one image in a chat should let the user walk the OTHER images of the same
  // session — not every file that happens to share a folder on disk. The set is derived from
  // the transcript, so it matches what the user can see:
  //   * paths the session wrote/edited (touchedPaths), and
  //   * image paths mentioned in any message text (links, inline-code chips, markdown images).
  //
  // Existence is then verified with ONE fs.listDir per referenced directory rather than through
  // matchPath's file index: that index comes from `git ls-files`, so a rendered/gitignored
  // output (the usual case for a batch of frames under `output/`) is INVISIBLE to it and the
  // gallery came out empty. listDir reads the real filesystem, and a mention the model merely
  // proposed but never wrote is dropped because it isn't there.
  const GALLERY_IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i
  // Path-ish run of characters ending in an image extension. Kept closed (no spaces) — the
  // same shape filePathOf accepts, which then does the real validation.
  const IMAGE_MENTION_RE = /[\w./~@#+-]*\.(?:png|jpe?g|gif|webp|bmp|avif|svg)\b/gi
  // Bound the work: a long session can mention a lot, and each new directory costs a listDir.
  const GALLERY_MAX = 80
  const GALLERY_DIRS_MAX = 8

  // Directory listings, keyed `root::dir`, shared across gallery builds in this session.
  const dirCache = new Map<string, Set<string>>()
  async function dirFileNames(r: string, dir: string): Promise<Set<string>> {
    const key = `${r}::${dir}`
    const hit = dirCache.get(key)
    if (hit) return hit
    let names = new Set<string>()
    try {
      const res = await fs.listDir(r, dir || undefined)
      names = new Set(res.entries.filter((e) => e.kind === 'file').map((e) => e.name))
    } catch {
      // unreadable dir → nothing from it qualifies
    }
    dirCache.set(key, names)
    return names
  }

  const dirOf = (p: string): string => {
    const i = p.lastIndexOf('/')
    return i > 0 ? p.slice(0, i) : ''
  }

  // Candidates in transcript order: files the session wrote first (its own output, which is
  // what a user steps through), then mentions as they appear.
  function sessionImageCandidates(): string[] {
    const out = new Set<string>()
    for (const p of touchedPaths.value) if (GALLERY_IMAGE_EXT.test(p)) out.add(p)
    const scan = (text: string): void => {
      for (const raw of text.match(IMAGE_MENTION_RE) ?? []) {
        const p = filePathOf(raw)
        if (p) out.add(p)
      }
    }
    for (const m of toValue(session).msgs) {
      // A user turn carries its prose directly; an assistant turn keeps it in text blocks
      // (steps are skipped — their targets are already covered by touchedPaths).
      if (m.role === 'assistant') {
        for (const b of m.blocks) if (b.kind === 'text') scan(b.text)
      } else {
        scan(m.text)
      }
      if (out.size >= GALLERY_MAX) break
    }
    return [...out].slice(0, GALLERY_MAX)
  }

  // Verified sibling set as PreviewRefs, always including the image being opened. [] when
  // there is nothing to step through.
  async function sessionImageSiblings(r: string, openedPath: string): Promise<PreviewRef[]> {
    // Transcript order, so ‹ › walks the images the way the session lists them. The opened one
    // is normally already among the mentions (that's what was clicked); it's only prepended
    // when it isn't, so it can never be missing from its own gallery.
    const mentioned = sessionImageCandidates()
      .map((c) => relativeToRoot(r, c))
      .filter((c) => GALLERY_IMAGE_EXT.test(c))
    const candidates = mentioned.includes(openedPath) ? mentioned : [openedPath, ...mentioned]
    // Cap the directories we're willing to probe, keeping the opened image's own dir first.
    const dirs: string[] = [dirOf(openedPath)]
    for (const c of candidates) {
      const d = dirOf(c)
      if (!dirs.includes(d) && dirs.length < GALLERY_DIRS_MAX) dirs.push(d)
    }
    const listings = new Map<string, Set<string>>()
    await Promise.all(dirs.map(async (d) => listings.set(d, await dirFileNames(r, d))))

    const paths: string[] = []
    for (const c of candidates) {
      if (paths.includes(c)) continue
      if (c !== openedPath && !listings.get(dirOf(c))?.has(baseName(c))) continue
      paths.push(c)
    }
    if (paths.length < 2) return []
    return paths.map((path) => ({
      name: baseName(path),
      kind: 'image' as const,
      workspaceRoot: r,
      path,
    }))
  }

  const open: FilePreviewApi['open'] = async (rawPath) => {
    const detected = filePathOf(rawPath) ?? rawPath.trim()
    if (!detected) return
    const r = await ensureRoot()
    // With a root, resolve against the real file tree (handles bare names / wrong
    // base); fall back to the written path — made root-relative when it's an absolute
    // path inside the workspace, which is the shape a PreviewRef must carry (an
    // unmatched file, e.g. a build output not in the git index, used to keep its
    // absolute path and broke "copy path" + the media:// stream URL) — so the modal can
    // still surface a clear "could not load". Without a root (browser-dev) degrade to a
    // placeholder.
    const path = r
      ? ((await matchPath(r, detected, touchedPaths.value)) ?? relativeToRoot(r, detected))
      : detected
    const name = baseName(path)
    const item: PreviewRef = { name, kind: previewKindFromPath(name) }
    if (r) {
      item.workspaceRoot = r
      item.path = path
    }
    // An image opens with the session's other images as its gallery (see above).
    const siblings = r && item.kind === 'image' ? await sessionImageSiblings(r, path) : []
    openPreview(item, siblings)
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
    const r = await ensureRoot()
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
  //
  // The cache is dropped at every TURN BOUNDARY. A path is not a version: the model
  // re-renders `…/thumb.png` in place (usually from a script it ran through Bash, so no
  // Write/Edit step names the file) and the transcript would keep serving the bytes read
  // the first time — for the whole life of the session. Turn end is the coarse but
  // reliable "the workspace may have moved under us" signal; it costs one re-read per
  // image actually on screen, and only when a turn finishes.
  const imageCache = new Map<string, string>()
  const imagesVersion = ref(0)
  const isRunning = (s: Session['status']): boolean => s === 'streaming' || s === 'awaiting'
  watch(
    () => toValue(session).status,
    (now, before) => {
      if (!isRunning(before) || isRunning(now)) return
      imageCache.clear()
      imagesVersion.value++
    },
  )
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
    const r = await ensureRoot()
    if (!r) return null
    const s = (rawSrc ?? '').trim()
    if (!s || ABSOLUTE_SCHEME.test(s)) return null
    const rel = normalizeAsset(s)
    if (!rel) return null
    const cached = imageCache.get(rel)
    if (cached !== undefined) return cached || null
    // A read that spans a turn boundary carries pre-boundary bytes: keep the result for
    // THIS caller but don't seed the freshly-cleared cache with it, or the refresh pass
    // right behind us would be served exactly the bytes it means to replace.
    const version = imagesVersion.value
    const keep = (url: string): void => {
      if (imagesVersion.value === version) imageCache.set(rel, url)
    }
    try {
      const res = await fs.readFileBase64(r, rel)
      const url =
        res.base64 && !res.truncated && res.mimeType.startsWith('image/')
          ? `data:${res.mimeType};base64,${res.base64}`
          : ''
      keep(url)
      return url || null
    } catch {
      keep('') // negative-cache a missing / out-of-root file
      return null
    }
  }
  provide(KEY, { open, shorten, resolve, imageSrc, root: ensureRoot, imagesVersion })
}

// No host (markdown rendered outside a session transcript) → links are inert.
const NOOP: FilePreviewApi = {
  open: () => undefined,
  shorten: (p) => p,
  resolve: () => Promise.resolve(null),
  imageSrc: () => Promise.resolve(null),
  root: () => Promise.resolve(null),
  imagesVersion: ref(0), // never bumps — nothing to refresh without a host
}

// Leaf-side API, injected from the nearest provideFilePreview ancestor.
export function useFilePreview(): FilePreviewApi {
  return inject(KEY, NOOP)
}
