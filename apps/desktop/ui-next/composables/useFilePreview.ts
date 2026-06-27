import { inject, provide, type InjectionKey, type MaybeRefOrGetter } from 'vue'
import { usePreview, type PreviewRef } from './usePreview'
import { useWorkspaceData } from './useWorkspaceData'
import { useFsApi } from './useFsApi'

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
  if (!/^[\w./#@~+-]+$/.test(path)) return null // path-segment-safe chars only
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
export function provideFilePreview(projectName: MaybeRefOrGetter<string | undefined>): void {
  const { root } = useWorkspaceData(projectName)
  const { open: openPreview } = usePreview()
  const fs = useFsApi()

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
  // Map a written path to a real workspace-relative path. Tries, in order: the
  // path as-is, a suffix match (wrong-base relative), then a unique-ish basename
  // match (shortest path wins). Falls back to the input so the modal surfaces a
  // clear "could not load" if the file genuinely isn't here.
  async function resolvePath(r: string, raw: string): Promise<string> {
    let p = raw
    if (p.startsWith(r + '/') || p.startsWith(r + '\\')) p = p.slice(r.length) // absolute-in-root
    p = p.replace(/^[/\\]+/, '')
    const files = await workspaceFiles(r)
    if (!files.length || files.includes(p)) return p
    const suffix = files.find((f) => f === p || f.endsWith('/' + p))
    if (suffix) return suffix
    const base = baseName(p)
    const hits = files.filter((f) => baseName(f) === base).sort((a, b) => a.length - b.length)
    return hits[0] ?? p
  }

  const open: FilePreviewApi['open'] = async (rawPath) => {
    const detected = filePathOf(rawPath) ?? rawPath.trim()
    if (!detected) return
    const r = root.value
    // With a root, resolve the path against the real file tree (handles bare names
    // / wrong base). Without one (browser-dev) just degrade to a placeholder.
    const path = r ? await resolvePath(r, detected) : detected
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
  provide(KEY, { open, shorten })
}

// No host (markdown rendered outside a session transcript) → links are inert.
const NOOP: FilePreviewApi = { open: () => undefined, shorten: (p) => p }

// Leaf-side API, injected from the nearest provideFilePreview ancestor.
export function useFilePreview(): FilePreviewApi {
  return inject(KEY, NOOP)
}
