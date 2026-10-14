// Session Workbench (ADR 0098) — controller của panel Explorer: tree fs lazy
// (fs.listDir theo dir đã expand), inline create/rename, context-menu chung,
// project hiện tại + repo git đang scope. Mọi state sống ở MODULE level
// (singleton): FilesView/ScmView/GithubView + WorkbenchView (badge view rail)
// đọc cùng một nguồn, và cây đã expand sống sót khi user đổi view rail / ẩn
// panel. SoC: chỉ orchestrate IPC (useSidecar/useFsApi) + store (workbench,
// git, sessions, projects); component chỉ bind — không gọi RPC trực tiếp.
import { computed, reactive, ref, watch } from 'vue'
import type { FsEntry } from '~/composables/useFsApi'
import { useFsApi } from '~/composables/useFsApi'
import { useGitApi } from '~/composables/useGitApi'
import type { MenuItem } from '~/composables/useContextMenu'
import { useSidecar } from '~/composables/useSidecar'
import { useConfirm } from '~/composables/useConfirm'
import { useToast } from '~/composables/useToast'
import { useGitStore } from '~/stores/git'
import { useProjectsStore } from '~/stores/projects'
import { useSessionsStore } from '~/stores/sessions'
import { useWorkbenchStore } from '~/stores/workbench'
import type { WorkbenchDocKind } from '~/types/workbench'
import { copyText } from '~/utils/clipboard'

// Một hàng trong menu chuột phải của workbench — MenuItem có sẵn + action đính
// kèm (workbench không dùng children/submenu).
export type WbCtxItem = Omit<MenuItem, 'children'> & { action?: () => void | Promise<void> }

// ── Menu chuột phải dùng chung (WorkbenchContextMenu render state này) ────────
const menuOpen = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuItems = ref<WbCtxItem[]>([])

const MENU_W = 200
const MENU_H = 360

function openWbMenu(items: WbCtxItem[], e: MouseEvent): void {
  e.preventDefault()
  e.stopPropagation()
  menuItems.value = items
  menuX.value = Math.min(e.clientX, window.innerWidth - MENU_W - 6)
  menuY.value = Math.min(e.clientY, window.innerHeight - MENU_H - 6)
  menuOpen.value = true
}

// ── Path helpers (đường dẫn tương đối kiểu POSIX trong workspace) ─────────────
const baseName = (p: string): string => p.split('/').pop() ?? p
const parentOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const joinPath = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name)
const isUnder = (p: string, dir: string): boolean => p === dir || p.startsWith(dir + '/')

export type TreeRow = {
  kind: 'row'
  path: string
  name: string
  depth: number
  isDir: boolean
  expanded: boolean
}
export type InputRow = {
  kind: 'input'
  path: string
  depth: number
  isDir: boolean
  initial: string
}
export type WbRow = TreeRow | InputRow

export type PendingEdit =
  | { mode: 'create'; isDir: boolean; parent: string; afterPath?: string; depth: number }
  | { mode: 'rename'; isDir: boolean; path: string; initial: string; depth: number }

// ── Mock fs cho browser-dev (không có sidecar bridge ⇒ fs.* trả rỗng) ─────────
// Chỉ ảnh hưởng `pnpm dev` ngoài Electron; đọc-only, không write ops.
const MOCK_FS: Record<string, FsEntry[]> = {
  '': [
    { name: 'apps', path: 'apps', kind: 'dir' },
    { name: 'docs', path: 'docs', kind: 'dir' },
    { name: 'CLAUDE.md', path: 'CLAUDE.md', kind: 'file' },
    { name: 'package.json', path: 'package.json', kind: 'file' },
  ],
  apps: [{ name: 'desktop', path: 'apps/desktop', kind: 'dir' }],
  'apps/desktop': [{ name: 'ui-next', path: 'apps/desktop/ui-next', kind: 'dir' }],
  'apps/desktop/ui-next': [
    { name: 'components', path: 'apps/desktop/ui-next/components', kind: 'dir' },
    { name: 'composables', path: 'apps/desktop/ui-next/composables', kind: 'dir' },
    { name: 'stores', path: 'apps/desktop/ui-next/stores', kind: 'dir' },
    { name: 'nuxt.config.ts', path: 'apps/desktop/ui-next/nuxt.config.ts', kind: 'file' },
  ],
  'apps/desktop/ui-next/components': [
    { name: 'session', path: 'apps/desktop/ui-next/components/session', kind: 'dir' },
    { name: 'workbench', path: 'apps/desktop/ui-next/components/workbench', kind: 'dir' },
  ],
  'apps/desktop/ui-next/components/session': [
    {
      name: 'SessionComposer.vue',
      path: 'apps/desktop/ui-next/components/session/SessionComposer.vue',
      kind: 'file',
    },
    {
      name: 'SessionDetail.vue',
      path: 'apps/desktop/ui-next/components/session/SessionDetail.vue',
      kind: 'file',
    },
  ],
  'apps/desktop/ui-next/components/workbench': [
    {
      name: 'WorkbenchView.vue',
      path: 'apps/desktop/ui-next/components/workbench/WorkbenchView.vue',
      kind: 'file',
    },
    {
      name: 'WorkbenchExplorer.vue',
      path: 'apps/desktop/ui-next/components/workbench/WorkbenchExplorer.vue',
      kind: 'file',
    },
  ],
  'apps/desktop/ui-next/composables': [
    {
      name: 'useSessionTranscript.ts',
      path: 'apps/desktop/ui-next/composables/useSessionTranscript.ts',
      kind: 'file',
    },
    {
      name: 'useWorkbenchExplorer.ts',
      path: 'apps/desktop/ui-next/composables/useWorkbenchExplorer.ts',
      kind: 'file',
    },
  ],
  'apps/desktop/ui-next/stores': [
    { name: 'sessions.ts', path: 'apps/desktop/ui-next/stores/sessions.ts', kind: 'file' },
    { name: 'workbench.ts', path: 'apps/desktop/ui-next/stores/workbench.ts', kind: 'file' },
  ],
  docs: [
    { name: 'decisions', path: 'docs/decisions', kind: 'dir' },
    { name: 'flow.mmd', path: 'docs/flow.mmd', kind: 'file' },
  ],
  'docs/decisions': [
    {
      name: '0098-session-workbench-ide-layout.md',
      path: 'docs/decisions/0098-session-workbench-ide-layout.md',
      kind: 'file',
    },
  ],
}

// ── Extension → doc kind / icon (bảng prototype: md/img/vid/mmd, còn lại file) ─
// Bảng lookup tĩnh → Record theo convention.
const IMG_EXT: Record<string, true> = {
  png: true,
  jpg: true,
  jpeg: true,
  gif: true,
  svg: true,
  webp: true,
}
const VID_EXT: Record<string, true> = { mp4: true, mov: true, webm: true }
const MMD_EXT: Record<string, true> = { mmd: true, mermaid: true }

export function docKindFor(name: string): WorkbenchDocKind {
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : ''
  if (ext === 'md') return 'md'
  if (IMG_EXT[ext]) return 'img'
  if (VID_EXT[ext]) return 'vid'
  if (MMD_EXT[ext]) return 'mmd'
  return 'file'
}

// ── Remote git → https base (commit URL + GitHub repo link) ───────────────────
// Sao y parseRemoteUrl của stores/git (private): ssh git@host:o/r(.git) và
// https://host/o/r(.git); null khi shape lạ.
export function parseGitRemoteUrl(
  raw: string,
): { host: string; owner: string; repo: string } | null {
  const url = raw.trim()
  if (!url) return null
  const stripGit = (s: string): string => (s.endsWith('.git') ? s.slice(0, -4) : s)
  const ssh = /^[^@]+@([^:]+):(.+?)\/([^/]+?)\/?$/.exec(url)
  if (ssh?.[1] && ssh[2] && ssh[3]) return { host: ssh[1], owner: ssh[2], repo: stripGit(ssh[3]) }
  const https = /^https?:\/\/([^/]+)\/(.+?)\/([^/]+?)\/?$/.exec(url)
  if (https?.[1] && https[2] && https[3])
    return { host: https[1], owner: https[2], repo: stripGit(https[3]) }
  return null
}

// Mở một URL thành doc 'web' trên stage. Ưu tiên tab thật của embedded browser
// (browId); khi bridge vắng mặt (browser-dev) rơi về doc id mang URL để surface
// web tự đọc.
export async function openWebDoc(url: string, title: string): Promise<void> {
  const wb = useWorkbenchStore()
  let browId: string | undefined
  try {
    const created = await window.awog?.browser?.newTab(url, { wait: false })
    if (created?.tabId) browId = created.tabId
  } catch {
    // Bridge vắng — vẫn mở doc web bằng URL (surface tự xử lý).
  }
  const id = browId ? `web-${browId}` : `web-${url}`
  wb.openDoc({ kind: 'web', id, title: title || url, ...(browId ? { browId } : {}) })
}

// ══ Singleton state ══════════════════════════════════════════════════════════

// Repos đã discover của project hiện tại (song lập với repoPathByLabel private
// của git store — label hiển thị = name cho root, relativePath cho repo con).
const repoEntries = ref<{ path: string; name: string; relativePath: string; isRoot: boolean }[]>([])

// Tree: children theo dir ('' = root), dir đã expand, kind cache quyết định
// dirForNew + icon + rename.
const childrenByPath = reactive<Record<string, FsEntry[]>>({})
const expanded = reactive(new Set<string>())
const kindByPath = new Map<string, 'file' | 'dir'>()
const pending = ref<PendingEdit | null>(null)
const pendingError = ref(false)

const sortEntries = (list: FsEntry[]): FsEntry[] =>
  [...list].sort((a, b) =>
    a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name),
  )

// ── Cache cây theo project ────────────────────────────────────────────────────
// Đổi project từng xoá sạch cây rồi chờ git scope + watcher + discoverRepos XONG
// mới nạp lại root ⇒ mỗi lần chuyển qua lại là một khoảng trống + mất hết thư mục
// đang mở. Nay cất trạng thái cây của project vừa rời đi, quay lại thì vẽ NGAY từ
// bản cất (giữ nguyên thư mục đang mở + node đang chọn) rồi nạp lại nền các dir đã
// load — watcher chỉ theo dõi project hiện tại nên thay đổi lúc vắng mặt phải nạp
// lại. Giới hạn LRU vì mỗi bản là danh sách entry của mọi dir đã từng mở.
type TreeSnapshot = {
  children: Record<string, FsEntry[]>
  expanded: string[]
  kinds: [string, 'file' | 'dir'][]
  selPath: string
}
const TREE_CACHE_MAX = 8
const treeCache = new Map<string, TreeSnapshot>()

function rememberTree(root: string, snap: TreeSnapshot): void {
  treeCache.delete(root)
  treeCache.set(root, snap)
  if (treeCache.size > TREE_CACHE_MAX) {
    const oldest = treeCache.keys().next().value
    if (oldest !== undefined) treeCache.delete(oldest)
  }
}

// Hai lần listDir cùng một dir trả cùng nội dung ⇒ giữ mảng cũ để `rows` không
// tính lại và Vue không vá lại cả cây chỉ vì một lần nạp lại nền.
const sameEntries = (a: FsEntry[], b: FsEntry[]): boolean =>
  a.length === b.length && a.every((e, i) => e.path === b[i]?.path && e.kind === b[i]?.kind)

// ── Flatten rows cho render (DFS theo expanded) ───────────────────────────────
const rows = computed<WbRow[]>(() => {
  const out: WbRow[] = []
  const p = pending.value
  const walk = (dir: string, depth: number): void => {
    // Hàng input create ở ĐẦU nhóm con khi không có neo "sau file đang chọn".
    if (p?.mode === 'create' && p.parent === dir && !p.afterPath) {
      out.push({ kind: 'input', path: `new:${dir}`, depth, isDir: p.isDir, initial: '' })
    }
    for (const e of childrenByPath[dir] ?? []) {
      if (p?.mode === 'rename' && p.path === e.path) {
        out.push({ kind: 'input', path: e.path, depth, isDir: e.kind === 'dir', initial: e.name })
        continue
      }
      const ex = e.kind === 'dir' && expanded.has(e.path)
      out.push({
        kind: 'row',
        path: e.path,
        name: e.name,
        depth,
        isDir: e.kind === 'dir',
        expanded: ex,
      })
      if (ex) walk(e.path, depth + 1)
      // Neo create "cùng cấp" — ngay sau file đang chọn.
      if (p?.mode === 'create' && p.afterPath === e.path) {
        out.push({ kind: 'input', path: `new:${e.path}`, depth, isDir: p.isDir, initial: '' })
      }
    }
  }
  walk('', 0)
  return out
})

// ══ Lifecycle ════════════════════════════════════════════════════════════════
// init() chỉ chạy một lần (WorkbenchExplorer mount) — các consumer khác chỉ đọc
// state/handler, không tự reset cây.
let lifecycleStarted = false
let watchedRoot = ''
let refreshTimer: ReturnType<typeof setTimeout> | null = null

// ══ Composable ═══════════════════════════════════════════════════════════════
export function useWorkbenchExplorer() {
  const sc = useSidecar()
  const fs = useFsApi()
  const git = useGitStore()
  const projectsStore = useProjectsStore()
  const sessions = useSessionsStore()
  const wb = useWorkbenchStore()
  const { confirm } = useConfirm()
  const toast = useToast()

  const notifyErr = (err: unknown): void => {
    toast.add({ title: err instanceof Error ? err.message : String(err), color: 'error' })
  }

  // ── Project hiện tại + repo đang scope ─────────────────────────────────────
  // Workbench theo tab project đang mở trong Sessions; '' (Default) → project
  // đầu danh sách (slice E thay bằng switcher thật).
  const project = computed(() => {
    const list = git.projects.length ? git.projects : projectsStore.projects
    const tab = sessions.activeTab
    if (tab) {
      const hit = list.find((p) => p.id === tab) ?? list.find((p) => p.name === tab)
      if (hit) return hit
    }
    const cur = list.find((p) => p.id === git.currentProjectId)
    return cur ?? list[0] ?? null
  })
  const projectId = computed(() => project.value?.id ?? '')
  const root = computed(() => project.value?.path ?? '')

  // Repo con đang scope → tiền tố đường dẫn (git status trả repo-relative,
  // cây fs trả project-relative — nối lại trước khi mở doc/select).
  const repoPrefix = computed(() => {
    const cur = repoEntries.value.find((e) => e.name === git.repo || e.relativePath === git.repo)
    return cur && !cur.isRoot ? cur.relativePath.replace(/^\/+|\/+$/g, '') : ''
  })
  const projectPath = (repoPath: string): string =>
    repoPrefix.value ? `${repoPrefix.value}/${repoPath}` : repoPath

  const ghBase = computed(() => {
    const remote = git.remotes.find((r) => r.name === 'origin') ?? git.remotes[0]
    if (!remote) return ''
    const parsed = parseGitRemoteUrl(remote.fetchUrl || remote.pushUrl)
    return parsed ? `https://${parsed.host}/${parsed.owner}/${parsed.repo}` : ''
  })

  // ── Tree ops ──────────────────────────────────────────────────────────────
  async function listDir(dir: string): Promise<FsEntry[]> {
    if (!sc.available) return sortEntries(MOCK_FS[dir] ?? [])
    const res = await fs.listDir(root.value, dir || undefined)
    // Ẩn metadata nội bộ — giống VS Code mặc định.
    return sortEntries(res.entries.filter((e) => e.name !== '.git' && e.name !== '.DS_Store'))
  }

  async function loadDir(dir: string, force = false): Promise<void> {
    const r = root.value
    if (!r || (childrenByPath[dir] && !force)) return
    let entries: FsEntry[]
    try {
      entries = await listDir(dir)
    } catch {
      // Dir không đọc được (mất quyền/đã xoá) — để trống, tree vẫn render.
      entries = []
    }
    // Người dùng đã chuyển project trong lúc chờ: kết quả là của cây khác.
    if (root.value !== r) return
    const prev = childrenByPath[dir]
    if (prev && sameEntries(prev, entries)) return
    childrenByPath[dir] = entries
    for (const e of entries) kindByPath.set(e.path, e.kind)
  }

  async function toggleDir(path: string): Promise<void> {
    if (expanded.has(path)) {
      expanded.delete(path)
      return
    }
    await loadDir(path)
    expanded.add(path)
  }

  /** Mở rộng mọi dir tổ tiên của path (sau create/rename/select sâu). */
  async function expandTo(path: string): Promise<void> {
    let dir = parentOf(path)
    const chain: string[] = []
    while (dir) {
      chain.unshift(dir)
      dir = parentOf(dir)
    }
    for (const d of chain) {
      await loadDir(d)
      expanded.add(d)
    }
  }

  function openFileDoc(projectRel: string): void {
    const name = baseName(projectRel)
    wb.openDoc({ kind: docKindFor(name), id: projectRel, title: name })
  }

  async function selectNode(path: string, isDir: boolean): Promise<void> {
    wb.selPath = path
    if (isDir) await toggleDir(path)
    else openFileDoc(path)
  }

  /** Thư mục cha cho New File/Folder: dir đang chọn → vào trong; file → cùng cấp; không chọn → root. */
  function dirForNew(): string {
    const sel = wb.selPath
    if (!sel) return ''
    return kindByPath.get(sel) === 'dir' ? sel : parentOf(sel)
  }

  // ── Inline create / rename ────────────────────────────────────────────────
  async function startCreate(isDir: boolean, insideDir?: string): Promise<void> {
    const parent = insideDir ?? dirForNew()
    await expandTo(parent)
    const sel = wb.selPath
    const afterPath =
      insideDir === undefined && sel && kindByPath.get(sel) !== 'dir' ? sel : undefined
    const depth = parent ? parent.split('/').length : 0
    pending.value = { mode: 'create', isDir, parent, afterPath, depth }
    pendingError.value = false
  }

  function startRename(path: string): void {
    const isDir = kindByPath.get(path) === 'dir'
    const depth = path.split('/').length - 1
    pending.value = { mode: 'rename', isDir, path, initial: baseName(path), depth }
    pendingError.value = false
  }

  function cancelPending(): void {
    pending.value = null
    pendingError.value = false
  }

  // Lỗi "đã tồn tại" của sidecar (createFile EEXIST / rename 'Target already
  // exists') → input đỏ giữ focus; lỗi khác đi qua toast.
  const isExistsErr = (err: unknown): boolean =>
    /already exists/i.test(err instanceof Error ? err.message : String(err))

  async function commitPending(name: string): Promise<void> {
    const p = pending.value
    if (!p) return
    const parts = name
      .trim()
      .split('/')
      .filter((seg) => seg !== '')
    // Tên rỗng / ký tự hệ thống / leo cấp → báo đỏ, giữ input.
    if (!parts.length || parts.some((seg) => seg === '.' || seg === '..' || seg.includes('\\'))) {
      pendingError.value = true
      return
    }
    if (!sc.available) {
      // Browser-dev: không ghi đĩa — đóng input như huỷ, không giả lập tạo file.
      cancelPending()
      return
    }

    if (p.mode === 'rename') {
      const parent = parentOf(p.path)
      const target = joinPath(parent, parts.join('/'))
      if (target === p.path) {
        cancelPending()
        return
      }
      try {
        await fs.rename(root.value, p.path, target)
      } catch (err) {
        if (isExistsErr(err)) {
          pendingError.value = true
          return
        }
        notifyErr(err)
        return
      }
      pruneTreeOf(p.path)
      await refreshDir(parent)
      pending.value = null
      if (isUnder(wb.selPath, p.path)) wb.selPath = target + wb.selPath.slice(p.path.length)
      // Doc đang mở trỏ path cũ → đóng, mở lại theo path mới (giữ kind).
      for (const d of [...wb.docs]) {
        if (d.kind !== 'chat' && isUnder(d.id, p.path)) {
          wb.closeDoc(d.id)
          openFileDoc(target + d.id.slice(p.path.length))
        }
      }
      return
    }

    // create — hỗ trợ cấp lồng a/b/c.ts: tạo thư mục trung gian trước
    // (createDir = mkdir recursive, đã có thì no-op).
    const rel = joinPath(p.parent, parts.join('/'))
    try {
      if (parts.length > 1) {
        await fs.createDir(root.value, joinPath(p.parent, parts.slice(0, -1).join('/')))
      }
      if (p.isDir) await fs.createDir(root.value, rel)
      else await fs.createFile(root.value, rel)
    } catch (err) {
      if (isExistsErr(err)) {
        pendingError.value = true
        return
      }
      notifyErr(err)
      return
    }
    pending.value = null
    // Nạp lại các dir trên đường tới node mới rồi chọn nó.
    await expandTo(rel)
    await refreshDir(p.parent)
    if (parts.length > 1) {
      await refreshDir(joinPath(p.parent, parts.slice(0, -1).join('/')))
    }
    wb.selPath = rel
    kindByPath.set(rel, p.isDir ? 'dir' : 'file')
    if (!p.isDir) openFileDoc(rel)
  }

  /** Gỡ path khỏi cache cây (children/expanded/kind) — dùng sau rename/xoá dir. */
  function pruneTreeOf(path: string): void {
    for (const key of Object.keys(childrenByPath)) {
      if (isUnder(key, path)) delete childrenByPath[key]
    }
    for (const key of [...expanded]) {
      if (isUnder(key, path)) expanded.delete(key)
    }
    for (const key of [...kindByPath.keys()]) {
      if (isUnder(key, path)) kindByPath.delete(key)
    }
  }

  /** Nạp lại một dir đã cache (no-op khi chưa load — không tự mở rộng). */
  async function refreshDir(dir: string): Promise<void> {
    if (!(dir in childrenByPath)) return
    await loadDir(dir, true)
  }

  /** Refresh explorer: nạp lại mọi dir đã load (expand giữ nguyên). */
  async function refreshAll(): Promise<void> {
    await Promise.all(Object.keys(childrenByPath).map((d) => loadDir(d, true)))
  }

  // ── Actions của context menu ───────────────────────────────────────────────
  /** Collapse all — đóng mọi dir đã expand (kể cả dir con ẩn trong cha đóng). */
  function collapseAll(): void {
    expanded.clear()
  }

  function openTerminalHere(dir: string): void {
    wb.dockView = 'Terminal'
    wb.toggleDock(true)
    const cwd = root.value ? `${root.value}${dir ? `/${dir}` : ''}` : dir
    wb.addTermTab(cwd)
  }

  async function deletePath(path: string, isDir: boolean): Promise<void> {
    const ok = await confirm({
      title: isDir ? 'Xoá thư mục' : 'Xoá tệp',
      description: isDir ? `${path} và toàn bộ nội dung bên trong?` : path,
      confirmLabel: 'Xoá',
      kind: 'danger',
    })
    if (!ok) return
    try {
      await fs.deletePath(root.value, path, isDir)
    } catch (err) {
      notifyErr(err)
      return
    }
    pruneTreeOf(path)
    await refreshDir(parentOf(path))
    if (isUnder(wb.selPath, path)) wb.selPath = ''
    for (const d of [...wb.docs]) {
      if (d.kind !== 'chat' && isUnder(d.id, path)) wb.closeDoc(d.id)
    }
    toast.add({ title: `Đã xoá ${baseName(path)}`, color: 'neutral' })
  }

  const copyAbsPath = (path: string): Promise<boolean> =>
    copyText(root.value ? `${root.value}/${path}` : path)

  /** Context menu cho một node của cây (file hoặc dir) — parity VS Code. */
  function fileCtxMenu(path: string, isDir: boolean, e: MouseEvent): void {
    const items: WbCtxItem[] = isDir
      ? [
          { label: 'Tệp mới…', action: () => startCreate(false, path) },
          { label: 'Thư mục mới…', action: () => startCreate(true, path) },
          { separator: true },
          { label: 'Mở Terminal ở đây', action: () => openTerminalHere(path) },
          { separator: true },
          { label: 'Đổi tên…', hint: 'F2', action: () => startRename(path) },
          { label: 'Xoá thư mục', danger: true, action: () => deletePath(path, true) },
          { separator: true },
          { label: 'Chép đường dẫn', action: () => copyAbsPath(path) },
          { label: 'Chép đường dẫn tương đối', action: () => copyText(path) },
        ]
      : [
          { label: 'Mở', action: () => openFileDoc(path) },
          { label: 'Mở bên cạnh (split)', action: () => openFileDoc(path) },
          { separator: true },
          {
            label: 'Hiện trong Finder',
            action: async () => {
              if (sc.available && root.value) await sc.revealPath(root.value, path)
            },
          },
          { label: 'Mở Terminal ở đây', action: () => openTerminalHere(parentOf(path)) },
          { separator: true },
          { label: 'Cắt', disabled: true },
          { label: 'Sao chép', disabled: true },
          { label: 'Đổi tên…', hint: 'F2', action: () => startRename(path) },
          { label: 'Xoá', danger: true, hint: '⌫', action: () => deletePath(path, false) },
          { separator: true },
          { label: 'Chép đường dẫn', action: () => copyAbsPath(path) },
          { label: 'Chép đường dẫn tương đối', action: () => copyText(path) },
        ]
    openWbMenu(items, e)
  }

  /** Menu khi bấm chuột phải vào vùng trống của cây (dưới đáy). */
  function blankCtxMenu(e: MouseEvent): void {
    openWbMenu(
      [
        { label: 'Tệp mới…', action: () => startCreate(false, '') },
        { label: 'Thư mục mới…', action: () => startCreate(true, '') },
        { separator: true },
        { label: 'Làm mới', action: refreshAll },
        { label: 'Thu gọn tất cả', action: collapseAll },
      ],
      e,
    )
  }

  // ── Git scope + fs watcher ─────────────────────────────────────────────────
  function queueFsRefresh(): void {
    clearTimeout(refreshTimer ?? undefined)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      for (const d of Object.keys(childrenByPath)) void loadDir(d, true)
    }, 250)
  }

  async function ensureWatch(): Promise<void> {
    const r = root.value
    if (!sc.available || !r || watchedRoot === r) return
    if (watchedRoot) await fs.unwatch(watchedRoot).catch(() => {})
    try {
      await fs.watch(r)
      watchedRoot = r
    } catch {
      watchedRoot = ''
    }
  }

  async function loadRepoEntries(): Promise<void> {
    const r = root.value
    if (!sc.available || !r) return
    let repos: typeof repoEntries.value
    try {
      repos = (await useGitApi().discoverRepos(r)).repos
    } catch {
      repos = []
    }
    // Chuyển project trong lúc dò: bỏ kết quả của project cũ.
    if (root.value === r) repoEntries.value = repos
  }

  // File doc đang mở → reveal trong cây: expand mọi dir tổ tiên + chọn node.
  // `revealActive` = nút toolbar FilesView (scroll=true) — cùng 1 hàm.
  const revealRel = (doc: { id: string; rel?: string }): string | null => {
    let rel = doc.rel ?? doc.id
    if (!doc.rel) {
      const slash = rel.indexOf('/')
      if (slash > 0) {
        const prefix = rel.slice(0, slash)
        const all = git.projects.length ? git.projects : projectsStore.projects
        if (all.some((p) => p.id === prefix)) rel = rel.slice(slash + 1)
      }
    }
    return rel || null
  }
  async function revealActive(scroll = false): Promise<void> {
    const docId = wb.activeDoc
    if (!docId) return
    const doc = wb.docs.find((d) => d.id === docId)
    if (!doc || !['file', 'md', 'img', 'vid', 'mmd'].includes(doc.kind)) return
    const rel = revealRel(doc)
    if (!rel) return
    await expandTo(rel)
    wb.selPath = rel
    if (scroll) {
      // Cây render phẳng — node mới nhảy vào sau expandTo → chờ 2 frame rồi cuộn.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          document
            .querySelector(`[data-wb-tree-path="${CSS.escape(rel)}"]`)
            ?.scrollIntoView({ block: 'nearest' })
        }),
      )
    }
  }

  /** Khởi động một lần từ WorkbenchExplorer (scope git + watcher + root load). */
  async function init(): Promise<void> {
    if (lifecycleStarted) return
    lifecycleStarted = true
    // Git store: nạp project roster + subscribe 1 lần, scope theo tab đang mở.
    await git.ensureScoped(sessions.activeTab || null)
    await loadRepoEntries()
    await ensureWatch()
    await loadDir('')

    // Listener fs:changed — gom debounce rồi nạp lại các dir đã load.
    if (sc.available) {
      void sc
        .onEvent((evt) => {
          if (evt.type !== 'fs:changed') return
          const payload = evt.payload as { workspaceRoot?: string } | null
          if (payload?.workspaceRoot === root.value) queueFsRefresh()
        })
        .catch(() => {})
    }

    // Đổi project → cất cây của project vừa rời, vẽ ngay cây đã cất của project
    // mới (nếu có), RỒI mới re-scope git + watcher + repo con song song ở nền.
    // Trước đây cây trống cho tới khi ba bước đó chạy tuần tự xong.
    watch(root, async (r, prev) => {
      if (!r || r === prev) return
      if (prev) {
        rememberTree(prev, {
          children: { ...childrenByPath },
          expanded: [...expanded],
          kinds: [...kindByPath],
          selPath: wb.selPath,
        })
      }
      for (const k of Object.keys(childrenByPath)) delete childrenByPath[k]
      expanded.clear()
      kindByPath.clear()
      pending.value = null
      const snap = treeCache.get(r)
      if (snap) {
        Object.assign(childrenByPath, snap.children)
        for (const p of snap.expanded) expanded.add(p)
        for (const [p, k] of snap.kinds) kindByPath.set(p, k)
        wb.selPath = snap.selPath
      } else {
        wb.selPath = ''
      }
      const scoped =
        projectId.value && projectId.value !== git.currentProjectId
          ? git.ensureScoped(projectId.value)
          : Promise.resolve()
      // Có bản cất ⇒ nạp lại nền mọi dir đã load (thay đổi lúc vắng mặt không có
      // watcher nào báo); chưa có ⇒ chỉ cần root.
      const tree = snap ? refreshAll() : loadDir('')
      await Promise.all([tree, scoped, ensureWatch(), loadRepoEntries()])
    })

    watch(
      () => wb.activeDoc,
      () => void revealActive(false),
      { immediate: true },
    )
  }

  // Expose reveal cho nút toolbar FilesView (scroll = true để cuộn tới node).
  const revealActiveDoc = async (): Promise<void> => revealActive(true)

  return {
    // project/repo
    project,
    projectId,
    root,
    repoEntries,
    repoPrefix,
    projectPath,
    ghBase,
    // tree
    rows,
    pending,
    pendingError,
    toggleDir,
    selectNode,
    revealActiveDoc,
    startCreate,
    startRename,
    cancelPending,
    commitPending,
    refreshAll,
    collapseAll,
    refreshDir,
    // actions / menu
    fileCtxMenu,
    blankCtxMenu,
    openTerminalHere,
    deletePath,
    openFileDoc,
    copyAbsPath,
    // menu state (WorkbenchContextMenu bind)
    menuOpen,
    menuX,
    menuY,
    menuItems,
    openWbMenu,
    closeWbMenu: () => {
      menuOpen.value = false
    },
    // lifecycle
    init,
  }
}
