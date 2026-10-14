// Doc orchestration for the Session Workbench (ADR 0098, slice C). Sits on top of
// the layout-level `useWorkbenchStore` (openDoc/closeDoc/markDirty) and adds the
// parts the surfaces need:
//   • kind inference from a file path (.md → md, .png → img, .mmd → mmd, …)
//   • project-root resolution for file docs (project id = sessions.activeTab)
//   • a module-level file-content cache so DocFile/DocMd share a model per doc
//   • save/close flows: ⌘S → fs.writeFile; closing a dirty doc → confirm; closing
//     a 'web' doc → also closes the native tab it shows
// SoC: orchestrates sidecar IPC + store only — no fs/DOM of its own.
import { computed, effectScope, reactive, watch } from 'vue'
import type { WorkbenchDoc, WorkbenchDocKind } from '~/types/workbench'
import { useWorkbenchStore } from '~/stores/workbench'
import { useProjectsStore } from '~/stores/projects'
import { useGitStore } from '~/stores/git'
import { useSessionsStore } from '~/stores/sessions'
import { useFsApi } from '~/composables/useFsApi'
import { sidecarErrorText, useSidecar } from '~/composables/useSidecar'
import { useConfirm } from '~/composables/useConfirm'

// Monaco language by extension — same table as useCodeWorkspace (readFile may
// return a better guess; this covers the not-yet-read window).
const EXT_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  vue: 'vue',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
  css: 'css',
  scss: 'scss',
  html: 'html',
  yaml: 'yaml',
  yml: 'yaml',
  py: 'python',
  rs: 'rust',
  go: 'go',
  sh: 'shell',
  toml: 'toml',
  sql: 'sql',
}

const IMG_EXT: Record<string, true> = {
  png: true,
  jpg: true,
  jpeg: true,
  gif: true,
  webp: true,
  avif: true,
  bmp: true,
  svg: true,
}
const VID_EXT: Record<string, true> = { mp4: true, m4v: true, webm: true, mov: true, mkv: true }
const MD_EXT: Record<string, true> = { md: true, markdown: true }
const MMD_EXT: Record<string, true> = { mmd: true, mermaid: true }

/** Doc kind a workspace file opens as. Non-media/text extensions → code doc. */
export function inferDocKind(path: string): WorkbenchDocKind {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (MD_EXT[ext]) return 'md'
  if (IMG_EXT[ext]) return 'img'
  if (VID_EXT[ext]) return 'vid'
  if (MMD_EXT[ext]) return 'mmd'
  return 'file'
}

// ── File state cache (per doc id) ────────────────────────────────────────────
// Module-level so DocFile (code view) and DocMd (preview ↔ edit) of the same doc
// share one truth: edits flip `content`, save syncs `saved` + clears the dirty
// flag in the workbench store. Entries are pruned when the doc closes.
export type WbFileStatus = 'idle' | 'loading' | 'ok' | 'error'
export interface WbFileState {
  status: WbFileStatus
  /** Current text — for editors this is the live model value (dirty edits count). */
  content: string
  /** Bytes at last load/save — dirty = content !== saved. */
  saved: string
  /** Absolute project root the path resolves against (captured at load). */
  root: string
  /** Monaco language. */
  language?: string
  /** Base64 payload for binary kinds (img). '' while loading/unavailable. */
  base64: string
  mimeType: string
  /** File size in bytes as reported by readFileBase64. */
  byteSize: number
  isBinary: boolean
  truncated: boolean
  error: string
  /** Nội dung trên đĩa khác `saved` (sửa từ ngoài app: agent, editor khác, git).
      Chỉ BÁO — nạp lại là việc người dùng bấm (DocReloadButton). */
  diskChanged: boolean
}
const fileStates = reactive(new Map<string, WbFileState>())
const loaded = new Set<string>()
const loading = new Map<string, Promise<void>>()
// Doc kind đọc bằng fs.readFile (text) — chỉ những kind này dò được thay đổi
// trên đĩa bằng so nội dung; img/vid đọc base64 nặng nên không dò.
const TEXT_KINDS: Partial<Record<WorkbenchDocKind, true>> = { file: true, md: true, mmd: true }
const checking = new Set<string>()
// Listener fs:changed + activeDoc + window focus: cài MỘT lần cho cả app, trong
// effect scope tách rời (không chết theo component gọi đầu tiên).
let diskWatchInstalled = false

export function useWorkbenchDocs() {
  const wb = useWorkbenchStore()
  const projectsStore = useProjectsStore()
  const sessions = useSessionsStore()
  const fs = useFsApi()
  const { confirm } = useConfirm()
  const sc = useSidecar()
  const { t } = useI18n()
  const toast = useToast()

  const browserApi = () => (typeof window === 'undefined' ? null : (window.awog?.browser ?? null))

  // Project the workbench stage is bound to = the Sessions tab của session
  // shown in the Trao đổi doc. Cùng luật resolve với useWorkbenchExplorer
  // (git.projects trước, match theo id HOẶC name, fallback list[0]) — resolve
  // chỉ qua projectsStore thì mở file báo "chưa chọn project" khi projectsStore
  // chưa kịp load dù cây explorer vẫn đổ file bình thường.
  const git = useGitStore()
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
  // project.path đã là absolute root — không cần useWorkspaceData resolve lại
  // (nó match qua engine projects.list, lệch một bước so với cây explorer).
  const root = computed(() => project.value?.path ?? null)

  /** Workspace root of a file doc. Its project id is the doc id prefix
      (`projectId/path`); docs without the prefix use the stage project. */
  function rootFor(doc: WorkbenchDoc): string | null {
    if (doc.root) return doc.root // doc 'abs:' — file ngoài mọi project
    const slash = doc.id.indexOf('/')
    if (slash > 0) {
      const all = git.projects.length ? git.projects : projectsStore.projects
      const hit = all.find((p) => p.id === doc.id.slice(0, slash))
      if (hit) return hit.path
    }
    return root.value
  }
  /** Workspace-relative path a file doc's id carries. Chỉ cắt segment đầu khi
      nó THỰC SỰ là project id — openFileDoc của explorer lưu id = path không
      prefix, cắt bừa làm mất segment đầu của đường dẫn. */
  function relPathOf(doc: WorkbenchDoc): string {
    if (doc.rel) return doc.rel // doc 'abs:'
    const slash = doc.id.indexOf('/')
    if (slash > 0) {
      const prefix = doc.id.slice(0, slash)
      const all = git.projects.length ? git.projects : projectsStore.projects
      if (all.some((p) => p.id === prefix)) return doc.id.slice(slash + 1)
    }
    return doc.id
  }
  function absPathOf(doc: WorkbenchDoc): string | null {
    const r = rootFor(doc)
    return r ? `${r}/${relPathOf(doc)}` : null
  }

  // ── Openers ─────────────────────────────────────────────────────────────────
  function openFile(projectId: string, relPath: string): void {
    wb.openDoc({
      kind: inferDocKind(relPath),
      id: `${projectId}/${relPath}`,
      title: relPath.split('/').pop() || relPath,
    })
  }

  /** Doc cho file TUYỆT ĐỐI ngoài mọi project (memory file, worktree draft,…):
      root = thư mục cha (đủ cho assertInsideWorkspace), rel = basename. */
  function openFileAbs(root: string, relPath: string): void {
    wb.openDoc({
      kind: inferDocKind(relPath),
      id: `abs:${root}/${relPath}`,
      title: relPath,
      root,
      rel: relPath,
    })
  }

  /** Mở diff working-tree/staged của một file là doc tab (thay dock 'Diff'
      đã gỡ). Id prefix `diff:` + suffix `:staged` tách khỏi doc file thường —
      relPathOf không cắt vì `diff:` không phải project id. */
  function openDiff(projectId: string, relPath: string, staged = false): void {
    wb.openDoc({
      kind: 'diff',
      id: `diff:${projectId}/${relPath}${staged ? ':staged' : ''}`,
      title: `Diff · ${relPath.split('/').pop() || relPath}`,
    })
  }

  /** Tab đã có của app browser → doc. `title` là fallback cho tới khi
      `browser:changed` đưa title thật về. */
  async function openWebTab(tabId: string, opts?: { title?: string }): Promise<void> {
    wb.openDoc({
      kind: 'web',
      id: `web-${tabId}`,
      title: opts?.title || t('workbench.web.newTab'),
      browId: tabId,
    })
  }

  /** Nút `＋` trên dải tab + chip pin — tab mới trong pool global rồi mở doc web
      cho nó. `url` vắng = trang trắng (new-tab của app). */
  async function openNewWebDoc(url?: string): Promise<void> {
    const api = browserApi()
    if (api) {
      try {
        const created = await api.newTab(url, { wait: false })
        await openWebTab(created.tabId, { title: created.title || url })
        return
      } catch {
        // Bridge lỗi → vẫn mở doc rỗng, DocWeb hiện trạng thái "tab không còn".
      }
    }
    wb.openDoc({
      kind: 'web',
      id: `web-${Date.now()}`,
      title: url || t('workbench.web.newTab'),
    })
  }

  // ── File state ──────────────────────────────────────────────────────────────
  function fileStateOf(doc: WorkbenchDoc): WbFileState {
    let st = fileStates.get(doc.id)
    if (!st) {
      fileStates.set(doc.id, {
        status: 'idle',
        content: '',
        saved: '',
        root: rootFor(doc) ?? '',
        base64: '',
        mimeType: '',
        byteSize: 0,
        isBinary: false,
        truncated: false,
        error: '',
        diskChanged: false,
      })
      // reactive(Map).get trả raw object ngay sau .set (Vue collection-proxy quirk)
      // — lấy lại entry để template nhận được proxy và theo dõi được mutation.
      st = fileStates.get(doc.id)!
    }
    return st
  }

  /** Đọc file từ đĩa vào `st` (text → readFile; img/vid → readFileBase64). Ném lỗi
      để caller quyết: lần mở đầu → trạng thái error; nạp lại → toast, giữ nội dung cũ. */
  async function readInto(doc: WorkbenchDoc, r: string, rel: string, st: WbFileState) {
    // Timeout cục bộ — engine.request không có deadline; fs.readFile hang (FS chậm,
    // engine wedged, IPC treo) sẽ spin "Đang tải" mãi. 15s đủ cho file lớn.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(t('workbench.file.timeout'))), 15_000),
    )
    if (doc.kind === 'img' || doc.kind === 'vid') {
      const res = await Promise.race([fs.readFileBase64(r, rel), timeout])
      st.base64 = res.base64
      st.mimeType = res.mimeType
      st.byteSize = res.size
      st.truncated = res.truncated
      st.isBinary = true
    } else {
      const res = await Promise.race([fs.readFile(r, rel), timeout])
      if (res.isBinary) {
        st.isBinary = true
        st.error = t('workbench.file.binary')
      } else {
        st.content = res.content
        st.saved = res.content
        const ext = rel.split('.').pop()?.toLowerCase()
        st.language = res.language ?? (ext ? EXT_LANG[ext] : undefined)
        st.truncated = res.truncated
      }
    }
    st.diskChanged = false
  }

  /** Đọc nội dung/doc (text → readFile; img/vid → readFileBase64). Idempotent. */
  async function ensureFile(doc: WorkbenchDoc): Promise<WbFileState> {
    const st = fileStateOf(doc)
    if (loaded.has(doc.id)) return st
    const inflight = loading.get(doc.id)
    if (inflight) {
      await inflight
      return st
    }
    const job = (async () => {
      const r = rootFor(doc)
      const rel = relPathOf(doc)
      st.root = r ?? ''
      if (!fs.available || !r || !rel) {
        st.status = 'error'
        st.error = fs.available ? t('workbench.file.noRoot') : t('workbench.unavailable')
        return
      }
      st.status = 'loading'
      try {
        await readInto(doc, r, rel, st)
        st.status = 'ok'
      } catch (err) {
        st.status = 'error'
        st.error = sidecarErrorText(err) || t('workbench.file.readFailed')
      }
      // Chỉ đánh dấu loaded khi ĐỌC ĐƯỢC — lỗi (ENOENT, timeout, socket deny) phải
      // cho phép retry lần mở sau, không kẹt ở trạng thái lỗi.
      if (st.status === 'ok') loaded.add(doc.id)
    })()
    loading.set(doc.id, job)
    try {
      await job
    } finally {
      loading.delete(doc.id)
    }
    return st
  }

  /** Nút "Nạp lại": đọc lại file từ đĩa, KHÔNG qua trạng thái 'loading' (giữ
      editor/preview đang hiện, không nháy). Có sửa chưa lưu → hỏi trước vì nạp
      lại là bỏ chúng. Trả true khi đã nạp — caller đồng bộ model Monaco. */
  async function reloadFile(doc: WorkbenchDoc): Promise<boolean> {
    const st = fileStateOf(doc)
    const r = st.root || rootFor(doc)
    const rel = relPathOf(doc)
    if (!fs.available || !r || !rel) return false
    if (st.status === 'ok' && st.content !== st.saved) {
      const ok = await confirm({
        title: t('workbench.file.reloadDirtyTitle'),
        description: t('workbench.file.reloadDirtyDesc', { name: doc.title }),
        confirmLabel: t('workbench.file.reloadDirtyConfirm'),
        kind: 'danger',
      })
      if (!ok) return false
    }
    try {
      await readInto(doc, r, rel, st)
    } catch (err) {
      toast.add({
        title: t('workbench.file.reloadFailed'),
        description: sidecarErrorText(err),
        color: 'error',
      })
      return false
    }
    st.root = r
    st.status = 'ok'
    loaded.add(doc.id)
    wb.markDirty(doc.id, false)
    return true
  }

  /** So nội dung trên đĩa với `saved` → bật/tắt `diskChanged`. Chỉ text doc đã nạp. */
  async function checkDisk(doc: WorkbenchDoc): Promise<void> {
    if (!TEXT_KINDS[doc.kind]) return
    const st = fileStates.get(doc.id)
    if (!st || st.status !== 'ok' || st.isBinary || checking.has(doc.id)) return
    const r = st.root || rootFor(doc)
    const rel = relPathOf(doc)
    if (!fs.available || !r || !rel) return
    checking.add(doc.id)
    try {
      const res = await fs.readFile(r, rel)
      // Doc đã đóng / đã nạp lại trong lúc đọc → kết quả này cũ.
      if (fileStates.get(doc.id) !== st || st.status !== 'ok') return
      st.diskChanged = res.isBinary || res.content !== st.saved
    } catch {
      // Dò nền: file vừa bị xoá/engine bận thì không đổi cờ — lỗi thật hiện ra
      // khi người dùng bấm nạp lại (reloadFile toast lỗi đọc).
    } finally {
      checking.delete(doc.id)
    }
  }

  if (!diskWatchInstalled && typeof window !== 'undefined') {
    diskWatchInstalled = true
    effectScope(true).run(() => {
      // Watcher của explorer (fs.watch project root) phát fs:changed với path
      // tương đối — khớp doc đang mở thì dò lại nội dung (text) hoặc bật cờ
      // thẳng (img/vid: không so được nội dung, và app không tự ghi media nên
      // event nào cũng là thay đổi từ ngoài).
      if (sc.available) {
        void sc
          .onEvent((evt) => {
            if (evt.type !== 'fs:changed') return
            const p = evt.payload as { workspaceRoot?: string; paths?: unknown } | null
            if (!p?.workspaceRoot || !Array.isArray(p.paths)) return
            const changed = new Set(p.paths)
            for (const d of wb.docs) {
              const st = fileStates.get(d.id)
              const docRoot = st?.root || rootFor(d)
              if (docRoot !== p.workspaceRoot || !changed.has(relPathOf(d))) continue
              if (TEXT_KINDS[d.kind]) void checkDisk(d)
              else if ((d.kind === 'img' || d.kind === 'vid') && st?.status === 'ok') {
                st.diskChanged = true
              }
            }
          })
          .catch(() => {})
      }
      // Doc ngoài root đang watch (doc 'abs:', project khác) không có event — dò
      // khi tab được chọn và khi cửa sổ lấy lại focus (vừa sửa ở app khác về).
      const checkActive = () => {
        const d = wb.docs.find((x) => x.id === wb.activeDoc)
        if (d) void checkDisk(d)
      }
      watch(() => wb.activeDoc, checkActive)
      window.addEventListener('focus', checkActive)
    })
  }

  /** Báo nội dung thay đổi từ editor: cập nhật cache + cờ dirty của tab. */
  function markEdit(doc: WorkbenchDoc, value: string): void {
    const st = fileStates.get(doc.id)
    if (st) st.content = value
    wb.markDirty(doc.id, value !== (st?.saved ?? ''))
  }

  /** ⌘S / nút Save — fs.writeFile rồi re-baseline dirty. */
  async function saveFile(doc: WorkbenchDoc): Promise<void> {
    const st = fileStates.get(doc.id)
    const r = st?.root || rootFor(doc)
    if (!st || !r || st.isBinary) return
    try {
      await fs.writeFile(r, relPathOf(doc), st.content)
      st.saved = st.content
      wb.markDirty(doc.id, false)
      toast.add({ title: t('workbench.file.saved', { name: doc.title }), color: 'success' })
    } catch (err) {
      const msg = err instanceof Error && err.message ? err.message : t('workbench.file.saveFailed')
      toast.add({ title: msg, color: 'error' })
    }
  }

  // ── Close flows ─────────────────────────────────────────────────────────────
  /** Đóng doc an toàn: dirty → hỏi trước; web → đóng luôn tab native của agent
      (parity prototype: đóng tab web = đóng luôn tab của agent). */
  async function requestCloseDoc(doc: WorkbenchDoc): Promise<boolean> {
    if (doc.pin) return false
    if (doc.dirty) {
      const ok = await confirm({
        title: t('workbench.close.dirtyTitle'),
        description: t('workbench.close.dirtyDesc', { name: doc.title }),
        confirmLabel: t('workbench.close.dirtyDiscard'),
        kind: 'danger',
      })
      if (!ok) return false
    }
    if (doc.kind === 'web' && doc.browId) {
      void browserApi()
        ?.closeTab(doc.browId)
        .catch(() => {})
    }
    wb.closeDoc(doc.id)
    fileStates.delete(doc.id)
    loaded.delete(doc.id)
    return true
  }

  /** Đóng các doc trong `ids` — dirty docs hỏi lần lượt (bỏ qua = giữ tab). */
  async function requestCloseMany(ids: string[]): Promise<void> {
    for (const id of ids) {
      const doc = wb.docs.find((d) => d.id === id)
      if (doc) await requestCloseDoc(doc)
    }
  }

  /** Ghim/bỏ ghim: tab ghim dồn về đầu dải (đúng prototype). */
  function togglePinDoc(doc: WorkbenchDoc): void {
    if (doc.id === 'chat') return // Trao đổi là cố định — không bỏ ghim được.
    doc.pin = !doc.pin
    wb.reorderPinned()
  }

  /** Cập nhật meta doc (title/nav/viewState/…) — action của composable để
      component không phải mutate prop trực tiếp. */
  function updateDocMeta(doc: WorkbenchDoc, patch: Partial<WorkbenchDoc>): void {
    Object.assign(doc, patch)
  }

  // State của file docs mồ côi (doc bị evict/đóng bằng đường khác) — một lần
  // đăng ký trên effect scope của caller đầu tiên.
  let watchInstalled = false
  if (!watchInstalled) {
    watchInstalled = true
    watch(
      () => wb.docs.map((d) => d.id).join('\n'),
      () => {
        const alive = new Set(wb.docs.map((d) => d.id))
        for (const id of fileStates.keys()) {
          if (!alive.has(id)) {
            fileStates.delete(id)
            loaded.delete(id)
          }
        }
      },
    )
  }

  return {
    // context
    project,
    allProjects: computed(() => (git.projects.length ? git.projects : projectsStore.projects)),
    root,
    rootFor,
    relPathOf,
    absPathOf,
    // openers
    openFile,
    openFileAbs,
    openDiff,
    openWebTab,
    openNewWebDoc,
    // files
    fileStateOf,
    ensureFile,
    reloadFile,
    markEdit,
    saveFile,
    // close + pin
    requestCloseDoc,
    requestCloseMany,
    togglePinDoc,
    updateDocMeta,
  }
}
