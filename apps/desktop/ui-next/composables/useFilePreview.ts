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
  // Verify a BATCH of workspace paths against the real filesystem: each input maps to
  // its true workspace-relative path, or to null when no such file exists. For
  // surfaces that LIST paths a session merely named (the Info tab's media/docs index)
  // — a row that opens nothing is worse than no row. Cheaper than `resolve` per path
  // (one directory listing serves every path in that directory) and it sees
  // generated/gitignored files, which the git-index path of `resolve` cannot.
  // Unverifiable (no root / browser-dev) maps a path to ITSELF, never to null: only a
  // checked miss drops a file.
  verifyPaths: (paths: string[]) => Promise<Map<string, string | null>>
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

// Run of path characters ending in `.<ext>` (+ optional `:line(:col)`) — the
// shape-based FIRST pass for bare paths in plain text (markdown text nodes,
// terminal lines, user bubbles). Deliberately loose; `filePathOf` then applies
// the real validation (closed extension list, no scheme, no spaces, no `1.2.3`)
// and callers gate on filePreview.resolve, so prose like `array.map` never
// becomes a link. Shared by the terminal link provider + markdown linkifier —
// keep the two in one place so detection stays identical across surfaces.
export const PATH_TOKEN_RE = /[\p{L}\p{N}\p{M}\w.@~+\-/]+\.[\p{L}\p{N}]{1,10}(?::\d+){0,2}/gu

// Scope một path TUYỆT ĐỐI về {root: thư mục cha, rel: basename} — fs.* chỉ cần
// `path` nằm trong `workspaceRoot` (gate assertInsideWorkspace), mà thư mục cha
// của chính file đã thoả điều đó. Dùng cho file ngoài workspace của phiên:
// draft trong ~/.awog/session-worktrees, file kéo vào từ đĩa… null khi input
// không phải abs hoặc trần "/x" (không có dir để scope).
export function absFileScope(abs: string): { root: string; rel: string } | null {
  if (!abs.startsWith('/')) return null // filePathOf never emits win32 drive paths
  const i = abs.lastIndexOf('/')
  if (i <= 0) return null
  return { root: abs.slice(0, i), rel: abs.slice(i + 1) }
}

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
  // `fresh` re-reads a directory whose cached listing predates a write in THIS turn —
  // without it a file the running turn just created reads as missing until turn end.
  // Only a cache MISS pays for it (see verifyPaths), so the storm the cache prevents
  // stays prevented.
  async function dirFileNames(r: string, dir: string, fresh = false): Promise<Set<string>> {
    const key = `${r}::${dir}`
    const hit = fresh ? undefined : dirCache.get(key)
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

  // ── batch existence check (verifyPaths) ─────────────────────────────────────
  // Three passes, cheapest first, over ONE directory listing per directory:
  //   1. cached listing says the file is there            → it is real
  //   2. re-read that directory (the running turn may have just written it)
  //   3. the git file index (matchPath) — only a DIRECTORY-PRESERVING hit is
  //      accepted, so a path anchored at an ancestor cwd is corrected
  //      (`awog/docs/x.md` → `docs/x.md`, memory: session-file-link-path-base) while
  //      a basename guess is NOT: matching `plan.md` to some other `plan.md` in the
  //      repo would just replace a dead row with a wrong one.
  // Anything still unmatched is null — a file the session named but never left behind.
  const VERIFY_DIRS_MAX = 32
  // True when the two paths share a full trailing segment run, i.e. one is the other
  // with directories added or removed at the FRONT. Rejects matchPath's tier-3
  // basename-only hits.
  const sameTail = (a: string, b: string): boolean =>
    a === b || (a.includes('/') && b.endsWith('/' + a)) || (b.includes('/') && a.endsWith('/' + b))

  const verifyPaths: FilePreviewApi['verifyPaths'] = async (paths) => {
    const out = new Map<string, string | null>()
    const r = await ensureRoot()
    // Can't verify → keep everything as written (browser-dev, session with no project).
    if (!r) {
      for (const p of paths) out.set(p, p)
      return out
    }
    const rels = new Map<string, string>()
    for (const p of paths) {
      const rel = relativeToRoot(r, p)
      // Absolute path ngoài workspace giữ nguyên dạng `/…` — verified riêng bên
      // dưới qua listing thư mục cha (absScope), không qua file index của root.
      rels.set(p, rel.startsWith('/') ? rel : rel.replace(/^[/\\]+/, ''))
    }

    // Absolute paths outside the workspace: verify each against its own parent
    // directory (same scope trick as resolve/open), then drop them from rels so
    // the workspace passes below never see a leading-slash "relative" path.
    for (const [written, rel] of rels) {
      if (!rel.startsWith('/')) continue
      const scope = absScope(rel)
      out.set(
        written,
        scope && (await dirFileNames(scope.root, '')).has(scope.rel) ? written : null,
      )
      rels.delete(written)
    }
    if (!rels.size) return out

    // Pass 1 — cached listings, capped. A path whose directory is over the cap stays
    // unverified (kept) rather than dropped for a check we never ran.
    const dirs: string[] = []
    for (const rel of rels.values()) {
      const d = dirOf(rel)
      if (!dirs.includes(d) && dirs.length < VERIFY_DIRS_MAX) dirs.push(d)
    }
    const listings = new Map<string, Set<string>>()
    await Promise.all(dirs.map(async (d) => listings.set(d, await dirFileNames(r, d))))
    const misses: [string, string][] = []
    for (const [written, rel] of rels) {
      const dir = dirOf(rel)
      if (!listings.has(dir))
        out.set(written, written) // over the directory cap
      else if (listings.get(dir)?.has(baseName(rel))) out.set(written, rel)
      else misses.push([written, rel])
    }
    if (!misses.length) return out

    // Pass 2 — one fresh listing per directory that produced a miss.
    const refreshed = new Set<string>()
    for (const [, rel] of misses) {
      const d = dirOf(rel)
      if (refreshed.has(d)) continue
      refreshed.add(d)
      listings.set(d, await dirFileNames(r, d, true))
    }
    // Pass 3 — the file index, directory-preserving hits only, and the hit is itself
    // confirmed on disk (git can still index a file that was deleted).
    for (const [written, rel] of misses) {
      if (listings.get(dirOf(rel))?.has(baseName(rel))) {
        out.set(written, rel)
        continue
      }
      const hit = await matchPath(r, rel, [])
      const onDisk =
        hit && sameTail(hit, rel) && (await dirFileNames(r, dirOf(hit))).has(baseName(hit))
      out.set(written, onDisk ? hit : null)
    }
    return out
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
    // Path tuyệt đối ngoài root (ảnh trong session-worktree…) probe qua thư mục
    // cha của chính nó — cùng trick absScope của open/verifyPaths — và PreviewRef
    // emit theo scope-root đó thay vì ghép vào workspace root của phiên.
    const scopeOf = (c: string): { root: string; rel: string } => {
      if (!c.startsWith('/')) return { root: r, rel: c }
      return absScope(c) ?? { root: r, rel: c.replace(/^\/+/, '') }
    }
    // Cap the directories we're willing to probe, keeping the opened image's own dir first.
    const dirKeys: string[] = []
    const dirKey = (c: string): string => {
      const s = scopeOf(c)
      return `${s.root}::${dirOf(s.rel)}`
    }
    for (const c of [openedPath, ...candidates]) {
      const k = dirKey(c)
      if (!dirKeys.includes(k) && dirKeys.length < GALLERY_DIRS_MAX) dirKeys.push(k)
    }
    const listings = new Map<string, Set<string>>()
    await Promise.all(
      dirKeys.map(async (k) => {
        const sepIdx = k.indexOf('::')
        listings.set(k, await dirFileNames(k.slice(0, sepIdx), k.slice(sepIdx + 2)))
      }),
    )

    const paths: string[] = []
    for (const c of candidates) {
      if (paths.includes(c)) continue
      if (c !== openedPath && !listings.get(dirKey(c))?.has(baseName(c))) continue
      paths.push(c)
    }
    if (paths.length < 2) return []
    return paths.map((path) => {
      const s = scopeOf(path)
      return {
        name: baseName(path),
        kind: 'image' as const,
        workspaceRoot: s.root,
        path: s.rel,
      }
    })
  }

  const open: FilePreviewApi['open'] = async (rawPath) => {
    const detected = filePathOf(rawPath) ?? rawPath.trim()
    if (!detected) return
    const r = await ensureRoot()
    // With a root, resolve against the real file tree (handles bare names / wrong
    // base); fall back to the written path — made root-relative when it's an absolute
    // path inside the workspace, which is the shape a PreviewRef must carry —
    // so the modal can still surface a clear "could not load" for a genuinely
    // missing file. Without a root (browser-dev) degrade to a placeholder.
    let path = detected
    if (r) {
      const rel = relativeToRoot(r, detected)
      if (rel.startsWith('/')) {
        // Abs ngoài workspace: file tồn tại đúng-chỗ trên đĩa THẮNG index —
        // một file cùng basename trong project không được che file thật.
        const scope = absScope(rel)
        path =
          scope && (await dirFileNames(scope.root, '')).has(scope.rel)
            ? rel
            : ((await matchPath(r, detected, touchedPaths.value)) ?? rel)
      } else {
        path = (await matchPath(r, detected, touchedPaths.value)) ?? rel
      }
    }
    let scopeRoot = r
    // An absolute path that stayed absolute is outside the workspace root —
    // anchor the preview root to its parent dir so fs.*'s inside-root gate holds
    // and every modal affordance (content, copy path, reveal, open-externally)
    // works for it just like a workspace file.
    if (path.startsWith('/')) {
      const scope = absScope(path)
      if (scope) {
        scopeRoot = scope.root
        path = scope.rel
      }
    }
    const name = baseName(path)
    const item: PreviewRef = { name, kind: previewKindFromPath(name) }
    if (scopeRoot) {
      item.workspaceRoot = scopeRoot
      item.path = path
    }
    // An image opens with the session's other images as its gallery (see above) —
    // only meaningful while the preview still sits inside the session workspace.
    const siblings =
      scopeRoot === r && r && item.kind === 'image' ? await sessionImageSiblings(r, path) : []
    openPreview(item, siblings)
  }
  const shorten: FilePreviewApi['shorten'] = (path) => {
    const r = root.value
    if (r && (path === r || path.startsWith(r + '/') || path.startsWith(r + '\\'))) {
      return path.slice(r.length).replace(/^[/\\]+/, '') || path
    }
    return path
  }
  // An absolute path outside the workspace (a session-worktree draft under
  // ~/.awog/session-worktrees, a file dragged in from Desktop, …) can't be keyed
  // to the workspace file index, but fs.* only needs a root the path sits inside
  // — its own parent directory qualifies. Returns {root: dir, rel: basename}.
  const absScope = absFileScope
  // Literal on-disk check for one workspace-relative path — the matchPath index
  // comes from `git ls-files`, so generated/gitignored files (`.awog/board-att`,
  // build output) are invisible to it even though they exist.
  const onDisk = async (r: string, rel: string): Promise<boolean> =>
    (await dirFileNames(r, dirOf(rel))).has(baseName(rel))

  // Existence check for chip highlighting: only a path that resolves to a real
  // file returns non-null. No root (browser-dev / no-project session) → relative
  // refs return null, absolute paths can still be verified against their own
  // directory. Unverifiable references stay plain text rather than fake chips.
  const resolve: FilePreviewApi['resolve'] = async (rawPath) => {
    const detected = filePathOf(rawPath)
    if (!detected) return null
    const r = await ensureRoot()
    if (detected.startsWith('/')) {
      // Absolute: prefer the workspace resolution when it lands inside the root;
      // otherwise verify the literal path on disk FIRST — scoped to its parent
      // dir — since the index can't see outside-root files and a same-named
      // project file must not shadow the real one the writer pointed at.
      const rel = r ? relativeToRoot(r, detected) : detected
      if (rel.startsWith('/')) {
        const scope = absScope(rel)
        if (scope && (await dirFileNames(scope.root, '')).has(scope.rel)) return detected
        // Missing on disk as written — fall back to the index (a hinted/touched
        // abs path can still resolve) before declaring dead.
        if (!r) return null
        return matchPath(r, detected, touchedPaths.value)
      }
      const stripped = rel.replace(/^[/\\]+/, '')
      return (
        (await matchPath(r!, detected, touchedPaths.value)) ??
        ((await onDisk(r!, stripped)) ? stripped : null)
      )
    }
    if (!r) return null
    return (
      (await matchPath(r, detected, touchedPaths.value)) ??
      ((await onDisk(r, detected.replace(/^[/\\]+/, ''))) ? detected : null)
    )
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
      // Directory listings go stale the same way the image bytes do: the turn that
      // just ended may have written, renamed or deleted files.
      dirCache.clear()
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
    const s = (rawSrc ?? '').trim()
    if (!s || ABSOLUTE_SCHEME.test(s)) return null
    // Absolute path ngoài workspace (ảnh đính kèm board, screenshot trong
    // session-worktree…): đọc qua scope thư mục cha — cùng trick của
    // open()/resolve, không cần root của phiên.
    if (s.startsWith('/')) {
      const scope = absScope(s)
      if (!scope) return null
      try {
        const res = await fs.readFileBase64(scope.root, scope.rel)
        return res.base64 && !res.truncated && res.mimeType.startsWith('image/')
          ? `data:${res.mimeType};base64,${res.base64}`
          : null
      } catch {
        return null
      }
    }
    const r = await ensureRoot()
    if (!r) return null
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
  provide(KEY, { open, shorten, resolve, verifyPaths, imageSrc, root: ensureRoot, imagesVersion })
}

// No host (markdown rendered outside a session transcript) → links are inert.
const NOOP: FilePreviewApi = {
  open: () => undefined,
  shorten: (p) => p,
  resolve: () => Promise.resolve(null),
  // No host = nothing to check against: keep every path rather than drop them all.
  verifyPaths: (paths) => Promise.resolve(new Map(paths.map((p) => [p, p]))),
  imageSrc: () => Promise.resolve(null),
  root: () => Promise.resolve(null),
  imagesVersion: ref(0), // never bumps — nothing to refresh without a host
}

// Leaf-side API, injected from the nearest provideFilePreview ancestor.
export function useFilePreview(): FilePreviewApi {
  return inject(KEY, NOOP)
}

// True khi component đứng dưới một provideFilePreview thật — caller dùng để
// tránh đăng ký surface tương tác (vd: file-link trong terminal) ở chỗ chỉ có
// NOOP, nơi link sẽ gạch chân nhưng click câm (GlobalTerminalHost, popout…).
export function hasFilePreviewHost(): boolean {
  return inject(KEY, null) != null
}
